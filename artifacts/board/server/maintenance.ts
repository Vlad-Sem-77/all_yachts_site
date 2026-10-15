import { and, eq, gte, isNotNull, isNull, lte, or, lt } from "drizzle-orm";
import type { Logger } from "pino";
import { boatCategories, boatListings, db } from "@workspace/db";
import { getSiteConfig } from "./site-config";
import { sendListingExpiryReminder, smtpConfigured } from "./email";

const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

export async function runMaintenance(logger: Logger): Promise<void> {
  const now = new Date();
  const expired = await db
    .update(boatListings)
    .set({ status: "expired", updatedAt: now })
    .where(and(
      eq(boatListings.status, "active"),
      isNotNull(boatListings.expiresAt),
      lte(boatListings.expiresAt, now),
    ))
    .returning({ id: boatListings.id });

  if (expired.length) {
    logger.info({ count: expired.length }, "Expired active listings");
  }
  if (!smtpConfigured()) {
    return;
  }
  const config = await getSiteConfig();
  if (!config.siteUrl) {
    logger.warn("SMTP is configured but SITE_URL is missing; expiry reminders are paused");
    return;
  }
  const reminderDeadline = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const staleClaim = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const due = await db
    .select({
      id: boatListings.id,
      slug: boatListings.slug,
      title: boatListings.title,
      email: boatListings.email,
      expiresAt: boatListings.expiresAt,
      categoryId: boatListings.categoryId,
    })
    .from(boatListings)
    .where(and(
      eq(boatListings.status, "active"),
      isNotNull(boatListings.expiresAt),
      isNotNull(boatListings.email),
      gte(boatListings.expiresAt, now),
      lte(boatListings.expiresAt, reminderDeadline),
      isNull(boatListings.reminderSentAt),
      or(isNull(boatListings.reminderClaimedAt), lt(boatListings.reminderClaimedAt, staleClaim)),
    ))
    .limit(100);

  for (const listing of due) {
    if (!listing.slug || !listing.email || !listing.expiresAt) continue;
    const [claimed] = await db
      .update(boatListings)
      .set({ reminderClaimedAt: now })
      .where(and(
        eq(boatListings.id, listing.id),
        eq(boatListings.status, "active"),
        isNull(boatListings.reminderSentAt),
        or(isNull(boatListings.reminderClaimedAt), lt(boatListings.reminderClaimedAt, staleClaim)),
      ))
      .returning({ id: boatListings.id });
    if (!claimed) continue;

    const [category] = await db
      .select({
        slug: boatCategories.slug,
        parentId: boatCategories.parentId,
      })
      .from(boatCategories)
      .where(eq(boatCategories.id, listing.categoryId))
      .limit(1);
    try {
      if (!category) throw new Error("Listing category is missing.");
      const categoryRows = category.parentId
        ? await db.select({ slug: boatCategories.slug })
          .from(boatCategories)
          .where(eq(boatCategories.id, category.parentId))
          .limit(1)
        : [];
      const pathSlug = categoryRows[0]?.slug ?? category.slug;
      const detailUrl = `${config.siteUrl}/category/${pathSlug}/${listing.slug}`;
      const manageUrl = `${config.siteUrl}/listing/${listing.slug}/manage`;
      await sendListingExpiryReminder(
        listing.email,
        listing.title,
        listing.expiresAt,
        detailUrl,
        manageUrl,
      );
      await db.update(boatListings)
        .set({ reminderSentAt: new Date(), reminderClaimedAt: null })
        .where(eq(boatListings.id, listing.id));
      logger.info({ listingId: listing.id }, "Listing expiry reminder sent");
    } catch {
      await db.update(boatListings)
        .set({ reminderClaimedAt: null })
        .where(eq(boatListings.id, listing.id));
      logger.error({ listingId: listing.id }, "Listing expiry reminder failed");
    }
  }
}

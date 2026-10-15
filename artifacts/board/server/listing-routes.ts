import bcrypt from "bcryptjs";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  boatCategories,
  boatListings,
  db,
  listingAuthorAttempts,
  listingCaptchaChallenges,
  listingPasswordResetTokens,
  listingPhotos,
  listingRateLimitEvents,
  listingReports,
  listingViewEvents,
} from "@workspace/db";
import {
  allowRateLimitedAction,
  clearAuthorFailures,
  createAuthorAccessToken,
  createCsrfToken,
  createOpaqueToken,
  getAuthorLock,
  getIpHash,
  hashSecret,
  rateLimitLockKey,
  recordAuthorFailure,
  validFormRequest,
  verifyAuthorAccessToken,
} from "./security";
import { messages, t } from "./localization";
import { getCategoryOptions } from "./form-routes";
import { renderPage } from "./view";
import { validateBoatListing } from "./listing-validation";
import { deletePrivateObject, getPrivateObjectFile } from "./object-storage";
import { passwordResetEmailEnabled } from "./email";

const router = Router();
const AUTHOR_COOKIE = "boat_author_access";
const reportReasons = new Set([
  "fraud",
  "wrongCategory",
  "prohibited",
  "duplicate",
  "other",
]);
const categoryFields = new Set([
  "maloletnie-suda",
  "motornye-lodki",
  "katera-kayutnye",
  "katera-otkrytye",
  "motornye-yakhty",
  "parusnye-yakhty",
]);

type SafeListingCard = {
  id: number;
  slug: string | null;
  title: string;
  price: number | null;
  currency: string;
  isNegotiable: boolean;
  country: string;
  cityOrRegion: string;
  categoryPath: string;
  thumbnailUrl: string | null;
};

async function getFooterCategories() {
  return db
    .select({
      id: boatCategories.id,
      slug: boatCategories.slug,
      nameRu: boatCategories.nameRu,
    })
    .from(boatCategories)
    .where(and(eq(boatCategories.isActive, true), isNull(boatCategories.parentId)))
    .orderBy(boatCategories.sortOrder, boatCategories.id);
}

export async function getListingCards(
  categoryIds: number[],
  exceptId?: number,
  limit = 4,
): Promise<SafeListingCard[]> {
  const filters = [
    inArray(boatListings.categoryId, categoryIds),
    eq(boatListings.status, "active"),
  ];
  if (exceptId !== undefined) filters.push(sql`${boatListings.id} <> ${exceptId}`);
  const listings = await db
    .select({
      id: boatListings.id,
      slug: boatListings.slug,
      categoryId: boatListings.categoryId,
      title: boatListings.title,
      price: boatListings.price,
      currency: boatListings.currency,
      isNegotiable: boatListings.isNegotiable,
      country: boatListings.country,
      cityOrRegion: boatListings.cityOrRegion,
    })
    .from(boatListings)
    .where(and(...filters))
    .orderBy(desc(boatListings.isFeatured), desc(boatListings.priority), desc(boatListings.createdAt))
    .limit(limit);
  if (!listings.length) return [];

  const categoryRows = await db
    .select({
      id: boatCategories.id,
      slug: boatCategories.slug,
      parentId: boatCategories.parentId,
    })
    .from(boatCategories)
    .where(inArray(boatCategories.id, [...new Set(listings.map((item) => item.categoryId))]));
  const parents = categoryRows.some((item) => item.parentId !== null)
    ? await db
        .select({ id: boatCategories.id, slug: boatCategories.slug })
        .from(boatCategories)
        .where(
          inArray(
            boatCategories.id,
            categoryRows.flatMap((item) => (item.parentId === null ? [] : [item.parentId])),
          ),
        )
    : [];
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  const parentById = new Map(parents.map((row) => [row.id, row]));
  const photos = await db
    .select({
      id: listingPhotos.id,
      listingId: listingPhotos.listingId,
      sortOrder: listingPhotos.sortOrder,
      isPrimary: listingPhotos.isPrimary,
    })
    .from(listingPhotos)
    .where(inArray(listingPhotos.listingId, listings.map((item) => item.id)))
    .orderBy(desc(listingPhotos.isPrimary), listingPhotos.sortOrder, listingPhotos.id);
  const photoByListing = new Map<number, number>();
  for (const photo of photos) {
    if (!photoByListing.has(photo.listingId)) photoByListing.set(photo.listingId, photo.id);
  }

  return listings.map((listing) => {
    const category = categoryById.get(listing.categoryId);
    const parent = category?.parentId ? parentById.get(category.parentId) : null;
    return {
      ...listing,
      categoryPath: parent?.slug ?? category?.slug ?? "boats",
      thumbnailUrl: photoByListing.has(listing.id)
        ? `/media/${photoByListing.get(listing.id)}/thumb`
        : null,
    };
  });
}

function formatPrice(
  price: number | null,
  currency: string,
  isNegotiable: boolean,
): string {
  if (price === null || isNegotiable) return t("listing.negotiable");
  const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(price);
  const symbols: Record<string, string> = {
    RUB: "₽",
    USD: "$",
    EUR: "€",
    GBP: "£",
  };
  return `${amount} ${symbols[currency] ?? currency}`;
}

async function getActiveListingBySlug(slug: string) {
  const [listing] = await db
    .select({
      id: boatListings.id,
      categoryId: boatListings.categoryId,
      slug: boatListings.slug,
      title: boatListings.title,
      description: boatListings.description,
      price: boatListings.price,
      currency: boatListings.currency,
      isNegotiable: boatListings.isNegotiable,
      priceUnit: boatListings.priceUnit,
      transactionType: boatListings.transactionType,
      year: boatListings.year,
      lengthM: boatListings.lengthM,
      widthM: boatListings.widthM,
      manufacturer: boatListings.manufacturer,
      model: boatListings.model,
      engineType: boatListings.engineType,
      enginePowerHp: boatListings.enginePowerHp,
      engineHours: boatListings.engineHours,
      condition: boatListings.condition,
      country: boatListings.country,
      cityOrRegion: boatListings.cityOrRegion,
      waterArea: boatListings.waterArea,
      contactName: boatListings.contactName,
      status: boatListings.status,
      viewCount: boatListings.viewCount,
      createdAt: boatListings.createdAt,
      expiresAt: boatListings.expiresAt,
    })
    .from(boatListings)
    .where(and(eq(boatListings.slug, slug), eq(boatListings.status, "active")))
    .limit(1);
  return listing;
}

async function renderListing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const slug = String(req.params.slug);
  const listing = await getActiveListingBySlug(slug);
  if (!listing) {
    next();
    return;
  }
  const [category] = await db
    .select()
    .from(boatCategories)
    .where(eq(boatCategories.id, listing.categoryId))
    .limit(1);
  if (!category) {
    next();
    return;
  }
  const parent = category.parentId
    ? (
        await db
          .select({ slug: boatCategories.slug, nameRu: boatCategories.nameRu })
          .from(boatCategories)
          .where(eq(boatCategories.id, category.parentId))
          .limit(1)
      )[0]
    : null;
  const routeCategorySlug = parent?.slug ?? category.slug;
  if (routeCategorySlug !== req.params.parentSlug) {
    next();
    return;
  }

  const ipHash = getIpHash(req);
  const userAgent = req.get("user-agent") ?? "";
  if (!/(bot|crawler|spider|preview|slurp|fetch)/i.test(userAgent)) {
    const viewDate = new Date().toISOString().slice(0, 10);
    const [newView] = await db
      .insert(listingViewEvents)
      .values({
        listingId: listing.id,
        viewerHash: ipHash,
        viewDate,
      })
      .onConflictDoNothing()
      .returning({ id: listingViewEvents.id });
    if (newView) {
      await db
        .update(boatListings)
        .set({ viewCount: sql`${boatListings.viewCount} + 1` })
        .where(eq(boatListings.id, listing.id));
      listing.viewCount += 1;
    }
  }

  const [photos, similar, footerCategories] = await Promise.all([
    db
      .select({
        id: listingPhotos.id,
        altText: listingPhotos.altText,
        sortOrder: listingPhotos.sortOrder,
        isPrimary: listingPhotos.isPrimary,
      })
      .from(listingPhotos)
      .where(eq(listingPhotos.listingId, listing.id))
      .orderBy(desc(listingPhotos.isPrimary), listingPhotos.sortOrder, listingPhotos.id),
    getListingCards([listing.categoryId], listing.id, 4),
    getFooterCategories(),
  ]);
  const conditions = {
    new: t("listing.conditionNew"),
    used: t("listing.conditionUsed"),
  } as Record<string, string>;
  const isPublishedNotice = req.query.published === "1";

  await renderPage(res, "listing", {
    categories: footerCategories,
    listing,
    category,
    parent,
    categoryPath: routeCategorySlug,
    photos: photos.map((photo) => ({
      ...photo,
      altText: photo.altText || listing.title,
      url: `/media/${photo.id}/full`,
      thumbnailUrl: `/media/${photo.id}/thumb`,
    })),
    similar,
    csrf: createCsrfToken(),
    publishedNotice: isPublishedNotice,
    reportedNotice: req.query.reported === "1",
    updatedNotice: req.query.updated === "1",
    conditions,
    formatPrice,
    title: `${listing.title} | ${messages.brand.name}`,
    description: listing.description.slice(0, 180),
  });
}

router.get("/category/:parentSlug/:slug", renderListing);

router.get("/media/:photoId/:variant", async (req, res, next) => {
  const photoId = Number(req.params.photoId);
  const variant = req.params.variant;
  if (!Number.isInteger(photoId) || !["full", "thumb"].includes(variant)) {
    res.sendStatus(404);
    return;
  }
  const [row] = await db
    .select({
      objectKey: listingPhotos.objectKey,
      thumbnailKey: listingPhotos.thumbnailKey,
      status: boatListings.status,
    })
    .from(listingPhotos)
    .innerJoin(boatListings, eq(listingPhotos.listingId, boatListings.id))
    .where(eq(listingPhotos.id, photoId))
    .limit(1);
  if (!row || row.status !== "active") {
    res.sendStatus(404);
    return;
  }
  const objectPath = variant === "thumb" ? row.thumbnailKey ?? row.objectKey : row.objectKey;
  try {
    const file = await getPrivateObjectFile(objectPath);
    res.set({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    file.createReadStream().on("error", next).pipe(res);
  } catch (error) {
    next(error);
  }
});

router.post("/phone/:slug", async (req, res) => {
  if (!validFormRequest(req)) {
    res.status(403).json({ error: t("formErrors.csrf") });
    return;
  }
  const ipHash = getIpHash(req);
  if (!(await allowRateLimitedAction("phone-reveal", ipHash, 30, 60 * 60 * 1000))) {
    res.status(429).json({ error: t("formErrors.rateLimit") });
    return;
  }
  const [listing] = await db
    .select({ contactPhone: boatListings.contactPhone })
    .from(boatListings)
    .where(and(eq(boatListings.slug, req.params.slug), eq(boatListings.status, "active")))
    .limit(1);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  res.set("Cache-Control", "no-store").json({ phone: listing.contactPhone });
});

router.post("/listing/:slug/report", async (req, res) => {
  if (!validFormRequest(req)) {
    res.sendStatus(403);
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (typeof body.website === "string" && body.website.trim()) {
    res.sendStatus(400);
    return;
  }
  const reason = typeof body.reason === "string" ? body.reason : "";
  const details = typeof body.details === "string" ? body.details.trim() : "";
  if (!reportReasons.has(reason) || details.length > 1000) {
    res.status(400).send(t("formErrors.generic"));
    return;
  }
  const [listing] = await db
    .select({
      id: boatListings.id,
      categoryId: boatListings.categoryId,
    })
    .from(boatListings)
    .where(and(eq(boatListings.slug, req.params.slug), eq(boatListings.status, "active")))
    .limit(1);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  const ipHash = getIpHash(req);
  if (
    !(await allowRateLimitedAction(
      `report:${listing.id}`,
      ipHash,
      5,
      24 * 60 * 60 * 1000,
    ))
  ) {
    res.status(429).send(t("formErrors.rateLimit"));
    return;
  }
  await db.insert(listingReports).values({
    listingId: listing.id,
    reason,
    details: details || null,
  });
  const categoryPath = await getListingCategoryPath(listing.categoryId);
  res.redirect(303, `/category/${categoryPath}/${req.params.slug}?reported=1#report`);
});

function setAuthorCookie(res: Response, token: string): void {
  res.cookie(AUTHOR_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 60 * 1000,
    path: "/listing/",
  });
}

function hasAuthorAccess(req: Request, listingId: number): boolean {
  return verifyAuthorAccessToken(req.cookies?.[AUTHOR_COOKIE], listingId);
}

async function getFullActiveListing(slug: string) {
  const [listing] = await db
    .select()
    .from(boatListings)
    .where(and(eq(boatListings.slug, slug), eq(boatListings.status, "active")))
    .limit(1);
  return listing;
}

async function renderManagePage(
  req: Request,
  res: Response,
  listing: Awaited<ReturnType<typeof getFullActiveListing>>,
  error: string | null = null,
  status = 200,
): Promise<void> {
  if (!listing) {
    await renderPage(res, "not-found", {
      categories: await getFooterCategories(),
      title: t("detail.notFoundTitle"),
      heading: t("detail.notFoundTitle"),
      message: t("detail.notFoundDescription"),
    }, 404);
    return;
  }
  const authenticated = hasAuthorAccess(req, listing.id);
  await renderPage(res, "manage", {
    categories: await getFooterCategories(),
    listing: {
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      categoryPath: await getListingCategoryPath(listing.categoryId),
    },
    authenticated,
    renewed: req.query.renewed === "1",
    csrf: createCsrfToken(),
    error,
    title: `${t("detail.manageTitle")} | ${messages.brand.name}`,
    description: t("detail.manageAccessRequired"),
  }, status);
}

router.get("/listing/:slug/manage", async (req, res) => {
  await renderManagePage(req, res, await getFullActiveListing(req.params.slug));
});

router.post("/listing/:slug/manage", async (req, res) => {
  const listing = await getFullActiveListing(req.params.slug);
  if (!listing) {
    await renderManagePage(req, res, listing);
    return;
  }
  if (!validFormRequest(req)) {
    await renderManagePage(req, res, listing, t("formErrors.csrf"), 403);
    return;
  }
  const ipHash = getIpHash(req);
  const lockUntil = await getAuthorLock(listing.id, ipHash);
  if (lockUntil) {
    await renderManagePage(req, res, listing, t("detail.manageLocked"), 429);
    return;
  }
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const matches = await bcrypt.compare(password, listing.authorPasswordHash);
  if (!matches) {
    const newLock = await recordAuthorFailure(listing.id, ipHash);
    await renderManagePage(
      req,
      res,
      listing,
      newLock ? t("detail.manageLocked") : t("detail.manageWrongPassword"),
      newLock ? 429 : 401,
    );
    return;
  }
  await clearAuthorFailures(listing.id, ipHash);
  setAuthorCookie(res, createAuthorAccessToken(listing.id));
  res.redirect(303, `/listing/${listing.slug}/manage`);
});

router.get("/listing/:slug/edit", async (req, res) => {
  const listing = await getFullActiveListing(req.params.slug);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  if (!hasAuthorAccess(req, listing.id)) {
    res.redirect(303, `/listing/${listing.slug}/manage`);
    return;
  }
  const [categories, footerCategories] = await Promise.all([
    getCategoryOptions(),
    getFooterCategories(),
  ]);
  const countries = messages.submit.countries;
  await renderPage(res, "edit", {
    categories: footerCategories,
    categoryOptions: categories,
    countries,
    footerCategories,
    categoriesForFooter: footerCategories,
    listing,
    values: {},
    csrf: createCsrfToken(),
    error: null,
    title: `${t("detail.editTitle")} | ${messages.brand.name}`,
    description: t("detail.editTitle"),
  });
});

router.post("/listing/:slug/edit", async (req, res) => {
  const listing = await getFullActiveListing(req.params.slug);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  if (!hasAuthorAccess(req, listing.id)) {
    res.redirect(303, `/listing/${listing.slug}/manage`);
    return;
  }
  if (!validFormRequest(req)) {
    res.status(403).send(t("formErrors.csrf"));
    return;
  }
  const body = req.body as Record<string, unknown>;
  const categoryId = Number(body.categoryId);
  const categories = await getCategoryOptions();
  if (!categories.some((item) => item.id === categoryId)) {
    res.status(400).send(t("formErrors.category"));
    return;
  }
  const validation = validateBoatListing(
    { ...body, condition: body.condition || "used" },
    categoryId,
    { requirePassword: false },
  );
  if (!validation.ok) {
    const footerCategories = await getFooterCategories();
    await renderPage(res, "edit", {
      categories: footerCategories,
      categoryOptions: categories,
      countries: messages.submit.countries,
      listing,
      values: body,
      csrf: createCsrfToken(),
      error: t(`formErrors.${validation.errorKey}`),
      title: t("detail.editTitle"),
      description: t("detail.editTitle"),
    }, 400);
    return;
  }
  await db
    .update(boatListings)
    .set({ ...validation.value, updatedAt: new Date() })
    .where(eq(boatListings.id, listing.id));
  res.redirect(303, `/category/${(await getListingCategoryPath(listing.categoryId))}/${listing.slug}?updated=1`);
});

async function getListingCategoryPath(categoryId: number): Promise<string> {
  const [category] = await db
    .select({ slug: boatCategories.slug, parentId: boatCategories.parentId })
    .from(boatCategories)
    .where(eq(boatCategories.id, categoryId))
    .limit(1);
  if (!category?.parentId) return category?.slug ?? "boats";
  const [parent] = await db
    .select({ slug: boatCategories.slug })
    .from(boatCategories)
    .where(eq(boatCategories.id, category.parentId))
    .limit(1);
  return parent?.slug ?? category.slug;
}

router.post("/listing/:slug/renew", async (req, res) => {
  const listing = await getFullActiveListing(req.params.slug);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  if (!validFormRequest(req) || !hasAuthorAccess(req, listing.id)) {
    res.sendStatus(403);
    return;
  }
  await db
    .update(boatListings)
    .set({
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(boatListings.id, listing.id));
  res.redirect(303, `/listing/${listing.slug}/manage?renewed=1`);
});

router.post("/listing/:slug/delete", async (req, res) => {
  const listing = await getFullActiveListing(req.params.slug);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  if (!validFormRequest(req) || !hasAuthorAccess(req, listing.id)) {
    res.sendStatus(403);
    return;
  }
  const photos = await db
    .select({
      objectKey: listingPhotos.objectKey,
      thumbnailKey: listingPhotos.thumbnailKey,
    })
    .from(listingPhotos)
    .where(eq(listingPhotos.listingId, listing.id));
  await db
    .update(boatListings)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(boatListings.id, listing.id));
  await Promise.all(
    photos.flatMap((photo) => [
      deletePrivateObject(photo.objectKey).catch((error) => {
        req.log?.error({ err: error }, "Could not remove deleted listing image");
      }),
      ...(photo.thumbnailKey
        ? [
            deletePrivateObject(photo.thumbnailKey).catch((error) => {
              req.log?.error({ err: error }, "Could not remove deleted listing thumbnail");
            }),
          ]
        : []),
    ]),
  );
  await db.delete(listingPhotos).where(eq(listingPhotos.listingId, listing.id));
  res.clearCookie(AUTHOR_COOKIE, { path: "/listing/" });
  res.redirect(303, "/");
});

router.get("/listing/:slug/forgot-password", async (req, res) => {
  const listing = await getActiveListingBySlug(req.params.slug);
  await renderPage(res, "forgot-password", {
    categories: await getFooterCategories(),
    listingSlug: listing?.slug ?? req.params.slug,
    csrf: createCsrfToken(),
    error: null,
    emailEnabled: passwordResetEmailEnabled,
    notice: passwordResetEmailEnabled ? null : t("detail.resetUnavailable"),
    title: `${t("detail.resetTitle")} | ${messages.brand.name}`,
    description: t("detail.resetRequest"),
  }, listing ? 200 : 404);
});

router.post("/listing/:slug/forgot-password", async (req, res) => {
  const listing = await getFullActiveListing(req.params.slug);
  const footerCategories = await getFooterCategories();
  const genericNotice = t("detail.resetSent");
  const emailEnabled = passwordResetEmailEnabled;
  if (!validFormRequest(req)) {
    await renderPage(res, "forgot-password", {
      categories: footerCategories,
      listingSlug: req.params.slug,
      csrf: createCsrfToken(),
      error: t("formErrors.csrf"),
      notice: null,
      emailEnabled,
      title: t("detail.resetTitle"),
      description: t("detail.resetRequest"),
    }, 403);
    return;
  }
  if (!emailEnabled) {
    await renderPage(res, "forgot-password", {
      categories: footerCategories,
      listingSlug: req.params.slug,
      csrf: createCsrfToken(),
      error: null,
      notice: t("detail.resetUnavailable"),
      emailEnabled,
      title: t("detail.resetTitle"),
      description: t("detail.resetRequest"),
    }, 503);
    return;
  }
  if (
    !(await allowRateLimitedAction(
      "password-reset-request",
      getIpHash(req),
      5,
      60 * 60 * 1000,
    ))
  ) {
    await renderPage(res, "forgot-password", {
      categories: footerCategories,
      listingSlug: req.params.slug,
      csrf: createCsrfToken(),
      error: t("formErrors.rateLimit"),
      notice: null,
      emailEnabled,
      title: t("detail.resetTitle"),
      description: t("detail.resetRequest"),
    }, 429);
    return;
  }
  if (listing?.email) {
    const token = createOpaqueToken();
    const tokenHash = hashSecret(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.transaction(async (tx) => {
      await tx
        .update(listingPasswordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(listingPasswordResetTokens.listingId, listing.id),
            isNull(listingPasswordResetTokens.usedAt),
          ),
        );
      await tx.insert(listingPasswordResetTokens).values({
        listingId: listing.id,
        tokenHash,
        expiresAt,
      });
    });
    const resetUrl = `${req.protocol}://${req.get("host")}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      const { sendPasswordResetEmail } = await import("./email");
      await sendPasswordResetEmail(listing.email, resetUrl);
    } catch (error) {
      await db
        .update(listingPasswordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(listingPasswordResetTokens.tokenHash, tokenHash));
      req.log?.error({ err: error }, "Password reset email could not be sent");
    }
  }
  await renderPage(res, "forgot-password", {
    categories: footerCategories,
    listingSlug: req.params.slug,
    csrf: createCsrfToken(),
    error: null,
    notice: genericNotice,
    emailEnabled,
    title: t("detail.resetTitle"),
    description: t("detail.resetRequest"),
  });
});

router.get("/reset-password", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const [reset] = token
    ? await db
        .select({ listingId: listingPasswordResetTokens.listingId })
        .from(listingPasswordResetTokens)
        .where(
          and(
            eq(listingPasswordResetTokens.tokenHash, hashSecret(token)),
            isNull(listingPasswordResetTokens.usedAt),
            gte(listingPasswordResetTokens.expiresAt, new Date()),
          ),
        )
        .limit(1)
    : [];
  await renderPage(res, "reset-password", {
    categories: await getFooterCategories(),
    token: reset ? token : "",
    csrf: createCsrfToken(),
    error: reset ? null : t("detail.resetInvalid"),
    title: `${t("detail.resetTitle")} | ${messages.brand.name}`,
    description: t("detail.resetTitle"),
  }, reset ? 200 : 400);
});

router.post("/reset-password", async (req, res) => {
  const token = typeof req.body.token === "string" ? req.body.token : "";
  const password = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
  const footerCategories = await getFooterCategories();
  const [reset] = token
    ? await db
        .select()
        .from(listingPasswordResetTokens)
        .where(
          and(
            eq(listingPasswordResetTokens.tokenHash, hashSecret(token)),
            isNull(listingPasswordResetTokens.usedAt),
            gte(listingPasswordResetTokens.expiresAt, new Date()),
          ),
        )
        .limit(1)
    : [];
  const validPassword =
    password.length >= 4 && Buffer.byteLength(password, "utf8") <= 72;
  if (!validFormRequest(req) || !reset || !validPassword) {
    await renderPage(res, "reset-password", {
      categories: footerCategories,
      token: reset ? token : "",
      csrf: createCsrfToken(),
      error: !validPassword
        ? t("formErrors.password")
        : t("detail.resetInvalid"),
      title: t("detail.resetTitle"),
      description: t("detail.resetTitle"),
    }, !validFormRequest(req) ? 403 : 400);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await db.transaction(async (tx) => {
    await tx
      .update(boatListings)
      .set({ authorPasswordHash: passwordHash, updatedAt: new Date() })
      .where(eq(boatListings.id, reset.listingId));
    await tx
      .update(listingPasswordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(listingPasswordResetTokens.listingId, reset.listingId),
          isNull(listingPasswordResetTokens.usedAt),
        ),
      );
    await tx
      .delete(listingAuthorAttempts)
      .where(eq(listingAuthorAttempts.listingId, reset.listingId));
  });
  await renderPage(res, "reset-complete", {
    categories: footerCategories,
    title: t("detail.resetTitle"),
    description: t("detail.resetComplete"),
  });
});

export default router;

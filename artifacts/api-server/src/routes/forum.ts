import { and, eq, isNotNull, or } from "drizzle-orm";
import { Router, type Request } from "express";
import { getAuth } from "@clerk/express";
import {
  boatCategories,
  boatListings,
  db,
  ensureForumSections,
  forumSections,
  forumTopics,
  getOrCreateForumUser,
} from "@workspace/db";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

const router = Router();

function isSameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === getClerkProxyHost(req);
  } catch {
    return false;
  }
}

router.post("/listings/:id/discuss", async (req, res): Promise<void> => {
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: "Недопустимый источник запроса." });
    return;
  }
  const clerkId = getAuth(req).userId;
  if (!clerkId) {
    res.status(401).json({ error: "Войдите, чтобы начать обсуждение." });
    return;
  }
  const user = await getOrCreateForumUser(clerkId);
  if (!user || !user.isActive) {
    res.status(403).json({ error: "Аккаунт не может создавать обсуждения." });
    return;
  }
  const listingId = Number(req.params.id);
  if (!Number.isSafeInteger(listingId) || listingId < 1) {
    res.sendStatus(400);
    return;
  }
  const [listing] = await db
    .select({
      id: boatListings.id,
      title: boatListings.title,
      status: boatListings.status,
      expiresAt: boatListings.expiresAt,
      categoryId: boatCategories.id,
      parentId: boatCategories.parentId,
    })
    .from(boatListings)
    .innerJoin(boatCategories, eq(boatListings.categoryId, boatCategories.id))
    .where(eq(boatListings.id, listingId))
    .limit(1);
  if (
    !listing ||
    listing.status !== "active" ||
    (listing.expiresAt && listing.expiresAt.getTime() <= Date.now())
  ) {
    res.sendStatus(404);
    return;
  }
  await ensureForumSections();
  const rootSectionId = listing.parentId ?? listing.categoryId;
  const [section] = await db
    .select({ id: forumSections.id })
    .from(forumSections)
    .where(and(
      eq(forumSections.siteSectionId, rootSectionId),
      eq(forumSections.kind, "listing"),
    ))
    .limit(1);
  if (!section) {
    res.status(503).json({ error: "Раздел обсуждений ещё не готов." });
    return;
  }
  const [created] = await db
    .insert(forumTopics)
    .values({
      sectionId: section.id,
      listingId: listing.id,
      authorId: user.id,
      title: listing.title.slice(0, 160),
    })
    .onConflictDoNothing({
      target: forumTopics.listingId,
      where: isNotNull(forumTopics.listingId),
    })
    .returning({ id: forumTopics.id });
  const existing = created
    ? null
    : (
        await db
          .select({ id: forumTopics.id })
          .from(forumTopics)
          .where(eq(forumTopics.listingId, listing.id))
          .limit(1)
      )[0] ?? null;
  const topicId = created?.id ?? existing?.id;
  if (!topicId) {
    res.status(500).json({ error: "Не удалось открыть обсуждение." });
    return;
  }
  res.status(created ? 201 : 200).json({
    topicId,
    url: `/forum/topic/${topicId}`,
  });
});

export default router;

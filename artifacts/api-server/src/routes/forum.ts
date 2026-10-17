import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { getAuth } from "@clerk/express";
import {
  boatCategories,
  boatListings,
  db,
  ensureForumSections,
  forumSections,
  forumPosts,
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
    .select({
      id: forumSections.id,
      rateLimitSec: forumSections.rateLimitSec,
    })
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
  const [alreadyExists] = await db.select({ id: forumTopics.id })
    .from(forumTopics).where(eq(forumTopics.listingId, listing.id)).limit(1);
  if (alreadyExists) {
    res.json({ topicId: alreadyExists.id, url: `/forum/topic/${alreadyExists.id}` });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const lockKey = (section.id * 2_147_483 + user.id) | 0;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    const [existingAfterLock] = await tx.select({ id: forumTopics.id })
      .from(forumTopics).where(eq(forumTopics.listingId, listing.id)).limit(1);
    if (existingAfterLock) return { id: existingAfterLock.id, created: false, limited: false };
    if (section.rateLimitSec > 0) {
      const cutoff = new Date(Date.now() - section.rateLimitSec * 1000);
      const [recentTopic] = await tx.select({ id: forumTopics.id })
        .from(forumTopics)
        .where(and(
          eq(forumTopics.authorId, user.id),
          eq(forumTopics.sectionId, section.id),
          gte(forumTopics.createdAt, cutoff),
        )).limit(1);
      const [recentPost] = await tx.select({ id: forumPosts.id })
        .from(forumPosts)
        .innerJoin(forumTopics, eq(forumPosts.topicId, forumTopics.id))
        .where(and(
          eq(forumPosts.authorId, user.id),
          eq(forumTopics.sectionId, section.id),
          gte(forumPosts.createdAt, cutoff),
        )).limit(1);
      if (recentTopic || recentPost) return { id: null, created: false, limited: true };
    }
    const [created] = await tx
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
    return created
      ? { id: created.id, created: true, limited: false }
      : { id: null, created: false, limited: false };
  });
  if (result.limited) {
    res.status(429).json({ error: "Подождите перед созданием следующего обсуждения." });
    return;
  }
  const existing = result.id
    ? null
    : (
        await db
          .select({ id: forumTopics.id })
          .from(forumTopics)
          .where(eq(forumTopics.listingId, listing.id))
          .limit(1)
      )[0] ?? null;
  const topicId = result.id ?? existing?.id;
  if (!topicId) {
    res.status(500).json({ error: "Не удалось открыть обсуждение." });
    return;
  }
  res.status(result.created ? 201 : 200).json({
    topicId,
    url: `/forum/topic/${topicId}`,
  });
});

export default router;

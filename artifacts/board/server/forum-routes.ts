import {
  and,
  count,
  desc,
  eq,
  gte,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  boatCategories,
  boatListings,
  db,
  forumPosts,
  forumReports,
  forumSectionBans,
  forumSections,
  forumTopics,
  forumUsers,
  getOrCreateForumUser,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import { hasAdminSession } from "./admin-auth";
import { createCsrfToken, validFormRequest } from "./security";
import { renderPage } from "./view";

const router = Router();
const badWords = [
  /(?:^|[^\p{L}\p{N}_])(?:хуй|хуя|хуе|хуи|пизд|еб[а-яё]*|ёб[а-яё]*|бля[а-яё]*|муд[а-яё]*|гандон[а-яё]*)(?=$|[^\p{L}\p{N}_])/iu,
];
const strictWords = [
  ...badWords,
  /(?:^|[^\p{L}\p{N}_])(?:чурк|ниггер|фашист|убей|сдохни)(?=$|[^\p{L}\p{N}_])/iu,
];

function clean(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max)
    : "";
}

function hasFilteredWords(value: string, section: typeof forumSections.$inferSelect): boolean {
  if (!section.censored) return false;
  const filters = section.kind === "offtopic" ? strictWords : badWords;
  return filters.some((pattern) => pattern.test(value));
}

async function currentUser(req: Request) {
  const clerkId = getAuth(req).userId;
  return clerkId ? getOrCreateForumUser(clerkId) : null;
}

function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/forum";
}

async function requireUser(req: Request, res: Response) {
  const user = await currentUser(req);
  if (!user) {
    const next = encodeURIComponent(req.originalUrl.split("?")[0]);
    res.redirect(303, `/sign-in?next=${next}`);
    return null;
  }
  if (!user.isActive) {
    res.status(403).send("Аккаунт ограничен.");
    return null;
  }
  return user;
}

function canModerate(req: Request, user: Awaited<ReturnType<typeof currentUser>>): boolean {
  return hasAdminSession(req) || user?.role === "moderator" || user?.role === "admin";
}

function requireCsrf(req: Request, res: Response): boolean {
  if (validFormRequest(req)) return true;
  res.status(403).send("Проверка формы не пройдена. Обновите страницу и попробуйте снова.");
  return false;
}

async function postWithRateLimit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
  section: typeof forumSections.$inferSelect,
  topicId: number,
  body: string,
) {
  const seconds = section.rateLimitSec;
  if (seconds > 0) {
    const lockKey = (section.id * 2_147_483 + userId) | 0;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    const cutoff = new Date(Date.now() - seconds * 1000);
    const [recentPost] = await tx
      .select({ createdAt: forumPosts.createdAt })
      .from(forumPosts)
      .innerJoin(forumTopics, eq(forumPosts.topicId, forumTopics.id))
      .where(and(
        eq(forumPosts.authorId, userId),
        eq(forumTopics.sectionId, section.id),
        gte(forumPosts.createdAt, cutoff),
      ))
      .limit(1);
    const [recentTopic] = await tx
      .select({ createdAt: forumTopics.createdAt })
      .from(forumTopics)
      .where(and(
        eq(forumTopics.authorId, userId),
        eq(forumTopics.sectionId, section.id),
        gte(forumTopics.createdAt, cutoff),
      ))
      .limit(1);
    if (recentPost || recentTopic) return false;
  }
  await tx.insert(forumPosts).values({ topicId, authorId: userId, body });
  await tx.update(forumTopics).set({ updatedAt: new Date() }).where(eq(forumTopics.id, topicId));
  return true;
}

router.get("/sign-in", async (req, res) => {
  await renderPage(res, "forum-auth", {
    mode: "sign-in",
    next: safeNext(clean(req.query.next, 500)),
    title: "Вход в аккаунт",
    description: "Войдите, чтобы участвовать в обсуждениях.",
    robots: "noindex, nofollow",
  });
});
router.get("/sign-up", async (req, res) => {
  await renderPage(res, "forum-auth", {
    mode: "sign-up",
    next: safeNext(clean(req.query.next, 500)),
    title: "Регистрация",
    description: "Создайте аккаунт, чтобы участвовать в обсуждениях.",
    robots: "noindex, nofollow",
  });
});
router.get("/sign-out", async (_req, res) => {
  await renderPage(res, "forum-auth", {
    mode: "sign-out",
    title: "Выход",
    description: "Выход из аккаунта.",
    robots: "noindex, nofollow",
  });
});

router.get("/forum", async (_req, res) => {
  const sections = await db
    .select({
      id: forumSections.id,
      slug: forumSections.slug,
      title: forumSections.title,
      kind: forumSections.kind,
      sortOrder: forumSections.sortOrder,
      topicCount: count(forumTopics.id),
    })
    .from(forumSections)
    .leftJoin(forumTopics, eq(forumTopics.sectionId, forumSections.id))
    .groupBy(forumSections.id)
    .orderBy(forumSections.sortOrder, forumSections.id);
  await renderPage(res, "forum-sections", {
    sections,
    title: "Форум лодочников",
    description: "Обсуждения объявлений и вопросы владельцев водной техники.",
    robots: "index, follow",
  });
});

router.get("/forum/:sectionSlug", async (req, res, next) => {
  if (req.params.sectionSlug === "topic" || req.params.sectionSlug === "moderation") {
    next();
    return;
  }
  const [section] = await db.select().from(forumSections).where(eq(forumSections.slug, req.params.sectionSlug)).limit(1);
  if (!section) { next(); return; }
  const topics = await db
    .select({
      id: forumTopics.id,
      title: forumTopics.title,
      listingId: forumTopics.listingId,
      isLocked: forumTopics.isLocked,
      isPinned: forumTopics.isPinned,
      updatedAt: forumTopics.updatedAt,
      author: forumUsers.displayName,
      postCount: count(forumPosts.id),
    })
    .from(forumTopics)
    .innerJoin(forumUsers, eq(forumTopics.authorId, forumUsers.id))
    .leftJoin(forumPosts, and(eq(forumPosts.topicId, forumTopics.id), eq(forumPosts.status, "visible")))
    .where(eq(forumTopics.sectionId, section.id))
    .groupBy(forumTopics.id, forumUsers.displayName)
    .orderBy(desc(forumTopics.isPinned), desc(forumTopics.updatedAt));
  await renderPage(res, "forum-topics", {
    section,
    topics,
    csrf: createCsrfToken(),
    title: `${section.title} — форум`,
    description: `Темы раздела «${section.title}».`,
    robots: "index, follow",
  });
});

router.get("/forum/topic/:topicId", async (req, res, next) => {
  const topicId = Number(req.params.topicId);
  if (!Number.isSafeInteger(topicId) || topicId < 1) { next(); return; }
  const [topic] = await db
    .select({
      id: forumTopics.id,
      title: forumTopics.title,
      listingId: forumTopics.listingId,
      isLocked: forumTopics.isLocked,
      isPinned: forumTopics.isPinned,
      sectionId: forumTopics.sectionId,
      sectionSlug: forumSections.slug,
      sectionTitle: forumSections.title,
      kind: forumSections.kind,
      censored: forumSections.censored,
      rateLimitSec: forumSections.rateLimitSec,
      listingSlug: boatListings.slug,
      listingCategoryId: boatListings.categoryId,
      listingTitle: boatListings.title,
    })
    .from(forumTopics)
    .innerJoin(forumSections, eq(forumTopics.sectionId, forumSections.id))
    .leftJoin(boatListings, eq(forumTopics.listingId, boatListings.id))
    .where(eq(forumTopics.id, topicId))
    .limit(1);
  if (!topic) { next(); return; }
  let listingUrl: string | null = null;
  if (topic.listingSlug && topic.listingCategoryId) {
    const [category] = await db.select().from(boatCategories).where(eq(boatCategories.id, topic.listingCategoryId)).limit(1);
    const [parent] = category?.parentId
      ? await db.select({ slug: boatCategories.slug }).from(boatCategories).where(eq(boatCategories.id, category.parentId)).limit(1)
      : [];
    listingUrl = `/category/${parent?.slug ?? category?.slug}/${topic.listingSlug}`;
  }
  const posts = await db
    .select({
      id: forumPosts.id,
      body: forumPosts.body,
      status: forumPosts.status,
      createdAt: forumPosts.createdAt,
      authorId: forumPosts.authorId,
      author: forumUsers.displayName,
      authorRole: forumUsers.role,
    })
    .from(forumPosts)
    .innerJoin(forumUsers, eq(forumPosts.authorId, forumUsers.id))
    .where(eq(forumPosts.topicId, topicId))
    .orderBy(forumPosts.createdAt, forumPosts.id);
  const viewer = await currentUser(req);
  await renderPage(res, "forum-topic", {
    topic,
    posts: posts.filter((post) => post.status === "visible" || canModerate(req, viewer)),
    viewer,
    canModerate: canModerate(req, viewer),
    listingUrl,
    csrf: createCsrfToken(),
    title: `${topic.title} — форум`,
    description: `Обсуждение: ${topic.title}`,
    robots: "index, follow",
  });
});

router.post("/forum/topic/:topicId/posts", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const topicId = Number(req.params.topicId);
  const [topic] = await db
    .select({ topic: forumTopics, section: forumSections })
    .from(forumTopics)
    .innerJoin(forumSections, eq(forumTopics.sectionId, forumSections.id))
    .where(eq(forumTopics.id, topicId))
    .limit(1);
  if (!topic) { res.sendStatus(404); return; }
  const [ban] = await db.select({ id: forumSectionBans.id }).from(forumSectionBans).where(and(
    eq(forumSectionBans.sectionId, topic.section.id),
    eq(forumSectionBans.userId, user.id),
    or(isNull(forumSectionBans.expiresAt), gte(forumSectionBans.expiresAt, new Date())),
  )).limit(1);
  if (ban) { res.status(403).send("Вы не можете писать в этом разделе."); return; }
  const body = clean(req.body?.body, 6000);
  if (!body) { res.redirect(303, `/forum/topic/${topicId}?error=empty`); return; }
  if (hasFilteredWords(body, topic.section)) { res.redirect(303, `/forum/topic/${topicId}?error=words`); return; }
  if (topic.topic.isLocked) { res.status(423).send("Обсуждение закрыто."); return; }
  const allowed = await db.transaction((tx) => postWithRateLimit(tx, user.id, topic.section, topicId, body));
  if (!allowed) { res.redirect(303, `/forum/topic/${topicId}?error=rate`); return; }
  res.redirect(303, `/forum/topic/${topicId}#post-new`);
});

router.post("/forum/topics", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const sectionId = Number(req.body?.sectionId);
  const [section] = await db.select().from(forumSections).where(eq(forumSections.id, sectionId)).limit(1);
  if (!section || section.kind === "listing") { res.sendStatus(400); return; }
  const title = clean(req.body?.title, 160);
  const body = clean(req.body?.body, 6000);
  if (!title || !body || hasFilteredWords(`${title}\n${body}`, section)) {
    res.redirect(303, `/forum/${section.slug}?error=invalid`);
    return;
  }
  const [ban] = await db.select({ id: forumSectionBans.id }).from(forumSectionBans).where(and(
    eq(forumSectionBans.sectionId, section.id),
    eq(forumSectionBans.userId, user.id),
    or(isNull(forumSectionBans.expiresAt), gte(forumSectionBans.expiresAt, new Date())),
  )).limit(1);
  if (ban) { res.status(403).send("Вы не можете писать в этом разделе."); return; }
  const [topic] = await db.transaction(async (tx) => {
    const created = await tx.insert(forumTopics).values({
      sectionId: section.id,
      authorId: user.id,
      title,
    }).returning({ id: forumTopics.id });
    if (!created[0]) return [];
    const allowed = await postWithRateLimit(tx, user.id, section, created[0].id, body);
    if (!allowed) throw new Error("forum_rate_limited");
    return created;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "forum_rate_limited") return [];
    throw error;
  });
  if (!topic) { res.redirect(303, `/forum/${section.slug}?error=rate`); return; }
  res.redirect(303, `/forum/topic/${topic.id}`);
});

router.post("/forum/posts/:postId/report", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const postId = Number(req.params.postId);
  const [row] = await db.select({ post: forumPosts, topicId: forumTopics.id, kind: forumSections.kind })
    .from(forumPosts).innerJoin(forumTopics, eq(forumPosts.topicId, forumTopics.id))
    .innerJoin(forumSections, eq(forumTopics.sectionId, forumSections.id))
    .where(eq(forumPosts.id, postId)).limit(1);
  if (!row || row.post.authorId === user.id) { res.sendStatus(404); return; }
  const reason = row.kind === "flood" ? "illegal" : clean(req.body?.reason, 80);
  if (row.kind === "flood" && req.body?.reason !== "illegal") { res.sendStatus(400); return; }
  if (!reason) { res.sendStatus(400); return; }
  await db.insert(forumReports).values({
    postId,
    reporterId: user.id,
    reason,
  }).onConflictDoNothing({ target: [forumReports.postId, forumReports.reporterId] });
  res.redirect(303, `/forum/topic/${row.topicId}?reported=1#post-${postId}`);
});

router.get("/forum/moderation", async (req, res, next) => {
  const user = await currentUser(req);
  if (!canModerate(req, user)) { next(); return; }
  const reports = await db
    .select({
      id: forumReports.id,
      reason: forumReports.reason,
      createdAt: forumReports.createdAt,
      postId: forumPosts.id,
      body: forumPosts.body,
      status: forumPosts.status,
      topicId: forumTopics.id,
      topicTitle: forumTopics.title,
      sectionTitle: forumSections.title,
      author: forumUsers.displayName,
    })
    .from(forumReports)
    .innerJoin(forumPosts, eq(forumReports.postId, forumPosts.id))
    .innerJoin(forumTopics, eq(forumPosts.topicId, forumTopics.id))
    .innerJoin(forumSections, eq(forumTopics.sectionId, forumSections.id))
    .innerJoin(forumUsers, eq(forumPosts.authorId, forumUsers.id))
    .where(eq(forumReports.resolved, false))
    .orderBy(forumReports.createdAt);
  const sections = await db.select().from(forumSections).orderBy(forumSections.sortOrder);
  await renderPage(res, "forum-moderation", {
    reports,
    sections,
    canManageUsers: hasAdminSession(req) || user?.role === "admin",
    csrf: createCsrfToken(),
    title: "Модерация форума",
    description: "Очередь жалоб и управление обсуждениями.",
    robots: "noindex, nofollow",
  });
});

router.post("/forum/moderation/reports/:reportId", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const user = await currentUser(req);
  if (!canModerate(req, user)) { res.sendStatus(403); return; }
  const reportId = Number(req.params.reportId);
  const action = clean(req.body?.action, 20);
  const [report] = await db.select().from(forumReports).where(eq(forumReports.id, reportId)).limit(1);
  if (!report) { res.sendStatus(404); return; }
  if (action === "hide" || action === "delete") {
    await db.update(forumPosts).set({ status: action === "hide" ? "hidden" : "deleted" }).where(eq(forumPosts.id, report.postId));
  }
  await db.update(forumReports).set({
    resolved: true,
    resolvedBy: user?.id ?? null,
    resolvedAt: new Date(),
  }).where(eq(forumReports.id, reportId));
  res.redirect(303, "/forum/moderation");
});

router.post("/forum/moderation/topics/:topicId", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const user = await currentUser(req);
  if (!canModerate(req, user)) { res.sendStatus(403); return; }
  const id = Number(req.params.topicId);
  const [topic] = await db.select().from(forumTopics).where(eq(forumTopics.id, id)).limit(1);
  if (!topic) { res.sendStatus(404); return; }
  const action = clean(req.body?.action, 16);
  if (action === "lock" || action === "unlock") {
    await db.update(forumTopics).set({ isLocked: action === "lock" }).where(eq(forumTopics.id, id));
  } else if (action === "pin" || action === "unpin") {
    await db.update(forumTopics).set({ isPinned: action === "pin" }).where(eq(forumTopics.id, id));
  }
  res.redirect(303, `/forum/topic/${id}`);
});

router.post("/forum/moderation/bans", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const moderator = await currentUser(req);
  if (!canModerate(req, moderator)) { res.sendStatus(403); return; }
  const sectionId = Number(req.body?.sectionId);
  const userId = Number(req.body?.userId);
  const action = clean(req.body?.action, 16);
  if (![sectionId, userId].every((value) => Number.isSafeInteger(value) && value > 0)) { res.sendStatus(400); return; }
  if (action === "unban") {
    await db.delete(forumSectionBans).where(and(eq(forumSectionBans.sectionId, sectionId), eq(forumSectionBans.userId, userId)));
  } else if (action === "ban") {
    await db.insert(forumSectionBans).values({
      sectionId,
      userId,
      bannedBy: moderator?.id ?? null,
      reason: clean(req.body?.reason, 300) || null,
      expiresAt: req.body?.permanent === "yes" ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).onConflictDoUpdate({
      target: [forumSectionBans.sectionId, forumSectionBans.userId],
      set: { bannedBy: moderator?.id ?? null, reason: clean(req.body?.reason, 300) || null, createdAt: new Date() },
    });
  }
  res.redirect(303, "/forum/moderation");
});

router.post("/forum/moderation/users/:userId/role", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const admin = await currentUser(req);
  if (!(hasAdminSession(req) || admin?.role === "admin")) { res.sendStatus(403); return; }
  const userId = Number(req.params.userId);
  const role = clean(req.body?.role, 20);
  if (!["user", "moderator", "admin"].includes(role)) { res.sendStatus(400); return; }
  await db.update(forumUsers).set({ role, updatedAt: new Date() }).where(eq(forumUsers.id, userId));
  res.redirect(303, "/forum/moderation");
});

export default router;

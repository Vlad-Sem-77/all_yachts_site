import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sum,
} from "drizzle-orm";
import { Router, type Request, type RequestHandler, type Response } from "express";
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
  listingsTable,
  forumTopics,
  pendingListingUploads,
  siteSettings,
} from "@workspace/db";
import { messages, t } from "./localization";
import {
  adminCredentialsConfigured,
  clearAdminSession,
  createAdminSessionToken,
  hasAdminSession,
  setAdminSession,
  verifyAdminCredentials,
} from "./admin-auth";
import {
  cleanSiteUrl,
  getDefaultCountries,
  getDefaultCurrencies,
  getSiteConfig,
  isEmail,
  isGoogleAnalyticsId,
  isYandexMetrikaId,
  saveSiteSettings,
} from "./site-config";
import {
  allowRateLimitedAction,
  createCsrfToken,
  getIpHash,
  validFormRequest,
} from "./security";
import { renderPage } from "./view";
import { getCategoryOptions } from "./form-routes";

const router = Router();
const PAGE_SIZE = 30;
const MAX_MERCHANDISING_DAYS = 365;

router.use((_req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
  });
  next();
});

function text(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength)
    : "";
}

function multiline(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength)
    : "";
}

function integer(value: unknown, min: number, max: number): number | null {
  const parsed = Number(text(value, 16));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function adminCsrf(req: Request): boolean {
  return validFormRequest(req);
}

function footerCategories() {
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

async function renderAdminLogin(
  res: Response,
  error: string | null = null,
  status = 200,
): Promise<void> {
  await renderPage(
    res,
    "admin-login",
    {
      title: t("admin.loginTitle"),
      description: t("admin.loginDescription"),
      robots: "noindex, nofollow, noarchive",
      csrf: createCsrfToken(),
      loginError: error,
      adminConfigured: adminCredentialsConfigured(),
    },
    status,
  );
}

async function renderAdmin(
  res: Response,
  page: string,
  locals: Record<string, unknown> = {},
  status = 200,
): Promise<void> {
  const [categories, config] = await Promise.all([
    footerCategories(),
    getSiteConfig(),
  ]);
  await renderPage(
    res,
    page,
    {
      categories,
      adminMode: true,
      csrf: createCsrfToken(),
      config,
      title: t("admin.title"),
      description: t("admin.description"),
      robots: "noindex, nofollow, noarchive",
      ...locals,
    },
    status,
  );
}

const adminRequired: RequestHandler = (req, res, next) => {
  if (!hasAdminSession(req)) {
    res.redirect(303, "/admin/login");
    return;
  }
  next();
};

router.get("/admin/login", async (req, res) => {
  if (hasAdminSession(req)) {
    res.redirect(303, "/admin");
    return;
  }
  await renderAdminLogin(res);
});

router.post("/admin/login", async (req, res) => {
  if (!adminCsrf(req)) {
    await renderAdminLogin(res, t("formErrors.csrf"), 403);
    return;
  }
  const allowed = await allowRateLimitedAction(
    "admin-login",
    getIpHash(req),
    5,
    15 * 60 * 1000,
  );
  if (!allowed) {
    await renderAdminLogin(res, t("formErrors.rateLimit"), 429);
    return;
  }
  if (!adminCredentialsConfigured()) {
    await renderAdminLogin(res, t("admin.credentialsMissing"), 503);
    return;
  }
  if (!verifyAdminCredentials(req.body?.username, req.body?.password)) {
    await renderAdminLogin(res, t("admin.loginFailed"), 401);
    return;
  }
  setAdminSession(res, createAdminSessionToken());
  res.redirect(303, "/admin");
});

router.post("/admin/logout", adminRequired, async (req, res) => {
  if (!adminCsrf(req)) {
    res.sendStatus(403);
    return;
  }
  clearAdminSession(res);
  res.redirect(303, "/admin/login");
});

router.get("/admin", adminRequired, async (_req, res) => {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [
    totalListings,
    activeListings,
    hiddenListings,
    expiredListings,
    newToday,
    newWeek,
    views,
    pendingReports,
    categoryStats,
  ] = await Promise.all([
    db.select({ value: count() }).from(boatListings),
    db
      .select({ value: count() })
      .from(boatListings)
      .where(and(
        eq(boatListings.status, "active"),
        or(isNull(boatListings.expiresAt), gte(boatListings.expiresAt, now)),
      )),
    db
      .select({ value: count() })
      .from(boatListings)
      .where(eq(boatListings.status, "hidden")),
    db
      .select({ value: count() })
      .from(boatListings)
      .where(eq(boatListings.status, "expired")),
    db
      .select({ value: count() })
      .from(boatListings)
      .where(gte(boatListings.createdAt, dayAgo)),
    db
      .select({ value: count() })
      .from(boatListings)
      .where(gte(boatListings.createdAt, weekAgo)),
    db
      .select({ value: sum(boatListings.viewCount) })
      .from(boatListings),
    db
      .select({ value: count() })
      .from(listingReports)
      .where(eq(listingReports.status, "new")),
    db
      .select({
        id: boatCategories.id,
        nameRu: boatCategories.nameRu,
        total: count(boatListings.id),
      })
      .from(boatCategories)
      .leftJoin(
        boatListings,
        and(
          eq(boatListings.categoryId, boatCategories.id),
          eq(boatListings.status, "active"),
        ),
      )
      .groupBy(boatCategories.id)
      .orderBy(asc(boatCategories.sortOrder), asc(boatCategories.id)),
  ]);
  await renderAdmin(res, "admin-dashboard", {
    stats: {
      totalListings: totalListings[0]?.value ?? 0,
      activeListings: activeListings[0]?.value ?? 0,
      hiddenListings: hiddenListings[0]?.value ?? 0,
      expiredListings: expiredListings[0]?.value ?? 0,
      newToday: newToday[0]?.value ?? 0,
      newWeek: newWeek[0]?.value ?? 0,
      views: views[0]?.value ?? 0,
      pendingReports: pendingReports[0]?.value ?? 0,
    },
    categoryStats,
  });
});

router.get("/admin/listings", adminRequired, async (req, res) => {
  const query = text(req.query.q, 100);
  const requestedStatus = text(req.query.status, 12);
  const status = ["active", "hidden", "expired", "deleted"].includes(requestedStatus)
    ? requestedStatus
    : "";
  const categoryId = integer(req.query.category, 1, 2_147_483_647);
  const requestedPage = integer(req.query.page, 1, 1_000_000) ?? 1;
  const conditions = [];
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(boatListings.title, pattern),
        ilike(boatListings.country, pattern),
        ilike(boatListings.cityOrRegion, pattern),
        ilike(boatListings.manufacturer, pattern),
      )!,
    );
  }
  if (status) conditions.push(eq(boatListings.status, status));
  if (categoryId) conditions.push(eq(boatListings.categoryId, categoryId));
  const where = conditions.length ? and(...conditions) : undefined;
  const [{ total }] = await db
    .select({ total: count() })
    .from(boatListings)
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const rows = await db
    .select({
      id: boatListings.id,
      slug: boatListings.slug,
      title: boatListings.title,
      categoryId: boatListings.categoryId,
      categoryName: boatCategories.nameRu,
      status: boatListings.status,
      country: boatListings.country,
      cityOrRegion: boatListings.cityOrRegion,
      price: boatListings.price,
      currency: boatListings.currency,
      createdAt: boatListings.createdAt,
      expiresAt: boatListings.expiresAt,
      priority: boatListings.priority,
      isPinned: boatListings.isPinned,
      pinnedUntil: boatListings.pinnedUntil,
      isFeatured: boatListings.isFeatured,
      featuredUntil: boatListings.featuredUntil,
      boostedAt: boatListings.boostedAt,
      boostedUntil: boatListings.boostedUntil,
    })
    .from(boatListings)
    .leftJoin(boatCategories, eq(boatListings.categoryId, boatCategories.id))
    .where(where)
    .orderBy(desc(boatListings.createdAt), desc(boatListings.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const photoRows = rows.length
    ? await db
        .select({
          listingId: listingPhotos.listingId,
          photoId: listingPhotos.id,
        })
        .from(listingPhotos)
        .where(inArray(listingPhotos.listingId, rows.map((row) => row.id)))
        .orderBy(desc(listingPhotos.isPrimary), asc(listingPhotos.sortOrder))
    : [];
  const photoByListing = new Map<number, number>();
  for (const photo of photoRows) {
    if (!photoByListing.has(photo.listingId)) photoByListing.set(photo.listingId, photo.photoId);
  }
  const categories = await db
    .select({
      id: boatCategories.id,
      slug: boatCategories.slug,
      nameRu: boatCategories.nameRu,
      parentId: boatCategories.parentId,
    })
    .from(boatCategories)
    .orderBy(asc(boatCategories.sortOrder), asc(boatCategories.id));
  const pages = Array.from({ length: Math.min(pageCount, 9) }, (_, index) =>
    Math.max(1, Math.min(pageCount - 8, page - 4)) + index,
  ).filter((number) => number <= pageCount);
  await renderAdmin(res, "admin-listings", {
    listings: rows.map((row) => ({
      ...row,
      categoryPath: categories.find((category) => category.id === row.categoryId)?.parentId
        ? categories.find((category) => category.id === categories.find((item) => item.id === row.categoryId)?.parentId)?.slug
        : categories.find((category) => category.id === row.categoryId)?.slug,
      thumbnailUrl: photoByListing.has(row.id)
        ? `/media/${photoByListing.get(row.id)}/thumb`
        : null,
    })),
    filters: { q: query, status, categoryId: categoryId ?? "", page },
    categories,
    total,
    page,
    pageCount,
    pages,
    notice: req.query.notice === "saved"
      ? t("admin.saved")
      : req.query.notice === "invalid-date"
        ? t("admin.invalidDate")
        : req.query.notice === "invalid-priority"
          ? t("admin.invalidPriority")
          : req.query.notice === "deleted"
            ? t("admin.cannotRestoreDeleted")
            : null,
  });
});

router.get("/admin/listings/:id/edit", adminRequired, async (req, res) => {
  const id = integer(req.params.id, 1, 2_147_483_647);
  if (!id) {
    res.sendStatus(400);
    return;
  }
  const [listing] = await db.select().from(boatListings).where(eq(boatListings.id, id)).limit(1);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  const [categoryOptions] = await Promise.all([getCategoryOptions()]);
  await renderAdmin(res, "admin-listing-edit", {
    listing,
    categoryOptions,
    csrf: createCsrfToken(),
    values: {},
    editError: null,
  });
});

router.post("/admin/listings/:id/edit", adminRequired, async (req, res) => {
  if (!adminCsrf(req)) {
    res.sendStatus(403);
    return;
  }
  const id = integer(req.params.id, 1, 2_147_483_647);
  if (!id) {
    res.sendStatus(400);
    return;
  }
  const [listing] = await db.select().from(boatListings).where(eq(boatListings.id, id)).limit(1);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  const values = {
    title: text(req.body?.title, 120),
    description: multiline(req.body?.description, 10_000),
    categoryId: integer(req.body?.categoryId, 1, 2_147_483_647),
    priceText: text(req.body?.price, 32),
    currency: text(req.body?.currency, 3).toUpperCase(),
    country: text(req.body?.country, 100),
    cityOrRegion: text(req.body?.cityOrRegion, 100),
  };
  const options = await getCategoryOptions();
  const siteConfig = await getSiteConfig();
  const price = values.priceText === "" ? null : Number(values.priceText);
  const valid =
    values.title.length >= 4 &&
    values.description.length >= 20 &&
    values.description.length <= 10_000 &&
    values.categoryId !== null &&
    options.some((item) => item.id === values.categoryId) &&
    siteConfig.currencies.some((currency) => currency.code === values.currency) &&
    (price === null || (Number.isFinite(price) && price >= 0 && price <= 9_999_999_999.99)) &&
    /^[A-Z]{3}$/.test(values.currency) &&
    values.country.length > 0 &&
    values.cityOrRegion.length > 0;
  if (!valid) {
    await renderAdmin(res, "admin-listing-edit", {
      listing,
      categoryOptions: options,
      csrf: createCsrfToken(),
      values,
      editError: t("admin.invalidListingEdit"),
    }, 400);
    return;
  }
  await db.update(boatListings).set({
    title: values.title,
    description: values.description,
    categoryId: values.categoryId!,
    price,
    isNegotiable: price === null,
    currency: values.currency,
    country: values.country,
    cityOrRegion: values.cityOrRegion,
    updatedAt: new Date(),
  }).where(eq(boatListings.id, id));
  res.redirect(303, "/admin/listings?notice=saved");
});

function merchandisingUntil(value: unknown): Date | null {
  const dateText = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const date = new Date(`${dateText}T23:59:59.999Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getTime() <= Date.now() ||
    date.getTime() > Date.now() + MAX_MERCHANDISING_DAYS * 24 * 60 * 60 * 1000
  ) {
    return null;
  }
  return date;
}

router.post("/admin/listings/:id/action", adminRequired, async (req, res) => {
  if (!adminCsrf(req)) {
    res.sendStatus(403);
    return;
  }
  const id = integer(req.params.id, 1, 2_147_483_647);
  if (!id) {
    res.sendStatus(400);
    return;
  }
  const [listing] = await db
    .select({
      id: boatListings.id,
      status: boatListings.status,
      expiresAt: boatListings.expiresAt,
    })
    .from(boatListings)
    .where(eq(boatListings.id, id))
    .limit(1);
  if (!listing) {
    res.sendStatus(404);
    return;
  }
  const action = text(req.body?.action, 20);
  const now = new Date();
  if (action === "hide") {
    await db.update(boatListings).set({ status: "hidden", updatedAt: now }).where(eq(boatListings.id, id));
    await db.update(forumTopics).set({ isLocked: true, updatedAt: now }).where(eq(forumTopics.listingId, id));
  } else if (action === "show") {
    if (listing.status === "deleted") {
      res.redirect(303, "/admin/listings?status=deleted&notice=deleted");
      return;
    }
    const expiry = listing.expiresAt && listing.expiresAt.getTime() > now.getTime()
      ? listing.expiresAt
      : new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    await db
      .update(boatListings)
      .set({
        status: "active",
        expiresAt: expiry,
        reminderSentAt: null,
        updatedAt: now,
      })
      .where(eq(boatListings.id, id));
  } else if (action === "delete") {
    await db.update(boatListings).set({ status: "deleted", updatedAt: now }).where(eq(boatListings.id, id));
    await db.update(forumTopics).set({ isLocked: true, updatedAt: now }).where(eq(forumTopics.listingId, id));
  } else if (action === "pin" || action === "feature" || action === "boost") {
    const until = merchandisingUntil(req.body?.until);
    if (!until) {
      res.redirect(303, "/admin/listings?notice=invalid-date");
      return;
    }
    const update =
      action === "pin"
        ? { isPinned: true, pinnedUntil: until, updatedAt: now }
        : action === "feature"
          ? { isFeatured: true, featuredUntil: until, updatedAt: now }
          : { boostedAt: now, boostedUntil: until, updatedAt: now };
    await db.update(boatListings).set(update).where(eq(boatListings.id, id));
  } else if (action === "unpin") {
    await db.update(boatListings).set({ isPinned: false, pinnedUntil: null, updatedAt: now }).where(eq(boatListings.id, id));
  } else if (action === "unfeature") {
    await db.update(boatListings).set({ isFeatured: false, featuredUntil: null, updatedAt: now }).where(eq(boatListings.id, id));
  } else if (action === "unboost") {
    await db.update(boatListings).set({ boostedAt: null, boostedUntil: null, updatedAt: now }).where(eq(boatListings.id, id));
  } else if (action === "priority") {
    const priority = integer(req.body?.priority, -1000, 1000);
    if (priority === null) {
      res.redirect(303, "/admin/listings?notice=invalid-priority");
      return;
    }
    await db.update(boatListings).set({ priority, updatedAt: now }).where(eq(boatListings.id, id));
  } else {
    res.sendStatus(400);
    return;
  }
  res.redirect(303, "/admin/listings?notice=saved");
});

router.get("/admin/reports", adminRequired, async (req, res) => {
  const status = ["new", "reviewed", "dismissed"].includes(text(req.query.status, 12))
    ? text(req.query.status, 12)
    : "new";
  const rows = await db
    .select({
      id: listingReports.id,
      listingId: listingReports.listingId,
      reason: listingReports.reason,
      details: listingReports.details,
      status: listingReports.status,
      createdAt: listingReports.createdAt,
      listingTitle: boatListings.title,
      listingSlug: boatListings.slug,
      listingStatus: boatListings.status,
    })
    .from(listingReports)
    .innerJoin(boatListings, eq(listingReports.listingId, boatListings.id))
    .where(eq(listingReports.status, status))
    .orderBy(desc(listingReports.createdAt))
    .limit(100);
  await renderAdmin(res, "admin-reports", {
    reports: rows,
    reportStatus: status,
    notice: req.query.notice === "saved" ? t("admin.saved") : null,
  });
});

router.post("/admin/reports/:id/action", adminRequired, async (req, res) => {
  if (!adminCsrf(req)) {
    res.sendStatus(403);
    return;
  }
  const id = integer(req.params.id, 1, 2_147_483_647);
  const action = text(req.body?.action, 12);
  if (!id || !["hide", "dismiss", "review"].includes(action)) {
    res.sendStatus(400);
    return;
  }
  const [report] = await db
    .select({ id: listingReports.id, listingId: listingReports.listingId })
    .from(listingReports)
    .where(eq(listingReports.id, id))
    .limit(1);
  if (!report) {
    res.sendStatus(404);
    return;
  }
  await db.transaction(async (tx) => {
    if (action === "hide") {
      await tx
        .update(boatListings)
        .set({ status: "hidden", updatedAt: new Date() })
        .where(eq(boatListings.id, report.listingId));
      await tx
        .update(forumTopics)
        .set({ isLocked: true, updatedAt: new Date() })
        .where(eq(forumTopics.listingId, report.listingId));
    }
    await tx
      .update(listingReports)
      .set({
        status: action === "dismiss" ? "dismissed" : "reviewed",
        reviewedAt: new Date(),
      })
      .where(eq(listingReports.id, id));
  });
  res.redirect(303, "/admin/reports?status=new&notice=saved");
});

router.get("/admin/categories", adminRequired, async (req, res) => {
  const rows = await db
    .select({
      id: boatCategories.id,
      parentId: boatCategories.parentId,
      slug: boatCategories.slug,
      nameRu: boatCategories.nameRu,
      descriptionRu: boatCategories.descriptionRu,
      sortOrder: boatCategories.sortOrder,
      isActive: boatCategories.isActive,
    })
    .from(boatCategories)
    .orderBy(asc(boatCategories.parentId), asc(boatCategories.sortOrder), asc(boatCategories.id));
  await renderAdmin(res, "admin-categories", {
    categoryRows: rows.map((row) => ({
      ...row,
      parentName: rows.find((parent) => parent.id === row.parentId)?.nameRu ?? "",
    })),
    rootCategories: rows.filter((row) => row.parentId === null),
    notice: req.query.notice === "saved"
      ? t("admin.saved")
      : req.query.notice === "invalid"
        ? t("admin.invalidCategory")
        : null,
  });
});

router.post("/admin/categories/create", adminRequired, async (req, res) => {
  if (!adminCsrf(req)) {
    res.sendStatus(403);
    return;
  }
  const slug = text(req.body?.slug, 100).toLowerCase();
  const nameRu = text(req.body?.nameRu, 100);
  const descriptionRu = text(req.body?.descriptionRu, 5000);
  const sortOrder = integer(req.body?.sortOrder, -9999, 9999);
  const parentRaw = text(req.body?.parentId, 16);
  const parentId = parentRaw ? integer(parentRaw, 1, 2_147_483_647) : null;
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !nameRu ||
    sortOrder === null ||
    (parentRaw && !parentId)
  ) {
    res.redirect(303, "/admin/categories?notice=invalid");
    return;
  }
  if (parentId) {
    const [parent] = await db
      .select({ id: boatCategories.id, parentId: boatCategories.parentId })
      .from(boatCategories)
      .where(eq(boatCategories.id, parentId))
      .limit(1);
    if (!parent || parent.parentId !== null) {
      res.redirect(303, "/admin/categories?notice=invalid");
      return;
    }
  }
  await db.insert(boatCategories).values({
    parentId,
    slug,
    nameRu,
    descriptionRu: descriptionRu || null,
    sortOrder,
    isActive: req.body?.isActive === "on",
  });
  res.redirect(303, "/admin/categories?notice=saved");
});

router.post("/admin/categories/:id/update", adminRequired, async (req, res) => {
  if (!adminCsrf(req)) {
    res.sendStatus(403);
    return;
  }
  const id = integer(req.params.id, 1, 2_147_483_647);
  const nameRu = text(req.body?.nameRu, 100);
  const descriptionRu = text(req.body?.descriptionRu, 5000);
  const sortOrder = integer(req.body?.sortOrder, -9999, 9999);
  if (!id || !nameRu || sortOrder === null) {
    res.redirect(303, "/admin/categories?notice=invalid");
    return;
  }
  await db
    .update(boatCategories)
    .set({
      nameRu,
      descriptionRu: descriptionRu || null,
      sortOrder,
      isActive: req.body?.isActive === "on",
      updatedAt: new Date(),
    })
    .where(eq(boatCategories.id, id));
  res.redirect(303, "/admin/categories?notice=saved");
});

router.get("/admin/settings", adminRequired, async (_req, res) => {
  const config = await getSiteConfig(true);
  await renderAdmin(res, "admin-settings", {
    config,
    currenciesText: config.currencies.map((item) => `${item.code}|${item.symbol}`).join("\n"),
    countriesText: config.countries.join("\n"),
    settingsSaved: false,
  });
});

router.post("/admin/settings", adminRequired, async (req, res) => {
  if (!adminCsrf(req)) {
    res.sendStatus(403);
    return;
  }
  const currenciesText = multiline(req.body?.currencies, 5000);
  const currencyLines = currenciesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const currencies = currencyLines.map((line) => {
    const separator = line.indexOf("|");
    return {
      code: line.slice(0, separator).trim().toUpperCase(),
      symbol: line.slice(separator + 1).trim(),
    };
  });
  const countries = [...new Set(
    multiline(req.body?.countries, 30_000)
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];
  const siteUrl = cleanSiteUrl(text(req.body?.siteUrl, 500));
  const yandex = text(req.body?.yandexMetrikaId, 20);
  const google = text(req.body?.googleAnalyticsId, 30).toUpperCase();
  const reportEmail = text(req.body?.reportNotificationEmail, 254).toLowerCase();
  const listingEmail = text(req.body?.newListingNotificationEmail, 254).toLowerCase();
  const rulesBody = multiline(req.body?.rulesBody, 5000);
  const currenciesValid =
    currencies.length >= 1 &&
    currencies.length <= 100 &&
    currencies.every(
      (item) =>
        /^[A-Z]{3}$/.test(item.code) &&
        item.symbol.length > 0 &&
        item.symbol.length <= 8,
    ) &&
    new Set(currencies.map((item) => item.code)).size === currencies.length;
  const countriesValid =
    countries.length >= 1 &&
    countries.length <= 300 &&
    countries.every((country) => country.length <= 100);
  if (
    !currenciesValid ||
    !countriesValid ||
    siteUrl === null ||
    (yandex && !isYandexMetrikaId(yandex)) ||
    (google && !isGoogleAnalyticsId(google)) ||
    !isEmail(reportEmail) ||
    !isEmail(listingEmail) ||
    !rulesBody
  ) {
    const config = await getSiteConfig(true);
    await renderAdmin(
      res,
      "admin-settings",
      {
        config,
        currenciesText,
        countriesText: countries.join("\n"),
        settingsSaved: false,
        settingsError: t("admin.settingsInvalid"),
      },
      400,
    );
    return;
  }
  await saveSiteSettings({
    currencies: JSON.stringify(currencies),
    countries: JSON.stringify(countries),
    site_url: siteUrl,
    yandex_metrika_id: yandex,
    google_analytics_id: google,
    report_notification_email: reportEmail,
    new_listing_notification_email: listingEmail,
    rules_body: rulesBody,
  });
  const config = await getSiteConfig(true);
  await renderAdmin(res, "admin-settings", {
    config,
    currenciesText: config.currencies.map((item) => `${item.code}|${item.symbol}`).join("\n"),
    countriesText: config.countries.join("\n"),
    settingsSaved: true,
    settingsError: null,
  });
});

router.get("/admin/export", adminRequired, async (req, res) => {
  if (!(await allowRateLimitedAction("admin-export", getIpHash(req), 3, 60 * 60 * 1000))) {
    res.status(429).send(t("formErrors.rateLimit"));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="boat-board-backup-${today}.json"`,
    "Cache-Control": "no-store",
  });
  res.write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"tables":{`);
  const tables: Array<{ name: string; load: () => Promise<unknown[]> }> = [
    { name: "listings", load: () => db.select().from(listingsTable) },
    { name: "boat_categories", load: () => db.select().from(boatCategories) },
    { name: "boat_listings", load: () => db.select().from(boatListings) },
    { name: "listing_photos", load: () => db.select().from(listingPhotos) },
    { name: "listing_reports", load: () => db.select().from(listingReports) },
    { name: "listing_view_events", load: () => db.select().from(listingViewEvents) },
    { name: "site_settings", load: () => db.select().from(siteSettings) },
    { name: "listing_author_attempts", load: () => db.select().from(listingAuthorAttempts) },
    { name: "listing_captcha_challenges", load: () => db.select().from(listingCaptchaChallenges) },
    { name: "listing_password_reset_tokens", load: () => db.select().from(listingPasswordResetTokens) },
    { name: "listing_rate_limit_events", load: () => db.select().from(listingRateLimitEvents) },
    { name: "pending_listing_uploads", load: () => db.select().from(pendingListingUploads) },
  ];
  for (const [index, table] of tables.entries()) {
    if (index) res.write(",");
    const rows = await table.load();
    res.write(`${JSON.stringify(table.name)}:${JSON.stringify(rows)}`);
  }
  res.end("}}");
});

export default router;

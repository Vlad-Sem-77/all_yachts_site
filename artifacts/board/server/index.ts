import { and, count, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import cookieParser from "cookie-parser";
import express, { type Request, type Response } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pino from "pino";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boatCategories,
  boatListings,
  db,
  getOrCreateForumUser,
} from "@workspace/db";
import { hasAdminSession } from "./admin-auth";
import { canModerateByForumRole } from "./user-access";
import adminRoutes from "./admin-routes";
import { getSiteConfig } from "./site-config";
import formRoutes from "./form-routes";
import forumRoutes from "./forum-routes";
import listingRoutes, {
  getCatalogPage,
  getListingCards,
  parseCatalogFilters,
} from "./listing-routes";
import { messages, t } from "./localization";
import { renderPage } from "./view";
import { runMaintenance } from "./maintenance";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = path.join(rootDir, "public");
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

function getClerkProxyHost(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || req.headers.host?.trim() || undefined;
}

const app = express();
app.set("trust proxy", 1);
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: "64kb" }));
app.use(express.json({ limit: "32kb" }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use(async (req, res, next) => {
  try {
    const config = await getSiteConfig();
    const origin = config.siteUrl || (() => {
      try {
        return new URL(`${req.protocol}://${req.get("host")}`).origin;
      } catch {
        return "";
      }
    })();
    res.locals.siteOrigin = origin;
    res.locals.canonicalUrl = origin && !req.path.startsWith("/admin")
      ? new URL(req.path, `${origin}/`).toString()
      : "";
    const consent = req.cookies?.analytics_consent === "accepted";
    res.locals.analyticsDecisionMade =
      req.cookies?.analytics_consent === "accepted" ||
      req.cookies?.analytics_consent === "rejected";
    res.locals.analyticsEnabled = Boolean(config.yandexMetrikaId || config.googleAnalyticsId);
    res.locals.analyticsAllowed = consent;
    res.locals.yandexMetrikaId = config.yandexMetrikaId;
    res.locals.googleAnalyticsId = config.googleAnalyticsId;
    next();
  } catch (error) {
    next(error);
  }
});
app.use("/assets", express.static(publicDir, { maxAge: "1h" }));
app.use(async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    const forumUser = userId ? await getOrCreateForumUser(userId) : null;
    res.locals.forumUser = forumUser;
    res.locals.canModerateForum =
      hasAdminSession(req) ||
      canModerateByForumRole(forumUser?.role, forumUser?.isActive);
    next();
  } catch (error) {
    next(error);
  }
});

type CategoryRow = typeof boatCategories.$inferSelect;
type CategoryView = CategoryRow & {
  count: number;
  children: CategoryView[];
};

async function getCategoryTree(): Promise<CategoryView[]> {
  const now = new Date();
  const [rows, listingCounts] = await Promise.all([
    db
      .select()
      .from(boatCategories)
      .where(eq(boatCategories.isActive, true))
      .orderBy(boatCategories.sortOrder, boatCategories.id),
    db
      .select({
        categoryId: boatListings.categoryId,
        count: count(),
      })
      .from(boatListings)
      .where(and(
        eq(boatListings.status, "active"),
        or(isNull(boatListings.expiresAt), gte(boatListings.expiresAt, now)),
      ))
      .groupBy(boatListings.categoryId),
  ]);

  const countsByCategory = new Map(
    listingCounts.map((row) => [row.categoryId, row.count]),
  );
  const childRows = new Map<number, CategoryRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const siblings = childRows.get(row.parentId) ?? [];
    siblings.push(row);
    childRows.set(row.parentId, siblings);
  }

  return rows
    .filter((row) => row.parentId === null)
    .map((row) => {
      const children = (childRows.get(row.id) ?? []).map((child) => ({
        ...child,
        count: countsByCategory.get(child.id) ?? 0,
        children: [],
      }));
      return {
        ...row,
        children,
        count:
          (countsByCategory.get(row.id) ?? 0) +
          children.reduce((total, child) => total + child.count, 0),
      };
    });
}

async function getRecentListings() {
  const rows = await db
    .select({ id: boatCategories.id })
    .from(boatCategories)
    .where(eq(boatCategories.isActive, true));
  return getListingCards(rows.map((row) => row.id), undefined, 8);
}

function formatPrice(
  price: number | null,
  currency: string,
  isNegotiable: boolean,
  t: (key: string) => string,
): string {
  if (price === null || isNegotiable) return t("listing.negotiable");
  const amount = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(price);
  const symbols: Record<string, string> = {
    RUB: "₽",
    USD: "$",
    EUR: "€",
    GBP: "£",
  };
  return `${amount} ${symbols[currency] ?? currency}`;
}

async function renderHome(_req: Request, res: Response): Promise<void> {
  const [categories, listings] = await Promise.all([
    getCategoryTree(),
    getRecentListings(),
  ]);
  await renderPage(res, "home", {
    categories,
    listings,
    title: messages.home.title,
    description: messages.home.description,
    formatPrice,
  });
}

async function renderCategories(_req: Request, res: Response): Promise<void> {
  const categories = await getCategoryTree();
  const siteOrigin = typeof res.locals.siteOrigin === "string" ? res.locals.siteOrigin : "";
  const pageUrl = typeof res.locals.canonicalUrl === "string"
    ? res.locals.canonicalUrl
    : `${siteOrigin}/categories`;
  const breadcrumbList = [
    { name: messages.brand.name, item: siteOrigin || "/" },
    { name: t("nav.categories"), item: pageUrl },
  ].map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: item.item,
  }));
  await renderPage(res, "categories", {
    categories,
    title: `${t("categoriesPage.title")} | ${messages.brand.name}`,
    description: t("categoriesPage.description"),
    structuredData: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbList,
    }).replace(/</g, "\\u003c"),
  });
}

async function renderCategory(
  req: Request,
  res: Response,
  parentSlug?: string,
): Promise<void> {
  const [categories] = await Promise.all([getCategoryTree()]);
  let category: CategoryView | undefined;

  if (parentSlug) {
    const parent = categories.find((item) => item.slug === parentSlug);
    category = parent?.children.find((item) => item.slug === req.params.slug);
  } else {
    category = categories.find((item) => item.slug === req.params.slug);
  }

  if (!category) {
    await renderPage(
      res,
      "not-found",
      { categories, title: messages.errors.notFoundTitle },
      404,
    );
    return;
  }

  const categoryIds = [
    category.id,
    ...category.children.map((child) => child.id),
  ];
  const filters = parseCatalogFilters(req.query);
  const pageData = await getCatalogPage(categoryIds, filters);
  const filterAction = parentSlug
    ? `/category/${parentSlug}/${category.slug}`
    : `/category/${category.slug}`;
  const siteOrigin = typeof res.locals.siteOrigin === "string" ? res.locals.siteOrigin : "";
  const categoryUrl = typeof res.locals.canonicalUrl === "string" ? res.locals.canonicalUrl : "";
  const breadcrumbList = [
    { name: messages.brand.name, item: siteOrigin || "/" },
    ...(parentSlug ? [{ name: categories.find((item) => item.slug === parentSlug)?.nameRu ?? "", item: `${siteOrigin}/category/${parentSlug}` }] : []),
    { name: category.nameRu, item: categoryUrl },
  ].map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: item.item,
  }));
  await renderPage(res, "category", {
    categories,
    category,
    listings: pageData.listings,
    total: pageData.total,
    filters,
    filterAction,
    pagination: makePagination(
      filters,
      filterAction,
      pageData.page,
      pageData.pageCount,
    ),
    title: `${category.nameRu} — ${t("category.titleSuffix")} | ${messages.brand.name}`,
    description: category.descriptionRu?.slice(0, 180) || t("category.description", { name: category.nameRu }),
    formatPrice,
    structuredData: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbList,
    }).replace(/</g, "\\u003c"),
  });
}

function makePagination(
  filters: ReturnType<typeof parseCatalogFilters>,
  basePath: string,
  currentPage: number,
  pageCount: number,
) {
  if (pageCount <= 1) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === "page" || value === "") continue;
    params.set(key, String(value));
  }
  const href = (page: number) => {
    const pageParams = new URLSearchParams(params);
    pageParams.set("page", String(page));
    return `${basePath}?${pageParams.toString()}`;
  };
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(pageCount, currentPage + 2);
  return {
    currentPage,
    pageCount,
    previousHref: currentPage > 1 ? href(currentPage - 1) : null,
    nextHref: currentPage < pageCount ? href(currentPage + 1) : null,
    pages: Array.from({ length: end - start + 1 }, (_, index) => {
      const page = start + index;
      return { page, href: href(page) };
    }),
  };
}

async function renderSearch(req: Request, res: Response): Promise<void> {
  const categories = await getCategoryTree();
  const categoryIds = categories.flatMap((category) => [
    category.id,
    ...category.children.map((child) => child.id),
  ]);
  const filters = parseCatalogFilters(req.query);
  const pageData = await getCatalogPage(categoryIds, filters);
  await renderPage(res, "search", {
    categories,
    listings: pageData.listings,
    total: pageData.total,
    filters,
    filterAction: "/search",
    pagination: makePagination(filters, "/search", pageData.page, pageData.pageCount),
    title: `${t("search.title")} | ${messages.brand.name}`,
    description: t("search.description"),
    formatPrice,
  });
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character]!);
}

function requestOrigin(req: Request, configured = ""): string | null {
  if (configured) return configured;
  try {
    return new URL(`${req.protocol}://${req.get("host")}`).origin;
  } catch {
    return null;
  }
}

app.get("/robots.txt", async (req, res) => {
  const origin = requestOrigin(req, String(res.locals.siteOrigin || ""));
  res.type("text/plain").send([
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    ...(origin ? [`Sitemap: ${origin}/sitemap.xml`] : []),
    "",
  ].join("\n"));
});

app.get("/sitemap.xml", async (req, res) => {
  const origin = requestOrigin(req, String(res.locals.siteOrigin || ""));
  if (!origin) {
    res.status(503).type("text/plain").send("Set the site's public URL in admin settings to generate the sitemap.");
    return;
  }
  const now = new Date();
  const [categoryRows, listings] = await Promise.all([
    db.select().from(boatCategories).where(eq(boatCategories.isActive, true)),
    db.select({
      slug: boatListings.slug,
      updatedAt: boatListings.updatedAt,
      categoryId: boatListings.categoryId,
      categorySlug: boatCategories.slug,
      parentId: boatCategories.parentId,
    })
      .from(boatListings)
      .innerJoin(boatCategories, eq(boatListings.categoryId, boatCategories.id))
      .where(and(
        eq(boatListings.status, "active"),
        or(isNull(boatListings.expiresAt), gte(boatListings.expiresAt, now)),
        eq(boatCategories.isActive, true),
      )),
  ]);
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  const entries: Array<{ path: string; updatedAt?: Date }> = [
    { path: "/" },
    { path: "/categories" },
    ...categoryRows.map((category) => ({
      path: category.parentId
        ? `/category/${categoryById.get(category.parentId)?.slug ?? category.slug}/${category.slug}`
        : `/category/${category.slug}`,
      updatedAt: category.updatedAt,
    })),
    ...listings.flatMap((listing) => {
      if (!listing.slug) return [];
      const category = categoryById.get(listing.categoryId);
      if (!category) return [];
      const parentSlug = category.parentId
        ? categoryById.get(category.parentId)?.slug
        : undefined;
      return [{
        path: `/category/${parentSlug ?? category.slug}/${listing.slug}`,
        updatedAt: listing.updatedAt,
      }];
    }),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((entry) =>
    `<url><loc>${xmlEscape(new URL(entry.path, `${origin}/`).toString())}</loc>${entry.updatedAt ? `<lastmod>${entry.updatedAt.toISOString()}</lastmod>` : ""}</url>`,
  ).join("")}</urlset>`;
  res.type("application/xml").set("Cache-Control", "public, max-age=300").send(xml);
});

app.use(adminRoutes);
app.use(formRoutes);
app.use(listingRoutes);
app.use(forumRoutes);
app.get("/", renderHome);
app.get("/categories", renderCategories);
app.get("/search", renderSearch);
app.get("/category/:parentSlug/:slug", (req, res) =>
  renderCategory(req, res, req.params.parentSlug),
);
app.get("/category/:slug", (req, res) => renderCategory(req, res));
app.use(async (_req, res) => {
  await renderPage(
    res,
    "not-found",
    {
      title: messages.errors.notFoundTitle,
      heading: messages.errors.notFoundTitle,
      message: messages.errors.notFoundDescription,
    },
    404,
  );
});

app.use(
  async (
    error: unknown,
    _req: Request,
    res: Response,
    _next: (error?: unknown) => void,
  ) => {
    logger.error({ err: error }, "SSR request failed");
    if (res.headersSent) return;
    try {
      await renderPage(
        res,
        "not-found",
        {
          title: messages.errors.serverError,
          heading: messages.errors.serverError,
          message: messages.errors.serverError,
          description: messages.errors.serverError,
        },
        500,
      );
    } catch {
      res.status(500).send(messages.errors.serverError);
    }
  },
);

const rawPort = process.env.PORT;
if (!rawPort) throw new Error("PORT environment variable is required.");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  logger.info({ port }, "SSR site listening");
  void runMaintenance(logger).catch(() => {
    logger.error("Startup maintenance run failed");
  });
  const maintenanceTimer = setInterval(() => {
    void runMaintenance(logger).catch(() => {
      logger.error("Scheduled maintenance run failed");
    });
  }, 15 * 60 * 1000);
  maintenanceTimer.unref();
});

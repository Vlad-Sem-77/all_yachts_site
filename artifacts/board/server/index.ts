import { and, count, desc, eq, inArray } from "drizzle-orm";
import cookieParser from "cookie-parser";
import express, { type Request, type Response } from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boatCategories, boatListings, db } from "@workspace/db";
import formRoutes from "./form-routes";
import listingRoutes, {
  getCatalogPage,
  getListingCards,
  parseCatalogFilters,
} from "./listing-routes";
import { messages, t } from "./localization";
import { renderPage } from "./view";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = path.join(rootDir, "public");
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

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
app.use("/assets", express.static(publicDir, { maxAge: "1h" }));

type CategoryRow = typeof boatCategories.$inferSelect;
type CategoryView = CategoryRow & {
  count: number;
  children: CategoryView[];
};

async function getCategoryTree(): Promise<CategoryView[]> {
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
      .where(eq(boatListings.status, "active"))
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
    description: t("category.description", { name: category.nameRu }),
    formatPrice,
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

app.use(formRoutes);
app.use(listingRoutes);
app.get("/", renderHome);
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
});

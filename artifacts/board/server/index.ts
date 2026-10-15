import { and, count, desc, eq, inArray } from "drizzle-orm";
import ejs from "ejs";
import express, { type Request, type Response } from "express";
import i18next from "i18next";
import pino from "pino";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boatCategories, boatListings, db } from "@workspace/db";
import ru from "../locales/ru.json";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const viewsDir = path.join(rootDir, "views");
const publicDir = path.join(rootDir, "public");
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const i18n = i18next.createInstance();

await i18n.init({
  lng: "ru",
  fallbackLng: "ru",
  supportedLngs: ["ru", "en"],
  resources: {
    ru: { translation: ru },
  },
  interpolation: {
    escapeValue: false,
  },
});

const app = express();
app.set("view engine", "ejs");
app.set("views", viewsDir);
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

async function renderPage(
  res: Response,
  page: string,
  locals: Record<string, unknown>,
  status = 200,
): Promise<void> {
  const t = i18n.getFixedT("ru");
  const shared = {
    t,
    lang: "ru",
    categories: [],
    title: ru.home.title,
    description: ru.home.description,
    heading: ru.errors.notFoundTitle,
    message: ru.errors.notFoundDescription,
    ...locals,
  };
  const body = await ejs.renderFile(path.join(viewsDir, `${page}.ejs`), shared);
  const html = await ejs.renderFile(path.join(viewsDir, "base.ejs"), {
    ...shared,
    body,
  });
  res.status(status).type("html").send(html);
}

async function getRecentListings() {
  return db
    .select({
      id: boatListings.id,
      slug: boatListings.slug,
      title: boatListings.title,
      price: boatListings.price,
      currency: boatListings.currency,
      isNegotiable: boatListings.isNegotiable,
      country: boatListings.country,
      cityOrRegion: boatListings.cityOrRegion,
      createdAt: boatListings.createdAt,
    })
    .from(boatListings)
    .where(eq(boatListings.status, "active"))
    .orderBy(desc(boatListings.isFeatured), desc(boatListings.priority), desc(boatListings.createdAt))
    .limit(8);
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
    title: ru.home.title,
    description: ru.home.description,
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
      { categories, title: ru.errors.notFoundTitle },
      404,
    );
    return;
  }

  const categoryIds = [
    category.id,
    ...category.children.map((child) => child.id),
  ];
  const [listings, [totalRow]] = await Promise.all([
    db
      .select({
        id: boatListings.id,
        slug: boatListings.slug,
        title: boatListings.title,
        price: boatListings.price,
        currency: boatListings.currency,
        isNegotiable: boatListings.isNegotiable,
        country: boatListings.country,
        cityOrRegion: boatListings.cityOrRegion,
        createdAt: boatListings.createdAt,
      })
      .from(boatListings)
      .where(
        and(
          inArray(boatListings.categoryId, categoryIds),
          eq(boatListings.status, "active"),
        ),
      )
      .orderBy(
        desc(boatListings.isFeatured),
        desc(boatListings.priority),
        desc(boatListings.createdAt),
      )
      .limit(20),
    db
      .select({ total: count() })
      .from(boatListings)
      .where(
        and(
          inArray(boatListings.categoryId, categoryIds),
          eq(boatListings.status, "active"),
        ),
      ),
  ]);
  const t = i18n.getFixedT("ru");

  await renderPage(res, "category", {
    categories,
    category,
    listings,
    total: totalRow.total,
    title: `${category.nameRu} — ${t("category.titleSuffix")} | ${ru.brand.name}`,
    description: t("category.description", { name: category.nameRu }),
    formatPrice,
  });
}

app.get("/", renderHome);
app.get("/category/:parentSlug/:slug", (req, res) =>
  renderCategory(req, res, req.params.parentSlug),
);
app.get("/category/:slug", (req, res) => renderCategory(req, res));
app.use(async (_req, res) => {
  await renderPage(
    res,
    "not-found",
    {
      title: ru.errors.notFoundTitle,
      heading: ru.errors.notFoundTitle,
      message: ru.errors.notFoundDescription,
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
          title: ru.errors.serverError,
          heading: ru.errors.serverError,
          message: ru.errors.serverError,
          description: ru.errors.serverError,
        },
        500,
      );
    } catch {
      res.status(500).send(ru.errors.serverError);
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

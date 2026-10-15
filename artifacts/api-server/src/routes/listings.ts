import { and, asc, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateListingBody,
  CreateListingResponse,
  GetFeaturedListingsResponse,
  GetListingParams,
  GetListingResponse,
  ListCategoriesResponse,
  ListListingsQueryParams,
  ListListingsResponse,
} from "@workspace/api-zod";
import { db, listingsTable } from "@workspace/db";

const router: IRouter = Router();

const categoryNames = [
  "Электроника",
  "Дом и дача",
  "Одежда и обувь",
  "Авто",
  "Работа",
  "Услуги",
  "Спорт и отдых",
];

router.get("/listings", async (req, res): Promise<void> => {
  const parsed = ListListingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { q, category, city, minPrice, maxPrice, sort, page, limit } =
    parsed.data;
  const filters = [];
  if (q?.trim()) {
    const pattern = `%${q.trim()}%`;
    filters.push(
      or(
        ilike(listingsTable.title, pattern),
        ilike(listingsTable.description, pattern),
      ),
    );
  }
  if (category) filters.push(eq(listingsTable.category, category));
  if (city?.trim()) filters.push(ilike(listingsTable.city, `%${city.trim()}%`));
  if (minPrice !== undefined) filters.push(gte(listingsTable.price, minPrice));
  if (maxPrice !== undefined) filters.push(lte(listingsTable.price, maxPrice));

  const where = filters.length ? and(...filters) : undefined;
  const ordering =
    sort === "price_asc"
      ? asc(listingsTable.price)
      : sort === "price_desc"
        ? desc(listingsTable.price)
        : desc(listingsTable.createdAt);

  const [items, [totalRow]] = await Promise.all([
    db
      .select()
      .from(listingsTable)
      .where(where)
      .orderBy(ordering)
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(listingsTable).where(where),
  ]);

  res.json(
    ListListingsResponse.parse({
      items,
      total: totalRow.total,
      page,
      limit,
    }),
  );
});

router.post("/listings", async (req, res): Promise<void> => {
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid listing payload");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [listing] = await db
    .insert(listingsTable)
    .values({
      ...parsed.data,
      contactPhone: parsed.data.contactPhone ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
    })
    .returning();

  res.status(201).json(CreateListingResponse.parse(listing));
});

router.get("/listings/featured", async (_req, res): Promise<void> => {
  const listings = await db
    .select()
    .from(listingsTable)
    .orderBy(desc(listingsTable.createdAt))
    .limit(6);
  res.json(GetFeaturedListingsResponse.parse(listings));
});

router.get("/listings/:id", async (req, res): Promise<void> => {
  const params = GetListingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, params.data.id))
    .limit(1);
  if (!listing) {
    res.status(404).json({ error: "Объявление не найдено" });
    return;
  }
  res.json(GetListingResponse.parse(listing));
});

router.get("/categories", async (_req, res): Promise<void> => {
  const counts = await db
    .select({
      name: listingsTable.category,
      count: count(),
    })
    .from(listingsTable)
    .groupBy(listingsTable.category);
  const countByName = new Map(counts.map((item) => [item.name, item.count]));

  res.json(
    ListCategoriesResponse.parse(
      categoryNames.map((name) => ({
        name,
        count: countByName.get(name) ?? 0,
      })),
    ),
  );
});

export default router;

INSERT INTO "boat_categories" ("slug", "name_ru", "name_en", "sort_order")
VALUES
  ('maloletnie-suda', 'Маломерные суда', NULL, 1),
  ('motornye-lodki', 'Моторные лодки', NULL, 2),
  ('katera-kayutnye', 'Катера каютные', NULL, 3),
  ('katera-otkrytye', 'Катера открытые', NULL, 4),
  ('motornye-yakhty', 'Моторные яхты', NULL, 5),
  ('parusnye-yakhty', 'Парусные яхты', NULL, 6),
  ('sudno-na-vozdushnoy-podushke', 'Судно на воздушной подушке', 'Hovercraft', 7),
  ('motory', 'Моторы', NULL, 8),
  ('pritsepy-i-transportirovka', 'Прицепы и транспортировка', NULL, 9),
  ('zapchasti-i-oborudovanie', 'Запчасти и оборудование', NULL, 10),
  ('arenda', 'Аренда', NULL, 11),
  ('mesta-na-stoyanke', 'Места на стоянке', NULL, 12),
  ('vsyakaya-vsyachina', 'Аксессуары, дельные вещи', 'Miscellaneous', 13)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "boat_categories" ("parent_id", "slug", "name_ru", "sort_order")
SELECT parent."id", seeded."slug", seeded."name_ru", seeded."sort_order"
FROM (
  VALUES
    ('maloletnie-suda', 's-podvesnym-motorom', 'С подвесным мотором', 1),
    ('maloletnie-suda', 'so-statsionarnym-motorom', 'Со стационарным мотором', 2),
    ('motornye-yakhty', 'motornye-yakhty-do-10-m', 'До 10 м', 1),
    ('motornye-yakhty', 'motornye-yakhty-do-15-m', 'До 15 м', 2),
    ('motornye-yakhty', 'motornye-yakhty-do-20-m', 'До 20 м', 3),
    ('parusnye-yakhty', 'parusnye-yakhty-do-10-m', 'До 10 м', 1),
    ('parusnye-yakhty', 'parusnye-yakhty-do-15-m', 'До 15 м', 2),
    ('parusnye-yakhty', 'parusnye-yakhty-do-20-m', 'До 20 м', 3),
    ('motory', 'podvesnye-motory', 'Подвесные', 1),
    ('motory', 'statsionarnye-motory', 'Стационарные', 2),
    ('arenda', 'arenda-lodok', 'Лодки', 1),
    ('arenda', 'arenda-katerov', 'Катера', 2),
    ('arenda', 'arenda-yakht', 'Яхты', 3),
    ('arenda', 'arenda-so-shkiperom', 'Со шкипером', 4),
    ('arenda', 'arenda-bez-shkipera', 'Без шкипера', 5),
    ('mesta-na-stoyanke', 'prodazha-mesta', 'Продажа места', 1),
    ('mesta-na-stoyanke', 'arenda-mesta', 'Аренда места', 2),
    ('mesta-na-stoyanke', 'mariny', 'Марины', 3),
    ('mesta-na-stoyanke', 'garazhi', 'Гаражи', 4),
    ('mesta-na-stoyanke', 'beregovaya-stoyanka', 'Береговая стоянка', 5),
    ('mesta-na-stoyanke', 'zimnee-hranenie', 'Зимнее хранение', 6)
) AS seeded("parent_slug", "slug", "name_ru", "sort_order")
INNER JOIN "boat_categories" AS parent ON parent."slug" = seeded."parent_slug"
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "forum_sections" (
  "slug", "title", "kind", "site_section_id", "censored", "rate_limit_sec", "sort_order"
)
SELECT
  'ads-' || category."slug",
  category."name_ru",
  'listing',
  category."id",
  true,
  10,
  category."sort_order" * 10
FROM "boat_categories" AS category
WHERE category."parent_id" IS NULL
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "forum_sections" (
  "slug", "title", "kind", "censored", "rate_limit_sec", "sort_order"
)
VALUES
  ('boaters', 'Вопросы лодочников', 'general', true, 5, 20000),
  ('offtopic', 'Оффтоп-болталка', 'offtopic', true, 10, 30000),
  ('flood', 'Флудильня', 'flood', false, 0, 40000)
ON CONFLICT ("slug") DO NOTHING;

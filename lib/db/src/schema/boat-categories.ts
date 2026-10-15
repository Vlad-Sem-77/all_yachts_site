import {
  AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const boatCategories = pgTable(
  "boat_categories",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id").references(
      (): AnyPgColumn => boatCategories.id,
      { onDelete: "set null" },
    ),
    slug: text("slug").notNull(),
    nameRu: text("name_ru").notNull(),
    nameEn: text("name_en"),
    descriptionRu: text("description_ru"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("boat_categories_slug_unique").on(table.slug),
    index("boat_categories_parent_order_idx").on(table.parentId, table.sortOrder),
  ],
);

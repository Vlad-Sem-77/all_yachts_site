import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { boatCategories } from "./boat-categories";

export const boatListings = pgTable(
  "boat_listings",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => boatCategories.id, { onDelete: "restrict" }),
    slug: text("slug"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    price: numeric("price", { precision: 12, scale: 2, mode: "number" }),
    currency: text("currency").notNull().default("RUB"),
    isNegotiable: boolean("is_negotiable").notNull().default(false),
    priceUnit: text("price_unit").notNull().default("total"),
    transactionType: text("transaction_type").notNull().default("sale"),
    year: integer("year"),
    lengthM: numeric("length_m", { precision: 7, scale: 2, mode: "number" }),
    widthM: numeric("width_m", { precision: 7, scale: 2, mode: "number" }),
    manufacturer: text("manufacturer"),
    model: text("model"),
    engineType: text("engine_type"),
    enginePowerHp: integer("engine_power_hp"),
    engineHours: numeric("engine_hours", {
      precision: 10,
      scale: 1,
      mode: "number",
    }),
    condition: text("condition").notNull(),
    country: text("country").notNull(),
    cityOrRegion: text("city_or_region").notNull(),
    waterArea: text("water_area"),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    telegram: text("telegram"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    authorPasswordHash: text("author_password_hash").notNull(),
    submissionIpHash: text("submission_ip_hash"),
    status: text("status").notNull().default("active"),
    viewCount: integer("view_count").notNull().default(0),
    isFeatured: boolean("is_featured").notNull().default(false),
    featuredUntil: timestamp("featured_until", { withTimezone: true }),
    boostedAt: timestamp("boosted_at", { withTimezone: true }),
    boostedUntil: timestamp("boosted_until", { withTimezone: true }),
    isPinned: boolean("is_pinned").notNull().default(false),
    pinnedUntil: timestamp("pinned_until", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    priority: integer("priority").notNull().default(0),
    paidStatus: text("paid_status").notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("boat_listings_slug_unique").on(table.slug),
    index("boat_listings_category_status_created_idx").on(
      table.categoryId,
      table.status,
      table.createdAt,
    ),
    index("boat_listings_featured_priority_idx").on(
      table.isFeatured,
      table.priority,
    ),
    index("boat_listings_ip_created_idx").on(
      table.submissionIpHash,
      table.createdAt,
    ),
  ],
);

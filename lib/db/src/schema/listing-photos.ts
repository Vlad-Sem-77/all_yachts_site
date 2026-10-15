import {
  AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { boatListings } from "./boat-listings";

export const listingPhotos = pgTable(
  "listing_photos",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references((): AnyPgColumn => boatListings.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    altText: text("alt_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("listing_photos_listing_order_idx").on(table.listingId, table.sortOrder),
  ],
);

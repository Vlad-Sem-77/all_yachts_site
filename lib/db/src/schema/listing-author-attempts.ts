import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { boatListings } from "./boat-listings";

export const listingAuthorAttempts = pgTable(
  "listing_author_attempts",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => boatListings.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    failures: integer("failures").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("listing_author_attempts_listing_ip_unique").on(
      table.listingId,
      table.ipHash,
    ),
    index("listing_author_attempts_lock_idx").on(table.lockedUntil),
  ],
);

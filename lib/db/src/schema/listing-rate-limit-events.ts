import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const listingRateLimitEvents = pgTable(
  "listing_rate_limit_events",
  {
    id: serial("id").primaryKey(),
    action: text("action").notNull(),
    ipHash: text("ip_hash").notNull(),
    listingId: integer("listing_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("listing_rate_limit_action_ip_created_idx").on(
      table.action,
      table.ipHash,
      table.createdAt,
    ),
  ],
);

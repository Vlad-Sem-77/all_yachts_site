import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { boatListings } from "./boat-listings";

export const listingViewEvents = pgTable(
  "listing_view_events",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => boatListings.id, { onDelete: "cascade" }),
    viewerHash: text("viewer_hash").notNull(),
    viewDate: date("view_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("listing_view_events_daily_unique").on(
      table.listingId,
      table.viewerHash,
      table.viewDate,
    ),
    index("listing_view_events_created_idx").on(table.createdAt),
  ],
);

import {
  AnyPgColumn,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { boatListings } from "./boat-listings";

export const listingReports = pgTable(
  "listing_reports",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references((): AnyPgColumn => boatListings.id, { onDelete: "cascade" }),
    reporterName: text("reporter_name"),
    reporterContact: text("reporter_contact"),
    reason: text("reason").notNull(),
    details: text("details"),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("listing_reports_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pendingListingUploads = pgTable(
  "pending_listing_uploads",
  {
    id: serial("id").primaryKey(),
    objectPath: text("object_path").notNull().unique(),
    draftTokenHash: text("draft_token_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pending_listing_uploads_draft_expiry_idx").on(
      table.draftTokenHash,
      table.expiresAt,
    ),
  ],
);

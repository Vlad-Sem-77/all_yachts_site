import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { forumUsers } from "./forum";

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull().default("site-admin"),
    action: text("action").notNull(),
    targetUserId: integer("target_user_id").references(() => forumUsers.id, {
      onDelete: "set null",
    }),
    previousValue: text("previous_value").notNull(),
    nextValue: text("next_value").notNull(),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_audit_logs_target_created_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
    check(
      "admin_audit_logs_action_check",
      sql`${table.action} in ('forum_role_changed', 'account_access_changed')`,
    ),
  ],
);

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;

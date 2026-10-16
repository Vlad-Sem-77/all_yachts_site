import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { boatCategories } from "./boat-categories";
import { boatListings } from "./boat-listings";

export const forumUsers = pgTable(
  "forum_users",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    displayName: text("display_name").notNull().default("Участник"),
    role: text("role").notNull().default("user"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("forum_users_clerk_user_id_uq").on(table.clerkUserId),
    check(
      "forum_users_role_check",
      sql`${table.role} in ('user', 'moderator', 'admin')`,
    ),
  ],
);

export const forumSections = pgTable(
  "forum_sections",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    siteSectionId: integer("site_section_id").references(
      () => boatCategories.id,
      { onDelete: "set null" },
    ),
    censored: boolean("censored").notNull().default(true),
    rateLimitSec: integer("rate_limit_sec").notNull().default(10),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("forum_sections_slug_uq").on(table.slug),
    uniqueIndex("forum_sections_site_section_uq")
      .on(table.siteSectionId)
      .where(sql`${table.siteSectionId} is not null`),
    check(
      "forum_sections_kind_check",
      sql`${table.kind} in ('listing', 'general', 'offtopic', 'flood')`,
    ),
    check("forum_sections_rate_limit_check", sql`${table.rateLimitSec} >= 0`),
  ],
);

export const forumTopics = pgTable(
  "forum_topics",
  {
    id: serial("id").primaryKey(),
    sectionId: integer("section_id")
      .notNull()
      .references(() => forumSections.id, { onDelete: "restrict" }),
    listingId: integer("listing_id").references(() => boatListings.id, {
      onDelete: "set null",
    }),
    authorId: integer("author_id")
      .notNull()
      .references(() => forumUsers.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    isLocked: boolean("is_locked").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("forum_topics_listing_uq")
      .on(table.listingId)
      .where(sql`${table.listingId} is not null`),
    index("forum_topics_section_order_idx").on(
      table.sectionId,
      table.isPinned,
      table.updatedAt,
    ),
    check("forum_topics_title_length_check", sql`length(${table.title}) between 1 and 160`),
  ],
);

export const forumPosts = pgTable(
  "forum_posts",
  {
    id: serial("id").primaryKey(),
    topicId: integer("topic_id")
      .notNull()
      .references(() => forumTopics.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => forumUsers.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    status: text("status").notNull().default("visible"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (table) => [
    index("forum_posts_topic_order_idx").on(
      table.topicId,
      table.createdAt,
      table.id,
    ),
    check(
      "forum_posts_status_check",
      sql`${table.status} in ('visible', 'hidden', 'deleted')`,
    ),
    check("forum_posts_body_length_check", sql`length(${table.body}) between 1 and 6000`),
  ],
);

export const forumReports = pgTable(
  "forum_reports",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => forumPosts.id, { onDelete: "cascade" }),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => forumUsers.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    resolvedBy: integer("resolved_by").references(() => forumUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("forum_reports_post_reporter_uq").on(
      table.postId,
      table.reporterId,
    ),
    index("forum_reports_queue_idx").on(table.resolved, table.createdAt),
  ],
);

export const forumSectionBans = pgTable(
  "forum_section_bans",
  {
    id: serial("id").primaryKey(),
    sectionId: integer("section_id")
      .notNull()
      .references(() => forumSections.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => forumUsers.id, { onDelete: "cascade" }),
    bannedBy: integer("banned_by").references(() => forumUsers.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("forum_section_bans_section_user_uq").on(
      table.sectionId,
      table.userId,
    ),
    index("forum_section_bans_user_idx").on(table.userId, table.sectionId),
  ],
);

export const insertForumUserSchema = createInsertSchema(forumUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertForumSectionSchema = createInsertSchema(forumSections).omit({
  id: true,
  createdAt: true,
});
export const insertForumTopicSchema = createInsertSchema(forumTopics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertForumPostSchema = createInsertSchema(forumPosts).omit({
  id: true,
  createdAt: true,
  editedAt: true,
});
export const insertForumReportSchema = createInsertSchema(forumReports).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});
export const insertForumSectionBanSchema = createInsertSchema(forumSectionBans).omit({
  id: true,
  createdAt: true,
});

export type ForumUser = typeof forumUsers.$inferSelect;
export type InsertForumUser = z.infer<typeof insertForumUserSchema>;
export type ForumSection = typeof forumSections.$inferSelect;
export type InsertForumSection = z.infer<typeof insertForumSectionSchema>;
export type ForumTopic = typeof forumTopics.$inferSelect;
export type InsertForumTopic = z.infer<typeof insertForumTopicSchema>;
export type ForumPost = typeof forumPosts.$inferSelect;
export type InsertForumPost = z.infer<typeof insertForumPostSchema>;
export type ForumReport = typeof forumReports.$inferSelect;
export type InsertForumReport = z.infer<typeof insertForumReportSchema>;
export type ForumSectionBan = typeof forumSectionBans.$inferSelect;
export type InsertForumSectionBan = z.infer<typeof insertForumSectionBanSchema>;

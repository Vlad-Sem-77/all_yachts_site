// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./listings";
export * from "./boat-categories";
export * from "./boat-listings";
export * from "./listing-photos";
export * from "./listing-reports";
export * from "./site-settings";
export * from "./listing-captcha-challenges";
export * from "./pending-listing-uploads";
export * from "./listing-author-attempts";
export * from "./listing-password-reset-tokens";
export * from "./listing-view-events";
export * from "./listing-rate-limit-events";
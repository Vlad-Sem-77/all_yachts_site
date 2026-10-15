import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const listingCaptchaChallenges = pgTable(
  "listing_captcha_challenges",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    answerHash: text("answer_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("listing_captcha_challenges_expiry_idx").on(table.expiresAt),
  ],
);

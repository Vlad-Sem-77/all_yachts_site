import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import {
  boatCategories,
  forumSections,
  forumUsers,
  type ForumUser,
} from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

export async function ensureForumSections(): Promise<void> {
  const roots = await db
    .select({
      id: boatCategories.id,
      slug: boatCategories.slug,
      title: boatCategories.nameRu,
      sortOrder: boatCategories.sortOrder,
    })
    .from(boatCategories)
    .where(and(eq(boatCategories.isActive, true), isNull(boatCategories.parentId)));

  for (const section of roots) {
    await db
      .insert(forumSections)
      .values({
        slug: `ads-${section.slug}`,
        title: section.title,
        kind: "listing",
        siteSectionId: section.id,
        censored: true,
        rateLimitSec: 10,
        sortOrder: section.sortOrder * 10,
      })
      .onConflictDoUpdate({
        target: forumSections.slug,
        set: {
          title: section.title,
          siteSectionId: section.id,
          sortOrder: section.sortOrder * 10,
        },
      });
  }

  const generalSections = [
    {
      slug: "boaters",
      title: "Вопросы лодочников",
      kind: "general",
      censored: true,
      rateLimitSec: 5,
      sortOrder: 20_000,
    },
    {
      slug: "offtopic",
      title: "Оффтоп-болталка",
      kind: "offtopic",
      censored: true,
      rateLimitSec: 10,
      sortOrder: 30_000,
    },
    {
      slug: "flood",
      title: "Флудильня",
      kind: "flood",
      censored: false,
      rateLimitSec: 0,
      sortOrder: 40_000,
    },
  ];

  for (const section of generalSections) {
    await db
      .insert(forumSections)
      .values(section)
      .onConflictDoUpdate({
        target: forumSections.slug,
        set: {
          title: section.title,
          kind: section.kind,
          censored: section.censored,
          rateLimitSec: section.rateLimitSec,
          sortOrder: section.sortOrder,
        },
      });
  }
}

export async function getOrCreateForumUser(
  clerkUserId: string,
): Promise<ForumUser | null> {
  const normalizedId = clerkUserId.trim();
  if (!normalizedId || normalizedId.length > 255) return null;

  await db
    .insert(forumUsers)
    .values({ clerkUserId: normalizedId })
    .onConflictDoNothing({ target: forumUsers.clerkUserId });

  const [user] = await db
    .select()
    .from(forumUsers)
    .where(eq(forumUsers.clerkUserId, normalizedId))
    .limit(1);

  return user ?? null;
}

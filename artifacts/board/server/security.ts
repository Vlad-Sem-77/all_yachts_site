import {
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Request } from "express";
import {
  and,
  count,
  eq,
  gte,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import {
  db,
  listingAuthorAttempts,
  listingCaptchaChallenges,
  listingRateLimitEvents,
} from "@workspace/db";

const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET is required for form security.");

function hmac(value: string): string {
  const signingSecret = process.env.SESSION_SECRET;
  if (!signingSecret) {
    throw new Error("SESSION_SECRET is required for form security.");
  }
  return createHmac("sha256", signingSecret).update(value).digest("hex");
}

function equalText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function getIpHash(req: Request): string {
  const address = req.ip || req.socket.remoteAddress || "unknown";
  return hmac(`ip:${address}`);
}

export function createCsrfToken(): string {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const nonce = randomUUID();
  const payload = `${expires}.${nonce}`;
  return `${payload}.${hmac(`csrf:${payload}`)}`;
}

export function verifyCsrfToken(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const [expiryText, nonce, signature, extra] = value.split(".");
  const expiry = Number(expiryText);
  if (!expiryText || !nonce || !signature || extra !== undefined) return false;
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) {
    return false;
  }
  return equalText(signature, hmac(`csrf:${expiryText}.${nonce}`));
}

export function hasSameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  const referer = req.get("referer");
  const candidate = origin || referer;
  if (!candidate) return true;
  try {
    return new URL(candidate).host === req.get("host");
  } catch {
    return false;
  }
}

export function validFormRequest(req: Request): boolean {
  return hasSameOrigin(req) && verifyCsrfToken(req.body?._csrf ?? req.get("x-csrf-token"));
}

export async function createMathChallenge(ipHash: string): Promise<{
  id: string;
  question: string;
}> {
  const first = randomInt(3, 19);
  const second = randomInt(2, 12);
  const id = randomUUID();
  const question = `${first} + ${second} = ?`;
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
  const answerHash = hmac(`captcha:${id}:${first + second}`);

  await db.insert(listingCaptchaChallenges).values({
    id,
    question,
    answerHash,
    ipHash,
    expiresAt,
  });

  return { id, question };
}

export async function isMathChallengeValid(
  id: unknown,
  answer: unknown,
  ipHash: string,
): Promise<boolean> {
  if (typeof id !== "string" || typeof answer !== "string") return false;
  if (!/^\d{1,3}$/.test(answer.trim())) return false;
  const [challenge] = await db
    .select()
    .from(listingCaptchaChallenges)
    .where(eq(listingCaptchaChallenges.id, id))
    .limit(1);
  if (
    !challenge ||
    challenge.ipHash !== ipHash ||
    challenge.consumedAt ||
    challenge.expiresAt.getTime() <= Date.now()
  ) {
    return false;
  }
  return equalText(
    challenge.answerHash,
    hmac(`captcha:${id}:${answer.trim()}`),
  );
}

export async function consumeMathChallenge(id: string): Promise<boolean> {
  const [row] = await db
    .update(listingCaptchaChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(listingCaptchaChallenges.id, id),
        isNull(listingCaptchaChallenges.consumedAt),
      ),
    )
    .returning({ id: listingCaptchaChallenges.id });
  return Boolean(row);
}

export function rateLimitLockKey(action: string, ipHash: string): number {
  return createHash("sha256")
    .update(`${action}:${ipHash}`)
    .digest()
    .readInt32BE(0);
}

export async function allowRateLimitedAction(
  action: string,
  ipHash: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMs);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${rateLimitLockKey(action, ipHash)})`,
    );
    const [current] = await tx
      .select({ total: count() })
      .from(listingRateLimitEvents)
      .where(
        and(
          eq(listingRateLimitEvents.action, action),
          eq(listingRateLimitEvents.ipHash, ipHash),
          gte(listingRateLimitEvents.createdAt, cutoff),
        ),
      );
    if (current.total >= limit) return false;
    await tx.insert(listingRateLimitEvents).values({ action, ipHash });
    await tx
      .delete(listingRateLimitEvents)
      .where(lt(listingRateLimitEvents.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000)));
    return true;
  });
}

export async function getAuthorLock(
  listingId: number,
  ipHash: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ lockedUntil: listingAuthorAttempts.lockedUntil })
    .from(listingAuthorAttempts)
    .where(
      and(
        eq(listingAuthorAttempts.listingId, listingId),
        eq(listingAuthorAttempts.ipHash, ipHash),
      ),
    )
    .limit(1);
  if (!row?.lockedUntil) return null;
  if (row.lockedUntil.getTime() <= Date.now()) {
    await db
      .update(listingAuthorAttempts)
      .set({ failures: 0, lockedUntil: null, updatedAt: new Date() })
      .where(
        and(
          eq(listingAuthorAttempts.listingId, listingId),
          eq(listingAuthorAttempts.ipHash, ipHash),
        ),
      );
    return null;
  }
  return row.lockedUntil;
}

export async function recordAuthorFailure(
  listingId: number,
  ipHash: string,
): Promise<Date | null> {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + 15 * 60 * 1000);
  const [row] = await db
    .insert(listingAuthorAttempts)
    .values({ listingId, ipHash, failures: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [listingAuthorAttempts.listingId, listingAuthorAttempts.ipHash],
      set: {
        failures: sql`${listingAuthorAttempts.failures} + 1`,
        updatedAt: now,
        lockedUntil: sql`CASE WHEN ${listingAuthorAttempts.failures} + 1 >= 5 THEN ${lockUntil} ELSE ${listingAuthorAttempts.lockedUntil} END`,
      },
    })
    .returning({
      failures: listingAuthorAttempts.failures,
      lockedUntil: listingAuthorAttempts.lockedUntil,
    });
  return row?.failures && row.failures >= 5 ? row.lockedUntil : null;
}

export async function clearAuthorFailures(
  listingId: number,
  ipHash: string,
): Promise<void> {
  await db
    .update(listingAuthorAttempts)
    .set({ failures: 0, lockedUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(listingAuthorAttempts.listingId, listingId),
        eq(listingAuthorAttempts.ipHash, ipHash),
      ),
    );
}

export function createAuthorAccessToken(listingId: number): string {
  const expires = Math.floor(Date.now() / 1000) + 30 * 60;
  const payload = `${listingId}.${expires}`;
  return `${payload}.${hmac(`author:${payload}`)}`;
}

export function verifyAuthorAccessToken(
  token: unknown,
  listingId: number,
): boolean {
  if (typeof token !== "string") return false;
  const [idText, expiryText, signature, extra] = token.split(".");
  if (!idText || !expiryText || !signature || extra !== undefined) return false;
  const expiry = Number(expiryText);
  if (
    Number(idText) !== listingId ||
    !Number.isSafeInteger(expiry) ||
    expiry < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }
  return equalText(
    signature,
    hmac(`author:${idText}.${expiryText}`),
  );
}

export function hashSecret(value: string): string {
  return hmac(`token:${value}`);
}

export function createOpaqueToken(): string {
  return randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
}

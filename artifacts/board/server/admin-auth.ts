import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";

export const ADMIN_COOKIE = "boat_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sign(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for admin sessions.");
  return createHmac("sha256", secret).update(`admin:${payload}`).digest("hex");
}

export function adminCredentialsConfigured(): boolean {
  return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

export function verifyAdminCredentials(username: unknown, password: unknown): boolean {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (
    !expectedUsername ||
    !expectedPassword ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 120 ||
    password.length > 256
  ) {
    return false;
  }
  return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}

export function createAdminSessionToken(): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expires}.${randomUUID()}`;
  return `${payload}.${sign(payload)}`;
}

export function isAdminSessionValid(token: unknown): boolean {
  if (typeof token !== "string") return false;
  const [expiryText, nonce, signature, extra] = token.split(".");
  const expires = Number(expiryText);
  if (
    !expiryText ||
    !nonce ||
    !signature ||
    extra !== undefined ||
    !Number.isSafeInteger(expires) ||
    expires < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }
  return safeEqual(signature, sign(`${expiryText}.${nonce}`));
}

export function setAdminSession(res: Response, token: string): void {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/admin",
  });
}

export function clearAdminSession(res: Response): void {
  res.clearCookie(ADMIN_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
  });
}

export function hasAdminSession(req: Request): boolean {
  return isAdminSessionValid(req.cookies?.[ADMIN_COOKIE]);
}

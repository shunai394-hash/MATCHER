import { timingSafeEqual } from "node:crypto";

export const INGESTION_SESSION_COOKIE = "matcher_ingestion_session";

export function ingestionTokenConfigured() {
  return Boolean(process.env.MATCHER_INGESTION_ADMIN_TOKEN && process.env.MATCHER_INGESTION_ADMIN_TOKEN.length >= 32);
}

export function matchesIngestionToken(candidate: unknown): boolean {
  const expected = process.env.MATCHER_INGESTION_ADMIN_TOKEN;
  if (!expected || expected.length < 32 || typeof candidate !== "string") return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasIngestionSession(request: Request): boolean {
  const expected = process.env.MATCHER_INGESTION_ADMIN_TOKEN;
  if (!expected || expected.length < 32) return false;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${INGESTION_SESSION_COOKIE}=`));
  if (!cookie) return false;
  let value = "";
  try {
    value = decodeURIComponent(cookie.slice(INGESTION_SESSION_COOKIE.length + 1));
  } catch {
    return false;
  }
  return matchesIngestionToken(value);
}

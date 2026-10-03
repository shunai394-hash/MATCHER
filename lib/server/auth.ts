import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/server/supabase";

/**
 * Server-side authorization helpers.
 *
 * - Users: a Supabase Auth access token (`Authorization: Bearer <access_token>`), verified
 *   with Supabase Auth on every request (never trusted from the JWT payload alone).
 *   Roles come from MATCHER_PURCHASER_EMAILS / MATCHER_ADMIN_EMAILS (comma separated) or
 *   from `app_metadata.matcher_role` ("purchaser" | "admin"), which only the service role can set.
 * - Machines: MATCHER_INGEST_TOKEN (`x-matcher-ingest-token`) or Vercel Cron's `Bearer $CRON_SECRET`.
 */

export type MatcherRole = "purchaser" | "admin";
export type AuthUser = { id: string; email: string | null; roles: Set<MatcherRole> };

function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function emailList(name: string) {
  return new Set((process.env[name] ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

export function hasOpsToken(request: Request) {
  if (safeEqual(request.headers.get("x-matcher-ingest-token"), process.env.MATCHER_INGEST_TOKEN)) return true;
  return safeEqual(bearer(request), process.env.CRON_SECRET);
}

export function hasReviewToken(request: Request) {
  return safeEqual(request.headers.get("x-matcher-review-token"), process.env.MATCHER_REVIEW_TOKEN);
}

/** Returns the verified Supabase user for the request, or null (no / invalid / expired token). */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const token = bearer(request);
  if (!token || token === process.env.CRON_SECRET) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data?.user) return null;
  const user = data.user;
  const email = user.email?.toLowerCase() ?? null;
  const roles = new Set<MatcherRole>();
  const metaRole = (user.app_metadata as Record<string, unknown> | undefined)?.matcher_role;
  if (metaRole === "admin" || (email && emailList("MATCHER_ADMIN_EMAILS").has(email))) roles.add("admin");
  if (metaRole === "purchaser" || roles.has("admin") || (email && emailList("MATCHER_PURCHASER_EMAILS").has(email))) roles.add("purchaser");
  return { id: user.id, email, roles };
}

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; status: 401 | 403; error: string };

export async function requireUserRole(request: Request, role: MatcherRole): Promise<AuthResult> {
  const user = await getAuthUser(request);
  if (!user) return { ok: false, status: 401, error: "AUTH_REQUIRED" };
  if (!user.roles.has(role)) return { ok: false, status: 403, error: role === "admin" ? "ADMIN_ROLE_REQUIRED" : "PURCHASER_ROLE_REQUIRED" };
  return { ok: true, user };
}

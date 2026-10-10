import { NextResponse } from "next/server";
import { INGESTION_SESSION_COOKIE, createIngestionSessionValue, hasIngestionSession, ingestionTokenConfigured, matchesIngestionToken } from "../../../../lib/matcher/ingestion/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    configured: ingestionTokenConfigured(),
    authenticated: ingestionTokenConfigured() && hasIngestionSession(request),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!ingestionTokenConfigured()) {
    return NextResponse.json({ ok: false, code: "INGESTION_AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }
  const token = body && typeof body === "object" && !Array.isArray(body) ? (body as { token?: unknown }).token : undefined;
  if (!matchesIngestionToken(token)) {
    return NextResponse.json({ ok: false, code: "INVALID_INGESTION_CREDENTIALS" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(INGESTION_SESSION_COOKIE, createIngestionSessionValue(String(token)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/ingestion",
    maxAge: 8 * 60 * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(INGESTION_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/ingestion",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

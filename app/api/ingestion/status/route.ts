import { NextResponse } from "next/server";
import { ingestionConfiguration } from "../../../../lib/matcher/ingestion/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    ingestion: ingestionConfiguration(),
    truth: "No configured source means no opportunity data is fabricated.",
  });
}
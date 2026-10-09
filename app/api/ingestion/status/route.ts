import { NextResponse } from "next/server";
import { ingestionConfiguration } from "../../../../lib/matcher/ingestion/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ingestion = ingestionConfiguration();
  const supabaseUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  const serviceKeyConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const databaseConfigured = supabaseUrlConfigured && serviceKeyConfigured;
  const missingDatabaseCredentials = [
    ...(!supabaseUrlConfigured ? ["NEXT_PUBLIC_SUPABASE_URL"] : []),
    ...(!serviceKeyConfigured ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];

  return NextResponse.json({
    ok: true,
    ...ingestion,
    database: {
      configured: databaseConfigured,
      missing: missingDatabaseCredentials,
    },
    readyForScan: ingestion.configured && databaseConfigured,
  });
}

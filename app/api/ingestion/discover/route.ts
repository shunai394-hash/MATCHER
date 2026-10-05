import { NextResponse } from "next/server";
import { configuredSupplierAdapter } from "../../../../lib/matcher/ingestion/config";
import { validateSourceProduct } from "../../../../lib/matcher/ingestion/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const adapter = configuredSupplierAdapter();
  if (!adapter) return NextResponse.json({ ok: false, code: "SUPPLIER_SOURCE_NOT_CONFIGURED" }, { status: 503 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const items = await adapter.discover(controller.signal);
    const accepted = items.filter((item) => validateSourceProduct(item).length === 0);
    const rejected = items.length - accepted.length;
    return NextResponse.json({ ok: true, source: adapter.key, discovered: items.length, accepted: accepted.length, rejected });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_SOURCE_ERROR";
    return NextResponse.json({ ok: false, code: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
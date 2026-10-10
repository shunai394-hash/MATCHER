import { NextResponse } from "next/server";
import { hasIngestionSession, ingestionTokenConfigured } from "../../../../lib/matcher/ingestion/auth";
import { configuredSupplierAdapter } from "../../../../lib/matcher/ingestion/config";
import { validateSourceProduct } from "../../../../lib/matcher/ingestion/validate";
import { persistSupplierDiscovery } from "../../../../lib/matcher/ingestion/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!ingestionTokenConfigured()) {
    return NextResponse.json({ ok: false, code: "INGESTION_AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!hasIngestionSession(request)) {
    return NextResponse.json({ ok: false, code: "INGESTION_AUTH_REQUIRED" }, { status: 401 });
  }
  const adapter = configuredSupplierAdapter();
  if (!adapter) return NextResponse.json({ ok: false, code: "SUPPLIER_SOURCE_NOT_CONFIGURED" }, { status: 503 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const items = await adapter.discover(controller.signal);
    const accepted = items.filter((item) => validateSourceProduct(item).length === 0);
    const rejected = items.length - accepted.length;
    const persisted = [];
    for (const item of accepted) persisted.push(await persistSupplierDiscovery(adapter.key, item, controller.signal));
    return NextResponse.json({ ok: true, source: adapter.key, discovered: items.length, accepted: accepted.length, rejected, persisted: persisted.length });
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    const message = timedOut ? "SCAN_TIMEOUT" : error instanceof Error ? error.message : "UNKNOWN_SOURCE_ERROR";
    return NextResponse.json({ ok: false, code: message }, { status: timedOut ? 504 : 502 });
  } finally {
    clearTimeout(timeout);
  }
}
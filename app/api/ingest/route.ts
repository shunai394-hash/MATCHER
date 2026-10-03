import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";

type SupplierItem = {
  supplierKey: string;
  supplierName: string;
  supplierProductId: string;
  title?: string;
  brand?: string;
  modelNumber?: string;
  sourceUrl?: string;
  cost?: number;
  shippingCost?: number;
  inventory?: number;
  orderability?: "ORDERABLE" | "OUT_OF_STOCK" | "UNKNOWN" | "BLOCKED";
  currency?: string;
  identifiers?: Array<{ type: "JAN" | "EAN" | "UPC" | "MPN" | "SKU" | "SUPPLIER_PRODUCT_NO"; value: string }>;
  source?: string;
};

type MarketObservation = {
  masterProductId: string;
  productVariantId?: string;
  source: string;
  sourceProductId?: string;
  salePrice: number;
  paymentFee?: number;
  marketplaceFee?: number;
  tax?: number;
  otherCost?: number;
  sold?: boolean;
  sourceUrl?: string;
};

function auth(request: Request) {
  const expected = process.env.MATCHER_INGEST_TOKEN;
  return !!expected && request.headers.get("x-matcher-ingest-token") === expected;
}

export async function POST(request: Request) {
  if (!auth(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const body = await request.json() as {
    source: string;
    supplierItems?: SupplierItem[];
    marketObservations?: MarketObservation[];
  };
  const source = String(body.source ?? "").trim();
  if (!source) return NextResponse.json({ error: "SOURCE_REQUIRED" }, { status: 400 });

  const run = await supabase.from("ingestion_run").insert({ source, status: "RUNNING" }).select("id").single();
  if (run.error) return NextResponse.json({ error: run.error.message }, { status: 500 });

  let itemCount = 0;
  let errorCount = 0;
  try {
    for (const item of body.supplierItems ?? []) {
      const supplier = await supabase.from("suppliers").upsert(
        { supplier_key: item.supplierKey, name: item.supplierName, status: "ACTIVE" },
        { onConflict: "supplier_key" },
      ).select("id").single();
      if (supplier.error) throw supplier.error;

      const product = await supabase.from("supplier_product").upsert({
        supplier_id: supplier.data.id,
        supplier_product_id: item.supplierProductId,
        title: item.title ?? null,
        brand: item.brand ?? null,
        model_number: item.modelNumber ?? null,
        source_url: item.sourceUrl ?? null,
        source_updated_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
      }, { onConflict: "supplier_id,supplier_product_id" }).select("id").single();
      if (product.error) throw product.error;

      const offer = await supabase.from("supplier_offer").insert({
        supplier_product_id: product.data.id,
        cost: item.cost ?? null,
        shipping_cost: item.shippingCost ?? null,
        currency: item.currency ?? "JPY",
        inventory: item.inventory ?? null,
        orderability: item.orderability ?? "UNKNOWN",
        observed_at: new Date().toISOString(),
        shipping_verified: item.shippingCost != null,
      }).select("id").single();
      if (offer.error) throw offer.error;

      for (const identifier of item.identifiers ?? []) {
        await supabase.from("supplier_product_identifier").upsert({
          supplier_product_id: product.data.id,
          identifier_type: identifier.type,
          identifier_value: identifier.value,
          normalized_value: identifier.value.trim().toUpperCase().replace(/[-\s]/g, ""),
          source,
        }, { onConflict: "supplier_product_id,identifier_type,normalized_value" });
      }

      const now = new Date().toISOString();
      await supabase.from("supplier_offer_freshness").upsert({
        supplier_offer_id: offer.data.id,
        price_observed_at: item.cost != null ? now : null,
        inventory_observed_at: item.inventory != null ? now : null,
        shipping_observed_at: item.shippingCost != null ? now : null,
        checked_at: now,
      }, { onConflict: "supplier_offer_id" });

      itemCount += 1;
    }

    for (const observation of body.marketObservations ?? []) {
      const result = await supabase.from("market_price_observation").insert({
        ...observation,
        observed_at: new Date().toISOString(),
      });
      if (result.error) throw result.error;
      itemCount += 1;
    }

    await supabase.from("ingestion_run").update({
      status: errorCount ? "PARTIAL" : "SUCCEEDED",
      item_count: itemCount,
      error_count: errorCount,
      finished_at: new Date().toISOString(),
    }).eq("id", run.data.id);

    return NextResponse.json({ ok: true, runId: run.data.id, itemCount, errorCount });
  } catch (error) {
    await supabase.from("ingestion_run").update({
      status: "FAILED",
      item_count: itemCount,
      error_count: errorCount + 1,
      finished_at: new Date().toISOString(),
    }).eq("id", run.data.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "INGESTION_FAILED", runId: run.data.id }, { status: 500 });
  }
}

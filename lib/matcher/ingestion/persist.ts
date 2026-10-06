import { createClient } from "@supabase/supabase-js";
import type { SourceProduct } from "./types";

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVER_CREDENTIALS_NOT_CONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function persistSupplierDiscovery(sourceKey: string, item: SourceProduct) {
  const supabase = db();

  const supplier = await supabase
    .from("supplier")
    .upsert({ name: sourceKey, status: "ACTIVE" }, { onConflict: "name" })
    .select("id")
    .single();
  if (supplier.error) throw new Error(`SUPPLIER_UPSERT_FAILED:${supplier.error.message}`);

  const product = await supabase
    .from("supplier_product")
    .upsert({
      supplier_id: supplier.data.id,
      supplier_product_id: item.externalId,
      brand: item.brand,
      product_name: item.productName,
      manufacturer: item.manufacturer,
      model_number: item.modelNumber,
      color: item.color,
      size: item.size,
      capacity: item.capacity,
      generation: item.generation,
      set_count: item.setCount,
      condition: item.condition,
      source_url: item.sourceUrl,
      last_seen_at: item.observedAt,
    }, { onConflict: "supplier_id,supplier_product_id" })
    .select("id")
    .single();
  if (product.error) throw new Error(`SUPPLIER_PRODUCT_UPSERT_FAILED:${product.error.message}`);

  for (const identifier of item.identifiers ?? []) {
    const result = await supabase.from("supplier_product_identifier").upsert({
      supplier_product_id: product.data.id,
      identifier_type: identifier.type,
      identifier_value: identifier.value,
    }, { onConflict: "supplier_product_id,identifier_type,identifier_value" });
    if (result.error) throw new Error(`IDENTIFIER_UPSERT_FAILED:${result.error.message}`);
  }

  const offer = await supabase
    .from("supplier_offer")
    .upsert({
      supplier_product_id: product.data.id,
      currency: item.currency ?? "JPY",
      orderability: item.orderability ?? "UNKNOWN",
    }, { onConflict: "supplier_product_id" })
    .select("id")
    .single();
  if (offer.error) throw new Error(`OFFER_UPSERT_FAILED:${offer.error.message}`);

  const observedAt = item.observedAt ?? new Date().toISOString();
  const snapshot = await supabase.from("supplier_offer_snapshot").insert({
    supplier_offer_id: offer.data.id,
    supplier_cost: item.cost,
    shipping_cost: item.shippingCost,
    inventory: item.inventory,
    shipping_confidence: item.shippingCost == null ? null : 1,
    observed_at: observedAt,
  });
  if (snapshot.error) throw new Error(`SNAPSHOT_INSERT_FAILED:${snapshot.error.message}`);

  const freshness = await supabase.from("supplier_offer_freshness").upsert({
    supplier_offer_id: offer.data.id,
    price_observed_at: item.cost == null ? null : observedAt,
    inventory_observed_at: item.inventory == null ? null : observedAt,
    shipping_observed_at: item.shippingCost == null ? null : observedAt,
  }, { onConflict: "supplier_offer_id" });
  if (freshness.error) throw new Error(`FRESHNESS_UPSERT_FAILED:${freshness.error.message}`);

  return { supplierId: supplier.data.id, supplierProductId: product.data.id, supplierOfferId: offer.data.id };
}
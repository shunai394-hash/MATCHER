import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";

type Opportunity = {
  masterProductId: string;
  productName: string;
  brand: string | null;
  supplierName: string;
  supplierOfferId: string;
  supplierProductId: string;
  salePrice: number;
  supplierCost: number | null;
  shippingCost: number | null;
  expectedProfit: number | null;
  currency: string;
  inventory: number | null;
  calculatedAt: string;
  gateStatus: string | null;
};

function latestBy<T extends { supplier_offer_id: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.supplier_offer_id)) map.set(row.supplier_offer_id, row);
  }
  return [...map.values()];
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(request.url);
    const minProfit = Math.max(0, Number(url.searchParams.get("minProfit") ?? 0) || 0);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));

    const { data: rawProfits, error: profitError } = await supabase
      .from("profit_snapshot")
      .select("supplier_offer_id,sale_price,supplier_cost,shipping_cost,expected_profit,cost_complete,calculated_at")
      .eq("cost_complete", true)
      .gt("expected_profit", minProfit)
      .order("calculated_at", { ascending: false })
      .limit(500);
    if (profitError) throw profitError;

    const profits = latestBy(rawProfits ?? []);
    if (!profits.length) {
      return NextResponse.json({ opportunities: [], total: 0, minProfit });
    }

    const offerIds = profits.map((row) => row.supplier_offer_id);
    const { data: offers, error: offerError } = await supabase
      .from("supplier_offer")
      .select("id,supplier_product_id,currency,inventory,orderability")
      .in("id", offerIds);
    if (offerError) throw offerError;

    const offerMap = new Map((offers ?? []).map((row) => [row.id, row]));
    const supplierProductIds = [...new Set((offers ?? []).map((row) => row.supplier_product_id))];
    const { data: supplierProducts, error: supplierProductError } = supplierProductIds.length
      ? await supabase
          .from("supplier_product")
          .select("id,supplier_id,title,source_url")
          .in("id", supplierProductIds)
      : { data: [], error: null };
    if (supplierProductError) throw supplierProductError;

    const supplierProductMap = new Map((supplierProducts ?? []).map((row) => [row.id, row]));
    const supplierIds = [...new Set((supplierProducts ?? []).map((row) => row.supplier_id))];
    const { data: suppliers, error: supplierError } = supplierIds.length
      ? await supabase.from("suppliers").select("id,name").in("id", supplierIds)
      : { data: [], error: null };
    if (supplierError) throw supplierError;

    const supplierMap = new Map((suppliers ?? []).map((row) => [row.id, row]));

    const gateRows = await supabase
      .from("quality_gate_result")
      .select("supplier_offer_id,status,evaluated_at")
      .in("supplier_offer_id", offerIds)
      .order("evaluated_at", { ascending: false })
      .limit(500);
    if (gateRows.error) throw gateRows.error;
    const gates = latestBy(gateRows.data ?? []);
    const gateMap = new Map(gates.map((row) => [row.supplier_offer_id, row]));

    const masterIds = [...new Set((supplierProducts ?? []).map((row) => row.id))];
    const { data: links, error: linkError } = await supabase
      .from("match_result")
      .select("supplier_product_id,master_product_id,confidence,decision,created_at")
      .in("supplier_product_id", masterIds.length ? masterIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("decision", "AUTO_LINK")
      .not("master_product_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (linkError) throw linkError;

    const linkMap = new Map<string, { masterProductId: string; confidence: number }>();
    for (const row of links ?? []) {
      if (!linkMap.has(row.supplier_product_id) && row.master_product_id) {
        linkMap.set(row.supplier_product_id, {
          masterProductId: row.master_product_id,
          confidence: Number(row.confidence ?? 0),
        });
      }
    }

    const linkedMasterIds = [...new Set([...linkMap.values()].map((row) => row.masterProductId))];
    const { data: masters, error: masterError } = linkedMasterIds.length
      ? await supabase.from("master_product").select("id,product_name,brand").in("id", linkedMasterIds)
      : { data: [], error: null };
    if (masterError) throw masterError;
    const masterMap = new Map((masters ?? []).map((row) => [row.id, row]));

    const opportunities: Opportunity[] = [];
    for (const profit of profits) {
      const offer = offerMap.get(profit.supplier_offer_id);
      if (!offer || offer.orderability !== "ORDERABLE") continue;
      const supplierProduct = supplierProductMap.get(offer.supplier_product_id);
      const link = linkMap.get(offer.supplier_product_id);
      if (!supplierProduct || !link) continue;
      const master = masterMap.get(link.masterProductId);
      const supplier = supplierMap.get(supplierProduct.supplier_id);
      if (!master || !supplier) continue;
      const gate = gateMap.get(profit.supplier_offer_id);
      if (gate?.status && gate.status !== "SELLABLE") continue;

      opportunities.push({
        masterProductId: master.id,
        productName: master.product_name,
        brand: master.brand,
        supplierName: supplier.name,
        supplierOfferId: offer.id,
        supplierProductId: supplierProduct.id,
        salePrice: Number(profit.sale_price),
        supplierCost: profit.supplier_cost == null ? null : Number(profit.supplier_cost),
        shippingCost: profit.shipping_cost == null ? null : Number(profit.shipping_cost),
        expectedProfit: profit.expected_profit == null ? null : Number(profit.expected_profit),
        currency: offer.currency ?? "JPY",
        inventory: offer.inventory == null ? null : Number(offer.inventory),
        calculatedAt: profit.calculated_at,
        gateStatus: gate?.status ?? null,
      });
    }

    opportunities.sort((a, b) => (b.expectedProfit ?? -Infinity) - (a.expectedProfit ?? -Infinity));
    return NextResponse.json({
      opportunities: opportunities.slice(0, limit),
      total: opportunities.length,
      minProfit,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OPPORTUNITIES_FAILED" },
      { status: 500 },
    );
  }
}

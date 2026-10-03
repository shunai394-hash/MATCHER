import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";

const tables = ["master_product","product_identifier","product_variant","supplier_product","supplier_offer","supplier_offer_snapshot","supplier_offer_freshness","identity_match","quality_gate_result"];

export async function POST() {
  try {
    const db = getSupabaseAdmin();
    const { data: run, error: runError } = await db.from("quality_patrol_run").insert({ status: "RUNNING", summary: {} }).select("id").single();
    if (runError) throw runError;
    const checks = [];
    for (const table of tables) {
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
      checks.push(error ? { code: `TABLE_${table}`, severity: "ERROR", details: { error: error.message } } : { code: `OK_${table}`, severity: "INFO", details: { count: count ?? 0 } });
    }
    const { data: policies, error: policyError } = await db.from("freshness_policy").select("data_type,max_age_seconds");
    if (policyError) throw policyError;
    for (const type of ["PRICE","INVENTORY","SHIPPING"]) {
      const p = policies?.find((x) => x.data_type === type);
      checks.push(p && p.max_age_seconds > 0 ? { code: `FRESHNESS_${type}`, severity: "INFO", details: { maxAgeSeconds: p.max_age_seconds } } : { code: `FRESHNESS_${type}`, severity: "ERROR", details: { message: "policy missing" } });
    }
    for (const check of checks) await db.from("quality_diagnosis").insert({ patrol_run_id: run.id, severity: check.severity, code: check.code, details: check.details });
    const errors = checks.filter((x) => x.severity === "ERROR").length;
    const warnings = checks.filter((x) => x.severity === "WARN").length;
    const status = errors ? "FAILED" : "PASSED";
    const summary = { checks: checks.length, errors, warnings, generatedAt: new Date().toISOString() };
    await db.from("quality_patrol_run").update({ finished_at: new Date().toISOString(), status, summary }).eq("id", run.id);
    return NextResponse.json({ runId: run.id, status, summary, checks });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "QUALITY_PATROL_FAILED" }, { status: 500 });
  }
}
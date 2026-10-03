import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { buildFreshnessPolicy } from "@/lib/matcher/opportunity";
import { hasOpsToken, requireUserRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const tables = [
  "master_product", "product_identifier", "product_variant", "suppliers",
  "supplier_product", "supplier_product_identifier", "supplier_offer", "supplier_offer_snapshot", "supplier_offer_freshness",
  "identity_match", "market_price_observation", "purchase_review", "quality_patrol_run", "quality_diagnosis", "profit_snapshot", "quality_gate_result", "freshness_policy", "ingestion_run",
];

type Check = { code: string; severity: "INFO" | "WARN" | "ERROR"; details: Record<string, unknown> };

const HOUR = 60 * 60 * 1000;

export async function POST(request: Request) {
  // Patrol writes diagnosis rows: only operators (ops token / cron) or admin users may run it.
  if (!hasOpsToken(request)) {
    const auth = await requireUserRole(request, "admin");
    if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "QUALITY_PATROL_AUTH_REQUIRED" : auth.error }, { status: auth.status });
  }
  try {
    const db = getSupabaseAdmin();
    const { data: run, error: runError } = await db.from("quality_patrol_run").insert({ status: "RUNNING", summary: {} }).select("id").single();
    if (runError) throw runError;
    const checks: Check[] = [];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
      if (error) checks.push({ code: `TABLE_${table}`, severity: "ERROR", details: { error: error.message } });
      else {
        counts[table] = count ?? 0;
        checks.push({ code: `OK_${table}`, severity: "INFO", details: { count: count ?? 0 } });
      }
    }

    const { data: policies, error: policyError } = await db.from("freshness_policy").select("*");
    if (policyError) throw policyError;
    const policy = buildFreshnessPolicy((policies ?? []) as Array<Record<string, unknown>>);
    for (const type of ["PRICE", "INVENTORY", "SHIPPING"]) {
      const maxAge = policy.get(type);
      checks.push(maxAge ? { code: `FRESHNESS_${type}`, severity: "INFO", details: { maxAgeSeconds: maxAge } } : { code: `FRESHNESS_${type}`, severity: "ERROR", details: { message: "policy missing" } });
    }

    // Pipeline health: is anything feeding the daily opportunity list?
    const { data: lastIngest, error: ingestError } = await db.from("ingestion_run").select("status,started_at,finished_at,error_count").order("started_at", { ascending: false }).limit(1);
    if (ingestError) throw ingestError;
    const ingest = lastIngest?.[0];
    if (!ingest) checks.push({ code: "PIPELINE_NO_INGESTION", severity: "WARN", details: { message: "no supplier/market data has ever been ingested" } });
    else {
      const ageHours = Math.round((Date.now() - new Date(ingest.started_at).getTime()) / HOUR);
      checks.push({ code: "PIPELINE_LAST_INGESTION", severity: ingest.status === "SUCCEEDED" && ageHours <= 24 ? "INFO" : "WARN", details: { ...ingest, ageHours } });
    }
    const { data: lastGate, error: gateError } = await db.from("quality_gate_result").select("evaluated_at").order("evaluated_at", { ascending: false }).limit(1);
    if (gateError) throw gateError;
    const gateAt = lastGate?.[0]?.evaluated_at;
    checks.push(gateAt
      ? { code: "PIPELINE_LAST_RECOMPUTE", severity: Date.now() - new Date(gateAt).getTime() <= 24 * HOUR ? "INFO" : "WARN", details: { evaluatedAt: gateAt } }
      : { code: "PIPELINE_NEVER_RECOMPUTED", severity: "WARN", details: { message: "quality gate has never been evaluated" } });
    const { count: candidateCount, error: candidateError } = await db.from("master_product").select("id", { count: "exact", head: true }).eq("approval_status", "CANDIDATE");
    if (candidateError) throw candidateError;
    if ((candidateCount ?? 0) > 0) checks.push({ code: "MASTER_CANDIDATES_AWAITING_REVIEW", severity: "WARN", details: { count: candidateCount } });
    if ((counts.supplier_product ?? 0) > 0 && (counts.identity_match ?? 0) === 0) {
      checks.push({ code: "PIPELINE_NO_IDENTITY_MATCH", severity: "WARN", details: { message: "supplier products exist but none were matched; run /api/opportunities/recompute" } });
    }

    for (const check of checks) {
      const { error } = await db.from("quality_diagnosis").insert({ patrol_run_id: run.id, severity: check.severity, code: check.code, details: check.details });
      if (error) throw error;
    }
    const errors = checks.filter((x) => x.severity === "ERROR").length;
    const warnings = checks.filter((x) => x.severity === "WARN").length;
    const status = errors ? "FAILED" : "PASSED";
    const summary = { checks: checks.length, errors, warnings, generatedAt: new Date().toISOString() };
    const { error: finishError } = await db.from("quality_patrol_run").update({ finished_at: new Date().toISOString(), status, summary }).eq("id", run.id);
    if (finishError) throw finishError;
    return NextResponse.json({ runId: run.id, status, summary, checks });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "QUALITY_PATROL_FAILED" }, { status: 500 });
  }
}

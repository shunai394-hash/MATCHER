import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getAuthUser, hasReviewToken } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/purchase";
import { recomputeOpportunities } from "@/lib/server/recompute";

export const dynamic = "force-dynamic";

/**
 * Human decision on a master candidate.
 * approve → status ACTIVE + approval APPROVED; the next identity sync may then AUTO_LINK
 *           supplier products to it on identifier evidence (never because it was "the only one").
 * reject  → stays INACTIVE + approval REJECTED; it is never proposed again for that supplier product.
 */
export async function POST(request: Request) {
  let reviewer: string | null = null;
  if (hasReviewToken(request)) reviewer = "review-token";
  else {
    const user = await getAuthUser(request);
    if (user?.roles.has("admin")) reviewer = user.email ?? user.id;
    else return NextResponse.json({ error: user ? "ADMIN_ROLE_REQUIRED" : "REVIEW_AUTH_REQUIRED" }, { status: user ? 403 : 401 });
  }
  let body: { masterProductId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (!isUuid(body.masterProductId) || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json({ error: "REVIEW_INPUT_REQUIRED" }, { status: 400 });
  }
  try {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const patch = body.action === "approve"
      ? { approval_status: "APPROVED", status: "ACTIVE", reviewed_at: now, reviewed_by: reviewer }
      : { approval_status: "REJECTED", status: "INACTIVE", reviewed_at: now, reviewed_by: reviewer };
    // Only candidates can be decided here; approved masters are managed elsewhere.
    const { data, error } = await db.from("master_product").update(patch)
      .eq("id", body.masterProductId)
      .eq("approval_status", "CANDIDATE")
      .select("id,approval_status,status");
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: "MASTER_CANDIDATE_NOT_FOUND" }, { status: 404 });
    // Re-evaluate identity/profit/gate so the decision takes effect immediately.
    const recompute = await recomputeOpportunities(db);
    return NextResponse.json({ ok: true, master: data[0], recompute });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "MASTER_REVIEW_FAILED" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { hasReviewToken, requireUserRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Master product candidates proposed from supplier data, waiting for a human decision. */
export async function GET(request: Request) {
  if (!hasReviewToken(request)) {
    const auth = await requireUserRole(request, "admin");
    if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "REVIEW_AUTH_REQUIRED" : auth.error }, { status: auth.status });
  }
  const status = (new URL(request.url).searchParams.get("approvalStatus") ?? "CANDIDATE").toUpperCase();
  if (!["CANDIDATE", "APPROVED", "REJECTED"].includes(status)) return NextResponse.json({ error: "INVALID_APPROVAL_STATUS" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data: masters, error } = await db
    .from("master_product")
    .select("id,brand,product_name,manufacturer,model_number,status,approval_status,origin,origin_supplier_product_id,created_at,reviewed_at,reviewed_by")
    .eq("approval_status", status)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (masters ?? []).map((m) => m.id as string);
  const { data: identifiers, error: idError } = ids.length
    ? await db.from("product_identifier").select("master_product_id,identifier_type,identifier_value").in("master_product_id", ids)
    : { data: [], error: null };
  if (idError) return NextResponse.json({ error: idError.message }, { status: 500 });
  const originIds = (masters ?? []).map((m) => m.origin_supplier_product_id as string | null).filter((v): v is string => !!v);
  const { data: origins, error: originError } = originIds.length
    ? await db.from("supplier_product").select("id,supplier_product_id,product_name,source_url").in("id", originIds)
    : { data: [], error: null };
  if (originError) return NextResponse.json({ error: originError.message }, { status: 500 });
  return NextResponse.json({
    masters: (masters ?? []).map((m) => ({
      ...m,
      identifiers: (identifiers ?? []).filter((i) => i.master_product_id === m.id),
      origin_supplier_product: (origins ?? []).find((o) => o.id === m.origin_supplier_product_id) ?? null,
    })),
  });
}

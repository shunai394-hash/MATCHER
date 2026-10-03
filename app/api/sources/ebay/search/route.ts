import { NextResponse } from "next/server";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getToken() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EBAY_API_CONFIG_MISSING");

  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const auth = Buffer.from(id + ":" + secret).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("EBAY_TOKEN_FAILED");
  const data = await response.json() as { access_token: string; expires_in: number };
  tokenCache.set(id, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

function auth(request: Request) {
  const token = process.env.MATCHER_INGEST_TOKEN;
  return !!token && request.headers.get("x-matcher-ingest-token") === token;
}

export async function GET(request: Request) {
  if (!auth(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    const gtin = url.searchParams.get("gtin")?.trim();
    const marketplace = (url.searchParams.get("marketplace") ?? "EBAY_US").toUpperCase();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    if (!q && !gtin) return NextResponse.json({ error: "QUERY_REQUIRED" }, { status: 400 });

    const params = new URLSearchParams({ limit: String(limit) });
    if (q) params.set("q", q);
    if (gtin) params.set("gtin", gtin);

    const response = await fetch(
      "https://api.ebay.com/buy/browse/v1/item_summary/search?" + params.toString(),
      {
        headers: {
          Authorization: "Bearer " + await getToken(),
          "X-EBAY-C-MARKETPLACE-ID": marketplace,
        },
        cache: "no-store",
      },
    );
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ error: "EBAY_SEARCH_FAILED", detail: data }, { status: response.status });

    const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
    return NextResponse.json({
      source: "EBAY",
      marketplace,
      total: data.total ?? items.length,
      items: items.map((item: Record<string, unknown>) => ({
        id: item.itemId,
        title: item.title,
        price: item.price ?? null,
        condition: item.condition ?? null,
        seller: item.seller ?? null,
        itemLocation: item.itemLocation ?? null,
        shippingOptions: item.shippingOptions ?? [],
        image: item.image ?? null,
        itemWebUrl: item.itemWebUrl ?? null,
        buyingOptions: item.buyingOptions ?? [],
        gtin: item.gtin ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "EBAY_SEARCH_FAILED" },
      { status: 500 },
    );
  }
}

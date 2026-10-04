"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PurchaserSignIn, usePurchaserSession } from "../purchaser-session";

type Freshness = { observedAt: string | null; ageSeconds: number | null; maxAgeSeconds: number | null; fresh: boolean };

type Opportunity = {
  supplierOfferId: string;
  supplierProductId: string;
  masterProductId: string;
  productName: string;
  brand: string | null;
  modelNumber: string | null;
  supplierName: string | null;
  supplierProductName: string | null;
  supplierSku: string | null;
  supplierUrl: string | null;
  currency: string;
  identity: {
    decision: string;
    confidence: number;
    linkedAt: string;
    evidence: Array<{ field: string; kind: string; source: string | null; master: string | null }>;
  };
  profit: {
    salePrice: number;
    supplierCost: number | null;
    shippingCost: number | null;
    paymentFee: number | null;
    marketplaceFee: number | null;
    tax: number | null;
    otherCost: number | null;
    expectedProfit: number | null;
    marginRate: number | null;
  };
  market: { source: string | null; sourceUrl: string | null; sold: boolean | null; observedAt: string | null };
  inventory: number | null;
  freshness: Record<"price" | "inventory" | "shipping" | "market", Freshness>;
  gate: { status: string; evaluatedAt: string };
  opportunityScore: number;
};

type FeedResponse = {
  opportunities?: Opportunity[];
  total?: number;
  lastEvaluatedAt?: string | null;
  checkedOffers?: number;
  linkedProducts?: number;
  excluded?: Record<string, number>;
  error?: string;
};

const PURCHASE_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "購入担当としてログインしてください。",
  PURCHASER_ROLE_REQUIRED: "このアカウントには購入権限がありません。",
  PURCHASE_TERMS_CHANGED: "価格または利益が変わりました。最新の内容を確認して、もう一度承認してください。",
  PURCHASE_NOT_SELLABLE: "購入直前の再確認で条件を満たさなくなりました（在庫・価格・鮮度など）。",
  IDENTITY_LINK_NOT_CONFIRMED: "同一商品の判定が変わりました。",
  QUALITY_GATE_OUTDATED: "新しいデータで再計算待ちです。少し待ってから更新してください。",
  QUALITY_GATE_NOT_SELLABLE: "品質ゲートを通過していません。",
  PROFIT_SNAPSHOT_OUTDATED: "利益計算が最新データに追いついていません。",
  STRIPE_SERVER_CONFIG_MISSING: "決済設定がありません。購入は実行されていません。",
};

const REASON_LABELS: Record<string, string> = {
  MASTER_NOT_APPROVED: "商品マスタが承認待ち",
  IDENTITY_REVIEW: "同一商品か要確認",
  IDENTITY_BLOCK: "仕様の不一致でブロック",
  IDENTITY_REJECT: "人が不一致と判断",
  IDENTITY_HARD_BLOCK: "仕様の不一致でブロック",
  SUPPLIER_NOT_ORDERABLE: "仕入先で注文不可",
  SUPPLIER_SNAPSHOT_MISSING: "仕入れ価格の観測なし",
  SUPPLIER_COST_UNKNOWN: "仕入れ価格が不明",
  SHIPPING_COST_UNKNOWN: "送料が不明",
  SHIPPING_UNVERIFIED: "送料が未確認",
  INVENTORY_UNKNOWN: "在庫が不明",
  OUT_OF_STOCK: "在庫切れ",
  PRICE_STALE: "仕入れ価格が古い",
  INVENTORY_STALE: "在庫情報が古い",
  SHIPPING_STALE: "送料情報が古い",
  FRESHNESS_RECORD_MISSING: "鮮度記録なし",
  MARKET_PRICE_MISSING: "販売相場の観測なし",
  MARKET_PRICE_STALE: "販売相場が古い",
  CURRENCY_MISMATCH: "通貨が一致しない",
  REQUIRED_FEES_UNKNOWN: "手数料・税が不明",
  PROFIT_NOT_CALCULABLE: "利益を計算できない",
  PROFIT_NOT_POSITIVE: "利益が出ない",
  GATE_NOT_EVALUATED: "品質ゲート未評価",
  GATE_BLOCKED: "品質ゲートでブロック",
  GATE_OUTDATED_RECOMPUTE_REQUIRED: "新しいデータで再計算待ち",
  BELOW_MIN_PROFIT: "最低利益に届かない",
};

function money(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("ja-JP")} ${currency}`;
}

function age(seconds: number | null) {
  if (seconds === null) return "不明";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}分前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}時間前`;
  return `${Math.round(seconds / 86400)}日前`;
}

function evidenceLabel(item: Opportunity["identity"]["evidence"][number]) {
  if (item.kind === "EXACT_IDENTIFIER") return `${item.field} 一致 (${item.source})`;
  if (item.field === "brand") return `ブランド一致 (${item.source})`;
  if (item.field === "modelNumber") return `型番一致 (${item.source})`;
  if (item.kind === "VARIANT_COMPATIBLE") return "色・容量など仕様に矛盾なし";
  return `${item.field} 一致`;
}

async function fetchFeed(minProfit: string, token: string | null): Promise<FeedResponse> {
  try {
    const response = await fetch("/api/opportunities?minProfit=" + encodeURIComponent(minProfit) + "&limit=50", { cache: "no-store", headers: token ? { authorization: `Bearer ${token}` } : undefined });
    const data = (await response.json()) as FeedResponse;
    if (!response.ok) return { error: data.error ?? "候補の取得に失敗しました。" };
    return data;
  } catch {
    return { error: "候補サービスに接続できません。時間を置いて再試行してください。" };
  }
}

export default function OpportunitiesPage() {
  const [minProfit, setMinProfit] = useState("1000");
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const session = usePurchaserSession();
  const [purchaseState, setPurchaseState] = useState<Record<string, string>>({});

  async function requestPurchase(item: Opportunity) {
    const amount = (item.profit.supplierCost ?? 0) + (item.profit.shippingCost ?? 0);
    const ok = window.confirm(`${item.productName}
仕入れ ${money(item.profit.supplierCost, item.currency)} + 送料 ${money(item.profit.shippingCost, item.currency)} = ${money(amount, item.currency)}
想定利益 ${money(item.profit.expectedProfit, item.currency)}

この条件でカードを仮押さえします。購入直前にサーバーが在庫・価格・利益を再確認します。`);
    if (!ok) return;
    setPurchaseState((s) => ({ ...s, [item.supplierOfferId]: "再確認中…" }));
    try {
      const response = await fetch("/api/purchase/authorize", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          masterProductId: item.masterProductId,
          supplierOfferId: item.supplierOfferId,
          approved: { amount, expectedProfit: item.profit.expectedProfit },
        }),
      });
      const data = await response.json();
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      setPurchaseState((s) => ({ ...s, [item.supplierOfferId]: PURCHASE_ERRORS[data.error] ?? data.error ?? "購入の準備に失敗しました。" }));
    } catch {
      setPurchaseState((s) => ({ ...s, [item.supplierOfferId]: "購入サービスに接続できません。" }));
    }
  }

  const reload = useCallback(async (value: string) => {
    setLoading(true);
    if (!session.token) { setFeed({ error: "AUTH_REQUIRED" }); setLoading(false); return; }
    setFeed(await fetchFeed(value, session.token));
    setLoading(false);
  }, [session.token]);

  useEffect(() => {
    let cancelled = false;
    if (!session.token) return () => { cancelled = true; };
    fetchFeed("1000", session.token).then((data) => {
      if (cancelled) return;
      setFeed(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [session.token]);

  const items = feed?.opportunities ?? [];
  const excluded = Object.entries(feed?.excluded ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <main className="opportunity-shell">
      <header className="opportunity-header">
        <Link href="/" className="console-brand">MATCHER</Link>
        <nav aria-label="仕入れナビ">
          <Link href="/console">仕入れ判断</Link>
          <Link href="/quality">品質</Link>
        </nav>
      </header>

      <section className="opportunity-hero">
        <p className="section-kicker">TODAY&apos;S PURCHASE CANDIDATES</p>
        <h1>今日の<em>仕入れ候補。</em></h1>
        <p>
          同一商品であること・仕入れ価格と送料・在庫・データの鮮度・販売相場・利益・品質ゲートを
          すべて実データで確認できた商品だけを並べています。最後に買うかどうかは、あなたが決めます。
        </p>
        <p className="opportunity-meta">
          最終評価: {feed?.lastEvaluatedAt ? new Date(feed.lastEvaluatedAt).toLocaleString("ja-JP") : "まだ評価されていません"}
          {feed?.checkedOffers !== undefined && ` · 同一商品として確定した仕入れ先 ${feed.linkedProducts ?? 0}件 / 確認したオファー ${feed.checkedOffers}件`}
        </p>
        <div className="opportunity-controls">
          <label>最低想定利益（円）
            <input value={minProfit} onChange={(e) => setMinProfit(e.target.value)} inputMode="numeric" />
          </label>
          <button onClick={() => void reload(minProfit)} disabled={loading}>{loading ? "更新中…" : "候補を更新 →"}</button>
        </div>
      </section>

      <PurchaserSignIn session={session} />

      {feed?.error && <div className="opportunity-empty"><strong>{feed.error === "AUTH_REQUIRED" ? "ログインすると今日の仕入れ候補が出ます" : "候補を取得できません"}</strong><p>{feed.error === "AUTH_REQUIRED" ? "MATCHERは仕入価格・利益・仕入先情報を保護しています。購入担当としてログインしてください。" : feed.error}</p></div>}

      {!feed?.error && !loading && items.length === 0 && (
        <section className="opportunity-empty">
          <span>NO VERIFIED OPPORTUNITIES</span>
          <h2>今は「儲かる」と言える実データがありません。</h2>
          <p>
            架空の商品や推測の利益は表示しません。すべての確認を通過した商品が出てきたら、ここに並びます。
          </p>
          {excluded.length > 0 && (
            <>
              <p><b>候補にならなかった理由（件数）</b></p>
              <ul className="opportunity-reasons">
                {excluded.map(([reason, count]) => <li key={reason}>{REASON_LABELS[reason] ?? reason} <b>{count}</b></li>)}
              </ul>
            </>
          )}
          <Link className="secondary-action" href="/console">手元の商品から判定する →</Link>
        </section>
      )}

      {!feed?.error && items.length > 0 && (
        <section className="opportunity-list" aria-live="polite">
          <div className="opportunity-list-head">
            <div><span>VERIFIED OPPORTUNITIES</span><strong>{feed?.total ?? items.length}件</strong></div>
            <p>想定利益が高い順。仕入れ前に、仕入先ページで価格と在庫をもう一度確認してください。</p>
          </div>
          {items.map((item) => (
            <article className="opportunity-card" key={item.supplierOfferId}>
              <div className="opportunity-main">
                <span className="opportunity-rank">買い優先度 {item.opportunityScore.toFixed(1)}/100 · 同一商品 · {item.identity.decision} · 信頼度 {Math.round(item.identity.confidence * 100)}%</span>
                <h2>{item.productName}</h2>
                <p>{[item.brand, item.modelNumber].filter(Boolean).join(" · ") || "ブランド・型番情報なし"}</p>
                <p>仕入先: {item.supplierName ?? "不明"}{item.supplierSku ? ` (SKU ${item.supplierSku})` : ""}{item.supplierProductName ? ` — ${item.supplierProductName}` : ""}</p>
                <ul className="opportunity-evidence">
                  {item.identity.evidence.map((ev) => <li key={ev.field + ev.kind}>✓ {evidenceLabel(ev)}</li>)}
                </ul>
              </div>
              <div className="opportunity-profit">
                <small>想定利益</small>
                <strong>{money(item.profit.expectedProfit, item.currency)}</strong>
                {item.profit.marginRate !== null && <p>利益率 {item.profit.marginRate}%</p>}
              </div>
              <div className="opportunity-metrics">
                <div><small>販売相場</small><b>{money(item.profit.salePrice, item.currency)}</b></div>
                <div><small>仕入れ価格</small><b>{money(item.profit.supplierCost, item.currency)}</b></div>
                <div><small>送料</small><b>{money(item.profit.shippingCost, item.currency)}</b></div>
                <div><small>手数料・税・他</small><b>{money((item.profit.paymentFee ?? 0) + (item.profit.marketplaceFee ?? 0) + (item.profit.tax ?? 0) + (item.profit.otherCost ?? 0), item.currency)}</b></div>
                <div><small>在庫</small><b>{item.inventory ?? "—"}</b></div>
                <div><small>価格の鮮度</small><b>{age(item.freshness.price.ageSeconds)}</b></div>
                <div><small>在庫の鮮度</small><b>{age(item.freshness.inventory.ageSeconds)}</b></div>
                <div><small>相場の観測</small><b>{age(item.freshness.market.ageSeconds)}{item.market.source ? ` · ${item.market.source}` : ""}</b></div>
              </div>
              <div className="opportunity-footer">
                <span>品質ゲート: {item.gate.status} ({new Date(item.gate.evaluatedAt).toLocaleString("ja-JP")})</span>
                {item.market.sourceUrl && <a href={item.market.sourceUrl} target="_blank" rel="noreferrer">販売相場を見る ↗</a>}
                {item.supplierUrl && <a href={item.supplierUrl} target="_blank" rel="noreferrer">仕入先で確認 ↗</a>}
                {session.token && (
                  <button type="button" className="opportunity-buy" onClick={() => void requestPurchase(item)}>
                    この条件で仕入れ申請 →
                  </button>
                )}
              </div>
              {purchaseState[item.supplierOfferId] && <p className="opportunity-purchase-state" role="status">{purchaseState[item.supplierOfferId]}</p>}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

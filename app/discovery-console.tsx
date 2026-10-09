"use client";

import { useEffect, useState, type FormEvent } from "react";

type DiscoveredProduct = {
  sourceKey?: string;
  externalId: string;
  productName: string;
  brand?: string | null;
  identifiers?: Array<{ type: string; value: string }>;
  cost?: number | null;
  shippingCost?: number | null;
  inventory?: number | null;
  orderability?: string;
  currency?: string;
  sourceUrl?: string | null;
  observedAt?: string;
};

type SpreadCandidate = {
  jan: string | null;
  buyPrice: number | null;
  referenceSellPrice: number | null;
  grossSpread: number;
  grossRoiPercent: number;
  buySourceUrl: string | null;
  referenceSourceUrl: string | null;
};

function safeExternalUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

type IngestionStatus = {
  readyForScan?: boolean;
  configured?: boolean;
  missingSourceCredentials?: string[];
  missingDatabaseCredentials?: string[];
  database?: { configured: boolean; missing: string[] };
  sources?: Record<string, { configured: boolean; missing: string[] }>;
};

type ScanResult = {
  ok: boolean;
  queries: string[];
  discovered: number;
  accepted: number;
  rejected: number;
  persisted: number;
  products: DiscoveredProduct[];
  spreadCandidates: SpreadCandidate[];
  errors: string[];
};

export function DiscoveryConsole() {
  const [query, setQuery] = useState("ワイヤレスイヤホン");
  const [status, setStatus] = useState<IngestionStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/ingestion/status")
      .then((response) => response.ok ? response.json() as Promise<IngestionStatus> : null)
      .then((value) => { if (active && value) setStatus(value); })
      .catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, []);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const missingSourceVariables = status?.missingSourceCredentials ?? Object.values(status?.sources ?? {}).flatMap((source) => source.missing);
  const missingDatabaseVariables = status?.missingDatabaseCredentials ?? status?.database?.missing ?? [];

  async function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ingestion/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: query, sources: ["yahoo", "rakuten"] }),
      });
      const payload = await response.json() as ScanResult;
      if (!response.ok || !payload.ok) {
        throw new Error((payload as unknown as { code?: string }).code ?? "SCAN_FAILED");
      }
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SCAN_FAILED");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="opportunity" id="discovery" aria-labelledby="discovery-title">
      <div className="opportunity-head">
        <div>
          <p className="section-index">01 / LIVE PRODUCT DISCOVERY</p>
          <h2 id="discovery-title">まず実在する商品を集め、<em>利益候補かどうかを検証する。</em></h2>
        </div>
        <p>Yahoo!ショッピングと楽天市場の取得結果を表示します。価格差は粗い候補であり、手数料・送料・需要・鮮度を検証するまでは純利益や購入推奨として扱いません。</p>
      </div>

      {status && status.readyForScan === false ? (
        <div className="opportunity-empty" role="status">
          <strong>CONFIGURATION REQUIRED</strong>
          <p>商品検索を実行する前に、Vercelの環境変数を設定してください。</p>
          {missingSourceVariables.length ? <p>検索元: {missingSourceVariables.join(", ")}</p> : null}
          {missingDatabaseVariables.length ? <p>保存・利益判定: {missingDatabaseVariables.join(", ")}</p> : null}
        </div>
      ) : null}

      <form className="hero-actions discovery-form" onSubmit={scan} aria-label="商品検索">
        <label htmlFor="matcher-query">検索キーワード</label>
        <input id="matcher-query" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} required placeholder="商品名・型番・JAN" />
        <button className="button primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? "検索中…" : "実データを検索"}
        </button>
      </form>

      {error ? (
        <div className="opportunity-empty" role="alert">
          <strong>SEARCH FAILED</strong>
          <p>{error}</p>
          <span>API設定と検索元の応答を確認してください。架空の商品は補完しません。</span>
        </div>
      ) : null}

      {result ? (
        <>
          <div className="hero-meta" aria-live="polite">
            <span>取得 {result.discovered}</span><span>·</span>
            <span>検証通過 {result.accepted}</span><span>·</span>
            <span>保存 {result.persisted}</span><span>·</span>
            <span>除外 {result.rejected}</span>
          </div>

          <h3>価格差候補（粗利益・未検証）</h3>
          {result.spreadCandidates.length ? (
            <div className="opportunity-list">
              {result.spreadCandidates.map((item, index) => (
                <article className="opportunity-item" key={item.jan ?? `spread-${index}`}>
                  <div className="opportunity-rank">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <span>JAN {item.jan ?? "未確認"} · GROSS SPREAD</span>
                    <h3>粗価格差 ¥{Math.round(item.grossSpread).toLocaleString()}</h3>
                    <p>仕入れ表示価格 ¥{item.buyPrice == null ? "—" : Math.round(item.buyPrice).toLocaleString()} → 比較価格 ¥{item.referenceSellPrice == null ? "—" : Math.round(item.referenceSellPrice).toLocaleString()} · 粗ROI {item.grossRoiPercent}%</p>
                    <p>{safeExternalUrl(item.buySourceUrl) ? <a href={safeExternalUrl(item.buySourceUrl)!} target="_blank" rel="noreferrer">仕入れ元を開く</a> : "仕入れ元URLなし"}　{safeExternalUrl(item.referenceSourceUrl) ? <a href={safeExternalUrl(item.referenceSourceUrl)!} target="_blank" rel="noreferrer">比較元を開く</a> : "比較元URLなし"}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="opportunity-empty" role="status">
              <strong>NO VERIFIED PRICE SPREADS</strong>
              <p>同一の有効JANと商品仕様を確認できる価格差候補はありませんでした。</p>
            </div>
          )}

          <h3>取得商品（利益未確定）</h3>
          {result.products.length ? (
            <div className="opportunity-list">
              {result.products.map((item, index) => (
                <article className="opportunity-item" key={item.sourceKey + ":" + item.externalId}>
                  <div className="opportunity-rank">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <span>{item.sourceKey ?? "SOURCE"} · {item.orderability ?? "ORDERABILITY UNKNOWN"}</span>
                    <h3>{item.productName}</h3>
                    <p>{item.brand ?? "ブランド未確認"} · JAN {item.identifiers?.find((id) => ["JAN", "EAN", "UPC"].includes(id.type))?.value ?? "未確認"}</p>
                    <p>表示価格 {item.cost == null ? "未取得" : `¥${Math.round(item.cost).toLocaleString()}`} · 送料 {item.shippingCost == null ? "未取得" : `¥${Math.round(item.shippingCost).toLocaleString()}`} · 在庫 {item.inventory == null ? "未確認" : item.inventory}</p>
                    {safeExternalUrl(item.sourceUrl) ? <a href={safeExternalUrl(item.sourceUrl)!} target="_blank" rel="noreferrer">商品ページを開く ↗</a> : <span>商品URLなし</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="opportunity-empty" role="status">
              <strong>NO SOURCE PRODUCTS</strong>
              <p>検索元から商品を取得できませんでした。設定不足や検索元APIエラーを下の診断で確認してください。</p>
            </div>
          )}

          {result.errors.length ? (
            <details>
              <summary>取得・保存エラー（{result.errors.length}件）</summary>
              <ul>{result.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

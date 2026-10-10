"use client";

import { useEffect, useState, type FormEvent } from "react";

type DiscoveredProduct = {
  source: string;
  externalId: string;
  productName: string;
  brand: string | null;
  identifiers: Array<{ type: string; value: string }>;
  cost: number | null;
  shippingCost: number | null;
  inventory: number | null;
  orderability: string;
  sourceUrl: string | null;
  observedAt?: string | null;
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

type ScanResult = {
  ok: boolean;
  mode?: "stored" | "scan";
  queries?: string[];
  sources?: string[];
  discovered?: number;
  displayed?: number;
  filteredOut?: number;
  accepted?: number;
  rejected?: number;
  persisted?: number;
  products?: DiscoveredProduct[];
  spreadCandidates?: SpreadCandidate[];
  errors?: string[];
  code?: string;
};

const safeHttpUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

const yen = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "未取得" : "¥" + Math.round(value).toLocaleString("ja-JP");

const freshnessLabel = (value: string | null | undefined) => {
  if (!value) return "鮮度不明";
  const observedAt = Date.parse(value);
  if (!Number.isFinite(observedAt)) return "鮮度不明";
  const ageMs = Date.now() - observedAt;
  if (ageMs < -60_000) return "時刻異常・要確認";
  if (ageMs > 24 * 60 * 60 * 1000) return "24時間超・要再確認";
  if (ageMs > 6 * 60 * 60 * 1000) return `約${Math.floor(ageMs / (60 * 60 * 1000))}時間前`;
  if (ageMs > 60 * 60 * 1000) return `約${Math.floor(ageMs / (60 * 60 * 1000))}時間前`;
  if (ageMs > 60 * 1000) return `約${Math.floor(ageMs / (60 * 1000))}分前`;
  return "直近取得";
};

export function LiveDiscoveryConsole() {
  const [query, setQuery] = useState("Nintendo Switch 2 本体");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/ingestion/scan", { cache: "no-store" })
      .then(async (response) => ({ response, payload: (await response.json()) as ScanResult }))
      .then(({ response, payload }) => {
        if (!active) return;
        if (response.ok && payload.ok) setResult(payload);
        else setError(payload.code ?? "保存済み商品を読み込めませんでした。");
      })
      .catch(() => {
        if (active) setError("保存済み商品を読み込めませんでした。");
      });
    return () => { active = false; };
  }, []);

  async function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !query.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ingestion/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: query.trim(), sources: ["yahoo"] }),
      });
      const payload = (await response.json()) as ScanResult;
      setResult(payload);
      if (!response.ok || !payload.ok) setError(payload.code ?? payload.errors?.join(" / ") ?? "商品検索に失敗しました。");
    } catch {
      setError("検索APIに接続できませんでした。時間をおいて再試行してください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="live-discovery" aria-labelledby="live-discovery-title" id="live-discovery">
      <div className="live-discovery-heading">
        <div>
          <p className="section-index">LIVE / SUPPLIER DISCOVERY</p>
          <h2 id="live-discovery-title">まず、<em>実在する商品</em>を取り込む。</h2>
          <p>Yahoo!ショッピングの商品検索を実行し、商品名・JAN・仕入れ価格・販売元へのリンクを取得します。利益が未検証の商品を、利益商品とは表示しません。</p>
        </div>
        <span className="live-discovery-tag">REAL SOURCE · NO MOCK DATA</span>
      </div>
      <form className="live-discovery-form" onSubmit={scan}>
        <label htmlFor="discovery-query">商品名・ブランド・型番</label>
        <div className="live-discovery-controls">
          <input id="discovery-query" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="例：Anker モバイルバッテリー" />
          <button type="submit" disabled={loading || !query.trim()}>{loading ? "検索中…" : "商品を検索する ↗"}</button>
        </div>
        <p>検索は1クエリずつ実行し、外部APIへの過剰な連続アクセスを避けます。</p>
      </form>

      {loading && <div className="live-discovery-feedback" role="status">Yahoo!ショッピングから実データを取得しています…</div>}
      {error && <div className="live-discovery-error" role="alert"><strong>検索結果を確認できません</strong><span>{error}</span></div>}
      {result && (
        <div className="live-discovery-results" aria-live="polite">
          <div className="live-discovery-summary">
            <div><strong>{result.discovered ?? 0}</strong><span>{result.mode === "stored" ? "保存済み商品" : "取得件数"}</span></div>
            <div><strong>{result.persisted ?? 0}</strong><span>{result.mode === "stored" ? "保存済み件数" : "DB保存件数"}</span></div>
            <div><strong>{result.spreadCandidates?.length ?? 0}</strong><span>JAN一致の価格差候補</span></div>
          </div>
          {result.spreadCandidates && result.spreadCandidates.length === 0 && (
            <p className="live-discovery-feedback">
              まだ価格差候補はありません。別ソース間で同じJANの商品が確認できた場合のみ候補を表示します。仕入れ価格だけで利益商品とは判定しません。
            </p>
          )}
          {result.spreadCandidates && result.spreadCandidates.length > 0 && (
            <div className="live-spread-list">
              <h3>JAN一致の価格差候補 <span>※手数料・送料未確定の粗利差</span></h3>
              {result.spreadCandidates.map((spread, index) => (
                <article className="live-spread-item" key={spread.jan ?? index}>
                  <div><small>JAN {spread.jan ?? "不明"}</small><strong>{yen(spread.grossSpread)} <em>価格差</em></strong></div>
                  <div><span>仕入れ {yen(spread.buyPrice)}</span><span>比較価格 {yen(spread.referenceSellPrice)}</span></div>
                  <small>粗ROI {spread.grossRoiPercent}% · 最終利益ではありません</small>
                </article>
              ))}
            </div>
          )}
          {(result.filteredOut ?? 0) > 0 && <p className="live-discovery-feedback">{result.filteredOut}件の付属品・周辺商品は今回の「本体」検索結果から除外しました。仕入れ元データは保持しています。</p>}
          <div className="live-product-list">
            <h3>取得した商品 <span>{result.products?.length ?? 0}件表示</span></h3>
            {result.products && result.products.length > 0 ? result.products.map((product) => {
              const jan = product.identifiers.find((identifier) => identifier.type === "JAN")?.value;
              return (
                <article className="live-product-item" key={product.source + ":" + product.externalId}>
                  <div className="live-product-index">{String(product.externalId).slice(0, 12)}</div>
                  <div className="live-product-main">
                    <strong>{product.productName}</strong>
                    <span>{product.brand ?? "ブランド未取得"} · JAN {jan ?? "未取得"}</span>
                    <small>{product.source} · 価格データ {freshnessLabel(product.observedAt)} · 在庫 {product.inventory == null ? "未確認" : product.inventory} · {product.orderability === "ORDERABLE" ? "注文可" : "注文可否未確認"}</small>
                  </div>
                  <div className="live-product-price"><strong>{yen(product.cost)}</strong><span>送料 {yen(product.shippingCost)}</span></div>
                  {safeHttpUrl(product.sourceUrl) && <a href={safeHttpUrl(product.sourceUrl)!} target="_blank" rel="noreferrer">販売ページ ↗</a>}
                </article>
              );
            }) : <p className="live-discovery-feedback">{result.mode === "stored" ? "保存済みの商品はまだありません。検索すると、取得・保存された商品がここに表示されます。" : "この検索では商品を取得できませんでした。検索語を変えて再試行してください。"}</p>}
          </div>
          <p className="live-discovery-disclaimer">重要：Yahoo!の商品価格だけでは売価・需要・在庫・送料・手数料が揃いません。JAN一致の他市場データと全コストが揃うまで、純利益や購入推奨は確定しません。</p>
          {result.errors && result.errors.length > 0 && <details className="live-discovery-errors"><summary>取得時の警告 {result.errors.length}件</summary><ul>{result.errors.slice(0, 10).map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
        </div>
      )}
    </section>
  );
}

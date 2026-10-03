"use client";

import { useEffect, useState } from "react";

type Opportunity = {
  masterProductId: string;
  productName: string;
  brand: string | null;
  supplierName: string;
  supplierOfferId: string;
  salePrice: number;
  supplierCost: number | null;
  shippingCost: number | null;
  expectedProfit: number | null;
  currency: string;
  inventory: number | null;
  calculatedAt: string;
  gateStatus: string | null;
};

export default function OpportunitiesPage() {
  const [minProfit, setMinProfit] = useState("1000");
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(value = minProfit) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/opportunities?minProfit=" + encodeURIComponent(value) + "&limit=20", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "候補の取得に失敗しました。");
      setItems(data.opportunities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "候補の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <main className="opportunity-shell">
      <header className="opportunity-header">
        <a href="/" className="console-brand">MATCHER</a>
        <nav aria-label="仕入れナビ">
          <a href="/console">仕入れ判断</a>
          <a href="/quality">品質</a>
        </nav>
      </header>

      <section className="opportunity-hero">
        <p className="section-kicker">OPPORTUNITY FEED · PROFIT FIRST</p>
        <h1>探す前に、<em>仕入れ候補を見る。</em></h1>
        <p>
          MATCHERが持つ実データの中から、同一商品として確認でき、仕入れ条件と利益計算を通過した候補だけを並べます。
          「何を探せばいいか」からではなく、「どれを確認して仕入れるか」から始めます。
        </p>
        <div className="opportunity-controls">
          <label>最低想定利益
            <input value={minProfit} onChange={(e) => setMinProfit(e.target.value)} inputMode="numeric" />
          </label>
          <button onClick={() => void load()} disabled={loading}>{loading ? "更新中…" : "利益候補を更新 →"}</button>
        </div>
      </section>

      {error && <div className="opportunity-empty"><strong>候補を取得できません</strong><p>{error}</p></div>}

      {!error && !loading && items.length === 0 && (
        <section className="opportunity-empty">
          <span>NO VERIFIED OPPORTUNITIES</span>
          <h2>今は「儲かる」と言える実データがありません。</h2>
          <p>
            ここで架空の商品や推測利益を表示することはしません。MATCHERは、商品同一性・仕入れ条件・利益計算・販売可能ゲートを通過したデータだけを候補にします。
            データが入れば、この画面が「探す場所」ではなく「仕入れ候補が出てくる場所」になります。
          </p>
          <a className="secondary-action" href="/console">手元の商品から判定する →</a>
        </section>
      )}

      {!error && items.length > 0 && (
        <section className="opportunity-list" aria-live="polite">
          <div className="opportunity-list-head">
            <div><span>VERIFIED OPPORTUNITIES</span><strong>{items.length}件</strong></div>
            <p>利益が高い順。最終判断は在庫・価格の鮮度と販売条件を確認してください。</p>
          </div>
          {items.map((item) => (
            <article className="opportunity-card" key={item.supplierOfferId}>
              <div className="opportunity-main">
                <span className="opportunity-rank">OPPORTUNITY</span>
                <h2>{item.productName}</h2>
                <p>{item.brand ?? "ブランド情報なし"} · {item.supplierName}</p>
              </div>
              <div className="opportunity-profit">
                <small>想定利益</small>
                <strong>{item.expectedProfit?.toLocaleString()} {item.currency}</strong>
              </div>
              <div className="opportunity-metrics">
                <div><small>販売価格</small><b>{item.salePrice.toLocaleString()} {item.currency}</b></div>
                <div><small>仕入れ</small><b>{item.supplierCost?.toLocaleString() ?? "—"} {item.currency}</b></div>
                <div><small>送料</small><b>{item.shippingCost?.toLocaleString() ?? "—"} {item.currency}</b></div>
                <div><small>在庫</small><b>{item.inventory ?? "—"}</b></div>
              </div>
              <div className="opportunity-footer">
                <span>SELLABILITY: {item.gateStatus ?? "VERIFIED"}</span>
                <span>利益計算: {new Date(item.calculatedAt).toLocaleString("ja-JP")}</span>
                <a href={"/console?masterProductId=" + encodeURIComponent(item.masterProductId)}>詳細判断 →</a>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

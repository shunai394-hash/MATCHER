"use client";

import { useMemo, useState } from "react";

const scenarios = [
  {
    key: "buy",
    index: "01",
    label: "BUY CANDIDATE",
    title: "進めていい候補",
    product: "ACME AX-204 / Black / 256GB",
    decision: "SELLABLE",
    tone: "good",
    profit: "+¥3,840",
    confidence: "94%",
    reason: "JAN一致 + MPN一致 + バリアント一致。仕入れ・送料・販売手数料を反映しても利益条件を通過。",
    next: "仕入れ条件を確認して申請",
  },
  {
    key: "block",
    index: "02",
    label: "HARD BLOCK",
    title: "安くても止める",
    product: "ACME AX-204 / White / 128GB",
    decision: "BLOCKED",
    tone: "danger",
    profit: "+¥6,120",
    confidence: "3%",
    reason: "ブランドは一致しても色・容量が不一致。利益が出ても同一商品として結合しない。",
    next: "別候補を確認",
  },
  {
    key: "review",
    index: "03",
    label: "NEEDS REVIEW",
    title: "証拠不足で保留",
    product: "ACME / 型番なし",
    decision: "REVIEW",
    tone: "warn",
    profit: "—",
    confidence: "41%",
    reason: "ブランド情報しかなく、MPNとバリアントが不足。推測で自動リンクしない。",
    next: "不足情報を確認",
  },
] as const;

export function DecisionPreview() {
  const [active, setActive] = useState("buy");
  const current = useMemo(
    () => scenarios.find((item) => item.key === active) ?? scenarios[0],
    [active],
  );

  return (
    <section className="decision-preview" aria-labelledby="decision-preview-title">
      <div className="decision-preview-head">
        <div>
          <span className="section-kicker">THE DECISION, NOT THE SEARCH</span>
          <h2 id="decision-preview-title">候補を見た瞬間、<em>次の一手</em>まで分かる。</h2>
          <p>同じ商品か、利益が残るか、危険条件はないか。MATCHERは「調べる場所」ではなく、判断を前に進めるための画面を目指す。</p>
        </div>
        <span className="decision-preview-live">INTERACTIVE SCENARIO</span>
      </div>

      <div className="decision-preview-tabs" role="tablist" aria-label="仕入れ判断のシナリオ">
        {scenarios.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active === item.key}
            aria-controls="decision-preview-panel"
            className={active === item.key ? "decision-preview-tab active" : "decision-preview-tab"}
            onClick={() => setActive(item.key)}
          >
            <span>{item.index}</span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

      <div
        id="decision-preview-panel"
        className={`decision-preview-panel ${current.tone}`}
        role="tabpanel"
        aria-live="polite"
      >
        <div className="decision-preview-product">
          <span>PRODUCT</span>
          <strong>{current.product}</strong>
          <small>{current.title}</small>
        </div>
        <div className="decision-preview-outcome">
          <span>DECISION</span>
          <strong>{current.decision}</strong>
        </div>
        <div className="decision-preview-metric">
          <span>EXPECTED PROFIT</span>
          <strong>{current.profit}</strong>
        </div>
        <div className="decision-preview-metric">
          <span>IDENTITY CONFIDENCE</span>
          <strong>{current.confidence}</strong>
        </div>
        <div className="decision-preview-reason">
          <span>WHY</span>
          <p>{current.reason}</p>
        </div>
        <div className="decision-preview-next">
          <span>NEXT STEP</span>
          <strong>{current.next} <b aria-hidden="true">→</b></strong>
        </div>
      </div>

      <p className="decision-preview-note">Illustrative scenario. 実際の仕入れ判断ではサーバー側で価格・在庫・同一商品・利益条件を再確認し、最後は人間が承認します。</p>
    </section>
  );
}

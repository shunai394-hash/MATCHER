"use client";

import { useState } from "react";

const candidates = [
  {
    id: "01",
    state: "SELLABLE",
    tone: "sellable",
    product: "Wireless Noise-Canceling Headphones",
    supplier: "Supplier A",
    buy: "¥12,800",
    sell: "¥21,900",
    profit: "+¥3,840",
    confidence: "94%",
    reason: "JAN exact · variant aligned · stock fresh",
  },
  {
    id: "02",
    state: "BLOCKED",
    tone: "blocked",
    product: "Wireless Noise-Canceling Headphones",
    supplier: "Supplier B",
    buy: "¥11,400",
    sell: "¥21,900",
    profit: "—",
    confidence: "3%",
    reason: "Color mismatch · 128GB vs 256GB",
  },
  {
    id: "03",
    state: "REVIEW",
    tone: "review",
    product: "Wireless Noise-Canceling Headphones",
    supplier: "Supplier C",
    buy: "¥13,100",
    sell: "¥21,900",
    profit: "—",
    confidence: "41%",
    reason: "MPN missing · variant evidence incomplete",
  },
] as const;

export function DecisionConsole() {
  const [active, setActive] = useState(0);
  const item = candidates[active];

  return (
    <section className="console" id="decision" aria-labelledby="decision-title">
      <div className="console-head">
        <div>
          <p className="section-index">03 / DECISION CONSOLE</p>
          <h2 id="decision-title">利益がある商品ではなく、<em>買っていい商品</em>を出す。</h2>
          <p className="console-lead">MATCHERが候補を絞り、証拠を並べ、最後の購入判断は人が握る。</p>
        </div>
        <span className="console-live"><i aria-hidden="true" /> LIVE DECISION MODEL</span>
      </div>

      <div className="console-body">
        <div className="candidate-list" role="tablist" aria-label="仕入れ候補">
          {candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              className={index === active ? "candidate active" : "candidate"}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls="decision-detail"
              onClick={() => setActive(index)}
            >
              <span className="candidate-number">{candidate.id}</span>
              <span className="candidate-main">
                <strong>{candidate.state}</strong>
                <small>{candidate.supplier}</small>
              </span>
              <span className="candidate-profit">{candidate.profit}</span>
            </button>
          ))}
        </div>

        <div className={`decision-detail ${item.tone}`} id="decision-detail" role="tabpanel" aria-live="polite">
          <div className="decision-topline">
            <span>{item.state}</span>
            <b>{item.confidence} identity confidence</b>
          </div>
          <h3>{item.product}</h3>
          <div className="decision-grid">
            <div><small>SUPPLIER COST</small><strong>{item.buy}</strong></div>
            <div><small>EXPECTED SELL</small><strong>{item.sell}</strong></div>
            <div><small>EXPECTED PROFIT</small><strong>{item.profit}</strong></div>
          </div>
          <div className="decision-reason">
            <span>WHY</span>
            <p>{item.reason}</p>
          </div>
          <div className="decision-actions">
            <button type="button" className="decision-primary">Open evidence</button>
            <span>Purchase requires human approval.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

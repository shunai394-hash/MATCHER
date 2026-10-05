"use client";

import { useRef, useState } from "react";

const candidates = [
  { id: "01", state: "SELLABLE", tone: "sellable", product: "Wireless Noise-Canceling Headphones", supplier: "Supplier A", buy: "¥12,800", sell: "¥21,900", profit: "+¥3,840", confidence: "94%", reason: "JAN exact · variant aligned · stock fresh", gates: [["IDENTITY", "PASS"], ["VARIANT", "PASS"], ["ECONOMICS", "PASS"], ["FRESHNESS", "PASS"]] },
  { id: "02", state: "BLOCKED", tone: "blocked", product: "Wireless Noise-Canceling Headphones", supplier: "Supplier B", buy: "¥11,400", sell: "¥21,900", profit: "—", confidence: "3%", reason: "Color mismatch · Black vs White", gates: [["IDENTITY", "PASS"], ["VARIANT", "BLOCK"], ["ECONOMICS", "—"], ["FRESHNESS", "—"]] },
  { id: "03", state: "REVIEW", tone: "review", product: "Wireless Noise-Canceling Headphones", supplier: "Supplier C", buy: "¥13,100", sell: "¥21,900", profit: "—", confidence: "41%", reason: "MPN missing · variant evidence incomplete", gates: [["IDENTITY", "REVIEW"], ["VARIANT", "REVIEW"], ["ECONOMICS", "—"], ["FRESHNESS", "—"]] },
] as const;

export function DecisionConsole() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const item = candidates[active];

  const select = (index: number) => setActive(index);
  const focusNext = (index: number) => {
    select(index);
    tabRefs.current[index]?.focus();
  };

  return (
    <section className="console" id="decision" aria-labelledby="decision-title">
      <div className="console-head">
        <div>
          <p className="section-index">03 / DECISION PREVIEW</p>
          <h2 id="decision-title">利益がある商品ではなく、<em>買っていい商品</em>を出す。</h2>
          <p className="console-lead">MATCHERが候補を絞り、証拠を並べ、最後の購入判断は人が握る。</p>
        </div>
        <span className="console-live"><i aria-hidden="true" /> ILLUSTRATIVE SCENARIO</span>
      </div>

      <div className="console-body">
        <div className="candidate-list" role="tablist" aria-label="仕入れ候補">
          {candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              className={index === active ? "candidate active" : "candidate"}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls="decision-detail"
              tabIndex={index === active ? 0 : -1}
              onClick={() => select(index)}
              onKeyDown={(event) => {
                const next = event.key === "ArrowDown" || event.key === "ArrowRight"
                  ? (index + 1) % candidates.length
                  : event.key === "ArrowUp" || event.key === "ArrowLeft"
                    ? (index - 1 + candidates.length) % candidates.length
                    : -1;
                if (next >= 0) {
                  event.preventDefault();
                  focusNext(next);
                }
              }}
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
          <div className="decision-gates" aria-label="判定ゲート">
            {item.gates.map(([label, state]) => (
              <div className="decision-gate" key={label}>
                <span>{label}</span>
                <strong>{state}</strong>
              </div>
            ))}
          </div>
          <div className="decision-signal" aria-label="判定サマリー">
            <div><span>DECISION SIGNAL</span><strong>{item.state === "SELLABLE" ? "BUY CANDIDATE" : item.state === "BLOCKED" ? "DO NOT BUY" : "HUMAN REVIEW"}</strong></div>
            <div className="signal-bar" aria-hidden="true"><i style={{ width: item.state === "SELLABLE" ? "94%" : item.state === "BLOCKED" ? "3%" : "41%" }} /></div>
            <small>{item.state === "SELLABLE" ? "全ゲート通過。購入承認へ進めます。" : item.state === "BLOCKED" ? "バリアント不一致。利益計算より先に停止します。" : "識別証拠が不足。追加確認が必要です。"}</small>
          </div>
          <div className="decision-reason">
            <span>WHY</span>
            <p>{item.reason}</p>
          </div>
          <div className="decision-actions">
            <button type="button" className="decision-primary" onClick={() => document.getElementById("proof")?.scrollIntoView({ behavior: "smooth" })}>判定の根拠を見る</button>
            <span>購入は人の承認後に進みます。</span>
          </div>
        </div>
      </div>
    </section>
  );
}

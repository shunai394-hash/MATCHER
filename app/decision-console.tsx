"use client";

import { useRef, useState } from "react";
import type { LiveOpportunity } from "../lib/matcher/live-opportunities";

type DecisionCandidate = LiveOpportunity & {
  state: "SELLABLE" | "BLOCKED" | "REVIEW";
  tone: "sellable" | "blocked" | "review";
};

function toCandidate(item: LiveOpportunity): DecisionCandidate {
  const state =
    item.orderability === "ORDERABLE" &&
    item.identityStrength >= 90 &&
    item.freshness >= 70 &&
    item.tier === "PRIORITY"
      ? "SELLABLE"
      : item.identityStrength === 0 || item.orderability === "BLOCKED"
        ? "BLOCKED"
        : "REVIEW";

  return {
    ...item,
    state,
    tone: state === "SELLABLE" ? "sellable" : state === "BLOCKED" ? "blocked" : "review",
  };
}

export function DecisionConsole({ opportunities }: { opportunities: LiveOpportunity[] }) {
  const candidates = opportunities.map(toCandidate);
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
          <p className="section-index">03 / DECISION CONSOLE</p>
          <h2 id="decision-title">利益がある商品ではなく、<em>買っていい商品</em>を出す。</h2>
          <p className="console-lead">実データから候補を絞り、証拠を並べ、最後の購入判断は人が握る。</p>
        </div>
        <span className="console-live"><i aria-hidden="true" /> VERIFIED DATA ONLY</span>
      </div>

      <div className="console-body">
        <div className="candidate-list" role="tablist" aria-label="仕入れ候補">
          {candidates.length === 0 ? (
            <div className="console-empty" role="status">
              <strong>NO VERIFIED CANDIDATES</strong>
              <span>利益・同定・鮮度を満たす実データが入るまで、購入候補を作りません。</span>
            </div>
          ) : candidates.map((candidate, index) => (
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
              <span className="candidate-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="candidate-main">
                <strong>{candidate.state}</strong>
                <small>{candidate.supplier}</small>
              </span>
              <span className="candidate-profit">¥{Math.round(candidate.profit).toLocaleString()}</span>
            </button>
          ))}
        </div>

        {item ? (
          <div className={`decision-detail ${item.tone}`} id="decision-detail" role="tabpanel" aria-live="polite">
            <div className="decision-topline">
              <span>{item.state}</span>
              <b>{item.identityStrength}% identity · {item.freshness}% freshness</b>
            </div>
            <h3>{item.product}</h3>
            <p className="decision-context">{item.supplier} · market observed {new Date(item.marketObservedAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}</p>
            <div className="decision-grid">
              <div><small>SUPPLIER COST</small><strong>¥{Math.round(item.buy).toLocaleString()}</strong></div>
              <div><small>EXPECTED SELL</small><strong>¥{Math.round(item.sell).toLocaleString()}</strong></div>
              <div><small>EXPECTED PROFIT</small><strong>¥{Math.round(item.profit).toLocaleString()}</strong></div>
            </div>
            <div className="decision-market" aria-label="市場シグナル">
  <div><span>DEMAND</span><strong>{item.demandVelocity}/100</strong></div>
  <div><span>COMPETITION</span><strong>{item.competition}/100</strong></div>
  <div><span>PRICE STABILITY</span><strong>{item.priceStability}/100</strong></div>
  <div><span>MARKET</span><strong>{item.marketSource}</strong></div>
</div>
<div className="decision-gates" aria-label="判定ゲート">
              <div className="decision-gate"><span>IDENTITY</span><strong>{item.identityStrength >= 90 ? "PASS" : item.identityStrength === 0 ? "BLOCK" : "REVIEW"}</strong></div>
              <div className="decision-gate"><span>ORDERABILITY</span><strong>{item.orderability === "ORDERABLE" ? "PASS" : item.orderability === "BLOCKED" ? "BLOCK" : "REVIEW"}</strong></div>
              <div className="decision-gate"><span>ECONOMICS</span><strong>{item.costComplete && item.profit > 0 ? "PASS" : "BLOCK"}</strong></div>
              <div className="decision-gate"><span>FRESHNESS</span><strong>{item.freshness >= 70 ? "PASS" : "BLOCK"}</strong></div>
            </div>
            <div className="decision-signal" aria-label="判定サマリー">
              <div><span>DECISION SIGNAL</span><strong>{item.state === "SELLABLE" ? "BUY CANDIDATE" : item.state === "BLOCKED" ? "DO NOT BUY" : "HUMAN REVIEW"}</strong></div>
              <div className="signal-bar" aria-hidden="true"><i style={{ width: `${item.score}%` }} /></div>
              <small>{item.state === "SELLABLE" ? "全ゲート通過。購入承認へ進めます。" : item.state === "BLOCKED" ? "ハード条件を満たさないため停止します。" : "証拠または鮮度が不足。追加確認が必要です。"}</small>
            </div>
            <div className="decision-reason">
              <span>WHY</span>
              <p>{item.reasons.join(" · ")}</p>
            </div>
            <div className="decision-actions">
              <button type="button" className="decision-primary" onClick={() => document.getElementById("proof")?.scrollIntoView({ behavior: "smooth" })}>判定の根拠を見る</button>
              <span>購入は人の承認後に進みます。カード決済前に最終確認します。</span>
            </div>
          </div>
        ) : (
          <div className="decision-detail review" id="decision-detail" role="status">
            <div className="decision-topline"><span>WAITING</span><b>LIVE DATA ONLY</b></div>
            <h3>検証済みの購入候補がまだありません。</h3>
            <p className="console-lead">実データが揃うまで、MATCHERは架空の利益を購入候補として表示しません。</p>
          </div>
        )}
      </div>
    </section>
  );
}

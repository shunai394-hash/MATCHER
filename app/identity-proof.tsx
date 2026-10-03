"use client";

import { useMemo, useState } from "react";

const cases = [
  {
    key: "exact",
    label: "EXACT IDENTIFIER",
    title: "JAN / EAN / UPC",
    source: "4901234567890",
    master: "4901234567890",
    decision: "AUTO LINK",
    note: "同一GTIN。識別子が一致。",
  },
  {
    key: "strong",
    label: "STRONG EVIDENCE",
    title: "Brand + MPN",
    source: "ACME / AX-204",
    master: "ACME / AX-204",
    decision: "AUTO LINK",
    note: "ブランドとメーカー型番が一致。",
  },
  {
    key: "variant",
    label: "VARIANT CRITICAL",
    title: "Variant mismatch",
    source: "BLACK / 256GB",
    master: "WHITE / 128GB",
    decision: "BLOCK",
    note: "色・容量が異なるため自動結合しない。",
  },
  {
    key: "review",
    label: "INSUFFICIENT EVIDENCE",
    title: "Needs review",
    source: "Brand only",
    master: "ACME",
    decision: "REVIEW",
    note: "証拠不足。推測で商品を結合しない。",
  },
] as const;

export function IdentityProof() {
  const [active, setActive] = useState("exact");
  const current = useMemo(() => cases.find((item) => item.key === active) ?? cases[0], [active]);

  return (
    <section className="proof" aria-labelledby="proof-title">
      <div className="proof-head">
        <div>
          <p className="proof-kicker">IDENTITY DECISION PROOF · ILLUSTRATIVE CASES</p>
          <h2 id="proof-title">一致を「推測」ではなく、証拠で見る。</h2>
        </div>
        <span className={current.decision === "BLOCK" ? "decision block" : current.decision === "REVIEW" ? "decision review" : "decision"}>
          {current.decision}
        </span>
      </div>

      <div className="proof-grid">
        <div className="proof-tabs" role="tablist" aria-label="識別判定の例">
          {cases.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active === item.key}
              tabIndex={active === item.key ? 0 : -1}
              className={active === item.key ? "proof-tab active" : "proof-tab"}
              onClick={() => setActive(item.key)}
            >
              <span>{item.label}</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </div>

        <div className="proof-stage">
          <div className="proof-node">
            <span>SUPPLIER</span>
            <strong>{current.source}</strong>
          </div>
          <div className="proof-connector" aria-hidden="true"><span>→</span></div>
          <div className="proof-node master">
            <span>PRODUCT MASTER</span>
            <strong>{current.master}</strong>
          </div>
          <p className="proof-note">{current.note}</p>
        </div>
      </div>
    </section>
  );
}

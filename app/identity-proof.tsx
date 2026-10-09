"use client";

import { useMemo, useRef, useState } from "react";

const cases = [
  { key:"exact", label:"EXACT IDENTIFIER", title:"JAN / EAN / UPC", source:"4901234567894", master:"4901234567894", decision:"AUTO LINK", coverage:"3/3", note:"同一GTIN。識別子が一致。", evidence:["GTIN exact match","Variant fields aligned","No blocking signal"] },
  { key:"strong", label:"STRONG EVIDENCE", title:"Brand + MPN", source:"ACME / AX-204", master:"ACME / AX-204", decision:"AUTO LINK", coverage:"3/3", note:"ブランドとメーカー型番が一致。", evidence:["Brand exact match","MPN exact match","Variant evidence present"] },
  { key:"variant", label:"VARIANT CRITICAL", title:"Variant mismatch", source:"BLACK / 256GB", master:"WHITE / 128GB", decision:"BLOCK", coverage:"1/3", note:"色・容量が異なるため自動結合しない。", evidence:["Brand context only","Color mismatch","Capacity mismatch"] },
  { key:"review", label:"INSUFFICIENT EVIDENCE", title:"Needs review", source:"Brand only", master:"ACME", decision:"REVIEW", coverage:"1/3", note:"証拠不足。推測で商品を結合しない。", evidence:["Brand exact match","MPN missing","Variant unknown"] },
] as const;

export function IdentityProof() {
  const [active, setActive] = useState("exact");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = useMemo(() => cases.find((item) => item.key === active) ?? cases[0], [active]);

  return (
    <section className="proof" aria-labelledby="proof-title">
      <div className="proof-head">
        <div>
          <p className="proof-kicker">IDENTITY DECISION PROOF · INTERACTIVE DEMO</p>
          <h2 id="proof-title">一致を「推測」ではなく、証拠で見る。</h2>
        </div>
        <span className={current.decision === "BLOCK" ? "decision block" : current.decision === "REVIEW" ? "decision review" : "decision"}>{current.decision}</span>
      </div>

      <div className="proof-grid">
        <div className="proof-tabs" role="tablist" aria-label="識別判定の例">
          {cases.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active === item.key}
              aria-controls="proof-result"
              tabIndex={active === item.key ? 0 : -1}
              className={active === item.key ? "proof-tab active" : "proof-tab"}
              onClick={() => setActive(item.key)}
              onKeyDown={(event) => {
                const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % cases.length : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + cases.length) % cases.length : -1;
                if (nextIndex < 0) return;
                event.preventDefault();
                setActive(cases[nextIndex].key);
                tabRefs.current[nextIndex]?.focus();
              }}
              ref={(node) => { tabRefs.current[index] = node; }}
            >
              <span>{item.label}</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </div>

        <div className="proof-stage" id="proof-result" role="tabpanel" aria-label={current.title}>
          <div className="proof-node">
            <span>SUPPLIER</span>
            <strong>{current.source}</strong>
          </div>
          <div className="proof-connector" aria-hidden="true"><span>→</span></div>
          <div className="proof-node master">
            <span>PRODUCT MASTER</span>
            <strong>{current.master}</strong>
          </div>
          <div className="proof-confidence" aria-label={`evidence coverage ${current.coverage}`}>
            <div><span>EVIDENCE COVERAGE</span><strong>{current.coverage}</strong></div>
            <div className="confidence-track" aria-hidden="true"><span style={{ width: current.coverage === "3/3" ? "100%" : "33%" }} /></div>
          </div>
          <div className="proof-evidence">
            {current.evidence.map((item, index) => <span key={item}><b>0{index + 1}</b>{item}</span>)}
          </div>
          <p className="proof-note">{current.note} <span>Illustrative demo.</span></p>
        </div>
      </div>
    </section>
  );
}

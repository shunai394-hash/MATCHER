"use client";
import { useState } from "react";

const stages = [["01","OBSERVE","商品・識別子・仕入れ・鮮度を観測"],["02","DIAGNOSE","不足・矛盾・古いデータを特定"],["03","REPAIR","原因に対する修正対象を決める"],["04","RETEST","修正後に同じ条件で再検証"],["05","LEARN","次の判定ルールへ反映"]];
export default function QualityPage() {
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function run() { setBusy(true); setResult(null); const r = await fetch("/api/quality-patrol", { method: "POST" }); setResult(await r.json()); setBusy(false); }
  return <main className="quality-shell">
    <header className="quality-header"><a href="/" className="console-brand">MATCHER</a><span>QUALITY CONTROL</span></header>
    <section className="quality-hero"><p className="section-kicker">CONTINUOUS QUALITY LOOP</p><h1>品質を「一度確認して終わり」にしない。</h1><p>観測 → 診断 → 修正 → 再検証 → 学習を同じ流れに置き、判定の信頼性を継続的に上げる。</p></section>
    <section className="quality-stages">{stages.map(([n,t,b]) => <article key={n}><small>{n}</small><h2>{t}</h2><p>{b}</p></article>)}</section>
    <section className="quality-action"><div><p className="section-kicker">LIVE PATROL</p><h2>今のMATCHERを検査する</h2><p>DB構造、必要テーブル、鮮度ポリシーを実際に確認します。データがない場合も「問題なし」とは扱いません。</p></div><button onClick={run} disabled={busy}>{busy ? "検査中…" : "品質パトロールを実行 →"}</button></section>
    {result && <section className="patrol-result" aria-live="polite"><strong>{result.error ? "PATROL ERROR" : result.status}</strong>{result.summary && <p>{result.summary.checks} checks / {result.summary.errors} errors / {result.summary.warnings} warnings</p>}<ul>{result.checks?.map((c:any) => <li key={c.code}><b>{c.severity}</b> {c.code}</li>)}</ul><p>{result.error}</p></section>}
  </main>;
}
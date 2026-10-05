import { DecisionConsole } from "./decision-console";
import { IdentityProof } from "./identity-proof";
import { getLiveOpportunities } from "../lib/matcher/live-opportunities";

const pillars = [
  ["01", "Product Master", "内部商品IDを中心に、識別子・仕様・バリアントを統合"],
  ["02", "Identity Matching", "JAN / EAN / UPC / MPN / SKU / ブランド・型番・仕様を証拠付きで照合"],
  ["03", "Supplier Linking", "1商品 : 多サプライヤーで価格・在庫・注文可否を管理"],
  ["04", "Profit & Safety", "実コストと利益を計算し、危険条件は利益が出ても自動ブロック"],
] as const;

const flow = ["Supplier Data", "Identity Match", "Product Master", "Cost / Profit", "Safety Gate", "Sellability"];

export const dynamic = "force-dynamic";

export default async function Home() {
  const liveFeed = await getLiveOpportunities();
  return (
    <main className="shell">
      <a className="skip-link" href="#decision">判断画面へ移動</a>
      <header className="header">
        <a className="brand" href="#" aria-label="MATCHER home">MATCHER</a>
        <nav className="nav" aria-label="Primary">
          <a href="#journey">Journey</a>
          <a href="#decision">Decision</a>
          <a href="#proof">Proof</a>
          <a href="#precision-title">Precision</a>
        </nav>
        <div className={`status status-${liveFeed.status.toLowerCase()}`} aria-label="Live data status">
  <span aria-hidden="true" />
  {liveFeed.status === "LIVE" ? "verified live data" : liveFeed.status === "EMPTY" ? "waiting for verified data" : "live feed unavailable"}
</div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">PROFIT OPPORTUNITY / SUPPLIER INTELLIGENCE</p>
        <h1 id="hero-title">利益機会を、<br /><em>探す前に見つける。</em></h1>
        <p className="lead">仕入れ候補をただ増やすのではなく、利益・需要・競争・鮮度・商品同定を一つの判断にまとめる。実データが揃わない機会は、見せない。<strong>「何を仕入れるか」を探し続ける時間を、買う理由を確かめる時間に変える。</strong></p>
        <div className="hero-actions">
          <a className="button primary" href="#opportunity">利益機会を見る <span aria-hidden="true">↘</span></a>
          <a className="button secondary" href="#proof">判定の根拠を見る <span aria-hidden="true">↓</span></a>
        </div>
        <div className="hero-meta" aria-label="MATCHER principles">
          <span>PROFIT FIRST</span><span>·</span><span>EVIDENCE LED</span><span>·</span><span>HUMAN APPROVED</span>
        </div>
        <div className="hero-signal" aria-label="The MATCHER decision model">
          <div><span>OPPORTUNITY</span><b>↓</b><strong>JUDGEMENT</strong></div>
          <p>候補を増やすのではなく、<em>今見る価値が高い機会だけを前に出す。</em></p>
        </div>
      </section>

      <section className="journey" id="journey" aria-labelledby="journey-title">
        <div className="journey-head">
          <div>
            <p className="section-index">00 / USER JOURNEY</p>
            <h2 id="journey-title">見る → 確かめる → 決める。</h2>
          </div>
          <p>一画面の中で「なぜ買えるか」「なぜ止まるか」を理解できる。MATCHERはデータを見せるためではなく、迷いを減らすために設計する。</p>
        </div>
        <div className="journey-steps">
          <article><span>01</span><strong>FIND</strong><p>候補を絞り、商品そのものを先に特定する。</p></article>
          <article><span>02</span><strong>PROVE</strong><p>識別子・仕様・バリアントを証拠として確認する。</p></article>
          <article><span>03</span><strong>DECIDE</strong><p>利益・鮮度・安全性を通過させ、人が最終承認する。</p></article>
        </div>
      </section>

      <section className="opportunity" id="opportunity" aria-labelledby="opportunity-title">
        <div className="opportunity-head">
          <div>
            <p className="section-index">02 / PROFIT OPPORTUNITY</p>
            <h2 id="opportunity-title">利益率だけでなく、<em>売れる確率と競争リスク</em>まで見て並べる。</h2>
          </div>
          <p>「価格差が大きい順」ではなく、期待利益・ROI・需要速度・競争・価格安定性・鮮度・商品同定・リスクをまとめて優先順位化する。</p>
        </div>
        {liveFeed.opportunities.length > 0 ? (
          <div className="opportunity-list">
            {liveFeed.opportunities.map((item, index) => (
              <article className={`opportunity-item ${item.tier.toLowerCase()}`} key={item.id}>
                <div className="opportunity-rank">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <span>{item.tier} · LIVE</span>
                  <h3>{item.product}</h3>
                  <p>ROI {item.roiPercent}% · expected profit ¥{Math.round(item.profit).toLocaleString()} · {item.supplier} · freshness {item.freshness}%</p>
                </div>
                <strong>{item.score}</strong>
              </article>
            ))}
          </div>
        ) : (
          <div className="opportunity-empty" role="status">
            <strong>{liveFeed.status === "UNAVAILABLE" ? "LIVE FEED UNAVAILABLE" : "WAITING FOR VERIFIED OPPORTUNITIES"}</strong>
            <p>{liveFeed.message}</p>
            <span>架空の利益機会は表示しません。</span>
          </div>
        )}
        <p className="opportunity-foot">LIVE: supplier offer / verified profit / identity / freshness / market observation. 市場観測が欠けた候補は、利益機会としてランキングしません。</p>
      </section>

      <DecisionConsole opportunities={liveFeed.opportunities} />
      <section id="proof"><IdentityProof /></section>

      <section className="precision-contract" aria-labelledby="precision-title">
        <div className="precision-head">
          <div>
            <p className="section-index">01 / PRECISION CONTRACT</p>
            <h2 id="precision-title">一致度ではなく、<em>止めるべき理由</em>を先に判定する。</h2>
          </div>
          <p>曖昧な候補を「たぶん同じ商品」として通さない。強い識別子、型番、バリアント、鮮度の順に証拠を確認し、矛盾が一つでもあれば下流の利益計算より先に止める。</p>
        </div>
        <div className="precision-rules">
          <article><span>01</span><strong>IDENTIFIER</strong><p>JAN / EAN / UPC が一致しても、バリアント不一致なら結合しない。</p><b>HARD GATE</b></article>
          <article><span>02</span><strong>MODEL</strong><p>MPN / 型番は完全一致を優先。欠落は推測で補完せず REVIEW。</p><b>NO GUESSING</b></article>
          <article><span>03</span><strong>VARIANT</strong><p>色・サイズ・容量・セット数・状態の矛盾は BLOCK。</p><b>BLOCK ON CONFLICT</b></article>
          <article><span>04</span><strong>FRESHNESS</strong><p>価格・在庫・送料は独立して鮮度を評価し、古い値を現在値として扱わない。</p><b>TIME-AWARE</b></article>
        </div>
        <div className="precision-foot"><strong>PRINCIPLE</strong><span>WEAK MATCH → REVIEW → NEVER SILENTLY PROMOTE</span></div>
      </section>

      <section className="section-intro" aria-labelledby="pillars-title">
        <div>
          <p className="section-index">01 / FOUNDATION</p>
          <h2 id="pillars-title">Matching is only the beginning.</h2>
        </div>
        <p>利益機会を見つけたあとに、つなぐ・証明する・計算する・止める。MATCHERは商品同定を、販売判断まで続く一つの系として扱う。</p>
      </section>

      <section className="grid" aria-label="MATCHER capabilities">
        {pillars.map(([num, title, text]) => (
          <article className="card" key={num}>
            <div className="num">{num}</div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="flow" id="architecture" aria-labelledby="flow-title">
        <div className="flow-head">
          <div>
            <p className="section-index">02 / DECISION PIPELINE</p>
            <h2 id="flow-title">From raw supplier data to a safe sell decision.</h2>
          </div>
          <span className="flow-state">6 STAGES · CONTINUOUS CHECK</span>
        </div>
        <div className="flow-row">
          {flow.map((item, i) => (
            <div className="flow-item" key={item}>
              <b>{String(i + 1).padStart(2, "0")}</b>
              <span>{item}</span>
              {i < flow.length - 1 && <i aria-hidden="true">→</i>}
            </div>
          ))}
        </div>
      </section>

      <section className="closing" aria-labelledby="closing-title">
        <p className="section-index">04 / THE PROMISE</p>
        <h2 id="closing-title">「探す」を終わらせ、<em>買う理由</em>を残す。</h2>
        <p>商品同定から仕入れ判断までを一本につなぎ、判断の根拠が後から追える体験へ。</p>
      </section>

      <footer className="footer">
        <span>MATCHER</span>
        <span>PROFIT OPPORTUNITY / SUPPLIER INTELLIGENCE</span>
        <span>FOUNDATION BUILD · 2026</span>
      </footer>
    </main>
  );
}

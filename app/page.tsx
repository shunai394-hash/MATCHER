import { DecisionConsole } from "./decision-console";
import { IdentityProof } from "./identity-proof";

const pillars = [
  ["01", "Product Master", "内部商品IDを中心に、識別子・仕様・バリアントを統合"],
  ["02", "Identity Matching", "JAN / EAN / UPC / MPN / SKU / ブランド・型番・仕様を証拠付きで照合"],
  ["03", "Supplier Linking", "1商品 : 多サプライヤーで価格・在庫・注文可否を管理"],
  ["04", "Profit & Safety", "実コストと利益を計算し、危険条件は利益が出ても自動ブロック"],
] as const;

const flow = ["Supplier Data", "Identity Match", "Product Master", "Cost / Profit", "Safety Gate", "Sellability"];

export default function Home() {
  return (
    <main className="shell">
      <a className="skip-link" href="#decision">判断画面へ移動</a>
      <header className="header">
        <a className="brand" href="#" aria-label="MATCHER home">MATCHER</a>
        <nav className="nav" aria-label="Primary">
          <a href="#journey">Journey</a>
          <a href="#decision">Decision</a>
          <a href="#proof">Proof</a>
          <a href="#architecture">System</a>
        </nav>
        <div className="status" aria-label="Interface status"><span aria-hidden="true" /> decision-first interface</div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">PRODUCT IDENTITY / SUPPLIER INTELLIGENCE</p>
        <h1 id="hero-title">同じ商品を、<br /><em>正しく見つける。</em></h1>
        <p className="lead">商品を識別し、サプライヤーを正確につなぎ、実コストと安全性まで判定する。<strong>「何を仕入れるか」を探し続ける時間を、判断の時間に変える。</strong></p>
        <div className="hero-actions">
          <a className="button primary" href="#decision">仕入れ候補を見る <span aria-hidden="true">↘</span></a>
          <a className="button secondary" href="#proof">判定の根拠を見る <span aria-hidden="true">↓</span></a>
        </div>
        <div className="hero-meta" aria-label="MATCHER principles">
          <span>IDENTITY FIRST</span><span>·</span><span>EVIDENCE LED</span><span>·</span><span>HUMAN APPROVED</span>
        </div>
        <div className="hero-signal" aria-label="The MATCHER decision model">
          <div><span>SEARCH</span><b>↓</b><strong>JUDGEMENT</strong></div>
          <p>探す量を増やすのではなく、<em>判断に必要な情報だけを前に出す。</em></p>
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

      <DecisionConsole />
      <section id="proof"><IdentityProof /></section>

      <section className="section-intro" aria-labelledby="pillars-title">
        <div>
          <p className="section-index">01 / FOUNDATION</p>
          <h2 id="pillars-title">Matching is only the beginning.</h2>
        </div>
        <p>識別したあとに、つなぐ・計算する・止める。MATCHERは商品同定を、販売判断まで続く一つの系として扱う。</p>
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
        <span>PRODUCT IDENTITY / SUPPLIER INTELLIGENCE</span>
        <span>FOUNDATION BUILD · 2026</span>
      </footer>
    </main>
  );
}

import { IdentityProof } from "./identity-proof";

const pillars = [
  ["01", "Product Master", "内部商品IDを中心に、識別子・仕様・バリアントを統合"],
  ["02", "Identity Matching", "JAN / EAN / UPC / MPN / SKU / ブランド・型番・仕様を証拠付きで照合"],
  ["03", "Supplier Linking", "1商品 : 多サプライヤーで価格・在庫・注文可否を管理"],
  ["04", "Profit & Safety", "実コストと利益を計算し、危険条件は利益が出ても自動ブロック"],
];

const journey = [
  ["01", "CHECK", "商品情報を入れる", "識別子・型番・ブランドなど、確認できる情報から照合を開始。"],
  ["02", "PROVE", "証拠を見る", "一致・要確認・ブロックを分け、推測で商品を結合しない。"],
  ["03", "DECIDE", "次の判断へ", "商品同一性、供給条件、利益、安全性を確認してから進む。"],
];

export default function Home() {
  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">MATCHER</div>
          <div className="brand-sub">IDENTITY INTELLIGENCE</div>
        </div>
        <div className="status"><span /> foundation online</div>
      </header>

      <section className="hero">
        <p className="eyebrow">PRODUCT IDENTITY & SUPPLIER INTELLIGENCE</p>
        <h1>同じ商品を、<br /><em>正しく見つける。</em></h1>
        <p className="lead">商品を識別し、サプライヤーを正確につなぎ、実コストと安全性まで判定する基盤。</p>
        <div className="hero-actions" aria-label="MATCHERの使い方">
          <a className="primary-action" href="#identity-proof">判定の仕組みを見る <span aria-hidden="true">↓</span></a>
          <a className="secondary-action" href="#customer-flow">3ステップで理解する</a>
        </div>
      </section>

      <section className="customer-flow" id="customer-flow" aria-labelledby="customer-flow-title">
        <div className="section-kicker">FIRST SESSION · 3 STEPS</div>
        <div className="section-heading">
          <div>
            <h2 id="customer-flow-title">最初の1分で、何が分かるか。</h2>
            <p>専門知識がなくても、MATCHERがどこまで確認できたかを追える設計にする。</p>
          </div>
          <span className="flow-status">EVIDENCE FIRST</span>
        </div>
        <div className="journey-grid">
          {journey.map(([num, title, text]) => (
            <article className="journey-card" key={num}>
              <span className="journey-num">{num}</span>
              <div>
                <span className="journey-label">{title}</span>
                <h3>{text}</h3>
              </div>
              <p>{title === "CHECK" ? "入力された事実から開始" : title === "PROVE" ? "証拠の強さを明示" : "不確かなものは止めて残す"}</p>
            </article>
          ))}
        </div>
      </section>

      <div id="identity-proof">
        <IdentityProof />
      </div>

      <section className="grid" aria-label="MATCHERの主要機能">
        {pillars.map(([num, title, text]) => (
          <article className="card" key={num}>
            <div className="num">{num}</div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="flow" aria-labelledby="core-flow-title">
        <div className="flow-title" id="core-flow-title">CORE FLOW</div>
        <div className="flow-row">
          {["Supplier Data", "Identity Match", "Product Master", "Cost / Profit", "Safety Gate", "Sellability"].map((item, i) => (
            <div className="flow-item" key={item}><b>{String(i + 1).padStart(2, "0")}</b>{item}</div>
          ))}
        </div>
      </section>

      <footer className="trust-note">
        <span>QUALITY PRINCIPLE</span>
        <p>証拠が足りないものは「一致」にしない。判定できない理由も、次の確認対象として残す。</p>
      </footer>
    </main>
  );
}

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
const qualityLoop = [
  ["01", "CHECK", "入力と前提を確認", "抜け・矛盾・不明点を先に見つける"],
  ["02", "MATCH", "候補を照合", "識別子と商品属性を証拠付きで比較する"],
  ["03", "PROVE", "根拠を検証", "一致・要確認・ブロックを分離する"],
  ["04", "GATE", "安全条件を通す", "精度を犠牲にして通過数を増やさない"],
  ["05", "RECHECK", "弱点を再確認", "不確かな点を次のチェック対象として残す"],
];

export default function Home() {
  return (
    <main className="shell">
      <header className="header">
        <a className="brand-lockup" href="#" aria-label="MATCHER トップ">
          <div className="brand">MATCHER</div>
          <div className="brand-sub">IDENTITY INTELLIGENCE</div>
        </a>
        <nav className="header-nav" aria-label="ページ内ナビゲーション">
          <a href="/console">仕入れ判断</a>
          <a href="/quality">品質センター</a>
          <a href="#identity-proof">判定を見る</a>
          <a href="#quality-loop">品質ループ</a>
          <a href="#core-flow-title">全体像</a>
        </nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">PRODUCT IDENTITY & SUPPLIER INTELLIGENCE</p>
        <h1 id="hero-title">同じ商品を、<br /><em>正しく見つける。</em></h1>
        <p className="lead">商品を識別し、サプライヤーを正確につなぎ、実コストと安全性まで判定する基盤。</p>
        <div className="hero-actions" aria-label="MATCHERを理解する">
          <a className="primary-action" href="#identity-proof">判定の仕組みを見る <span aria-hidden="true">↓</span></a>
          <a className="secondary-action" href="/console">仕入れ判断を試す</a>
        </div>
        <p className="hero-note"><span aria-hidden="true">01</span> まず「なぜ一致したか」を見る。そこから品質ループへ進む。</p>
      </section>

      <section className="customer-flow" id="customer-flow" aria-labelledby="customer-flow-title">
        <div className="section-kicker">DECISION JOURNEY · 3 STEPS</div>
        <div className="section-heading">
          <div>
            <h2 id="customer-flow-title">迷わず、判定の根拠までたどれる。</h2>
            <p>専門知識がなくても、何を確認し、どこで止まり、次に何を見るかを追える設計。</p>
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

      <section className="quality-loop" id="quality-loop" aria-labelledby="quality-loop-title">
        <div className="section-kicker">QUALITY LOOP · REPEATABLE CHECK</div>
        <div className="section-heading">
          <div>
            <h2 id="quality-loop-title">一度で終わらせず、弱点を見つけて再確認する。</h2>
            <p>判定を通すこと自体を目的にせず、チェック → 検証 → ゲート → 再確認を同じ品質基準で回す。</p>
          </div>
          <span className="flow-status">PRECISION FIRST</span>
        </div>
        <div className="quality-grid">
          {qualityLoop.map(([num, label, title, text], index) => (
            <article className="quality-card" key={num}>
              <div className="quality-top">
                <span>{num}</span>
                {index < qualityLoop.length - 1 ? <span aria-hidden="true">→</span> : <span aria-hidden="true">↻</span>}
              </div>
              <span className="journey-label">{label}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <div className="loop-note">
          <span>AI / AUTOMATION PRINCIPLE</span>
          <p>AIや自動化を使う場合も、推測だけで一致を確定しない。根拠・ゲート・再確認を同じ品質ループに残す。</p>
        </div>
      </section>

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

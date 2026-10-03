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
        <nav className="mobile-nav" aria-label="主要ページ">
          <a href="/console">仕入れ判断</a>
          <a href="/quality">品質</a>
        </nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">PRODUCT IDENTITY & SUPPLIER INTELLIGENCE</p>
        <h1 id="hero-title">同じ商品を、<br /><em>正しく見つける。</em></h1>
        <p className="lead">「これ、本当に同じ商品？」「仕入れて利益が残る？」を、証拠から一つずつ確認。迷ったまま買わないための仕入れ判断基盤。</p>
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



      <section className="value-proposition" aria-labelledby="value-title">
        <div className="section-kicker">WHY MATCHER</div>
        <div className="section-heading">
          <div>
            <h2 id="value-title">「探す」ではなく、<em>仕入れて後悔しない。</em></h2>
            <p>他の仕入れ先を増やすだけでは、同じ商品を取り違えたり、送料・手数料を見落として利益が消えます。MATCHERは「買う前の不安」を減らすために使います。</p>
          </div>
          <span className="flow-status">VALUE FIRST</span>
        </div>
        <div className="value-grid">
          <article><b>01 · 時間</b><h3>同じ商品かを毎回手作業で調べない</h3><p>JAN・型番・ブランド・仕様をまとめて確認し、候補と根拠を一つの判断画面に集める。</p></article>
          <article><b>02 · 損失</b><h3>「安く買えたのに赤字」を減らす</h3><p>仕入れ・送料・手数料など、利益計算に必要な条件が揃わなければ販売可能にしない。</p></article>
          <article><b>03 · 安心</b><h3>自信がない商品を無理に通さない</h3><p>一致・要確認・ブロックを分け、証拠不足を「たぶん同じ」で済ませない。</p></article>
          <article><b>04 · 改善</b><h3>使うほど「どこで迷ったか」が残る</h3><p>品質ループで弱点を再チェックし、次の判定品質を上げるための対象として残す。</p></article>
        </div>
        <div className="value-promise">
          <strong>あなたが欲しいのは商品情報ではなく、<em>「この仕入れで進んでいい」という判断材料。</em></strong>
          <a className="primary-action" href="/console">実際に仕入れ判断を試す →</a>
        </div>
      </section>

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

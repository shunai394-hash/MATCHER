import { IdentityProof } from "./identity-proof";

const pillars = [
  ["01", "Product Master", "内部商品IDを中心に、識別子・仕様・バリアントを統合"],
  ["02", "Identity Matching", "JAN / EAN / UPC / MPN / SKU / ブランド・型番・仕様を証拠付きで照合"],
  ["03", "Supplier Linking", "1商品 : 多サプライヤーで価格・在庫・注文可否を管理"],
  ["04", "Profit & Safety", "実コストと利益を計算し、危険条件は利益が出ても自動ブロック"],
];

export default function Home() {
  return (
    <main className="shell">
      <header className="header">
        <div className="brand">MATCHER</div>
        <div className="status"><span /> foundation online</div>
      </header>

      <section className="hero">
        <p className="eyebrow">PRODUCT IDENTITY & SUPPLIER INTELLIGENCE</p>
        <h1>同じ商品を、<br /><em>正しく見つける。</em></h1>
        <p className="lead">商品を識別し、サプライヤーを正確につなぎ、実コストと安全性まで判定する基盤。</p>
      </section>

      <IdentityProof />

      <section className="grid">
        {pillars.map(([num, title, text]) => (
          <article className="card" key={num}>
            <div className="num">{num}</div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="flow">
        <div className="flow-title">CORE FLOW</div>
        <div className="flow-row">
          {['Supplier Data', 'Identity Match', 'Product Master', 'Cost / Profit', 'Safety Gate', 'Sellability'].map((item, i) => (
            <div className="flow-item" key={item}><b>{String(i + 1).padStart(2, '0')}</b>{item}</div>
          ))}
        </div>
      </section>
    </main>
  );
}

"use client";
import { useState } from "react";

const product = "https://www.amazon.co.jp/dp/B0HNWHHBXJ";
const routines = [
 { id:"beauty", title:"美容習慣を見直したい", lead:"毎日の栄養を、ひとつずつ丁寧に。", body:"忙しい日々でも、自分をいたわる時間をつくりたい方へ。まずは食事全体のバランスを大切にしながら、続けやすい習慣を考えてみませんか。", tags:["毎日の栄養補給","続けやすさ","成分表示を確認"] },
 { id:"active", title:"運動と栄養を意識したい", lead:"動く日も、休む日も。", body:"運動習慣とあわせて、たんぱく質を含む食事を意識したい方へ。普段の食事や活動量に合わせて取り入れ方を検討できます。", tags:["たんぱく質","運動習慣","食事との組み合わせ"] },
 { id:"forty", title:"40代からの習慣づくり", lead:"これからの自分に、できることから。", body:"年齢を重ねても、自分らしい毎日を大切にしたい方へ。特別なことを増やすより、食事・運動・休養を見直すきっかけに。", tags:["毎日のリズム","食生活を見直す","無理なく続ける"] }
];
const facts = [
 {n:"01", title:"たんぱく質", amount:"16g", note:"1食20gあたり", body:"商品画像に表示されたたんぱく質量です。日々の食事全体と合わせて、摂取量をご確認ください。"},
 {n:"02", title:"エネルギー", amount:"104kcal", note:"1食20gあたり", body:"1食あたりのエネルギー表示。実際の摂取量は、製品の正式な栄養成分表示をご確認ください。"},
 {n:"03", title:"HMB-Ca", amount:"300mg", note:"1食20gあたり", body:"パッケージ画像に記載された配合量です。成分の働きや体感を保証するものではありません。"},
 {n:"04", title:"8PN配合", amount:"8種類", note:"美容サポート成分の表示", body:"画像上の表示に基づく案内です。原材料名・配合内容は購入前に商品パッケージの正式表示をご確認ください。"}
];
const faq = [
 ["どのような商品ですか？","商品画像では、チョコレート風味の粉末プロテインとして案内されています。内容量は300g、約15食分と表示されています。"],
 ["1食あたりの目安は？","商品画像には1食20gあたり、たんぱく質16g・104kcal・HMB-Ca 300mgと表示されています。正確な召し上がり方は商品パッケージの表示を優先してください。"],
 ["どうやって飲みますか？","商品画像の背面には、付属スプーンすりきり約2杯を水など200〜300mlに溶かす旨の案内が見えます。お手元の商品に記載された飲み方をご確認ください。"],
 ["価格・在庫・配送日は？","販売状況により変わるため、Amazonの商品ページで最新の価格・在庫・配送予定をご確認ください。"],
 ["原材料や注意事項はどこで確認できますか？","購入前に、商品パッケージと販売ページに掲載された原材料・アレルゲン・栄養成分・注意事項を確認してください。"]
];
export default function Home() {
 const [routine,setRoutine]=useState("beauty");
 const selected=routines.find(x=>x.id===routine) || routines[0];
 return <main className="soy-lp" id="top">
  <div className="soy-announce">SOY+ BEAUTY FORMULA <span>／</span> CHOCOLATE FLAVOR</div>
  <header className="soy-header"><a className="soy-brand" href="#top">SOY<span>+</span></a><nav aria-label="ページ内メニュー"><a href="#features">商品特徴</a><a href="#ingredients">成分表示</a><a href="#howto">飲み方</a><a href="#faq">FAQ</a></nav><a className="soy-header-cta" href={product} target="_blank" rel="noreferrer">販売ページへ ↗</a></header>
  <section className="soy-hero">
   <div className="soy-hero-copy"><p className="soy-eyebrow">40代からの美容習慣に</p><h1>美しく、<br/><em>健康的に。</em></h1><p className="soy-hero-sub">カラダの中から、キレイをつくるプロテイン</p><p className="soy-hero-description">美容も、毎日の栄養も、自分らしい習慣から。<br/>チョコレート風味の「BEAUTY FORMULA」を、<br className="desktop-only"/>いつもの暮らしに取り入れる選択肢に。</p><div className="soy-hero-actions"><a className="soy-btn soy-btn-primary" href={product} target="_blank" rel="noreferrer">商品ページで価格を確認 <span>↗</span></a><a className="soy-underlink" href="#features">商品特徴を詳しく見る ↓</a></div><p className="soy-hero-caution">価格・在庫・配送条件は販売ページでご確認ください。</p></div>
   <div className="soy-hero-image"><img src="/soy-plus-chocolate-product.png" alt="SOY+ BEAUTY FORMULA チョコレート風味のピンク色パッケージとシェイクの商品イメージ"/><span className="soy-image-caption">BEAUTY FORMULA / CHOCOLATE FLAVOR</span></div>
   <div className="soy-hero-bottom"><span>300g <i>／</i> 約15食分</span><span>商品画像に表示された情報を掲載</span></div>
  </section>
  <section className="soy-proof-strip" aria-label="商品画像に表示された主な情報">{facts.map(f=><div key={f.n}><span className="soy-proof-number">{f.n}</span><div><strong>{f.amount}</strong><small>{f.title} <i>{f.note}</i></small></div></div>)}</section>
  <section className="soy-intro" id="features"><div className="soy-section-top"><span>01 / ABOUT BEAUTY FORMULA</span><span>商品を知る</span></div><div className="soy-intro-grid"><h2>毎日の自分を、<br/><em>少しずついたわる。</em></h2><div><p>続けるために大切なのは、商品の特徴を知り、自分の生活に合うかを確かめること。SOY+ BEAUTY FORMULAは、チョコレート風味・300g入りのプロテインとして紹介されています。</p><p>成分の量や召し上がり方、原材料・注意事項を購入前に確認して、自分に合った選択を。</p></div></div></section>
  <section className="soy-features"><div className="soy-section-top"><span>02 / AT A GLANCE</span><span>パッケージ表示から</span></div><h2>選ぶ前に知っておきたい、<br/><em>4つのポイント。</em></h2><div className="soy-feature-grid">{facts.map(f=><article key={f.n} className="soy-feature-card"><span>{f.n} / PRODUCT INFO</span><h3>{f.title}</h3><strong>{f.amount}</strong><small>{f.note}</small><p>{f.body}</p></article>)}</div><p className="soy-smallprint">※数値・表現はアップロードされた商品画像から読み取れる範囲に基づきます。実際の商品に記載された最新の表示を必ずご確認ください。</p></section>
  <section className="soy-routine"><div className="soy-section-top"><span>03 / YOUR ROUTINE</span><span>あなたの暮らしに合わせて</span></div><div className="soy-routine-heading"><h2>あなたが大切にしたいのは、<br/><em>どんな習慣ですか？</em></h2><p>気になる目的を選ぶと、取り入れる前に考えたいポイントを確認できます。</p></div><div className="soy-routine-tabs" role="tablist" aria-label="習慣を選択">{routines.map(r=><button key={r.id} role="tab" aria-selected={routine===r.id} aria-controls="soy-routine-panel" onClick={()=>setRoutine(r.id)} className={routine===r.id?"active":""}>{r.title}<span>{routine===r.id?"−":"＋"}</span></button>)}</div><div className="soy-routine-panel" id="soy-routine-panel" role="tabpanel"><p>YOUR ROUTINE / 0{routines.findIndex(r=>r.id===routine)+1}</p><h3>{selected.lead}</h3><div><p>{selected.body}</p><ul>{selected.tags.map(t=><li key={t}>{t}</li>)}</ul></div></div><p className="soy-smallprint">※本商品が特定の美容効果・健康効果をもたらすことを保証するものではありません。食事全体のバランスを大切にしてください。</p></section>
  <section className="soy-ingredients" id="ingredients"><div className="soy-section-top"><span>04 / CHECK THE LABEL</span><span>購入前に成分を確認</span></div><div className="soy-ingredients-head"><h2>気になる成分は、<br/><em>正式な表示で確認。</em></h2><p>商品画像の裏面には原材料名・栄養成分表示などが掲載されています。小さな文字を推測で読み替えず、販売ページやお手元のパッケージで詳細をご確認ください。</p></div><div className="soy-label-list"><article><span>01</span><div><h3>原材料・アレルゲン</h3><p>原材料の一覧と、アレルギーに関する表示を確認しましょう。</p></div><b>CHECK</b></article><article><span>02</span><div><h3>栄養成分・1食量</h3><p>1食あたりの目安量と栄養成分を確認し、食事全体とのバランスを考えましょう。</p></div><b>CHECK</b></article><article><span>03</span><div><h3>召し上がり方・注意事項</h3><p>使用量、溶かし方、保存方法、注意事項は製品パッケージの指示に従ってください。</p></div><b>CHECK</b></article></div><a className="soy-underlink" href={product} target="_blank" rel="noreferrer">販売ページで商品情報を確認 ↗</a></section>
  <section className="soy-howto" id="howto"><div className="soy-howto-visual"><img src="/soy-plus-chocolate-product.png" alt="チョコレート風味のSOY+ BEAUTY FORMULA 商品画像"/></div><div className="soy-howto-copy"><p className="soy-eyebrow">05 / HOW TO ENJOY</p><h2>いつもの時間に、<br/><em>取り入れやすく。</em></h2><p>商品画像の背面には、付属スプーンすりきり約2杯を水など200〜300mlに溶かす飲み方が記載されています。正確な量や作り方は、購入した商品のパッケージ表示に従ってください。</p><div className="soy-howto-step"><span>STEP 01</span><b>パッケージの目安量を確認</b></div><div className="soy-howto-step"><span>STEP 02</span><b>水などに溶かして飲む</b></div><div className="soy-howto-step"><span>STEP 03</span><b>食事・運動・休養と組み合わせる</b></div><p className="soy-smallprint">※画像から読み取れる情報をもとにした案内です。実際の製品表示を優先してください。</p></div></section>
  <section className="soy-buy-band"><div><p className="soy-eyebrow">READY TO CHECK?</p><h2>購入前に、商品情報を<br/><em>しっかり確認。</em></h2><p>価格・在庫・配送予定・正式な成分表示は販売ページでご確認ください。</p></div><a className="soy-btn soy-btn-primary" href={product} target="_blank" rel="noreferrer">Amazonの商品ページへ ↗</a></section>
  <section className="soy-faq" id="faq"><div className="soy-section-top"><span>06 / FAQ</span><span>購入前によくある確認事項</span></div><h2>気になることに、<br/><em>購入前に答えます。</em></h2><div className="soy-faq-list">{faq.map(([q,a],i)=><details key={q}><summary><span>Q{String(i+1).padStart(2,"0")}</span><b>{q}</b><i>＋</i></summary><p>{a}</p></details>)}</div></section>
  <section className="soy-final"><p className="soy-eyebrow">A SMALL STEP FOR YOUR DAILY ROUTINE</p><h2>自分のための習慣を、<br/><em>今日から考えよう。</em></h2><p>まずは商品情報を確認して、自分に合うかどうかを確かめてください。</p><a className="soy-btn soy-btn-light" href={product} target="_blank" rel="noreferrer">商品ページで価格・在庫を確認 ↗</a><small>注文・決済は販売ページで行います。</small></section>
  <div className="soy-sticky"><div><b>SOY+</b><span>BEAUTY FORMULA / チョコレート風味</span></div><a href={product} target="_blank" rel="noreferrer">商品情報・価格を見る ↗</a></div>
  <footer className="soy-footer"><a className="soy-brand" href="#top">SOY<span>+</span></a><span>BEAUTY FORMULA / CHOCOLATE FLAVOR</span><a href="#top">ページ上部へ ↑</a></footer><p className="soy-legal">本ページは商品情報を確認するための案内です。効果・効能を保証するものではありません。原材料・アレルゲン・栄養成分・使用方法・注意事項は、販売ページおよび実際の商品パッケージの正式表示をご確認ください。</p>
 </main>;
}

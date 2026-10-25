import type { Metadata } from "next";
import Image from "next/image";
import productImage from "../public/images/soy-plus/beauty-formula-chocolate-set.webp";
import { SceneImage } from "./soy-scene-image";
import styles from "./soy-lp.module.css";

// Lifestyle photos generated with Higgsfield. They never show the product itself; the
// product always appears from the supplied package photo above. Served through the
// Next.js image optimizer (see images.remotePatterns in next.config.ts).
const HIGGSFIELD_CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3L5iapCiBz1VMC05NhTNVQsVbou";
const scenes = {
  morning: `${HIGGSFIELD_CDN}/hf_20261025_101156_a3d661e6-1043-4865-98ef-3f978615818a.png`,
  shake: `${HIGGSFIELD_CDN}/hf_20261025_101157_e8b9e0bb-20fb-49f2-8e0f-a57b7417aad9.png`,
  scoop: `${HIGGSFIELD_CDN}/hf_20261025_101156_939180fe-90cb-4472-83a6-7d702822d18f.png`,
  stretch: `${HIGGSFIELD_CDN}/hf_20261025_101156_61762265-f503-4999-8d71-f35d805cff75.png`,
  window: `${HIGGSFIELD_CDN}/hf_20261025_101157_91185dfc-1517-4ac3-8154-d111dda48920.png`,
} as const;

// Every buy button goes to one destination. Set NEXT_PUBLIC_SOY_PURCHASE_URL to the
// store's own product page or cart URL; it falls back to the Amazon listing.
// Price, stock and shipping are never shown here because they change on the store side.
const PURCHASE_URL = process.env.NEXT_PUBLIC_SOY_PURCHASE_URL || "https://www.amazon.co.jp/dp/B0HNWHHBXJ";
const PURCHASE_STORE = PURCHASE_URL.includes("amazon.co.jp") ? "Amazon" : "販売ページ";
const PRODUCT_NAME = "BEAUTY FORMULA";
const PRODUCT_ALT =
  "BEAUTY FORMULA チョコレート風味のピンク色パッケージ（表面と裏面）とチョコレートドリンク。パッケージ表面に「たんぱく質16g・104kcal・HMB-Ca 300mg（1食20gあたり）」「8PN配合」「300g 約15食分」と表示";

const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "BEAUTY FORMULA｜美容プロテイン・チョコ風味",
  description:
    "40代からの美容習慣に。1食20gあたりたんぱく質16g・104kcal・HMB-Ca 300mg、8PN配合のチョコレート風味プロテイン（300g・約15食分）。特徴・飲み方・購入前の確認事項をまとめています。",
  openGraph: {
    title: "BEAUTY FORMULA｜美容プロテイン・チョコ風味",
    description: "1食20gあたりたんぱく質16g・104kcal・HMB-Ca 300mg。8PN配合のチョコレート風味プロテイン。",
    images: [{ url: "/images/soy-plus/beauty-formula-chocolate-set.webp", width: 1254, height: 1254, alt: PRODUCT_ALT }],
    locale: "ja_JP",
    type: "website",
  },
};

const specs = [
  { label: "たんぱく質", value: "16", unit: "g" },
  { label: "エネルギー", value: "104", unit: "kcal" },
  { label: "HMB-Ca", value: "300", unit: "mg" },
  { label: "美容サポート成分", value: "8PN", unit: "配合" },
] as const;

const worries = [
  "プロテインの種類が多すぎて、どれが自分向きなのかわからない",
  "カロリーや成分量を見比べても、何を基準にすればいいのか迷う",
  "続けられる味なのか、毎日どう飲めばいいのかが想像できない",
] as const;

const evidence = [
  {
    no: "01",
    title: "たんぱく質 16g",
    note: "1食20gあたり",
    body: "たんぱく質は筋肉や肌・髪など、からだをつくるもとになる栄養素。1食20gで16gを摂れるので、朝食や間食など不足しがちな場面にプラスしやすい量です。",
  },
  {
    no: "02",
    title: "104kcal",
    note: "1食20gあたり",
    body: "1食あたりのエネルギーは104kcal。カロリーを気にしながら、食事全体の中でたんぱく質を足したい方が量を把握しやすい表示です。",
  },
  {
    no: "03",
    title: "HMB-Ca 300mg",
    note: "1食20gあたり",
    body: "HMB-Ca（HMBカルシウム）は、必須アミノ酸のひとつロイシンが体内で代謝されてできる成分「HMB」をカルシウム塩にしたもの。1食あたり300mgを配合しています。",
  },
  {
    no: "04",
    title: "8PN配合",
    note: "8種類の美容サポート成分",
    body: "パッケージに「8種類の美容サポート成分」として表示されています。8種類の成分名と配合量は、販売ページまたはお手元のパッケージの原材料表示でご確認ください。",
  },
] as const;

const fits = [
  { title: "40代からの美容習慣を見直したい方", body: "スキンケアだけでなく、毎日の食事から栄養のとり方を見直したい方に。" },
  { title: "朝食や間食のたんぱく質が気になる方", body: "忙しい朝やおやつの時間に、手軽にたんぱく質をプラスしたい方に。" },
  { title: "運動習慣をつくっている方", body: "ウォーキングやヨガ、トレーニングなど、からだを動かす毎日の栄養補給に。" },
  { title: "おいしく続けたい方", body: "チョコレート風味なので、デザート感覚で取り入れたい方に。" },
] as const;

// Only rows that can be read reliably from the supplied package photo are stated.
// Anything else is marked as unconfirmed rather than guessed.
const productInfo: { term: string; detail: string; pending?: boolean }[] = [
  { term: "商品名", detail: "BEAUTY FORMULA" },
  { term: "名称", detail: "プロテインパウダー（粉末たんぱく食品）" },
  { term: "内容量", detail: "300g（約15食分／1食20g）" },
  { term: "1食20gあたり", detail: "たんぱく質16g／エネルギー104kcal／HMB-Ca 300mg" },
  { term: "召し上がり方", detail: "付属スプーンすりきり約2杯を、200〜300mlのお水等に溶かしてお召し上がりください。" },
  { term: "原産国表示", detail: "MADE IN JAPAN" },
  {
    term: "原材料名・栄養成分（全項目）",
    detail: "パッケージ裏面に記載。掲載画像の解像度では正確に判読できないため、本ページでは転記していません。",
    pending: true,
  },
  {
    term: "アレルギー物質",
    detail:
      "パッケージ画像では「乳成分・大豆・ゼラチン」の表示が見えますが、正式情報での確認前のため参考情報です。アレルギーのある方は必ず実物の表示をご確認ください。",
    pending: true,
  },
  { term: "賞味期限・保存方法", detail: "パッケージに記載（賞味期限は製造ロットにより異なります）。", pending: true },
  { term: "販売者・製造所", detail: "パッケージおよび販売ページに記載。", pending: true },
];

const steps = [
  { title: "スプーン約2杯をはかる", body: "付属スプーンで、すりきり約2杯をすくいます。" },
  { title: "200〜300mlのお水等に", body: "シェイカーやグラスに、お水等200〜300mlを用意します。" },
  { title: "よく溶かして、いただきます", body: "粉が残らないようによく混ぜたら、できあがりです。" },
] as const;

const faq = [
  {
    q: "どのような商品ですか？",
    a: "チョコレート風味の粉末プロテイン（名称：プロテインパウダー〈粉末たんぱく食品〉）です。内容量は300g、1食20gで約15食分です。",
  },
  {
    q: "1日にどれくらい飲めばよいですか？",
    a: "パッケージには「付属スプーンすりきり約2杯を、200〜300mlのお水等に溶かして」と記載されています。1日あたりの目安量は、お手元のパッケージの表示に従ってください。",
  },
  {
    q: "水以外でも溶かせますか？",
    a: "パッケージには「お水等に溶かして」と記載されています。水以外の飲み物での飲み方は、パッケージの表示または販売事業者にご確認ください。",
  },
  {
    q: "飲むだけでキレイになったり、やせたりしますか？",
    a: "本品は食品であり、特定の美容効果や体重の変化を保証するものではありません。主食・主菜・副菜を基本とした食事のバランスに加え、運動や休養とあわせて毎日の習慣にお役立てください。",
  },
  {
    q: "アレルギーが心配です。",
    a: "アレルギー物質を含む原材料は、必ず実物のパッケージと販売ページの表示でご確認ください。不安な場合は、医師にご相談のうえご利用ください。",
  },
  {
    q: "価格・送料・お届け日は？",
    a: "価格・送料・在庫・お届け予定は変動するため、本ページでは掲載していません。販売ページで最新の情報をご確認ください。",
  },
  {
    q: "返品・交換や問い合わせ先は？",
    a: "ご注文・お支払い・配送・返品は、購入手続きを行う販売ページの条件に準じます。販売事業者の情報（特定商取引法に基づく表記を含む）は販売ページでご確認ください。",
  },
] as const;

function BuyLink({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <a className={className} href={PURCHASE_URL} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true" className={styles.external}>↗</span>
      <span className={styles.srOnly}>（{PURCHASE_STORE}の商品ページを新しいタブで開きます）</span>
    </a>
  );
}

function Scene({ src, alt, sizes }: { src: string; alt: string; sizes: string }) {
  return (
    <figure className={styles.scene}>
      <SceneImage src={src} alt={alt} sizes={sizes} fill />
      <figcaption>イメージ</figcaption>
    </figure>
  );
}

export default function SoyPlusLanding() {
  return (
    <div className={styles.root}>
      <a className={styles.skip} href="#main">本文へスキップ</a>

      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="BEAUTY FORMULA ページ上部へ">
          BEAUTY FORMULA
        </a>
        <nav aria-label="ページ内メニュー" className={styles.nav}>
          <a href="#evidence">特徴</a>
          <a href="#howto">飲み方</a>
          <a href="#info">商品情報</a>
          <a href="#faq">よくある質問</a>
        </nav>
        <BuyLink className={styles.headerCta}>{PURCHASE_STORE}で見る</BuyLink>
      </header>

      <main id="main">
        {/* Hero: who it is for, what it is, and the numbers that decide it */}
        <section className={styles.hero} id="top" aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>40代からの美容習慣に</p>
            <h1 id="hero-title" className={styles.heroTitle}>
              <span className={styles.heroBrand}>BEAUTY FORMULA</span>
              <span className={styles.heroName}>美容プロテイン</span>
              <span className={styles.heroFlavor}>チョコ風味 300g</span>
            </h1>
            <p className={styles.heroLead}>
              1食20gで、たんぱく質16g・104kcal。HMB-Ca 300mgと8種類の美容サポート成分（8PN）を配合した、デザート感覚で続けやすいプロテインです。
            </p>
            <ul className={styles.heroSpecs} aria-label="1食20gあたりの主な表示">
              {specs.map((s) => (
                <li key={s.label}>
                  <b>
                    {s.value}
                    <small>{s.unit}</small>
                  </b>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
            <p className={styles.heroNote}>※1食20gあたり（8PNを除く）。300g・約15食分。</p>
            <div className={styles.heroActions}>
              <BuyLink className={styles.btnPrimary}>{PURCHASE_STORE}で価格・在庫を確認</BuyLink>
              <a className={styles.btnGhost} href="#problem">
                くわしく見る <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
          <figure className={styles.heroVisual}>
            <Image
              src={productImage}
              alt={PRODUCT_ALT}
              placeholder="blur"
              preload
              sizes="(max-width: 860px) 100vw, 52vw"
              className={styles.heroImage}
            />
          </figure>
        </section>

        {/* P: Problem / A: Affinity */}
        <section className={styles.problem} id="problem" aria-labelledby="problem-title">
          <div className={styles.split}>
            <Scene
              src={scenes.morning}
              alt="朝のキッチンでスマートフォンを手にする女性の手元。食べかけのトーストとコーヒー"
              sizes="(max-width: 860px) 100vw, 50vw"
            />
            <div className={styles.splitCopy}>
              <p className={styles.kicker}>YOUR STORY</p>
              <h2 id="problem-title" className={styles.h2}>
                きれいでいたい。
                <br />
                <em>でも、何を選べばいいの？</em>
              </h2>
              <ul className={styles.worries}>
                {worries.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className={styles.body}>
                毎日を忙しく過ごしながら、自分のことも大切にしたい。そう思うからこそ、選ぶ前に迷うのは自然なことです。
                大切なのは、数値と飲み方を確かめて、自分の暮らしに合うかどうかで選ぶこと。このページでは、そのための情報をすべてパッケージの表示からまとめました。
              </p>
            </div>
          </div>
        </section>

        {/* S: Solution / B: Benefit */}
        <section className={styles.solution} aria-labelledby="solution-title">
          <div className={`${styles.split} ${styles.splitReverse}`}>
            <Scene
              src={scenes.shake}
              alt="朝食のテーブルに置かれたチョコレート色のドリンクと、いちご、板チョコレート"
              sizes="(max-width: 860px) 100vw, 50vw"
            />
            <div className={styles.splitCopy}>
              <p className={styles.kicker}>SOLUTION</p>
              <h2 id="solution-title" className={styles.h2}>
                いつもの朝に、
                <br />
                <em>チョコレートの一杯を。</em>
              </h2>
              <p className={styles.body}>
                BEAUTY FORMULAは、40代からの美容習慣に向けたチョコレート風味の粉末プロテイン。付属スプーン約2杯をお水などに溶かすだけで、1食20gあたりたんぱく質16gを摂ることができます。
              </p>
              <p className={styles.body}>
                甘いものが欲しくなる時間や、慌ただしい朝の一杯に。特別なことを増やすのではなく、いつもの食事にひとさじ足す。それが、無理なく続けられる習慣づくりの第一歩です。
              </p>
              <dl className={styles.facts}>
                <div><dt>風味</dt><dd>チョコレート</dd></div>
                <div><dt>内容量</dt><dd>300g</dd></div>
                <div><dt>1食</dt><dd>20g</dd></div>
                <div><dt>目安</dt><dd>約15食分</dd></div>
              </dl>
            </div>
          </div>
        </section>

        {/* E: Evidence — only what the package states */}
        <section className={styles.evidence} id="evidence" aria-labelledby="evidence-title">
          <div className={styles.container}>
            <p className={styles.kicker}>EVIDENCE</p>
            <h2 id="evidence-title" className={styles.h2}>
              選ぶ理由は、
              <br />
              <em>パッケージの数値で確かめる。</em>
            </h2>
            <div className={styles.evidenceLayout}>
              <figure className={styles.evidenceVisual}>
                <Image src={productImage} alt="" sizes="(max-width: 860px) 90vw, 420px" />
                <figcaption>パッケージ表面の表示（1食20gあたり）</figcaption>
              </figure>
              <ol className={styles.evidenceGrid}>
                {evidence.map((f) => (
                  <li key={f.no} className={styles.evidenceCard}>
                    <span className={styles.evidenceNo} aria-hidden="true">{f.no}</span>
                    <h3>{f.title}</h3>
                    <p className={styles.evidenceNote}>{f.note}</p>
                    <p>{f.body}</p>
                  </li>
                ))}
              </ol>
            </div>
            <p className={styles.small}>
              ※数値はパッケージ表面の表示（1食20gあたり）です。本品は食品であり、特定の効果・効能を保証するものではありません。
            </p>
          </div>
        </section>

        {/* C: Contents — how to drink */}
        <section className={styles.howto} id="howto" aria-labelledby="howto-title">
          <div className={`${styles.split} ${styles.splitReverse}`}>
            <Scene
              src={scenes.scoop}
              alt="ココア色のパウダーが入った計量スプーン、水の入ったグラスとシェイカー"
              sizes="(max-width: 860px) 100vw, 50vw"
            />
            <div className={styles.splitCopy}>
              <p className={styles.kicker}>HOW TO</p>
              <h2 id="howto-title" className={styles.h2}>
                かんたん、
                <br />
                <em>3ステップ。</em>
              </h2>
              <ol className={styles.steps}>
                {steps.map((s, i) => (
                  <li key={s.title}>
                    <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
                    <div>
                      <h3>{s.title}</h3>
                      <p>{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className={styles.small}>
                ※パッケージ記載の召し上がり方に基づきます。1日の摂取目安量は、お手元のパッケージの表示に従ってください。
              </p>
            </div>
          </div>
        </section>

        {/* N: Narrow — who it suits */}
        <section className={styles.fit} aria-labelledby="fit-title">
          <div className={styles.split}>
            <Scene
              src={scenes.stretch}
              alt="朝の光が差し込む部屋で、ピンクのヨガマットのそばに立つ女性の足元"
              sizes="(max-width: 860px) 100vw, 50vw"
            />
            <div className={styles.splitCopy}>
              <p className={styles.kicker}>FOR YOU</p>
              <h2 id="fit-title" className={styles.h2}>
                こんな方の
                <br />
                <em>毎日の習慣に。</em>
              </h2>
              <ul className={styles.fitList}>
                {fits.map((l) => (
                  <li key={l.title}>
                    <h3>{l.title}</h3>
                    <p>{l.body}</p>
                  </li>
                ))}
              </ul>
              <p className={styles.small}>※食生活は、主食、主菜、副菜を基本に、食事のバランスを。</p>
            </div>
          </div>
        </section>

        <section className={styles.info} id="info" aria-labelledby="info-title">
          <div className={styles.containerNarrow}>
            <p className={styles.kicker}>PRODUCT INFORMATION</p>
            <h2 id="info-title" className={styles.h2}>商品情報・ご注意</h2>
            <dl className={styles.infoTable}>
              {productInfo.map((row) => (
                <div key={row.term}>
                  <dt>{row.term}</dt>
                  <dd>
                    {row.pending && <span className={styles.badge}>要確認</span>}
                    {row.detail}
                  </dd>
                </div>
              ))}
            </dl>
            <div className={styles.caution}>
              <h3>ご購入・お召し上がりの前に</h3>
              <ul>
                <li>原材料名・アレルギー物質・栄養成分表示は、必ず実物のパッケージと販売ページでご確認ください。</li>
                <li>食物アレルギーのある方、妊娠・授乳中の方、治療中・通院中の方は、医師にご相談のうえご利用ください。</li>
                <li>体質や体調に合わないと感じた場合は、ご利用をお控えください。</li>
                <li>本品は食品です。疾病の診断・治療・予防を目的としたものではありません。</li>
              </ul>
            </div>
          </div>
        </section>

        {/* O: Offer */}
        <section className={styles.offer} id="purchase" aria-labelledby="offer-title">
          <div className={styles.offerInner}>
            <div className={styles.offerImage}>
              <Image src={productImage} alt="" sizes="(max-width: 860px) 80vw, 420px" />
            </div>
            <div>
              <p className={styles.kicker}>HOW TO BUY</p>
              <h2 id="offer-title" className={styles.h2}>ご購入はこちら</h2>
              <p className={styles.offerName}>{PRODUCT_NAME}</p>
              <ul className={styles.offerList}>
                <li>内容量300g・1食20gで約15食分</li>
                <li>ご注文・お支払い・配送は、{PURCHASE_STORE}の購入手続きで行います。</li>
                <li>価格・送料・在庫・お届け予定は変動するため、商品ページで最新の情報をご確認ください。</li>
              </ul>
              <BuyLink className={styles.btnPrimary}>{PURCHASE_STORE}の商品ページへ</BuyLink>
            </div>
          </div>
        </section>

        <section className={styles.faq} id="faq" aria-labelledby="faq-title">
          <div className={styles.containerNarrow}>
            <p className={styles.kicker}>FAQ</p>
            <h2 id="faq-title" className={styles.h2}>よくあるご質問</h2>
            <div className={styles.faqList}>
              {faq.map((item, i) => (
                <details key={item.q} className={styles.faqItem}>
                  <summary>
                    <span aria-hidden="true">Q{i + 1}</span>
                    {item.q}
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* A: Action */}
        <section className={styles.final} aria-labelledby="final-title">
          <SceneImage src={scenes.window} alt="" fill sizes="100vw" className={styles.finalBg} />
          <div className={styles.finalCopy}>
            <p className={styles.finalEyebrow}>40代からの美容習慣に</p>
            <h2 id="final-title" className={styles.finalTitle}>
              毎日の一杯から、
              <br />
              自分をいたわる習慣を。
            </h2>
            <p>{PRODUCT_NAME}（約15食分）</p>
            <BuyLink className={styles.btnPrimary}>{PURCHASE_STORE}で価格・在庫を確認</BuyLink>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p className={styles.footerBrand}>
          BEAUTY FORMULA
        </p>
        <nav aria-label="フッター">
          <a href="#evidence">特徴</a>
          <a href="#howto">飲み方</a>
          <a href="#info">商品情報</a>
          <a href="#faq">よくある質問</a>
          <a href="#top">ページ上部へ</a>
        </nav>
        <p className={styles.legal}>
          本ページは商品のご案内ページです。ご注文は販売ページで承り、特定商取引法に基づく表記・返品条件・お問い合わせ先は販売ページに記載の販売事業者情報をご確認ください。
          掲載している数値はパッケージ表面の表示に基づきます。本品は食品であり、効果・効能を保証するものではありません。
          商品写真以外の写真はイメージです。
        </p>
      </footer>

      <div className={styles.sticky}>
        <p>
          <b>BEAUTY FORMULA</b>
          <span>チョコレート風味 300g</span>
        </p>
        <BuyLink className={styles.stickyBtn}>{PURCHASE_STORE}で見る</BuyLink>
      </div>
    </div>
  );
}

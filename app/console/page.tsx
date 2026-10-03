"use client";

import { FormEvent, useState } from "react";

type Result = {
  decision?: { decision: string; confidence: number; reasons: string[]; masterProductId: string | null };
  profitability?: { expectedProfit: number | null; complete: boolean; missing: string[] } | null;
  sellability?: { status: string; reasons: string[] } | null;
  purchase?: { masterProductId: string; supplierOfferId: string; amount: number; currency: string } | null;
  candidateCount?: number;
  error?: string;
};

export default function ConsolePage() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        salePrice: payload.salePrice ? Number(payload.salePrice) : null,
        setCount: payload.setCount ? Number(payload.setCount) : null,
        paymentFee: payload.paymentFee ? Number(payload.paymentFee) : null,
        marketplaceFee: payload.marketplaceFee ? Number(payload.marketplaceFee) : null,
        tax: payload.tax ? Number(payload.tax) : null,
        otherCost: payload.otherCost ? Number(payload.otherCost) : null,
      }),
    });
      setResult(await response.json());
      setPurchaseMessage(null);
    } catch {
      setResult({ error: "判定サービスに接続できません。時間を置いて再試行してください。" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="console-shell">
      <header className="console-header">
        <a href="/" className="console-brand">MATCHER</a>
        <span>仕入れ判断コンソール</span>
      </header>

      <section className="console-hero">
        <p className="section-kicker">LIVE DECISION CONSOLE</p>
        <h1>商品を入れて、<em>仕入れ判断まで確認する。</em></h1>
        <p>DBの商品マスタと照合し、証拠不足・variant矛盾・利益条件をゲートします。</p>
      </section>

      <form className="decision-form" onSubmit={submit}>
        <div className="form-section">
          <h2>1. 商品識別</h2>
          <div className="form-grid">
            <label>ブランド<input name="brand" placeholder="例: ACME" /></label>
            <label>型番<input name="modelNumber" placeholder="例: AX-204" /></label>
            <label>JAN<input name="jan" inputMode="numeric" /></label>
            <label>EAN<input name="ean" inputMode="numeric" /></label>
            <label>UPC<input name="upc" inputMode="numeric" /></label>
          </div>
        </div>

        <div className="form-section">
          <h2>2. バリアント</h2>
          <div className="form-grid">
            <label>色<input name="color" /></label>
            <label>サイズ<input name="size" /></label>
            <label>容量<input name="capacity" /></label>
            <label>世代<input name="generation" /></label>
            <label>セット数<input name="setCount" type="number" min="1" /></label>
            <label>状態<input name="condition" placeholder="新品 / 中古など" /></label>
          </div>
        </div>

        <div className="form-section">
          <h2>3. 販売価格</h2>
          <div className="form-grid">
            <label>想定販売価格<input name="salePrice" type="number" min="0" step="1" placeholder="円" /></label>
            <label>決済手数料<input name="paymentFee" type="number" min="0" step="1" placeholder="円" /></label>
            <label>モール手数料<input name="marketplaceFee" type="number" min="0" step="1" placeholder="円" /></label>
            <label>税<input name="tax" type="number" min="0" step="1" placeholder="円" /></label>
            <label>その他コスト<input name="otherCost" type="number" min="0" step="1" placeholder="円" /></label>
          </div>
        </div>

        <button className="decision-submit" disabled={busy}>{busy ? "判定中…" : "仕入れ判断を実行 →"}</button>
      </form>

      {result && (
        <section className="decision-result" aria-live="polite">
          {result.error ? (
            <div className="result-card block"><strong>接続エラー</strong><p>{result.error}</p></div>
          ) : (
            <>
              <div className={"result-card " + (result.decision?.decision === "AUTO_LINK" ? "good" : result.decision?.decision === "BLOCK" ? "block" : "review")}>
                <span>IDENTITY</span>
                <strong>{result.decision?.decision}</strong>
                <p>候補 {result.candidateCount ?? 0}件 / confidence {Math.round((result.decision?.confidence ?? 0) * 100)}%</p>
                <ul>{result.decision?.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </div>
              <div className="result-card">
                <span>PROFIT</span>
                <strong>{result.profitability?.complete ? `${result.profitability.expectedProfit?.toLocaleString()} 円` : "計算不能"}</strong>
                <p>{result.profitability?.missing?.length ? `不足: ${result.profitability.missing.join(", ")}` : "必要コストを確認済み"}</p>
              </div>
              <div className={"result-card " + (result.sellability?.status === "SELLABLE" ? "good" : "block")}>
                <span>SELLABILITY</span>
                <strong>{result.sellability?.status ?? "判定待ち"}</strong>
                <ul>{result.sellability?.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                {result.purchase && (
                  <div className="purchase-gate">
                    <b>購入前に人間確認</b>
                    <p>カード情報はMATCHERに保存せず、決済は承認されるまで確定しません。</p>
                    <button
                      type="button"
                      disabled={purchaseBusy}
                      onClick={async () => {
                        setPurchaseBusy(true);
                        setPurchaseMessage(null);
                        const response = await fetch("/api/purchase/authorize", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            masterProductId: result.purchase?.masterProductId,
                            supplierOfferId: result.purchase?.supplierOfferId,
                            decisionSnapshot: result,
                          }),
                        });
                        const data = await response.json();
                        if (data.checkoutUrl) window.location.href = data.checkoutUrl;
                        else setPurchaseMessage(data.error ?? "購入承認の準備に失敗しました。");
                        setPurchaseBusy(false);
                      }}
                    >
                      {purchaseBusy ? "決済準備中…" : "カードを仮押さえして人間確認へ →"}
                    </button>
                    {purchaseMessage && <p role="alert">{purchaseMessage}</p>}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}

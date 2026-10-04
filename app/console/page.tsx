"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PurchaserSignIn, usePurchaserSession } from "../purchaser-session";

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
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);\n  const [selectedPurchase, setSelectedPurchase] = useState<Result["purchase"]>(null);
  const session = usePurchaserSession();

  useEffect(() => {
    if (!selectedPurchase) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedPurchase(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPurchase]);

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
        <Link href="/" className="console-brand">MATCHER</Link>
        <span>仕入れ判断コンソール</span>
      </header>

      <section className="console-hero">
        <p className="section-kicker">LIVE DECISION CONSOLE</p>
        <h1>商品を入れて、<em>仕入れ判断まで確認する。</em></h1>
        <p>まず商品を特定。次に「なぜ同じと言えるか」「利益が残るか」「買ってよいか」を順番に確認します。</p>
        <div className="decision-promises" aria-label="この画面で得られるもの">
          <span>同一商品か</span><span>利益が残るか</span><span>買ってよいか</span>
        </div>
      </section>

      <form className="decision-form" onSubmit={submit}>
        <div className="form-section">
          <h2>1. 商品識別 <small>まずは1つでもOK</small></h2>
          <div className="form-grid">
            <label>ブランド<input name="brand" placeholder="例: ACME" /></label>
            <label>型番<input name="modelNumber" placeholder="例: AX-204" /></label>
            <label>JAN<input name="jan" inputMode="numeric" /></label>
            <label>EAN<input name="ean" inputMode="numeric" /></label>
            <label>UPC<input name="upc" inputMode="numeric" /></label>
          </div>
        </div>

        <div className="form-section">
          <h2>2. バリアント <small>分かる範囲で入力</small></h2>
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
          <h2>3. 利益を見る <small>販売価格が分かれば精度アップ</small></h2>
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
                    <p>カード情報はMATCHERに保存せず、決済は承認されるまで確定しません。購入直前にサーバーが在庫・価格・利益を再確認します。</p>
                    <PurchaserSignIn session={session} />
                    <button
                      type="button"
                      disabled={purchaseBusy || !session.token}
                      onClick={() => setSelectedPurchase(result.purchase ?? null)}
                    >
                      購入条件を確認して申請 →
                    </button>
                    {purchaseMessage && <p role="alert">{purchaseMessage}</p>}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {selectedPurchase && (
        <div className="purchase-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedPurchase(null);
        }}>
          <section className="purchase-modal" role="dialog" aria-modal="true" aria-labelledby="console-purchase-title" aria-describedby="console-purchase-note">
            <span className="purchase-modal-kicker">HUMAN PURCHASE REVIEW</span>
            <h2 id="console-purchase-title">この条件で購入申請しますか？</h2>
            <p className="purchase-modal-product">購入前に条件を確認し、サーバー側でも価格・在庫・利益条件を再確認します。</p>
            <dl className="purchase-modal-facts">
              <div><dt>SUPPLIER COST</dt><dd>{selectedPurchase.amount.toLocaleString()} {selectedPurchase.currency}</dd></div>
              <div><dt>OFFER</dt><dd>{selectedPurchase.supplierOfferId}</dd></div>
            </dl>
            <p id="console-purchase-note" className="purchase-modal-note">カード情報はMATCHERに保存しません。申請後も条件が変わった場合は購入を止めます。最終判断は人間が行います。</p>
            <div className="purchase-modal-actions">
              <button type="button" className="purchase-modal-cancel" autoFocus onClick={() => setSelectedPurchase(null)}>戻る</button>
              <button type="button" className="purchase-modal-confirm" disabled={purchaseBusy || !session.token} onClick={async () => {
                setPurchaseBusy(true);
                setPurchaseMessage(null);
                try {
                  const response = await fetch("/api/purchase/authorize", {
                    method: "POST",
                    headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
                    body: JSON.stringify({
                      masterProductId: selectedPurchase.masterProductId,
                      supplierOfferId: selectedPurchase.supplierOfferId,
                      approved: { amount: selectedPurchase.amount },
                    }),
                  });
                  const data = await response.json();
                  if (data.checkoutUrl) window.location.href = data.checkoutUrl;
                  else setPurchaseMessage(data.error ?? "購入承認の準備に失敗しました。");
                } catch {
                  setPurchaseMessage("購入サービスに接続できません。");
                } finally {
                  setPurchaseBusy(false);
                }
              }}>{purchaseBusy ? "再確認中…" : "再確認して申請 →"}</button>
            </div>
            {purchaseMessage && <p role="alert" className="purchase-modal-note">{purchaseMessage}</p>}
          </section>
        </div>
      )}

    </main>
  );
}

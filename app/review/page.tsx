"use client";

import Link from "next/link";
import { useState } from "react";

type Review = {
  id: string;
  master_product_id: string | null;
  supplier_offer_id: string | null;
  amount: number;
  currency: string;
  status: string;
  decision_snapshot: Record<string, unknown>;
  created_at: string;
};

export default function ReviewPage() {
  const [token, setToken] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setMessage(null);
    const response = await fetch("/api/purchase/pending", { headers: { "x-matcher-review-token": token } });
    const data = await response.json();
    if (!response.ok) setMessage(data.error ?? "レビュー待ち一覧を取得できません。");
    else setReviews(data.reviews ?? []);
    setLoading(false);
  }

  async function decide(reviewId: string, action: "approve" | "reject") {
    if (action === "approve" && !window.confirm("カードの仮押さえを決済確定します。内容を確認しましたか？")) return;
    const reason = action === "reject" ? window.prompt("却下理由を入力してください。")?.trim() : undefined;
    if (action === "reject" && !reason) return;
    setMessage(null);
    const response = await fetch("/api/purchase/review", {
      method: "POST",
      headers: { "content-type": "application/json", "x-matcher-review-token": token },
      body: JSON.stringify({ reviewId, action, reason }),
    });
    const data = await response.json();
    if (!response.ok) setMessage(data.error ?? "レビュー処理に失敗しました。");
    else setReviews((current) => current.filter((item) => item.id !== reviewId));
  }

  return (
    <main className="review-shell">
      <header className="review-header"><Link href="/" className="console-brand">MATCHER</Link><span>購入レビュー</span></header>
      <section className="review-hero">
        <p className="section-kicker">HUMAN PURCHASE GATE</p>
        <h1>自動購入の最後は、<em>人が確認する。</em></h1>
        <p>IDENTITY・仕入れ条件・利益の根拠を確認してから承認します。カードは仮押さえ状態で止まり、承認しない限り決済確定しません。</p>
      </section>
      <section className="review-auth">
        <label>レビュー認証キー<input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="管理者キー" autoComplete="off" /></label>
        <button type="button" disabled={!token || loading} onClick={load}>{loading ? "取得中…" : "承認待ちを確認 →"}</button>
        {message && <p className="review-error" role="alert">{message}</p>}
      </section>
      <section className="review-list" aria-live="polite">
        {reviews.length === 0 ? <p className="review-error">承認待ちはありません。認証後に最新状態を再確認してください。</p> : reviews.map((review) => {
          const snapshot = review.decision_snapshot ?? {};
          return (
            <article className="review-card" key={review.id}>
              <header><h2>購入レビュー</h2><span>{review.status}</span></header>
              <div className="review-meta">
                <div><small>金額</small><strong>{Number(review.amount).toLocaleString()} {review.currency.toUpperCase()}</strong></div>
                <div><small>商品</small><strong>{review.master_product_id ?? "不明"}</strong></div>
                <div><small>仕入先オファー</small><strong>{review.supplier_offer_id ?? "不明"}</strong></div>
              </div>
              <div className="review-snapshot">{JSON.stringify(snapshot, null, 2)}</div>
              <div className="review-actions">
                <button type="button" onClick={() => decide(review.id, "approve")}>承認して決済確定</button>
                <button type="button" className="review-reject" onClick={() => decide(review.id, "reject")}>却下してカード取消</button>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

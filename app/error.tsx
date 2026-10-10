"use client";

import { useEffect } from "react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep the UI recoverable without exposing internal error details.
  }, []);

  return (
    <main className="error-page">
      <p className="error-page-code">SYSTEM / TEMPORARY ERROR</p>
      <h1>処理を完了できませんでした</h1>
      <p>一時的な問題が発生しました。もう一度お試しください。</p>
      <button type="button" onClick={() => reset()}>もう一度試す</button>
      <a href="/">トップページへ戻る</a>
    </main>
  );
}

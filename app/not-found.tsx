import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-page">
      <p className="error-page-code">404 / NOT FOUND</p>
      <h1>このページは見つかりませんでした</h1>
      <p>URLが変更されたか、ページが削除された可能性があります。</p>
      <Link href="/">MATCHERのトップへ戻る</Link>
    </main>
  );
}

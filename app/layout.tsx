import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOY+ — 今日の自分に、必要な栄養を。",
  description: "たんぱく質とコラーゲンを毎日の習慣に。目的に合わせて選びやすいソイコラーゲンの成分情報をご紹介します.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

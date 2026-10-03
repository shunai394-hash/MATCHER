import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MATCHER — Product Identity & Supplier Intelligence",
  description: "商品同一性を証拠から判定し、サプライヤーと安全につなぐプロダクト・アイデンティティ基盤。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

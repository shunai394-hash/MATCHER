import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MATCHER — Product Identity & Supplier Intelligence",
  description: "商品同一性を証拠付きで照合し、サプライヤー・コスト・安全性まで確認するMATCHER。",
  openGraph: {
    title: "MATCHER — Product Identity & Supplier Intelligence",
    description: "同じ商品を、正しく見つける。",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

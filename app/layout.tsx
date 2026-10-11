import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://matcher-pink.vercel.app"),
  title: "MATCHER — 商品を正しく見つけ、仕入れ判断を速くする",
  description: "商品同定、サプライヤー照合、利益計算、安全性確認を一つの判断フローにまとめるMATCHER。",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "MATCHER",
    title: "MATCHER — 商品を正しく見つけ、仕入れ判断を速くする",
    description: "商品同定、サプライヤー照合、利益計算、安全性確認を一つの判断フローにまとめるMATCHER。",
  },
  twitter: {
    card: "summary",
    title: "MATCHER — 商品を正しく見つけ、仕入れ判断を速くする",
    description: "商品同定、サプライヤー照合、利益計算、安全性確認を一つの判断フローにまとめるMATCHER。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

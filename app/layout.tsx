import type { Metadata } from "next";
import "./globals.css";

const siteUrl = "https://matcher-pink.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "MATCHER — 商品を正しく見つけ、仕入れ判断を速くする",
    template: "%s | MATCHER",
  },
  description: "商品同定、サプライヤー照合、利益計算、安全性確認を一つの判断フローにまとめるMATCHER。",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "MATCHER",
    locale: "ja_JP",
    title: "MATCHER — 実データに基づく仕入れ判断",
    description: "商品同定、サプライヤー照合、利益計算、安全性確認を一つの判断フローに。",
  },
  twitter: {
    card: "summary",
    title: "MATCHER — 実データに基づく仕入れ判断",
    description: "実データと根拠を確認して仕入れ判断を行うMATCHER。",
  },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg", shortcut: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

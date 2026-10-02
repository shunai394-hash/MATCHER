import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MATCHER",
  description: "Product identity and supplier matching engine",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

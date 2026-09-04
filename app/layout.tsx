import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.stonkdrops.fun"),
  title: "StonkRips | Rip the Market",
  description: "Rip $20 packs and pull onchain-selected Stock Tokens. Creator fees fund holder drops and refill future packs.",
  applicationName: "StonkRips",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "StonkRips | Rip the Market",
    description: "$20. One funded pack. One onchain Stock Token delivered to your wallet.",
    siteName: "StonkRips",
    images: [{ url: "/stonkrips-og.png", width: 1774, height: 887, alt: "StonkRips premium Stock Token pack — Rip the Market" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StonkRips | Rip the Market",
    description: "$20. One funded pack. One onchain Stock Token delivered to your wallet.",
    images: ["/stonkrips-og.png"],
  },
  icons: { icon: "/stonkrips-logo.png", apple: "/stonkrips-logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

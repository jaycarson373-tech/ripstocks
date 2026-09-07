import { ACTIVE_PACK, PACK_PRICE_USD } from "@/app/lib/pack-config";
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
  description: `${ACTIVE_PACK.label} — ${PACK_PRICE_USD}. Rip a funded pack and receive one onchain Stock Token. More packs coming soon.`,
  applicationName: "StonkRips",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "StonkRips | Rip the Market",
    description: `${ACTIVE_PACK.label} — ${PACK_PRICE_USD}. One funded Stock Token delivered to your wallet.`,
    siteName: "StonkRips",
    images: [{ url: "/stonkrips-og.png", width: 1774, height: 887, alt: "StonkRips premium Stock Token pack — Rip the Market" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StonkRips | Rip the Market",
    description: `${ACTIVE_PACK.label} — ${PACK_PRICE_USD}. One funded Stock Token delivered to your wallet.`,
    images: ["/stonkrips-og.png"],
  },
  icons: {
    icon: [
      { url: "/stonkrips-open-pack-32.png", sizes: "32x32", type: "image/png" },
      { url: "/stonkrips-open-pack-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/stonkrips-open-pack-32.png",
    apple: { url: "/stonkrips-open-pack-180.png", sizes: "180x180", type: "image/png" },
  },
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

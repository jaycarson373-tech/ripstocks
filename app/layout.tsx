import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./holder-drop.css";
import "./branding.css";
import "./inventory.css";
import "./protocol.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://stockdrop.fun"),
  title: "StockDrop — holder stock airdrops.",
  description: "Hold DROP for provably fair xStock airdrops on Solana.",
  openGraph: {
    title: "StockDrop — holder stock airdrops.",
    description: "Every 15 minutes, one eligible holder receives a funded xStock airdrop.",
    images: [{ url: "/stockdrop-banner.svg", width: 1280, height: 426, alt: "StockDrop holder stock airdrops" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StockDrop — holder stock airdrops.",
    description: "Every 15 minutes, one eligible holder receives a funded xStock airdrop.",
    images: ["/stockdrop-banner.svg"],
  },
  icons: {
    icon: "/stockdrop-logo.svg",
    shortcut: "/stockdrop-logo.svg",
    apple: "/stockdrop-logo.svg",
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

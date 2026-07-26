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
  title: "StockRips — RIPS holder stock-pack draws.",
  description: "Hold RIPS for provably fair xStock pack draws on Solana.",
  openGraph: {
    title: "StockRips — RIPS holder stock-pack draws.",
    description: "Every five minutes, eligible RIPS holders enter a provably fair xStock pack draw.",
    images: [{ url: "/stockrips-banner.jpg", width: 1280, height: 426, alt: "StockRips holder stock-pack draws" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StockRips — RIPS holder stock-pack draws.",
    description: "Every five minutes, eligible RIPS holders enter a provably fair xStock pack draw.",
    images: ["/stockrips-banner.jpg"],
  },
  icons: {
    icon: "/stockrips-logo.jpg",
    shortcut: "/stockrips-logo.jpg",
    apple: "/stockrips-logo.jpg",
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

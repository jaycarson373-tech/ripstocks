import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./hourly.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RipStocks — Rip. Pull. Own.",
  description: "Open randomized xStock packs on Solana with USDC.",
  openGraph: {
    title: "RipStocks — Rip. Pull. Own.",
    description: "Crack randomized xStock packs on Solana with USDC.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "RipStocks pack machine" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RipStocks — Rip. Pull. Own.",
    description: "Crack randomized xStock packs on Solana with USDC.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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

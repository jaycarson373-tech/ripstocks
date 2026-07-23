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
  title: "PackRips — Rip. Pull. Own.",
  description: "Open randomized xStock packs on Solana with USDC.",
  openGraph: {
    title: "PackRips — Rip. Pull. Own.",
    description: "Crack randomized xStock packs on Solana with USDC.",
    images: [{ url: "/ripstocks-banner.jpg", width: 1280, height: 426, alt: "PackRips stock pack" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PackRips — Rip. Pull. Own.",
    description: "Crack randomized xStock packs on Solana with USDC.",
    images: ["/ripstocks-banner.jpg"],
  },
  icons: {
    icon: "/ripstocks-logo.jpg",
    shortcut: "/ripstocks-logo.jpg",
    apple: "/ripstocks-logo.jpg",
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

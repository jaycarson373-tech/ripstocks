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
  metadataBase: new URL("https://stockdrops.fun"),
  title: "Stock Drops — holder stock airdrops.",
  description: "Hold DROPS for 15-minute xStock holder drops and jackpot routing on Solana.",
  openGraph: {
    title: "Stock Drops — holder stock airdrops.",
    description: "Every 15 minutes, creator fees fund a random xStock drop for one eligible holder.",
    images: [{ url: "/stockdrops-banner.svg", width: 1280, height: 426, alt: "Stock Drops holder stock airdrops" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Drops — holder stock airdrops.",
    description: "Every 15 minutes, creator fees fund a random xStock drop for one eligible holder.",
    images: ["/stockdrops-banner.svg"],
  },
  icons: {
    icon: "/stockdrops-logo.svg",
    shortcut: "/stockdrops-logo.svg",
    apple: "/stockdrops-logo.svg",
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

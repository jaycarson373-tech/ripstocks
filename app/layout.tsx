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
  metadataBase: new URL("https://stonkdrops.fun"),
  title: "Stonk Drops — holder stock airdrops.",
  description: "Hold DROPS for 5-minute xStock holder drops and jackpot routing on Solana.",
  openGraph: {
    title: "Stonk Drops — holder stock airdrops.",
    description: "Every 5 minutes, creator fees fund a random xStock drop for one eligible holder.",
    images: [{ url: "/brand/stonkdrops-banner.jpg", width: 1280, height: 426, alt: "Stonk Drops holder stock airdrops" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stonk Drops — holder stock airdrops.",
    description: "Every 5 minutes, creator fees fund a random xStock drop for one eligible holder.",
    images: ["/brand/stonkdrops-banner.jpg"],
  },
  icons: {
    icon: "/brand/stonkdrops-logo.jpg",
    shortcut: "/brand/stonkdrops-logo.jpg",
    apple: "/brand/stonkdrops-logo.jpg",
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

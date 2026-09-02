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
  title: "RipStonks — The Stock Pack Arcade on Robinhood Chain",
  description: "Rip one $20 USDG inventory-backed pack and receive a Stock Token directly to your wallet. Powered by a Pons v2 hourly fee flywheel.",
  openGraph: {
    title: "RipStonks — Rip packs. Pull stocks.",
    description: "$20 USDG funded Stock Token packs with an hourly Pons v2 fee flywheel on Robinhood Chain.",
    images: [{ url: "/ripstonks-arcade.jpg", width: 1280, height: 426, alt: "RipStonks arcade with Stock Token claw machines" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RipStonks — Rip packs. Pull stocks.",
    description: "$20 USDG funded Stock Token packs with an hourly Pons v2 fee flywheel on Robinhood Chain.",
    images: ["/ripstonks-arcade.jpg"],
  },
  icons: { icon: "/favicon.svg", apple: "/ripstonks-pack.jpg" },
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

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
  title: "MemePacks — Rip a Pack",
  description: "Rip a $10 MemePack, reveal one random Series 001 pull, and hold $PACKS for holder draws.",
  openGraph: {
    title: "MemePacks — Rip a Pack",
    description: "One sealed pack. One random Series 001 pull. Powered by $PACKS.",
    images: [{ url: "/memepacks-banner.jpeg", width: 1280, height: 426, alt: "MemePacks banner" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MemePacks — Rip a Pack",
    description: "One sealed pack. One random Series 001 pull. Powered by $PACKS.",
    images: ["/memepacks-banner.jpeg"],
  },
  icons: {
    icon: "/favicon.jpg",
    shortcut: "/favicon.jpg",
    apple: "/favicon.jpg",
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

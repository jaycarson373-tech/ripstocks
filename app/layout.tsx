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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://stonkrips.fun"),
  title: "StonkRips — $20 Stock Token packs on Robinhood Chain",
  description: "Rip a $20 USDG Stock Token pack. Hourly Pons creator fees split between weighted holder drops and funded pack inventory.",
  openGraph: {
    title: "StonkRips — rip a pack, pull a Stock Token",
    description: "$20 USDG packs with an hourly 50/50 Pons fee flywheel on Robinhood Chain.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "StonkRips on Robinhood Chain" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StonkRips — rip a pack, pull a Stock Token",
    description: "$20 USDG packs with an hourly 50/50 Pons fee flywheel on Robinhood Chain.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg" },
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

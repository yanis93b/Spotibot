import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AceMusic Studio — AI Music Generation",
  description:
    "Generate original songs from a text prompt. Powered by the Ace Music model. A Suno-style AI music studio.",
  keywords: [
    "AI music",
    "Ace Music",
    "Suno alternative",
    "song generator",
    "text to music",
    "Next.js",
  ],
  authors: [{ name: "AceMusic Studio" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "AceMusic Studio — AI Music Generation",
    description: "Generate original songs from a text prompt.",
    siteName: "AceMusic Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AceMusic Studio",
    description: "Generate original songs from a text prompt.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Dark theme is the default (and only) theme for this music studio UI.
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

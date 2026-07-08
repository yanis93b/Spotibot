import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SessionProvider } from "@/components/session-provider";
import ThemeInit from "@/lib/theme-init";
import { RegisterSW } from "@/components/pwa/register-sw";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpotiBot — Le bot de musique moderne",
  description:
    "Génère des morceaux originaux à partir d'un prompt texte. Propulsé par le modèle Ace Music (ACE-Step v1.5). Interface façon Spotify.",
  keywords: [
    "SpotiBot",
    "AI music",
    "Ace Music",
    "Suno alternative",
    "song generator",
    "text to music",
    "générateur de musique",
    "Next.js",
  ],
  authors: [{ name: "SpotiBot" }],
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SpotiBot",
  },
  openGraph: {
    title: "SpotiBot — Le bot de musique moderne",
    description: "Génère des morceaux originaux à partir d'un prompt texte. Propulsé par Ace Music.",
    siteName: "SpotiBot",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "SpotiBot" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SpotiBot",
    description: "Le bot de musique moderne — génération IA de morceaux.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#d946ef",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeInit />
        <SessionProvider>{children}</SessionProvider>
        <RegisterSW />
        <Toaster />
      </body>
    </html>
  );
}

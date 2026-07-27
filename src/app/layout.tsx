import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TopProgressBar } from "@/components/TopProgressBar";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { SplashScreen } from "@/components/SplashScreen";
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
  title: {
    default: "SOHO Social House · Reserve your night",
    template: "%s · SOHO Social House",
  },
  description:
    "Book a table, host your night, share the bill. Social table booking for SOHO Social House Purwokerto.",
  applicationName: "SOHO Social House",
  openGraph: {
    title: "SOHO Social House · Reserve your night",
    description:
      "Book a table, host your night, share the bill. Social table booking for SOHO Social House Purwokerto.",
    siteName: "SOHO Social House",
    locale: "id_ID",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SOHO Social House · Reserve your night",
    description:
      "Book a table, host your night, share the bill.",
  },
  appleWebApp: {
    title: "SOHO",
    capable: true,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SplashScreen />
        <Suspense fallback={null}>
          <TopProgressBar />
        </Suspense>
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster
          position="top-center"
          theme="dark"
          richColors
          toastOptions={{
            style: {
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            },
          }}
        />
      </body>
    </html>
  );
}

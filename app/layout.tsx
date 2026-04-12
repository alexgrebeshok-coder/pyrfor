import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Toaster } from "sonner";

import { PWARegistrar } from "@/components/pwa-registrar";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { AIChatPanelLazy } from "@/components/ai/chat-panel-lazy";
import { DashboardProvider } from "@/components/dashboard-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/auth/session-provider";
import { AIContextProvider } from "@/lib/ai/context-provider";
import { LocaleProvider } from "@/contexts/locale-context";
import { PreferencesProvider } from "@/contexts/preferences-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { MemoryProvider } from "@/contexts/memory-context";
import { siteUrl } from "@/lib/site-url";

import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "CEOClaw Dashboard",
  description: "Multilingual project portfolio control panel with a PWA-first mobile shell and limited offline support.",
  metadataBase: siteUrl,
  applicationName: "CEOClaw",
  manifest: "/manifest.json",
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  appleWebApp: {
    capable: true,
    title: "CEOClaw",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="ru" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <SessionProvider>
          <a className="skip-link" href="#main-content">
            Перейти к основному содержимому
          </a>
          <Script id="ceoclaw-theme-bootstrap" strategy="beforeInteractive">
            {`
              try {
                var savedTheme = localStorage.getItem("ceoclaw-theme") || "dark";
                var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                var resolvedTheme = savedTheme === "dark" || (savedTheme === "system" && prefersDark)
                  ? "dark"
                  : "light";
                document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
                document.documentElement.dataset.theme = resolvedTheme;
              } catch (error) {
                document.documentElement.classList.add("dark");
                document.documentElement.dataset.theme = "dark";
              }
            `}
          </Script>
          <Script id="ceoclaw-locale-bootstrap" strategy="beforeInteractive">
            {`
              try {
                var savedLocale = localStorage.getItem("ceoclaw-locale");
                var htmlLang = savedLocale === "zh" ? "zh-CN" : savedLocale === "en" ? "en" : "ru";
                document.documentElement.lang = htmlLang;
                document.documentElement.dataset.scrollBehavior = "smooth";
              } catch (error) {
                document.documentElement.lang = "ru";
                document.documentElement.dataset.scrollBehavior = "smooth";
              }
            `}
          </Script>
          <Script id="ceoclaw-preferences-bootstrap" strategy="beforeInteractive">
            {`
              try {
                var rawPreferences = localStorage.getItem("ceoclaw-settings");
                var parsedPreferences = rawPreferences ? JSON.parse(rawPreferences) : null;
                document.documentElement.dataset.density =
                  parsedPreferences && parsedPreferences.compactMode === false ? "comfortable" : "compact";
              } catch (error) {
                document.documentElement.dataset.density = "compact";
              }
            `}
          </Script>
          <ThemeProvider>
            <MemoryProvider>
              <LocaleProvider>
                <PreferencesProvider>
                  <DashboardProvider>
                    <AIContextProvider>
                      <ErrorBoundary resetKey="app-shell">
                        <AppShell>{children}</AppShell>
                        <AIChatPanelLazy />
                      </ErrorBoundary>
                      <Toaster position="top-right" richColors />
                    </AIContextProvider>
                  </DashboardProvider>
                </PreferencesProvider>
              </LocaleProvider>
            </MemoryProvider>
          </ThemeProvider>
          <PWAInstallPrompt />
          <PWARegistrar />
        </SessionProvider>
      </body>
    </html>
  );
}

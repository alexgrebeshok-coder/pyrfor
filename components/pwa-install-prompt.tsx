"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, isNativeShell, isStandaloneApp } from "@/lib/utils";
import { isPublicAppPath } from "@/lib/public-paths";

const DISMISSED_STORAGE_KEY = "ceoclaw-pwa-install-banner-dismissed";

interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform?: string;
  }>;
}

declare global {
  interface Window {
    __ceoclawDeferredInstallPrompt?: DeferredInstallPromptEvent;
  }
}

function isIOSBrowser() {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";

  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function PWAInstallPrompt() {
  const pathname = usePathname() ?? "/";
  const deferredPromptRef = useRef<DeferredInstallPromptEvent | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isNativeApp, setIsNativeApp] = useState(false);
  const isPublicPage = isPublicAppPath(pathname);

  useEffect(() => {
    setMounted(true);
    setIsIOS(isIOSBrowser());
    setIsNativeApp(isNativeShell());

    if (isStandaloneApp()) {
      setIsInstalled(true);
      return;
    }

    try {
      setIsDismissed(localStorage.getItem(DISMISSED_STORAGE_KEY) === "1");
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as DeferredInstallPromptEvent;
      event.preventDefault();
      deferredPromptRef.current = promptEvent;
      setIsReady(true);
    };

    const handleDeferredPromptReady = () => {
      if (window.__ceoclawDeferredInstallPrompt) {
        deferredPromptRef.current = window.__ceoclawDeferredInstallPrompt;
        setIsReady(true);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsReady(false);
      deferredPromptRef.current = null;
      window.__ceoclawDeferredInstallPrompt = undefined;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("ceoclaw-beforeinstallprompt", handleDeferredPromptReady);
    window.addEventListener("appinstalled", handleAppInstalled);

    handleDeferredPromptReady();

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("ceoclaw-beforeinstallprompt", handleDeferredPromptReady);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [mounted]);

  // Don't show PWA prompt in native shells or if already installed/dismissed
  if (!mounted || isPublicPage || isInstalled || isDismissed || isNativeApp || (!isReady && !isIOS)) {
    return null;
  }

  async function handleInstall() {
    const promptEvent = deferredPromptRef.current;
    if (!promptEvent) {
      handleDismiss();
      return;
    }

    setIsInstalling(true);

    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      setIsDismissed(true);
      try {
        localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
      } catch {
        // Ignore storage failures.
      }
    } finally {
      setIsInstalling(false);
      setIsReady(false);
      deferredPromptRef.current = null;
      window.__ceoclawDeferredInstallPrompt = undefined;
    }
  }

  function handleDismiss() {
    setIsDismissed(true);
    setIsReady(false);
    deferredPromptRef.current = null;

    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
    } catch {
      // Ignore storage failures.
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-x-3 bottom-3 z-[70] flex justify-center pb-[max(env(safe-area-inset-bottom),0px)]",
        "lg:hidden"
      )}
    >
      <div
        className={cn(
          "relative w-full max-w-md overflow-hidden rounded-2xl border border-[color:var(--line-strong)]",
        "bg-[color:var(--surface-panel)]/96 text-[var(--ink)] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]",
        "backdrop-blur-md"
      )}
      aria-label="Установка CEOClaw"
      aria-live="polite"
        role="region"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)]/60 to-transparent" />

        <div className="flex items-start gap-3 p-4">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-white shadow-sm">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="info">PWA</Badge>
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                {isIOS ? "iPhone install guide" : "Mobile shell"}
              </span>
            </div>

            <h2 className="text-sm font-semibold leading-5 text-[var(--ink)]">
              Установить CEOClaw на экран
            </h2>
            <p className="mt-1 text-sm leading-5 text-[var(--ink-muted)]">
              {isIOS
                ? "На iPhone установка идёт через Share → «На экран Домой». Это ограниченный офлайн-shell для уже кэшированных экранов."
                : "Быстрый доступ, нативный вид и ограниченный офлайн-shell для уже кэшированных экранов."}
            </p>
            {isIOS ? (
              <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
                Автоматический install prompt в Safari не поддерживается, поэтому показываем ручную подсказку.
              </p>
            ) : null}

            <div className="mt-4 flex items-center gap-2">
              <Button
                className="min-w-0 flex-1"
                disabled={isInstalling}
                onClick={handleInstall}
                size="sm"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {isInstalling ? "Открываем…" : deferredPromptRef.current ? "Установить" : "Понятно"}
              </Button>
              <Button onClick={handleDismiss} size="sm" variant="ghost">
                <X className="h-4 w-4" aria-hidden="true" />
                Позже
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

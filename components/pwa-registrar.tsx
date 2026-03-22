'use client';

import { useEffect } from 'react';

import { isNativeShell } from "@/lib/utils";

interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform?: string;
  }>;
}

declare global {
  interface Window {
    __ceoclawDeferredInstallPrompt?: DeferredInstallPromptEvent;
  }
}

export function PWARegistrar() {
  useEffect(() => {
    if (isNativeShell() || !('serviceWorker' in navigator) || !window.isSecureContext) {
      return;
    }

    let cancelled = false;

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        if (!cancelled) {
          registration.update().catch(() => {});
        }
      } catch (error) {
        console.error('Service Worker registration failed:', error);
      }
    };

    const handleLoad = () => {
      void registerServiceWorker();
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as DeferredInstallPromptEvent;
      window.__ceoclawDeferredInstallPrompt = promptEvent;
      window.dispatchEvent(new Event('ceoclaw-beforeinstallprompt'));
    };

    if (document.readyState === 'complete') {
      handleLoad();
    } else {
      window.addEventListener('load', handleLoad, { once: true });
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      cancelled = true;
      window.removeEventListener('load', handleLoad);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  return null;
}

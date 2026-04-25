import React, { useEffect, useState } from 'react';

interface UpdateState {
  available: boolean;
  version: string;
  installing: boolean;
}

/**
 * Checks for Pyrfor IDE updates via tauri-plugin-updater on mount.
 * Shows a toast bottom-right when an update is available.
 * Only active inside Tauri runtime (no-op in browser dev).
 */
export default function UpdateNotifier() {
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    // Only run inside Tauri context
    if (!('__TAURI_INTERNALS__' in window)) return;

    let cancelled = false;

    (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const result = await check();
        if (!cancelled && result?.available) {
          setUpdate({ available: true, version: result.currentVersion ?? '', installing: false });
        }
      } catch {
        // Updater disabled or network error — silent
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!update?.available) return null;

  const handleInstall = async () => {
    if (update.installing) return;
    setUpdate((u) => (u ? { ...u, installing: true } : u));
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const result = await check();
      if (result?.available) {
        await result.downloadAndInstall();
        await relaunch();
      }
    } catch (err) {
      console.error('[UpdateNotifier] install failed:', err);
      setUpdate((u) => (u ? { ...u, installing: false } : u));
    }
  };

  const handleLater = () => setUpdate(null);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '2rem',
        right: '1.5rem',
        zIndex: 9999,
        background: 'var(--bg-2, #1e2433)',
        border: '1px solid var(--border, #3a3f55)',
        borderRadius: '8px',
        padding: '12px 16px',
        minWidth: '260px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        color: 'var(--fg, #e0e4f0)',
        fontSize: '13px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
      role="alert"
      aria-live="polite"
    >
      <span>
        🚀 <strong>Pyrfor v{update.version}</strong> available — Restart to update
      </span>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={handleLater}
          style={{
            background: 'transparent',
            border: '1px solid var(--border, #3a3f55)',
            color: 'var(--fg-muted, #8892b0)',
            borderRadius: '4px',
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Later
        </button>
        <button
          onClick={handleInstall}
          disabled={update.installing}
          style={{
            background: 'var(--accent, #7c6af7)',
            border: 'none',
            color: '#fff',
            borderRadius: '4px',
            padding: '4px 14px',
            cursor: update.installing ? 'wait' : 'pointer',
            fontSize: '12px',
            opacity: update.installing ? 0.7 : 1,
          }}
        >
          {update.installing ? 'Installing…' : 'Install'}
        </button>
      </div>
    </div>
  );
}

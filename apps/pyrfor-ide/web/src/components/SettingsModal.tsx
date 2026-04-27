import React, { useState, useEffect, useCallback } from 'react';
import { listModels, getActiveModel, setActiveModel, getLocalMode, setLocalMode, type ModelEntry } from '../lib/api';
import { getCloudFallbackConfig, setCloudFallbackConfig } from '../lib/cloudFallback';

interface SettingsModalProps {
  onClose: () => void;
  onProviderKeysSaved?: () => void;
}

type Tab = 'appearance' | 'keybindings' | 'provider-keys' | 'daemon' | 'models';

export interface IdeSettings {
  version: number;
  theme: 'auto' | 'dark' | 'light';
  font: string;
  fontSize: number;
  lineHeight: number;
  keybindings: Record<string, string>;
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  onboardingComplete?: boolean;
}

export const DEFAULT_SETTINGS: IdeSettings = {
  version: 1,
  theme: 'auto',
  font: 'Menlo',
  fontSize: 13,
  lineHeight: 1.5,
  keybindings: {},
  logLevel: 'info',
};

export const PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'zai',
  'google',
  'mistral',
  'cohere',
  'deepseek',
  'groq',
  'perplexity',
] as const;

export const ONBOARDING_PROVIDER_OPTIONS = [
  { id: 'openrouter', label: 'OpenRouter', secretKey: 'provider:openrouter', defaultModel: 'openrouter/auto' },
  { id: 'zai', label: 'ZAI', secretKey: 'provider:zai', defaultModel: 'glm-4.5' },
  { id: 'openai', label: 'OpenAI', secretKey: 'provider:openai', defaultModel: 'gpt-4.1-mini' },
] as const;

type Provider = (typeof PROVIDERS)[number];

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error('Tauri runtime unavailable');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

function maskSecret(value: string): string {
  if (value.length <= 4) return '●'.repeat(value.length);
  return '●●●●…' + value.slice(-4);
}

// ─── Appearance Tab ──────────────────────────────────────────────────────────

function AppearanceTab({
  settings,
  onChange,
}: {
  settings: IdeSettings;
  onChange: (s: IdeSettings) => void;
}) {
  return (
    <div className="settings-section" data-testid="tab-appearance">
      <div className="settings-row">
        <label className="settings-label">Theme</label>
        <select
          className="settings-select"
          value={settings.theme}
          onChange={(e) =>
            onChange({ ...settings, theme: e.target.value as IdeSettings['theme'] })
          }
        >
          <option value="auto">Auto (system)</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
      <div className="settings-row">
        <label className="settings-label">Font Family</label>
        <input
          className="settings-input"
          type="text"
          value={settings.font}
          onChange={(e) => onChange({ ...settings, font: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <label className="settings-label">Font Size (px)</label>
        <input
          className="settings-input"
          type="number"
          min={10}
          max={32}
          value={settings.fontSize}
          onChange={(e) =>
            onChange({ ...settings, fontSize: Math.max(10, Math.min(32, Number(e.target.value))) })
          }
        />
      </div>
      <div className="settings-row">
        <label className="settings-label">Line Height</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          max={3}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => onChange({ ...settings, lineHeight: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}

// ─── Keybindings Tab ─────────────────────────────────────────────────────────

function KeybindingsTab({
  settings,
  onChange,
}: {
  settings: IdeSettings;
  onChange: (s: IdeSettings) => void;
}) {
  const [overridesText, setOverridesText] = useState(
    JSON.stringify(settings.keybindings, null, 2)
  );
  const [jsonError, setJsonError] = useState('');

  const handleOverridesChange = (text: string) => {
    setOverridesText(text);
    try {
      const parsed = JSON.parse(text);
      setJsonError('');
      onChange({ ...settings, keybindings: parsed });
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  const defaultBindings = [
    { key: 'Cmd+S', action: 'Save current file' },
    { key: 'Cmd+O', action: 'Open folder' },
    { key: 'Cmd+J', action: 'Toggle terminal panel' },
    { key: 'Cmd+Shift+G', action: 'Toggle Git panel' },
    { key: 'Cmd+,', action: 'Open Settings' },
    { key: 'Cmd+P', action: 'Focus file search' },
    { key: 'Cmd+E', action: 'Focus chat input' },
    { key: 'Cmd+`', action: 'Toggle command runner' },
  ];

  return (
    <div className="settings-section" data-testid="tab-keybindings">
      <p className="settings-hint">Default bindings (read-only):</p>
      <table className="keybindings-table">
        <tbody>
          {defaultBindings.map(({ key, action }) => (
            <tr key={key}>
              <td>
                <kbd>{key}</kbd>
              </td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="settings-row settings-row--col">
        <label className="settings-label">JSON overrides</label>
        <textarea
          className={`settings-textarea${jsonError ? ' settings-textarea--error' : ''}`}
          rows={6}
          value={overridesText}
          onChange={(e) => handleOverridesChange(e.target.value)}
          spellCheck={false}
          aria-label="Keybinding overrides JSON"
        />
        {jsonError && <span className="settings-error">{jsonError}</span>}
      </div>
    </div>
  );
}

// ─── Cloud Fallback Panel ─────────────────────────────────────────────────────

function CloudFallbackPanel({ onToast }: { onToast?: (msg: string, type: string) => void }) {
  const [cfg, setCfg] = useState(() => getCloudFallbackConfig());
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saved, setSaved] = useState(() => !!getCloudFallbackConfig().apiKey);

  const handleToggle = (enabled: boolean) => {
    const next = { ...cfg, enabled };
    setCfg(next);
    setCloudFallbackConfig(next);
    onToast?.(`Cloud fallback ${enabled ? 'enabled' : 'disabled'}`, 'info');
  };

  const handleModelChange = (model: string) => {
    const next = { ...cfg, model };
    setCfg(next);
    setCloudFallbackConfig(next);
  };

  const handleSaveKey = () => {
    const key = apiKeyInput.trim();
    if (!key) return;
    const next = { ...cfg, apiKey: key };
    setCfg(next);
    setCloudFallbackConfig(next);
    setApiKeyInput('');
    setSaved(true);
    onToast?.('Cloud fallback API key saved', 'success');
  };

  const handleDeleteKey = () => {
    const next = { ...cfg, apiKey: null };
    setCfg(next);
    setCloudFallbackConfig(next);
    setSaved(false);
    onToast?.('Cloud fallback API key removed', 'info');
  };

  return (
    <div className="settings-section" data-testid="cloud-fallback-panel" style={{ marginTop: '1.5rem' }}>
      <p className="settings-label" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
        Cloud Fallback (when daemon is down)
      </p>
      <div className="settings-row" data-testid="cloud-fallback-toggle-row">
        <label className="settings-label">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => handleToggle(e.target.checked)}
            data-testid="cloud-fallback-toggle"
          />
          {' '}Enable cloud fallback when daemon is unreachable
        </label>
      </div>
      <div className="settings-row">
        <label className="settings-label">Provider</label>
        <select
          className="settings-select"
          value={cfg.provider}
          disabled
          data-testid="cloud-fallback-provider"
        >
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>
      <div className="settings-row">
        <label className="settings-label">API Key</label>
        {saved ? (
          <span className="provider-masked" aria-label="Cloud fallback API key saved">
            {maskSecret('placeholder')}
          </span>
        ) : (
          <input
            className="settings-input provider-input"
            type="password"
            placeholder="OpenRouter API key…"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            aria-label="Cloud fallback API key"
            data-testid="cloud-fallback-api-key"
          />
        )}
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSaveKey}
          disabled={saved || !apiKeyInput.trim()}
          aria-label="Save cloud fallback API key"
          data-testid="cloud-fallback-save-key"
        >
          Save
        </button>
        {saved && (
          <button
            className="btn btn-sm btn-secondary"
            onClick={handleDeleteKey}
            aria-label="Delete cloud fallback API key"
            data-testid="cloud-fallback-delete-key"
          >
            Delete
          </button>
        )}
      </div>
      <div className="settings-row">
        <label className="settings-label">Model</label>
        <input
          className="settings-input"
          type="text"
          value={cfg.model}
          onChange={(e) => handleModelChange(e.target.value)}
          placeholder="openrouter/auto"
          aria-label="Cloud fallback model"
          data-testid="cloud-fallback-model"
        />
      </div>
      <p className="settings-hint">
        When enabled and the local daemon is unreachable, chat messages are routed directly
        to OpenRouter using your API key. Multipart (attachment) messages are not supported
        in fallback mode.
      </p>
    </div>
  );
}

// ─── Provider Keys Tab ───────────────────────────────────────────────────────

interface ProviderKeyState {
  value: string;
  saved: boolean;
  saving: boolean;
  deleting: boolean;
}

function ProviderKeysTab({ onToast }: { onToast?: (msg: string, type: string) => void }) {
  const [keys, setKeys] = useState<Record<Provider, ProviderKeyState>>(
    () =>
      Object.fromEntries(
        PROVIDERS.map((p) => [p, { value: '', saved: false, saving: false, deleting: false }])
      ) as Record<Provider, ProviderKeyState>
  );

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    // Load existing keys — show masked placeholder if key exists
    PROVIDERS.forEach(async (provider) => {
      try {
        const existing = await tauriInvoke<string | null>('get_secret', {
          key: `provider:${provider}`,
        });
        if (existing) {
          setKeys((prev) => ({
            ...prev,
            [provider]: { ...prev[provider], value: '', saved: true },
          }));
        }
      } catch {
        // Key not found — leave empty
      }
    });
  }, []);

  const handleSave = useCallback(
    async (provider: Provider) => {
      const val = keys[provider].value.trim();
      if (!val) return;
      setKeys((prev) => ({ ...prev, [provider]: { ...prev[provider], saving: true } }));
      try {
        await tauriInvoke('set_secret', { key: `provider:${provider}`, value: val });
        setKeys((prev) => ({
          ...prev,
          [provider]: { value: '', saved: true, saving: false, deleting: false },
        }));
        onToast?.(`${provider} key saved`, 'success');
      } catch (e: unknown) {
        setKeys((prev) => ({ ...prev, [provider]: { ...prev[provider], saving: false } }));
        onToast?.(`Failed to save ${provider} key: ${String(e)}`, 'error');
      }
    },
    [keys, onToast]
  );

  const handleDelete = useCallback(
    async (provider: Provider) => {
      setKeys((prev) => ({ ...prev, [provider]: { ...prev[provider], deleting: true } }));
      try {
        await tauriInvoke('delete_secret', { key: `provider:${provider}` });
        setKeys((prev) => ({
          ...prev,
          [provider]: { value: '', saved: false, saving: false, deleting: false },
        }));
        onToast?.(`${provider} key deleted`, 'info');
      } catch (e: unknown) {
        setKeys((prev) => ({ ...prev, [provider]: { ...prev[provider], deleting: false } }));
        onToast?.(`Failed to delete ${provider} key: ${String(e)}`, 'error');
      }
    },
    [onToast]
  );

  return (
    <div className="settings-section" data-testid="tab-provider-keys">
      <p className="settings-hint">
        Keys are stored in the macOS Keychain and never written to disk.
      </p>
      {PROVIDERS.map((provider) => {
        const state = keys[provider];
        return (
          <div key={provider} className="provider-key-row">
            <span className="provider-name">{provider}</span>
            {state.saved ? (
              <span className="provider-masked" aria-label={`${provider} key saved`}>
                {maskSecret('placeholder')}
              </span>
            ) : (
              <input
                className="settings-input provider-input"
                type="password"
                placeholder={`${provider} API key…`}
                value={state.value}
                onChange={(e) =>
                  setKeys((prev) => ({
                    ...prev,
                    [provider]: { ...prev[provider], value: e.target.value },
                  }))
                }
                aria-label={`${provider} API key`}
              />
            )}
            <button
              className="btn btn-sm btn-primary"
              onClick={() => handleSave(provider)}
              disabled={state.saving || (!state.saved && !keys[provider].value.trim())}
              aria-label={`Save ${provider} key`}
            >
              {state.saving ? '…' : 'Save'}
            </button>
            {state.saved && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => handleDelete(provider)}
                disabled={state.deleting}
                aria-label={`Delete ${provider} key`}
              >
                {state.deleting ? '…' : 'Delete'}
              </button>
            )}
          </div>
        );
      })}
      <CloudFallbackPanel onToast={onToast} />
    </div>
  );
}

// ─── Daemon Tab ───────────────────────────────────────────────────────────────

function DaemonTab({
  settings,
  onChange,
  onToast,
}: {
  settings: IdeSettings;
  onChange: (s: IdeSettings) => void;
  onToast?: (msg: string, type: string) => void;
}) {
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramSaved, setTelegramSaved] = useState(false);
  const [daemonPort, setDaemonPort] = useState<number | null>(null);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    tauriInvoke<string | null>('get_secret', { key: 'provider:telegram_token' })
      .then((val) => { if (val) setTelegramSaved(true); })
      .catch(() => {});
    tauriInvoke<number>('get_daemon_port')
      .then(setDaemonPort)
      .catch(() => {});
  }, []);

  const saveTelegramToken = async () => {
    const val = telegramToken.trim();
    if (!val) return;
    try {
      await tauriInvoke('set_secret', { key: 'provider:telegram_token', value: val });
      setTelegramToken('');
      setTelegramSaved(true);
      onToast?.('Telegram token saved', 'success');
    } catch (e: unknown) {
      onToast?.(`Failed to save Telegram token: ${String(e)}`, 'error');
    }
  };

  return (
    <div className="settings-section" data-testid="tab-daemon">
      <div className="settings-row">
        <label className="settings-label">Daemon URL</label>
        <span className="settings-value-readonly">
          {daemonPort ? `http://localhost:${daemonPort}` : 'Connecting…'}
        </span>
      </div>
      <div className="settings-row settings-row--col">
        <label className="settings-label">Telegram Bot Token</label>
        {telegramSaved ? (
          <span className="provider-masked">{maskSecret('placeholder')}</span>
        ) : (
          <input
            className="settings-input"
            type="password"
            placeholder="Bot token…"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            aria-label="Telegram bot token"
          />
        )}
        <button
          className="btn btn-sm btn-primary"
          onClick={saveTelegramToken}
          disabled={!telegramSaved && !telegramToken.trim()}
          aria-label="Save Telegram token"
        >
          Save
        </button>
      </div>
      <div className="settings-row">
        <label className="settings-label">Daemon Log Level</label>
        <div className="radio-group">
          {(['silent', 'error', 'warn', 'info', 'debug'] as const).map((level) => (
            <label key={level} className="radio-label">
              <input
                type="radio"
                name="logLevel"
                value={level}
                checked={settings.logLevel === level}
                onChange={() => onChange({ ...settings, logLevel: level })}
              />
              {level}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function SettingsModal({ onClose, onProviderKeysSaved }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('appearance');
  const [settings, setSettings] = useState<IdeSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      setLoading(false);
      return;
    }
    tauriInvoke<IdeSettings>('read_settings')
      .then((s) => {
        setSettings({ ...DEFAULT_SETTINGS, ...s });
        applyTheme(s.theme ?? DEFAULT_SETTINGS.theme);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const applyTheme = (theme: IdeSettings['theme']) => {
    const resolved =
      theme === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    document.body.setAttribute('data-theme', resolved);
  };

  const handleSettingsChange = (updated: IdeSettings) => {
    setSettings(updated);
    applyTheme(updated.theme);
  };

  const handleSave = async () => {
    if (!('__TAURI_INTERNALS__' in window)) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await tauriInvoke('write_settings', { value: settings });
    } catch {
      // Non-fatal
    } finally {
      setSaving(false);
    }
    onClose();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'keybindings', label: 'Keybindings' },
    { id: 'provider-keys', label: 'Provider Keys' },
    { id: 'daemon', label: 'Daemon' },
    { id: 'models', label: 'Models' },
  ];

  return (
    <div className="modal-overlay visible" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal modal--settings">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="settings-tabs" role="tablist">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              className={`settings-tab${activeTab === id ? ' settings-tab--active' : ''}`}
              onClick={() => setActiveTab(id)}
              data-testid={`tab-btn-${id}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {loading ? (
            <div className="settings-loading">Loading…</div>
          ) : (
            <>
              {activeTab === 'appearance' && (
                <AppearanceTab settings={settings} onChange={handleSettingsChange} />
              )}
              {activeTab === 'keybindings' && (
                <KeybindingsTab settings={settings} onChange={handleSettingsChange} />
              )}
              {activeTab === 'provider-keys' && (
                <ProviderKeysTab
                  onToast={(msg, type) => console.info(`[settings] ${type}: ${msg}`)}
                />
              )}
              {activeTab === 'daemon' && (
                <DaemonTab
                  settings={settings}
                  onChange={handleSettingsChange}
                  onToast={(msg, type) => console.info(`[settings] ${type}: ${msg}`)}
                />
              )}
              {activeTab === 'models' && (
                <ModelsTab
                  onToast={(msg, type) => console.info(`[settings] ${type}: ${msg}`)}
                />
              )}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            data-testid="settings-save-btn"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Models Tab ───────────────────────────────────────────────────────────────

function ModelsTab({ onToast }: { onToast?: (msg: string, type: string) => void }) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [activeModel, setActiveModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [localFirst, setLocalFirst] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listModels().catch(() => [] as ModelEntry[]),
      getActiveModel().catch(() => null),
      getLocalMode().catch(() => ({ localFirst: false, localOnly: false })),
    ]).then(([ms, am, lm]) => {
      if (cancelled) return;
      setModels(ms);
      setActiveModelState(am);
      setLocalFirst(lm.localFirst);
      setLocalOnly(lm.localOnly);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleLocalFirstChange = async (checked: boolean) => {
    const next = { localFirst: checked, localOnly: checked ? localOnly : false };
    if (!checked) next.localOnly = false;
    setLocalFirst(next.localFirst);
    setLocalOnly(next.localOnly);
    setSavingMode(true);
    try {
      await setLocalMode(next);
      onToast?.(`Local-first ${next.localFirst ? 'enabled' : 'disabled'}`, 'success');
    } catch (e: unknown) {
      onToast?.(`Failed to update local mode: ${String(e)}`, 'error');
    } finally {
      setSavingMode(false);
    }
  };

  const handleLocalOnlyChange = async (checked: boolean) => {
    const next = { localFirst: checked ? true : localFirst, localOnly: checked };
    setLocalFirst(next.localFirst);
    setLocalOnly(next.localOnly);
    setSavingMode(true);
    try {
      await setLocalMode(next);
      onToast?.(`Local-only ${next.localOnly ? 'enabled' : 'disabled'}`, 'success');
    } catch (e: unknown) {
      onToast?.(`Failed to update local mode: ${String(e)}`, 'error');
    } finally {
      setSavingMode(false);
    }
  };

  const handleSelect = async (provider: string, modelId: string) => {
    const key = `${provider}:${modelId}`;
    setSelecting(key);
    try {
      await setActiveModel(provider, modelId);
      setActiveModelState({ provider, modelId });
      onToast?.(`Active model set to ${provider}/${modelId}`, 'success');
    } catch (e: unknown) {
      onToast?.(`Failed to set model: ${String(e)}`, 'error');
    } finally {
      setSelecting(null);
    }
  };

  if (loading) {
    return (
      <div className="settings-section" data-testid="tab-models">
        <div className="settings-loading">Loading models…</div>
      </div>
    );
  }

  const grouped: Record<string, ModelEntry[]> = {};
  for (const m of models) {
    if (!grouped[m.provider]) grouped[m.provider] = [];
    grouped[m.provider]!.push(m);
  }

  const isEmpty = Object.keys(grouped).length === 0;

  return (
    <div className="settings-section" data-testid="tab-models">
      <div className="settings-row" data-testid="local-first-row">
        <label className="settings-label">
          <input
            type="checkbox"
            checked={localFirst}
            disabled={savingMode}
            onChange={(e) => handleLocalFirstChange(e.target.checked)}
            data-testid="local-first-toggle"
          />
          {' '}Local-first (prefer local LLMs, fall back to cloud)
        </label>
      </div>
      <div className="settings-row" data-testid="local-only-row">
        <label className={`settings-label${!localFirst ? ' settings-label--disabled' : ''}`}>
          <input
            type="checkbox"
            checked={localOnly}
            disabled={savingMode || !localFirst}
            onChange={(e) => handleLocalOnlyChange(e.target.checked)}
            data-testid="local-only-toggle"
          />
          {' '}Local-only (disable cloud — requires local LLM)
        </label>
      </div>
      {isEmpty && (
        <p className="settings-hint">No models found. Make sure Ollama or MLX is running.</p>
      )}
      {Object.entries(grouped).map(([provider, providerModels]) => (
        <div key={provider} className="models-provider-group">
          <p className="settings-label models-provider-label">{provider}</p>
          {providerModels.map((m) => {
            const isActive = activeModel?.provider === m.provider && activeModel?.modelId === m.id;
            const key = `${m.provider}:${m.id}`;
            return (
              <div
                key={key}
                className={`model-row${isActive ? ' model-row--active' : ''}${!m.available ? ' model-row--unavailable' : ''}`}
              >
                <span className="model-availability" title={m.available ? 'Available' : 'Unavailable'}>
                  {m.available ? '●' : '○'}
                </span>
                <span className="model-id">{m.label ?? m.id}</span>
                <button
                  className={`btn btn-sm${isActive ? ' btn-primary' : ' btn-secondary'}`}
                  onClick={() => handleSelect(m.provider, m.id)}
                  disabled={selecting === key || isActive}
                  aria-label={`Select ${m.provider}/${m.id}`}
                  data-testid={`model-select-${key.replace(/[:/]/g, '-')}`}
                >
                  {isActive ? 'Active' : selecting === key ? '…' : 'Select'}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

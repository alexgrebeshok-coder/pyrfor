import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  ONBOARDING_PROVIDER_OPTIONS,
  isTauriRuntime,
  tauriInvoke,
  type IdeSettings,
} from './SettingsModal';

type OnboardingMode = 'ide-only' | 'cloud' | 'telegram' | 'local-model';
type ProviderId = (typeof ONBOARDING_PROVIDER_OPTIONS)[number]['id'];
type ProviderTabId = ProviderId | 'telegram';

interface OnboardingWizardProps {
  onComplete: (result: { mode: OnboardingMode; providerLabel?: string; modelLabel?: string }) => void;
  onToast?: (message: string, type?: string, durationMs?: number) => void;
}

interface WizardConfig {
  version?: string;
  ai?: {
    defaultProvider?: string;
    defaultModel?: string;
    providers?: unknown[];
  };
  telegram?: {
    mode?: 'polling' | 'webhook';
  };
  onboarding?: {
    mode?: OnboardingMode;
    completedAt?: string;
    source?: string;
    provider?: string;
    model?: string;
  };
  [key: string]: unknown;
}

interface DownloadState {
  status: 'idle' | 'downloading' | 'done' | 'error';
  progress: number;
  message: string;
}

const MODE_OPTIONS: Array<{
  id: OnboardingMode;
  title: string;
  description: string;
  badge: string;
}> = [
  {
    id: 'ide-only',
    title: 'IDE-only',
    description: 'Запустить IDE без обязательной настройки облака, Telegram или локальной модели.',
    badge: 'Быстрый старт',
  },
  {
    id: 'cloud',
    title: 'Cloud',
    description: 'Подключить OpenRouter, ZAI или OpenAI и работать через облачного провайдера.',
    badge: 'API ключи',
  },
  {
    id: 'telegram',
    title: 'Telegram',
    description: 'Настроить облачного провайдера и токен Telegram-бота для удалённого доступа.',
    badge: 'Бот + AI',
  },
  {
    id: 'local-model',
    title: 'Local model / Ollama',
    description: 'Скачать локальную модель Ollama и запускать без облачной зависимости.',
    badge: 'Приватно',
  },
];

const LOCAL_MODEL_OPTIONS = [
  {
    id: 'qwen2.5:3b',
    title: 'qwen2.5:3b',
    minRam: 8,
    recommendation: 'Для 8 GB RAM',
    description: 'Самый лёгкий вариант для ноутбуков и базовых задач.',
  },
  {
    id: 'qwen2.5:7b',
    title: 'qwen2.5:7b',
    minRam: 16,
    recommendation: 'Для 16 GB RAM',
    description: 'Оптимальный баланс качества и скорости для повседневной работы.',
  },
  {
    id: 'qwen2.5:14b',
    title: 'qwen2.5:14b',
    minRam: 32,
    recommendation: 'Для 32+ GB RAM',
    description: 'Более сильная локальная модель для сложных задач и долгого контекста.',
  },
  {
    id: 'llama3:8b',
    title: 'llama3:8b',
    minRam: 32,
    recommendation: 'Альтернатива для 32+ GB RAM',
    description: 'Хороший универсальный вариант с широкой поддержкой в Ollama.',
  },
] as const;

const TELEGRAM_SECRET_KEY = 'provider:telegram_token';
const STEP_TITLES = ['Режим', 'Локальная модель', 'Ключи доступа', 'Готово'];

function defaultLocalModel(memoryGb: number | null): string {
  if (memoryGb !== null && memoryGb >= 32) return 'qwen2.5:14b';
  if (memoryGb !== null && memoryGb >= 16) return 'qwen2.5:7b';
  return 'qwen2.5:3b';
}

function detectMode(config: WizardConfig | null): OnboardingMode {
  const savedMode = config?.onboarding?.mode;
  if (savedMode) return savedMode;
  if (config?.telegram) return 'telegram';
  if (config?.ai?.defaultProvider === 'ollama') return 'local-model';
  if (config?.ai?.defaultProvider) return 'cloud';
  return 'ide-only';
}

function buildConfig(
  existingConfig: WizardConfig | null,
  mode: OnboardingMode,
  selectedProvider: ProviderId,
  selectedModel: string
): WizardConfig {
  const existing = existingConfig && typeof existingConfig === 'object' ? existingConfig : {};
  const next: WizardConfig = {
    ...existing,
    version: typeof existing.version === 'string' ? existing.version : '1.0.0',
    onboarding: {
      ...(existing.onboarding && typeof existing.onboarding === 'object' ? existing.onboarding : {}),
      mode,
      completedAt: new Date().toISOString(),
      source: 'web',
      provider: mode === 'cloud' || mode === 'telegram' ? selectedProvider : undefined,
      model: mode === 'local-model' ? selectedModel : undefined,
    },
  };

  if (mode === 'cloud' || mode === 'telegram') {
    next.ai = {
      ...(existing.ai && typeof existing.ai === 'object' ? existing.ai : {}),
      defaultProvider: selectedProvider,
      defaultModel:
        ONBOARDING_PROVIDER_OPTIONS.find((provider) => provider.id === selectedProvider)?.defaultModel ??
        existing.ai?.defaultModel,
    };
  }

  if (mode === 'local-model') {
    next.ai = {
      ...(existing.ai && typeof existing.ai === 'object' ? existing.ai : {}),
      defaultProvider: 'ollama',
      defaultModel: selectedModel,
    };
  }

  if (mode === 'telegram') {
    next.telegram = {
      ...(existing.telegram && typeof existing.telegram === 'object' ? existing.telegram : {}),
      mode: existing.telegram?.mode ?? 'polling',
    };
  }

  return next;
}

export default function OnboardingWizard({ onComplete, onToast }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<OnboardingMode>('ide-only');
  const [detectedMemoryGb, setDetectedMemoryGb] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(() => defaultLocalModel(null));
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: 'idle',
    progress: 0,
    message: '',
  });
  const [activeProviderTab, setActiveProviderTab] = useState<ProviderTabId>('openrouter');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('openrouter');
  const [providerInputs, setProviderInputs] = useState<Record<ProviderTabId, string>>({
    openrouter: '',
    zai: '',
    openai: '',
    telegram: '',
  });
  const [testedConnections, setTestedConnections] = useState<Record<ProviderTabId, boolean>>({
    openrouter: false,
    zai: false,
    openai: false,
    telegram: false,
  });
  const [testingConnection, setTestingConnection] = useState<ProviderTabId | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingConfig, setExistingConfig] = useState<WizardConfig | null>(null);

  const providerTabs = useMemo(
    () => [
      ...ONBOARDING_PROVIDER_OPTIONS,
      ...(mode === 'telegram'
        ? ([{ id: 'telegram', label: 'Telegram', secretKey: TELEGRAM_SECRET_KEY }] as const)
        : []),
    ],
    [mode]
  );

  useEffect(() => {
    let cancelled = false;

    if (!isTauriRuntime()) return undefined;

    Promise.all([
      tauriInvoke<number>('detect_system_memory_gb').catch(() => null),
      tauriInvoke<WizardConfig | null>('read_pyrfor_config').catch(() => null),
    ]).then(([memoryGb, config]) => {
      if (cancelled) return;
      if (typeof memoryGb === 'number') {
        setDetectedMemoryGb(memoryGb);
        setSelectedModel(defaultLocalModel(memoryGb));
      }
      if (config && typeof config === 'object') {
        setExistingConfig(config);
        const nextMode = detectMode(config);
        setMode(nextMode);
        if (config.ai?.defaultProvider === 'openrouter' || config.ai?.defaultProvider === 'zai' || config.ai?.defaultProvider === 'openai') {
          setSelectedProvider(config.ai.defaultProvider);
          setActiveProviderTab(config.ai.defaultProvider);
        }
        if (config.ai?.defaultProvider === 'ollama' && config.ai?.defaultModel) {
          setSelectedModel(config.ai.defaultModel);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'telegram' && activeProviderTab === 'telegram') {
      setActiveProviderTab(selectedProvider);
    }
  }, [activeProviderTab, mode, selectedProvider]);

  const currentProviderConfig = providerTabs.find((provider) => provider.id === activeProviderTab);
  const currentProviderValue = providerInputs[activeProviderTab] ?? '';
  const currentProviderTested = testedConnections[activeProviderTab] ?? false;

  const finishDisabled =
    saving ||
    (mode === 'cloud' && !testedConnections[selectedProvider]) ||
    (mode === 'telegram' && (!testedConnections[selectedProvider] || !testedConnections.telegram));

  const handleProviderInputChange = (tab: ProviderTabId, value: string) => {
    setProviderInputs((prev) => ({ ...prev, [tab]: value }));
    setTestedConnections((prev) => ({ ...prev, [tab]: false }));
  };

  const handleDownloadModel = async () => {
    if (!isTauriRuntime()) {
      onToast?.('Загрузка локальных моделей доступна только в Tauri.', 'info');
      return;
    }

    setDownloadState({ status: 'downloading', progress: 6, message: `Downloading ${selectedModel}…` });
    const progressTimer = window.setInterval(() => {
      setDownloadState((prev) => {
        if (prev.status !== 'downloading') return prev;
        return { ...prev, progress: Math.min(prev.progress + 9, 92) };
      });
    }, 350);

    try {
      const result = await tauriInvoke<unknown>('ollama_pull_model', { model: selectedModel });
      window.clearInterval(progressTimer);
      const message =
        typeof result === 'string'
          ? result
          : typeof result === 'object' && result && 'status' in result && typeof result.status === 'string'
            ? result.status
            : `${selectedModel} downloaded`;
      setDownloadState({ status: 'done', progress: 100, message });
      onToast?.(`${selectedModel} готова локально`, 'success');
    } catch (error) {
      window.clearInterval(progressTimer);
      setDownloadState({
        status: 'error',
        progress: 0,
        message: `Не удалось скачать ${selectedModel}: ${String(error)}`,
      });
      onToast?.(`Не удалось скачать ${selectedModel}`, 'error');
    }
  };

  const handleTestConnection = async () => {
    const secretValue = currentProviderValue.trim();
    if (!secretValue || !currentProviderConfig) return;
    if (!isTauriRuntime()) {
      setTestedConnections((prev) => ({ ...prev, [activeProviderTab]: true }));
      return;
    }

    setTestingConnection(activeProviderTab);
    try {
      await tauriInvoke('test_provider_connection', {
        provider: activeProviderTab,
        secret: secretValue,
      });
      await tauriInvoke('set_secret', {
        key: currentProviderConfig.secretKey,
        value: secretValue,
      });
      setTestedConnections((prev) => ({ ...prev, [activeProviderTab]: true }));
      onToast?.(`${currentProviderConfig.label} подключение подтверждено`, 'success');
    } catch (error) {
      onToast?.(`Не удалось сохранить ${currentProviderConfig.label}: ${String(error)}`, 'error');
    } finally {
      setTestingConnection(null);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      if (isTauriRuntime()) {
        const settings = await tauriInvoke<IdeSettings>('read_settings').catch(() => DEFAULT_SETTINGS);

        for (const provider of ONBOARDING_PROVIDER_OPTIONS) {
          const value = providerInputs[provider.id].trim();
          if (value) {
            await tauriInvoke('set_secret', { key: provider.secretKey, value });
          }
        }
        if (mode === 'telegram' && providerInputs.telegram.trim()) {
          await tauriInvoke('set_secret', {
            key: TELEGRAM_SECRET_KEY,
            value: providerInputs.telegram.trim(),
          });
        }

        const nextConfig = buildConfig(existingConfig, mode, selectedProvider, selectedModel);
        await tauriInvoke('write_pyrfor_config', { value: nextConfig });
        await tauriInvoke('write_settings', {
          value: {
            ...DEFAULT_SETTINGS,
            ...settings,
            onboardingComplete: true,
          },
        });
      }

      onComplete({
        mode,
        providerLabel: mode === 'cloud' || mode === 'telegram'
          ? ONBOARDING_PROVIDER_OPTIONS.find((provider) => provider.id === selectedProvider)?.label
          : undefined,
        modelLabel: mode === 'local-model' ? selectedModel : undefined,
      });
    } catch (error) {
      onToast?.(`Не удалось завершить онбординг: ${String(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const nextStep = () => setStep((current) => Math.min(current + 1, STEP_TITLES.length - 1));
  const previousStep = () => setStep((current) => Math.max(current - 1, 0));

  return (
    <div className="modal-overlay visible onboarding-overlay" role="dialog" aria-modal="true" aria-label="Pyrfor onboarding wizard">
      <div className="modal modal--onboarding">
        <div className="modal-header onboarding-header">
          <div>
            <h2>Добро пожаловать в Pyrfor</h2>
            <p className="modal-desc">Настройте рабочий режим, модель и ключи доступа за пару минут.</p>
          </div>
          <div className="onboarding-step-indicator">Шаг {step + 1} / {STEP_TITLES.length}</div>
        </div>

        <div className="onboarding-progress" aria-hidden="true">
          {STEP_TITLES.map((title, index) => (
            <div
              key={title}
              className={`onboarding-progress-step${index === step ? ' active' : ''}${index < step ? ' complete' : ''}`}
            >
              <span>{index + 1}</span>
              <small>{title}</small>
            </div>
          ))}
        </div>

        <div className="settings-body onboarding-body">
          {step === 0 && (
            <div className="onboarding-mode-grid">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`onboarding-mode-card${mode === option.id ? ' selected' : ''}`}
                  onClick={() => setMode(option.id)}
                >
                  <span className="onboarding-mode-badge">{option.badge}</span>
                  <strong>{option.title}</strong>
                  <p>{option.description}</p>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-section">
              <div className="onboarding-summary-card">
                <span className="onboarding-summary-label">System RAM</span>
                <strong>{detectedMemoryGb ? `${detectedMemoryGb} GB` : 'Недоступно'}</strong>
                <p>
                  {mode === 'local-model'
                    ? 'Подберите модель под объём памяти и при необходимости скачайте её через Ollama.'
                    : 'Локальная модель не обязательна для выбранного режима, но её можно подготовить заранее.'}
                </p>
              </div>

              <div className="onboarding-model-grid">
                {LOCAL_MODEL_OPTIONS.map((option) => {
                  const recommended = detectedMemoryGb !== null
                    ? detectedMemoryGb >= option.minRam && option.id === defaultLocalModel(detectedMemoryGb)
                    : selectedModel === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`onboarding-model-card${selectedModel === option.id ? ' selected' : ''}`}
                      onClick={() => setSelectedModel(option.id)}
                    >
                      <div className="onboarding-model-title-row">
                        <strong>{option.title}</strong>
                        {recommended && <span className="onboarding-pill">Рекомендуем</span>}
                      </div>
                      <span className="onboarding-model-meta">{option.recommendation}</span>
                      <p>{option.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="onboarding-download-row">
                <button className="btn btn-primary" onClick={handleDownloadModel} disabled={downloadState.status === 'downloading'}>
                  {downloadState.status === 'downloading' ? 'Downloading…' : `Download ${selectedModel}`}
                </button>
                <div className="onboarding-download-status">
                  <div className="onboarding-progressbar">
                    <div className="onboarding-progressbar-fill" style={{ width: `${downloadState.progress}%` }} />
                  </div>
                  <span className={`onboarding-download-text${downloadState.status === 'done' ? ' success' : ''}${downloadState.status === 'error' ? ' error' : ''}`}>
                    {downloadState.message || 'Скачивание необязательно — можно продолжить и загрузить модель позже.'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-section">
              <div className="onboarding-provider-tabs" role="tablist" aria-label="Provider keys">
                {providerTabs.map((provider) => {
                  const isPrimaryProvider = provider.id === selectedProvider;
                  const isTelegram = provider.id === 'telegram';
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      role="tab"
                      aria-selected={activeProviderTab === provider.id}
                      className={`onboarding-provider-tab${activeProviderTab === provider.id ? ' active' : ''}`}
                      onClick={() => {
                        setActiveProviderTab(provider.id);
                        if (!isTelegram) setSelectedProvider(provider.id);
                      }}
                    >
                      {provider.label}
                      {testedConnections[provider.id] && <span className="onboarding-connection-ok">✓</span>}
                      {isPrimaryProvider && !isTelegram && <span className="onboarding-pill">Основной</span>}
                    </button>
                  );
                })}
              </div>

              {currentProviderConfig && (
                <div className="onboarding-provider-panel">
                  <label className="settings-label" htmlFor={`provider-input-${activeProviderTab}`}>
                    {currentProviderConfig.label} {activeProviderTab === 'telegram' ? 'bot token' : 'API key'}
                  </label>
                  <input
                    id={`provider-input-${activeProviderTab}`}
                    className="input-field"
                    type="password"
                    placeholder={activeProviderTab === 'telegram' ? 'Telegram bot token…' : `${currentProviderConfig.label} API key…`}
                    value={currentProviderValue}
                    onChange={(event) => handleProviderInputChange(activeProviderTab, event.target.value)}
                  />
                  <div className="onboarding-provider-actions">
                    <button
                      className="btn btn-primary"
                      onClick={handleTestConnection}
                      disabled={!currentProviderValue.trim() || testingConnection === activeProviderTab}
                    >
                      {testingConnection === activeProviderTab ? 'Проверяем…' : 'Test connection'}
                    </button>
                    {currentProviderTested && (
                      <span className="onboarding-provider-success">✓ Подключение подтверждено</span>
                    )}
                  </div>
                  <p className="settings-hint">
                    {activeProviderTab === 'telegram'
                      ? 'Токен сохранится в Keychain. Для режима Telegram также нужен один проверенный AI-провайдер.'
                      : 'Ключ сохранится в Keychain и не будет записан в pyrfor.json.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-section onboarding-review-grid">
              <div className="onboarding-summary-card">
                <span className="onboarding-summary-label">Режим</span>
                <strong>{MODE_OPTIONS.find((option) => option.id === mode)?.title}</strong>
                <p>{MODE_OPTIONS.find((option) => option.id === mode)?.description}</p>
              </div>
              <div className="onboarding-summary-card">
                <span className="onboarding-summary-label">Локальная модель</span>
                <strong>{selectedModel}</strong>
                <p>{downloadState.status === 'done' ? 'Модель скачана через Ollama.' : 'Можно скачать сейчас или позже из Settings.'}</p>
              </div>
              <div className="onboarding-summary-card">
                <span className="onboarding-summary-label">Cloud provider</span>
                <strong>{ONBOARDING_PROVIDER_OPTIONS.find((provider) => provider.id === selectedProvider)?.label}</strong>
                <p>
                  {testedConnections[selectedProvider]
                    ? 'Подключение проверено и готово к использованию.'
                    : mode === 'cloud' || mode === 'telegram'
                      ? 'Перед завершением нужен проверенный провайдер.'
                      : 'Необязательный шаг для выбранного режима.'}
                </p>
              </div>
              {mode === 'telegram' && (
                <div className="onboarding-summary-card">
                  <span className="onboarding-summary-label">Telegram</span>
                  <strong>{testedConnections.telegram ? 'Готово' : 'Нужно проверить токен'}</strong>
                  <p>Токен бота хранится в Keychain и используется только локально.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-actions onboarding-actions">
          <button className="btn btn-secondary" onClick={previousStep} disabled={step === 0 || saving}>
            Назад
          </button>
          {step < STEP_TITLES.length - 1 ? (
            <button className="btn btn-primary" onClick={nextStep}>
              Далее
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleFinish} disabled={finishDisabled}>
              {saving ? 'Сохраняем…' : 'Завершить'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

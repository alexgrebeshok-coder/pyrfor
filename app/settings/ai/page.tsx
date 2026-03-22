"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Zap,
  CheckCircle,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { browserStorage, STORAGE_KEYS } from "@/lib/persistence/storage";
import { isTauriDesktop } from "@/lib/utils";
import {
  getDesktopLocalGatewayStatus,
  runDesktopLocalGatewayPrompt,
  type DesktopLocalGatewayStatus,
} from "@/lib/desktop/local-gateway";

// ============================================
// Types
// ============================================

interface AISettings {
  provider: string;
  openrouterKey: string;
  zaiKey: string;
  openaiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface AIStatus {
  mode: "gateway" | "provider" | "mock" | "unavailable";
  gatewayKind?: "local" | "remote" | "missing";
  gatewayAvailable: boolean;
  providerAvailable: boolean;
  isProduction: boolean;
  unavailableReason: string | null;
  running?: boolean;
  port?: number | null;
  auto_start?: boolean;
  model_path?: string | null;
  adapter_path?: string | null;
  python_path?: string | null;
}

const DEFAULT_SETTINGS: AISettings = {
  provider: "openrouter",
  openrouterKey: "",
  zaiKey: "",
  openaiKey: "",
  model: "google/gemini-3.1-flash-lite-preview",
  temperature: 0.7,
  maxTokens: 4096,
};

const PROVIDER_MODELS: Record<string, string[]> = {
  openrouter: [
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-2.5-flash-lite",
    "deepseek/deepseek-r1:free",
    "qwen/qwen3-coder:free",
  ],
  zai: ["glm-5", "glm-4.7", "glm-4.7-flash"],
  openai: ["gpt-5.4", "gpt-5.2", "gpt-5.1"],
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter (рекомендуется)",
  zai: "ZAI",
  openai: "OpenAI",
  gigachat: "GigaChat",
  yandexgpt: "YandexGPT",
};

// ============================================
// Component
// ============================================

export default function AISettingsPage() {
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<Array<{ provider: string; model: string }>>([]);
  const [providerRegistryState, setProviderRegistryState] = useState<"loading" | "ready" | "error">("loading");
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [desktopLocalGatewayStatus, setDesktopLocalGatewayStatus] = useState<DesktopLocalGatewayStatus | null>(null);

  // Load settings
  useEffect(() => {
    const saved = browserStorage.get<AISettings>(STORAGE_KEYS.AI_SETTINGS);
    if (saved) {
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    }
  }, []);

  // Fetch live server provider registry
  useEffect(() => {
    let cancelled = false;

    fetch("/api/ai/chat")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`AI registry unavailable (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;

        setAiStatus(data.aiStatus ?? null);
        setAvailableProviders(Array.isArray(data.providers) ? data.providers : []);
        setAvailableModels(Array.isArray(data.models) ? data.models : []);
        setProviderRegistryState("ready");
      })
      .catch(() => {
        if (cancelled) return;

        setAiStatus(null);
        setAvailableProviders([]);
        setAvailableModels([]);
        setProviderRegistryState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) {
      return;
    }

    let cancelled = false;

    getDesktopLocalGatewayStatus().then((status) => {
      if (!cancelled) {
        setDesktopLocalGatewayStatus(status);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Check for changes
  useEffect(() => {
    const saved = browserStorage.get<AISettings>(STORAGE_KEYS.AI_SETTINGS);
    const current = JSON.stringify(settings);
    const original = JSON.stringify(saved || DEFAULT_SETTINGS);
    setHasChanges(current !== original);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      browserStorage.set(STORAGE_KEYS.AI_SETTINGS, settings);
      setHasChanges(false);
      setTimeout(() => setSaving(false), 500);
    } catch (error) {
      console.error("[Settings] Error saving:", error);
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    browserStorage.remove(STORAGE_KEYS.AI_SETTINGS);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const workspaceMode = browserStorage.get<string>("ceoclaw-ai-mode");

      if (
        isTauriDesktop() &&
        (workspaceMode === "local" || activeAiStatus?.gatewayKind === "local" || !activeAiStatus)
      ) {
        const response = await runDesktopLocalGatewayPrompt({
          prompt: "Проверь локальную AI-модель и ответь одним коротким подтверждением.",
          runId: `ai-settings-${Date.now()}`,
          sessionKey: `pm-dashboard:ai-settings-${Date.now()}`,
          model: "openclaw:main",
        });

        setTestResult(response.content.trim().length > 0 ? "ok" : "error");
        return;
      }

      if (activeAiStatus?.mode === "gateway") {
        const res = await fetch("/api/ai/local", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Проверь локальную AI-модель и ответь одним коротким подтверждением.",
          }),
        });

        setTestResult(res.ok ? "ok" : "error");
        return;
      }

      const res = await fetch("/api/health");
      const data = await res.json();

      setTestResult(data.checks?.ai?.available ? "ok" : "error");
    } catch (error) {
      setTestResult("error");
    } finally {
      setTesting(false);
    }
  };

  const toggleShowKey = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateSetting = <K extends keyof AISettings>(
    key: K,
    value: AISettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const currentKey = (() => {
    switch (settings.provider) {
      case "openrouter":
        return settings.openrouterKey;
      case "zai":
        return settings.zaiKey;
      case "openai":
        return settings.openaiKey;
      default:
        return "";
    }
  })();

  const providerAvailable =
    availableProviders.length > 0 ? availableProviders.includes(settings.provider) : true;
  const localCredentialRequired = ["openrouter", "zai", "openai"].includes(settings.provider);
  const isConfigured = providerAvailable && (!localCredentialRequired || currentKey.length > 0);
  const providerOptions = availableProviders.length > 0
    ? availableProviders
    : ["openrouter", "zai", "openai"];
  const selectedModelsFromRegistry = availableModels
    .filter((item) => item.provider === settings.provider)
    .map((item) => item.model);
  const selectedModels =
    selectedModelsFromRegistry.length > 0
      ? selectedModelsFromRegistry
      : PROVIDER_MODELS[settings.provider] || [];
  const activeAiStatus = desktopLocalGatewayStatus ?? aiStatus;
  const aiModeLabel =
    activeAiStatus?.mode === "gateway"
      ? activeAiStatus?.gatewayKind === "remote"
        ? "Remote gateway"
        : "Local model"
      : activeAiStatus?.mode === "provider"
        ? "Live provider"
        : activeAiStatus?.mode === "mock"
          ? "Dev mock"
          : activeAiStatus?.mode === "unavailable"
            ? "Unavailable"
            : "Unknown";
  const aiModeDescription =
    activeAiStatus?.mode === "gateway"
      ? activeAiStatus?.gatewayKind === "remote"
        ? "Запросы идут через удалённый gateway или совместимый endpoint."
        : "Запросы идут через локальную модель OpenClaw / MLX gateway."
      : activeAiStatus?.mode === "provider"
        ? "Запросы идут через живого cloud provider с API-ключом."
        : activeAiStatus?.mode === "mock"
          ? "В dev без ключей AI отвечает через встроенный mock fallback."
          : activeAiStatus?.mode === "unavailable"
            ? activeAiStatus.unavailableReason ?? "AI сейчас недоступен."
            : "Статус AI ещё не загружен.";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Назад
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              Настройки AI
            </h1>
            <p className="text-sm text-gray-500">Подключение AI провайдеров</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Статус подключения
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isConfigured ? (
                  <>
                    <Badge className="bg-green-500">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Настроен
                    </Badge>
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Провайдер: {settings.provider}
                    </span>
                  </>
                ) : (
                  <Badge variant="info">
                    <XCircle className="w-3 h-3 mr-1" />
                    Не настроен
                  </Badge>
                )}
                {activeAiStatus?.mode === "gateway" && activeAiStatus?.gatewayKind === "remote" && (
                  <Badge variant="success">Remote gateway</Badge>
                )}
                {activeAiStatus?.mode === "gateway" && activeAiStatus?.gatewayKind !== "remote" && (
                  <Badge variant="success">Local model</Badge>
                )}
                {activeAiStatus?.mode === "provider" && (
                  <Badge variant="success">Live provider</Badge>
                )}
                {activeAiStatus?.mode === "mock" && (
                  <Badge variant="info">Dev mock</Badge>
                )}
                {activeAiStatus?.mode === "unavailable" && (
                  <Badge variant="warning">AI unavailable</Badge>
                )}
                {providerRegistryState === "ready" && (
                  <Badge variant="info">
                    Live registry
                  </Badge>
                )}
                {providerRegistryState === "error" && (
                  <Badge variant="warning">
                    Registry fallback
                  </Badge>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-300">
                <p className="font-medium text-gray-900 dark:text-white">{aiModeLabel}</p>
                <p className="mt-1 leading-6">{aiModeDescription}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {isTauriDesktop()
                    ? "На desktop CEOClaw автоматически поднимает локальный MLX server с fine-tuned моделью через Tauri bridge. Если сервер ещё не поднят, приложение стартует его на первом AI запросе."
                    : (
                        <>
                          Для browser/local mode запусти локальный MLX server или OpenAI-compatible gateway и задай{" "}
                          <code className="rounded bg-gray-200 px-1 py-0.5 text-[11px] dark:bg-gray-700">
                            OPENCLAW_GATEWAY_URL
                          </code>
                          . В dev без ключей система отвечает через mock fallback.
                      </>
                    )}
                </p>
                {activeAiStatus && (
                  <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-md bg-white/80 px-3 py-2 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                      <p className="text-gray-500">Status</p>
                      <p className="mt-1 font-medium text-gray-900 dark:text-white">
                        {activeAiStatus.running ? "Running" : "Stopped"}
                      </p>
                    </div>
                    <div className="rounded-md bg-white/80 px-3 py-2 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                      <p className="text-gray-500">Port</p>
                      <p className="mt-1 font-medium text-gray-900 dark:text-white">
                        {activeAiStatus.port ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-md bg-white/80 px-3 py-2 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                      <p className="text-gray-500">Auto-start</p>
                      <p className="mt-1 font-medium text-gray-900 dark:text-white">
                        {activeAiStatus.auto_start ? "Enabled" : "Disabled"}
                      </p>
                    </div>
                    <div className="rounded-md bg-white/80 px-3 py-2 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                      <p className="text-gray-500">Model</p>
                      <p className="mt-1 break-all font-medium text-gray-900 dark:text-white">
                        {activeAiStatus.model_path ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-md bg-white/80 px-3 py-2 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                      <p className="text-gray-500">Adapter</p>
                      <p className="mt-1 break-all font-medium text-gray-900 dark:text-white">
                        {activeAiStatus.adapter_path ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-md bg-white/80 px-3 py-2 ring-1 ring-gray-200 dark:bg-gray-900/40 dark:ring-gray-700">
                      <p className="text-gray-500">Python</p>
                      <p className="mt-1 break-all font-medium text-gray-900 dark:text-white">
                        {activeAiStatus.python_path ?? "—"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={testing || !isConfigured}
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : testResult === "ok" ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : testResult === "error" ? (
                  <XCircle className="w-4 h-4 text-red-500" />
                ) : (
                  "Проверить"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Provider Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Провайдер</CardTitle>
            <CardDescription>
              Выберите AI провайдера и введите API ключ
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Provider Select */}
            <div className="space-y-2">
              <Label>Провайдер</Label>
              <Select
                value={settings.provider}
                onValueChange={(v) => updateSetting("provider", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {PROVIDER_LABELS[provider] || provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {providerRegistryState === "ready" && providerOptions.length > 3 && (
                <p className="text-xs text-gray-500">
                  Серверный registry уже содержит дополнительные AI providers.
                </p>
              )}
            </div>

            {/* Model Select */}
            <div className="space-y-2">
              <Label>Модель</Label>
              <Select
                value={settings.model}
                onValueChange={(v) => updateSetting("model", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* API Keys */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm">API Ключи</h4>

              {/* OpenRouter */}
              <div className="space-y-2">
                <Label
                  htmlFor="openrouter-key"
                  className="flex items-center gap-2"
                >
                  OpenRouter API Key
                  {settings.provider === "openrouter" && (
                    <Badge variant="info" className="text-xs">
                      активный
                    </Badge>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="openrouter-key"
                    type={showKeys.openrouter ? "text" : "password"}
                    placeholder="sk-or-..."
                    value={settings.openrouterKey}
                    onChange={(e) =>
                      updateSetting("openrouterKey", e.target.value)
                    }
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleShowKey("openrouter")}
                  >
                    {showKeys.openrouter ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Получите ключ на{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    openrouter.ai/keys
                  </a>
                </p>
              </div>

              {settings.provider !== "openrouter" && settings.provider !== "zai" && settings.provider !== "openai" && (
                <div className="rounded-md border border-dashed border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-700">
                  Этот provider конфигурируется через серверный manifest и env-переменные.
                  Для него не требуется локальный API key в браузере.
                </div>
              )}

              {/* ZAI */}
              <div className="space-y-2">
                <Label htmlFor="zai-key" className="flex items-center gap-2">
                  ZAI API Key
                  {settings.provider === "zai" && (
                    <Badge variant="info" className="text-xs">
                      активный
                    </Badge>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="zai-key"
                    type={showKeys.zai ? "text" : "password"}
                    placeholder="zai-..."
                    value={settings.zaiKey}
                    onChange={(e) => updateSetting("zaiKey", e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleShowKey("zai")}
                  >
                    {showKeys.zai ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* OpenAI */}
              <div className="space-y-2">
                <Label htmlFor="openai-key" className="flex items-center gap-2">
                  OpenAI API Key
                  {settings.provider === "openai" && (
                    <Badge variant="info" className="text-xs">
                      активный
                    </Badge>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="openai-key"
                    type={showKeys.openai ? "text" : "password"}
                    placeholder="sk-..."
                    value={settings.openaiKey}
                    onChange={(e) => updateSetting("openaiKey", e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleShowKey("openai")}
                  >
                    {showKeys.openai ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Расширенные настройки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Temperature: {settings.temperature}</Label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={settings.temperature}
                onChange={(e) =>
                  updateSetting("temperature", parseFloat(e.target.value))
                }
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                Низкие значения = более точные ответы, высокие = более
                креативные
              </p>
            </div>

            <div className="space-y-2">
              <Label>Max Tokens: {settings.maxTokens}</Label>
              <input
                type="range"
                min="256"
                max="8192"
                step="256"
                value={settings.maxTokens}
                onChange={(e) =>
                  updateSetting("maxTokens", parseInt(e.target.value))
                }
                className="w-full"
              />
              <p className="text-xs text-gray-500">Максимальная длина ответа</p>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Сбросить
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Сохранить
          </Button>
        </div>
      </main>
    </div>
  );
}

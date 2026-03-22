"use client";

import { useState } from "react";
import { Key, ExternalLink, Check, Eye, EyeOff } from "lucide-react";
import type { OnboardingData } from "../wizard";

interface AIStepProps {
  data: OnboardingData;
  isProductionLaunch: boolean;
  updateData: (updates: Partial<OnboardingData>) => void;
}

const PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Рекомендуется — быстро и дёшево",
    model: "Gemini 3.1 Lite",
    price: "Бесплатно $1 на старте",
    url: "https://openrouter.ai/keys",
    color: "from-blue-400 to-blue-600",
  },
  {
    id: "zai",
    name: "ZAI",
    description: "Российский AI провайдер",
    model: "GLM-5",
    price: "По тарифам ZAI",
    url: "https://zai.com/",
    color: "from-purple-400 to-purple-600",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-5.2 — мощная модель",
    model: "GPT-5.2",
    price: "По тарифам OpenAI",
    url: "https://platform.openai.com/api-keys",
    color: "from-green-400 to-green-600",
  },
  {
    id: "mock",
    name: "Mock Mode",
    description: "Без AI — mock ответы",
    model: "Mock",
    price: "Бесплатно",
    url: null,
    color: "from-gray-400 to-gray-600",
  },
];

export function AIStep({ data, isProductionLaunch, updateData }: AIStepProps) {
  const [showKey, setShowKey] = useState(false);

  const visibleProviders = isProductionLaunch
    ? PROVIDERS.filter((provider) => provider.id !== "mock")
    : PROVIDERS;
  const selectedProvider = visibleProviders.find((p) => p.id === data.aiProvider);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Настройка AI
      </h2>
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        Выберите AI провайдера и добавьте API ключ для работы ассистента.
      </p>

      {/* Provider Selection */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {visibleProviders.map((provider) => (
          <button
            key={provider.id}
            onClick={() => updateData({ aiProvider: provider.id as any })}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              data.aiProvider === provider.id
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className={`w-8 h-8 bg-gradient-to-br ${provider.color} rounded-lg flex items-center justify-center`}
              >
                <Key className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {provider.name}
                  </span>
                  {data.aiProvider === provider.id && (
                    <Check className="w-4 h-4 text-blue-500" />
                  )}
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {provider.model}
            </div>
          </button>
        ))}
      </div>

      {/* API Key Input */}
      {data.aiProvider !== "mock" && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            API ключ {selectedProvider?.name}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={data.apiKey}
              onChange={(e) => updateData({ apiKey: e.target.value })}
              placeholder={
                data.aiProvider === "openrouter"
                  ? "sk-or-v1-..."
                  : data.aiProvider === "openai"
                  ? "sk-..."
                  : "ваш-ключ"
              }
              className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>
          {selectedProvider?.url && (
            <a
              href={selectedProvider.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Получить ключ на {selectedProvider.name}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Info */}
      {!isProductionLaunch && data.aiProvider === "mock" && (
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Mock mode возвращает заранее подготовленные ответы без реального AI.
            Подходит для тестирования.
          </p>
        </div>
      )}

      {data.aiProvider !== "mock" && !data.apiKey && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {isProductionLaunch
              ? "API ключ не указан — live AI будет недоступен до настройки провайдера."
              : "API ключ не указан — AI будет работать в mock mode. Вы можете добавить ключ позже в настройках."}
          </p>
        </div>
      )}

      {data.apiKey && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
            <Check className="w-4 h-4" />
            API ключ добавлен — AI готов к работе!
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import { Check, ArrowRight, Bot, LayoutDashboard, MessageSquare } from "lucide-react";
import type { OnboardingData } from "../wizard";

interface ReadyStepProps {
  data: OnboardingData;
  isProductionLaunch: boolean;
}

export function ReadyStep({ data, isProductionLaunch }: ReadyStepProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
      <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
        <Check className="w-10 h-10 text-white" />
      </div>

      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        Всё готово! 🎉
      </h2>
      <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
        CEOClaw настроен и готов к работе
      </p>

      {/* Summary */}
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-6 mb-8 text-left">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
          Ваша конфигурация:
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Режим работы
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {isProductionLaunch || data.mode === "production"
                ? "Production"
                : "Demo (локально)"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              AI Провайдер
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {data.aiProvider === "openrouter"
                ? "OpenRouter"
                : data.aiProvider === "zai"
                ? "ZAI"
                : data.aiProvider === "openai"
                ? "OpenAI"
                : isProductionLaunch
                ? "Live provider required"
                : "Mock Mode"}
            </span>
          </div>
          {data.apiKey && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                API Ключ
              </span>
              <span className="text-sm font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                <Check className="w-4 h-4" />
                Добавлен
              </span>
            </div>
          )}
          {isProductionLaunch && !data.apiKey && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                API Ключ
              </span>
              <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Требуется для live AI
              </span>
            </div>
          )}
        </div>
      </div>

      {/* What's Next */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <LayoutDashboard className="w-8 h-8 text-blue-500 mx-auto mb-2" />
          <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
            Dashboard
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Обзор проектов
          </div>
        </div>

        <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
          <MessageSquare className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
          <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
            AI Chat
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Голос + текст
          </div>
        </div>

        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl">
          <Bot className="w-8 h-8 text-purple-500 mx-auto mb-2" />
          <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
            AI Skills
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Автоматизация
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Нажмите <strong>Начать работу</strong> чтобы открыть dashboard
      </p>
    </div>
  );
}

"use client";

import { Zap, Server, Check } from "lucide-react";
import type { OnboardingData } from "../wizard";

interface ModeStepProps {
  data: OnboardingData;
  isProductionLaunch: boolean;
  updateData: (updates: Partial<OnboardingData>) => void;
}

export function ModeStep({ data, isProductionLaunch, updateData }: ModeStepProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Выберите режим работы
      </h2>
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        {isProductionLaunch
          ? "Production launch принимает только живой режим. Demo/mock отключены для production-onboarding."
          : "Demo mode подходит для быстрого старта. Production — для постоянного использования."}
      </p>

      <div className="space-y-4">
        {!isProductionLaunch ? (
          <button
            onClick={() => updateData({ mode: "demo" })}
            className={`w-full p-6 rounded-xl border-2 text-left transition-all ${
              data.mode === "demo"
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Demo Mode
                  </h3>
                  {data.mode === "demo" && (
                    <Check className="w-5 h-5 text-blue-500" />
                  )}
                  <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium rounded-full">
                    Рекомендуется
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                  Быстрый старт без настройки базы данных
                </p>
                <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  <li>✓ Работает сразу</li>
                  <li>✓ Mock данные</li>
                  <li>✓ Без авторизации</li>
                  <li>✓ Данные в памяти</li>
                </ul>
              </div>
            </div>
          </button>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
            Demo mode отключён для production launch. Этот onboarding ведёт только в live setup.
          </div>
        )}

        {/* Production Mode */}
        <button
          onClick={() => updateData({ mode: "production" })}
          className={`w-full p-6 rounded-xl border-2 text-left transition-all ${
            data.mode === "production"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
          }`}
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Server className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Production Mode
                </h3>
                {data.mode === "production" && (
                  <Check className="w-5 h-5 text-blue-500" />
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                Полноценная система с базой данных и авторизацией
              </p>
              <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <li>✓ PostgreSQL база данных</li>
                <li>✓ NextAuth авторизация</li>
                <li>✓ Persistence данных</li>
                <li>✓ Multi-user support</li>
              </ul>
            </div>
          </div>
        </button>
      </div>

      {data.mode === "production" && (
        <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Примечание:</strong> Production mode требует настройки PostgreSQL базы данных. 
            Вы можете сделать это позже в настройках.
          </p>
        </div>
      )}
    </div>
  );
}

import { Rocket } from "lucide-react";

import { Progress } from "@/components/ui/progress";

import type { OnboardingWizardHeaderProps } from "@/components/onboarding/onboarding-wizard.types";

export function OnboardingWizardHeader({
  currentStep,
  progress,
  steps,
  stepComplete,
  onStepSelect,
}: OnboardingWizardHeaderProps) {
  return (
    <header className="border-b border-[var(--line)]/70 bg-[color:rgba(255,255,255,0.55)] backdrop-blur supports-[backdrop-filter]:bg-[color:rgba(255,255,255,0.45)] dark:bg-[color:rgba(10,12,16,0.48)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
              <Rocket className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                CEOClaw Onboarding
              </h1>
              <p className="text-sm text-[var(--ink-muted)]">
                Быстрый старт: роль → шаблон → задачи → бюджет → AI.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-panel)] px-3 py-2 text-sm text-[var(--ink-muted)] shadow-sm">
            <span>
              Шаг {currentStep + 1} / {steps.length}
            </span>
            <span aria-hidden="true">•</span>
            <span>{steps[currentStep]?.title}</span>
          </div>
        </div>

        <Progress className="h-2" value={progress} />

        <div className="grid grid-cols-5 gap-2 sm:gap-3">
          {steps.map((step, index) => {
            const active = index === currentStep;
            const done =
              index < currentStep || (index === currentStep && stepComplete[index]);

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => onStepSelect(index)}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                  active
                    ? "border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/30"
                    : done
                      ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                      : "border-[var(--line)] bg-[var(--surface-panel)] hover:border-blue-300"
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                    active
                      ? "bg-blue-600 text-white"
                      : done
                        ? "bg-emerald-600 text-white"
                        : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                  }`}
                >
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ink)]">
                    {step.title}
                  </div>
                  <div className="text-xs text-[var(--ink-muted)]">
                    {active ? "Текущий этап" : done ? "Готово" : "Следующий"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}

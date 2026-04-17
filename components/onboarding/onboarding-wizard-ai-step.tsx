"use client";

import {
  CheckCircle2,
  MessageSquareText,
  WandSparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getRoleLabel } from "@/lib/onboarding";

import type { OnboardingWizardStepPanelProps } from "@/components/onboarding/onboarding-wizard.types";

export function OnboardingWizardAiStep({
  draft,
  hasAiAnswer,
  onUpdateDraft,
  template,
}: OnboardingWizardStepPanelProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="ai-question" className="text-sm font-medium leading-none">
            Вопрос к AI
          </label>
          <textarea
            id="ai-question"
            value={draft.aiQuestion}
            onChange={(event) =>
              onUpdateDraft({
                aiQuestion: event.target.value,
                aiAnswer: undefined,
              })
            }
            rows={5}
            className="min-h-32 w-full rounded-2xl border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-blue-500"
            placeholder="Что нам важно контролировать в первую очередь и какие 3 шага помогут стартовать без риска?"
          />
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--ink-muted)]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={draft.createdProjectId ? "success" : "neutral"}
              className="gap-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {draft.createdProjectId ? "Workspace создан" : "Workspace ещё не создан"}
            </Badge>
            <Badge variant={hasAiAnswer ? "success" : "neutral"}>
              {hasAiAnswer ? "Ответ готов" : "Ответ ожидается"}
            </Badge>
          </div>
          <p className="mt-3 leading-relaxed">
            AI получит контекст роли, шаблона, задач, бюджета и вопрос пользователя.
            Если workspace ещё не создан, CEOClaw создаст team → project → tasks
            автоматически.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {draft.aiAnswer ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-100">
              <MessageSquareText className="h-4 w-4" />
              Ответ AI
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-emerald-900 dark:text-emerald-50">
              {draft.aiAnswer}
            </p>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[var(--line)] bg-[var(--surface-muted)]/40 p-4 text-sm text-[var(--ink-muted)]">
            После генерации ответ появится здесь. Можно вернуться и скорректировать
            вопрос до завершения onboarding.
          </div>
        )}

        <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--ink-muted)]">
          <div className="flex items-center gap-2 text-[var(--ink)]">
            <WandSparkles className="h-4 w-4 text-blue-600" />
            Что отправим в AI prompt
          </div>
          <ul className="mt-3 space-y-2">
            <li>• Роль: {getRoleLabel(draft.role)}</li>
            <li>• Шаблон: {template.label}</li>
            <li>• Задач: {draft.tasks.length}</li>
            <li>
              • Бюджет: {draft.plannedBudget.toLocaleString("ru-RU")} {draft.currency}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

"use client";

import { ClipboardList, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OnboardingDraft } from "@/lib/onboarding";

import type { OnboardingWizardStepPanelProps } from "@/components/onboarding/onboarding-wizard.types";

const MIN_TASKS = 2;
const MAX_TASKS = 3;

export function OnboardingWizardTasksStep({
  draft,
  taskCount,
  onUpdateTask,
  onAddTask,
  onRemoveTask,
}: OnboardingWizardStepPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-[var(--ink-muted)]">
          Настройте список стартовых задач: сейчас{" "}
          <span className="font-medium text-[var(--ink)]">{taskCount}</span>.
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddTask}
          disabled={taskCount >= MAX_TASKS}
        >
          <Plus className="h-4 w-4" />
          Добавить задачу
        </Button>
      </div>

      <div className="space-y-3">
        {draft.tasks.map((task, index) => (
          <div
            key={`${task.title}-${index}`}
            className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink-muted)]">
                <ClipboardList className="h-4 w-4" />
                Задача {index + 1}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemoveTask(index)}
                disabled={draft.tasks.length <= MIN_TASKS}
              >
                <Trash2 className="h-4 w-4" />
                Удалить
              </Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]">
              <div className="space-y-2">
                <Label htmlFor={`task-title-${index}`}>Название</Label>
                <Input
                  id={`task-title-${index}`}
                  value={task.title}
                  onChange={(event) =>
                    onUpdateTask(index, { title: event.target.value })
                  }
                  placeholder="Например: Зафиксировать scope релиза"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`task-due-${index}`}>Срок, дней</Label>
                <Input
                  id={`task-due-${index}`}
                  type="number"
                  min={1}
                  max={30}
                  value={task.dueInDays}
                  onChange={(event) =>
                    onUpdateTask(index, {
                      dueInDays: Math.min(
                        30,
                        Math.max(1, Number(event.target.value || 0))
                      ),
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`task-priority-${index}`}>Приоритет</Label>
                <select
                  id={`task-priority-${index}`}
                  value={task.priority}
                  onChange={(event) =>
                    onUpdateTask(index, {
                      priority:
                        event.target
                          .value as OnboardingDraft["tasks"][number]["priority"],
                    })
                  }
                  className="h-10 w-full rounded-lg border border-[var(--line)] bg-transparent px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-blue-500"
                >
                  <option value="low">Низкий</option>
                  <option value="medium">Средний</option>
                  <option value="high">Высокий</option>
                  <option value="critical">Критичный</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-muted)]/40 p-4 text-sm text-[var(--ink-muted)]">
        AI предложит ответ уже на основе этих 2–3 задач. Задачи можно менять до
        финального шага.
      </div>
    </div>
  );
}

export function OnboardingWizardBudgetStep({
  draft,
  budgetDelta,
  onUpdateDraft,
}: OnboardingWizardStepPanelProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="project-name">Название проекта</Label>
          <Input
            id="project-name"
            value={draft.projectName}
            onChange={(event) => onUpdateDraft({ projectName: event.target.value })}
            placeholder="Например: Release 2.4 — Customer Portal"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-description">Описание</Label>
          <textarea
            id="project-description"
            value={draft.projectDescription}
            onChange={(event) =>
              onUpdateDraft({ projectDescription: event.target.value })
            }
            rows={5}
            className="min-h-28 w-full rounded-2xl border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-blue-500"
            placeholder="Коротко опишите цель проекта и результат"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="start-date">Дата старта</Label>
            <Input
              id="start-date"
              type="date"
              value={draft.startDate.slice(0, 10)}
              onChange={(event) => onUpdateDraft({ startDate: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="end-date">Дата завершения</Label>
            <Input
              id="end-date"
              type="date"
              value={draft.endDate.slice(0, 10)}
              onChange={(event) => onUpdateDraft({ endDate: event.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="planned-budget">Плановый бюджет</Label>
            <Input
              id="planned-budget"
              type="number"
              min={0}
              step={1000}
              value={draft.plannedBudget}
              onChange={(event) =>
                onUpdateDraft({ plannedBudget: Number(event.target.value || 0) })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="actual-budget">Фактический бюджет</Label>
            <Input
              id="actual-budget"
              type="number"
              min={0}
              step={1000}
              value={draft.actualBudget}
              onChange={(event) =>
                onUpdateDraft({ actualBudget: Number(event.target.value || 0) })
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4">
          <div className="flex items-center justify-between text-sm text-[var(--ink-muted)]">
            <span>Бюджетный разрыв</span>
            <span className={budgetDelta >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {budgetDelta >= 0 ? "+" : ""}
              {budgetDelta.toLocaleString("ru-RU")} {draft.currency}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-[var(--ink-muted)]">
            <span>Срок</span>
            <span>
              {draft.startDate} → {draft.endDate}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

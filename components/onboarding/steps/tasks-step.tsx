"use client";

import type { Dispatch, SetStateAction } from "react";

import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OnboardingDraft, OnboardingTaskDraft } from "@/lib/onboarding";

interface TasksStepProps {
  draft: OnboardingDraft;
  onChange: Dispatch<SetStateAction<OnboardingDraft>>;
  disabled?: boolean;
}

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

function createEmptyTask(index: number): OnboardingTaskDraft {
  return {
    title: `Новая задача ${index + 1}`,
    priority: "medium",
    dueInDays: 3 + index * 2,
  };
}

export function TasksStep({ draft, onChange, disabled = false }: TasksStepProps) {
  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
      <CardHeader className="space-y-2">
        <Badge variant="info">Шаг 3 из 5</Badge>
        <CardTitle className="text-2xl tracking-[-0.06em]">Добавьте 2–3 стартовые задачи</CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
          Небольшой набор задач помогает AI сразу видеть, что нужно делать в ближайшие дни и кто
          в команде может это подхватить.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4">
          {draft.tasks.map((task, index) => (
            <Card key={`${task.title}-${index}`} className="border-[color:var(--line)] bg-[var(--panel-soft)]">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg tracking-[-0.04em]">Задача {index + 1}</CardTitle>
                  <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                    Порог: 2–3 задачи, без лишней бюрократии.
                  </CardDescription>
                </div>
                {draft.tasks.length > 2 ? (
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      onChange((current) => ({
                        ...current,
                        tasks: current.tasks.filter((_, taskIndex) => taskIndex !== index),
                        aiAnswer: undefined,
                      }))
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </CardHeader>

              <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_170px_150px]">
                <div className="space-y-2">
                  <Label htmlFor={`task-${index}-title`}>Название</Label>
                  <Input
                    disabled={disabled}
                    id={`task-${index}-title`}
                    onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      tasks: current.tasks.map((item, taskIndex) =>
                          taskIndex === index ? { ...item, title: event.target.value } : item
                      ),
                      aiAnswer: undefined,
                    }))
                    }
                    placeholder="Собрать статус по блоку"
                    value={task.title}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`task-${index}-priority`}>Приоритет</Label>
                  <Select
                    disabled={disabled}
                    onValueChange={(value) =>
                      onChange((current) => ({
                        ...current,
                        tasks: current.tasks.map((item, taskIndex) =>
                          taskIndex === index
                            ? { ...item, priority: value as OnboardingTaskDraft["priority"] }
                            : item
                        ),
                        aiAnswer: undefined,
                      }))
                    }
                    value={task.priority}
                  >
                    <SelectTrigger id={`task-${index}-priority`}>
                      <SelectValue placeholder="Приоритет" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`task-${index}-due`}>Срок, дней</Label>
                  <Input
                    disabled={disabled}
                    id={`task-${index}-due`}
                    min={1}
                    onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      tasks: current.tasks.map((item, taskIndex) =>
                          taskIndex === index
                            ? { ...item, dueInDays: Math.max(1, Number(event.target.value) || 1) }
                            : item
                        ),
                      aiAnswer: undefined,
                    }))
                    }
                    type="number"
                    value={task.dueInDays}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={disabled || draft.tasks.length >= 3}
            onClick={() =>
              onChange((current) => ({
                ...current,
                tasks: [...current.tasks, createEmptyTask(current.tasks.length)],
                aiAnswer: undefined,
              }))
            }
            type="button"
            variant="secondary"
          >
            <Plus className="h-4 w-4" />
            Добавить задачу
          </Button>
          <p className="text-sm text-[var(--ink-soft)]">Оставьте 2–3 задачи, чтобы не перегрузить первый запуск.</p>
        </div>
      </CardContent>
    </Card>
  );
}

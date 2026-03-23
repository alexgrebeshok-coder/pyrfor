"use client";

import type { Dispatch, SetStateAction } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  formatOnboardingCurrency,
  getTemplateById,
  type OnboardingCurrency,
  type OnboardingDraft,
} from "@/lib/onboarding";

interface BudgetStepProps {
  draft: OnboardingDraft;
  onChange: Dispatch<SetStateAction<OnboardingDraft>>;
  disabled?: boolean;
}

const CURRENCY_OPTIONS: Array<{ value: OnboardingCurrency; label: string }> = [
  { value: "RUB", label: "RUB" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
];

export function BudgetStep({ draft, onChange, disabled = false }: BudgetStepProps) {
  const template = getTemplateById(draft.templateId);
  const variance = draft.plannedBudget - draft.actualBudget;
  const variancePercent = draft.plannedBudget > 0 ? (variance / draft.plannedBudget) * 100 : 0;
  const durationDays = Math.max(
    1,
    Math.round((new Date(draft.endDate).getTime() - new Date(draft.startDate).getTime()) / 86_400_000)
  );

  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
      <CardHeader className="space-y-2">
        <Badge variant="info">Шаг 4 из 5</Badge>
        <CardTitle className="text-2xl tracking-[-0.06em]">Настройте бюджет и сроки</CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
          План-факт и срок проекта нужны AI с первого дня. Даже короткий cockpit должен говорить
          про деньги и дедлайны.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="planned-budget">Плановый бюджет</Label>
            <Input
              disabled={disabled}
              id="planned-budget"
              min={0}
              onChange={(event) =>
              onChange((current) => ({
                  ...current,
                  plannedBudget: Math.max(0, Number(event.target.value) || 0),
                  aiAnswer: undefined,
                }))
              }
              type="number"
              value={draft.plannedBudget}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="actual-budget">Факт / уже потрачено</Label>
            <Input
              disabled={disabled}
              id="actual-budget"
              min={0}
              onChange={(event) =>
              onChange((current) => ({
                  ...current,
                  actualBudget: Math.max(0, Number(event.target.value) || 0),
                  aiAnswer: undefined,
                }))
              }
              type="number"
              value={draft.actualBudget}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Валюта</Label>
            <Select
              disabled={disabled}
              onValueChange={(value) =>
                onChange((current) => ({
                  ...current,
                  currency: value as OnboardingCurrency,
                  aiAnswer: undefined,
                }))
              }
              value={draft.currency}
            >
              <SelectTrigger id="currency">
                <SelectValue placeholder="Валюта" />
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-start">Дата старта</Label>
            <Input
              disabled={disabled}
              id="project-start"
              onChange={(event) =>
              onChange((current) => ({
                  ...current,
                  startDate: event.target.value,
                  aiAnswer: undefined,
                }))
              }
              type="date"
              value={draft.startDate}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="project-end">Дата окончания</Label>
            <Input
              disabled={disabled}
              id="project-end"
              onChange={(event) =>
              onChange((current) => ({
                  ...current,
                  endDate: event.target.value,
                  aiAnswer: undefined,
                }))
              }
              type="date"
              value={draft.endDate}
            />
          </div>
        </div>

        <Card className="border-[color:var(--line)] bg-[var(--panel-soft)]">
          <CardHeader className="space-y-2">
            <CardTitle className="text-lg tracking-[-0.04em]">Быстрый финансовый свод</CardTitle>
            <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
              {template.label} обычно требует короткого план-факт обзора уже в первый день.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--ink-soft)]">
            <div className="flex items-center justify-between gap-3">
              <span>План</span>
              <span className="font-medium text-[var(--ink)]">
                {formatOnboardingCurrency(draft.plannedBudget, draft.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Факт</span>
              <span className="font-medium text-[var(--ink)]">
                {formatOnboardingCurrency(draft.actualBudget, draft.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Отклонение</span>
              <span
                className={cn(
                  "font-medium",
                  variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                )}
              >
                {formatOnboardingCurrency(variance, draft.currency)} ({variancePercent.toFixed(1)}%)
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Длительность</span>
              <span className="font-medium text-[var(--ink)]">{durationDays} дн.</span>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}

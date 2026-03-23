"use client";

import type { Dispatch, SetStateAction } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getOnboardingRoleSummary,
  getRoleOptions,
  type OnboardingDraft,
  type OnboardingRole,
} from "@/lib/onboarding";

interface RoleStepProps {
  role: OnboardingRole;
  onChange: Dispatch<SetStateAction<OnboardingDraft>>;
  disabled?: boolean;
}

export function RoleStep({ role, onChange, disabled = false }: RoleStepProps) {
  const roleOptions = getRoleOptions();

  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
      <CardHeader className="space-y-2">
        <Badge variant="info">Шаг 1 из 5</Badge>
        <CardTitle className="text-2xl tracking-[-0.06em]">Кто будет работать в CEOClaw?</CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
          Выберите роль, чтобы мы сразу подстроили тон, сценарии и первый рабочий набор под вашу
          задачу.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roleOptions.map((option) => {
          const isSelected = option.value === role;

          return (
            <button
              aria-pressed={isSelected}
              className={cn(
                "rounded-2xl border p-4 text-left transition-all duration-150",
                isSelected
                  ? "border-[var(--brand)] bg-[var(--brand)]/6 shadow-sm"
                  : "border-[var(--line)] bg-[var(--panel-soft)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel-strong)]",
                disabled && "cursor-not-allowed opacity-60"
              )}
              disabled={disabled}
              key={option.value}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  role: option.value,
                  aiAnswer: undefined,
                }))
              }
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[var(--ink)]">{option.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{option.description}</p>
                </div>
                {isSelected ? <Badge variant="info">Выбрано</Badge> : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
                <span className="rounded-full bg-white/70 px-2.5 py-1 dark:bg-black/10">
                  {getOnboardingRoleSummary(option.value)}
                </span>
                <span className="rounded-full bg-white/70 px-2.5 py-1 dark:bg-black/10">
                  {option.value}
                </span>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

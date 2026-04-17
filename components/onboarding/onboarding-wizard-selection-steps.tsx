"use client";

import { Badge } from "@/components/ui/badge";
import { ONBOARDING_TEMPLATES, getRoleLabel } from "@/lib/onboarding";

import type { OnboardingWizardStepPanelProps } from "@/components/onboarding/onboarding-wizard.types";

export function OnboardingWizardRoleStep({
  draft,
  roleOptions,
  onSelectRole,
}: OnboardingWizardStepPanelProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {roleOptions.map((roleOption) => {
        const selected = draft.role === roleOption.value;

        return (
          <button
            key={roleOption.value}
            type="button"
            onClick={() => onSelectRole(roleOption.value)}
            className={`rounded-2xl border p-4 text-left transition-all ${
              selected
                ? "border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/30"
                : "border-[var(--line)] bg-[var(--surface-panel)] hover:border-blue-300"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-base font-semibold text-[var(--ink)]">
                  {roleOption.label}
                </div>
                <div className="mt-1 text-sm text-[var(--ink-muted)]">
                  {roleOption.description}
                </div>
              </div>
              <Badge variant={selected ? "success" : "neutral"}>
                {selected ? "Выбрано" : getRoleLabel(roleOption.value)}
              </Badge>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function OnboardingWizardTemplateStep({
  draft,
  onSelectTemplate,
}: OnboardingWizardStepPanelProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {ONBOARDING_TEMPLATES.map((templateOption) => {
        const selected = draft.templateId === templateOption.id;

        return (
          <button
            key={templateOption.id}
            type="button"
            onClick={() => onSelectTemplate(templateOption.id)}
            className={`rounded-2xl border p-4 text-left transition-all ${
              selected
                ? "border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/30"
                : "border-[var(--line)] bg-[var(--surface-panel)] hover:border-blue-300"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{templateOption.label}</div>
                <div className="mt-1 text-sm text-[var(--ink-muted)]">
                  {templateOption.summary}
                </div>
              </div>
              <Badge variant={selected ? "success" : "neutral"}>
                {selected ? "Активен" : templateOption.direction}
              </Badge>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-[var(--ink-muted)] sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--surface-muted)]/60 px-3 py-2">
                <div className="text-xs uppercase tracking-wide">Бюджет</div>
                <div className="font-medium text-[var(--ink)]">
                  {templateOption.plannedBudget.toLocaleString("ru-RU")}{" "}
                  {templateOption.currency}
                </div>
              </div>
              <div className="rounded-xl bg-[var(--surface-muted)]/60 px-3 py-2">
                <div className="text-xs uppercase tracking-wide">Срок</div>
                <div className="font-medium text-[var(--ink)]">
                  {templateOption.durationDays} дней
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

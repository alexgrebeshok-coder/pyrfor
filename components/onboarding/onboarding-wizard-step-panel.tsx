"use client";

import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OnboardingWizardAiStep } from "@/components/onboarding/onboarding-wizard-ai-step";
import {
  OnboardingWizardRoleStep,
  OnboardingWizardTemplateStep,
} from "@/components/onboarding/onboarding-wizard-selection-steps";
import {
  OnboardingWizardBudgetStep,
  OnboardingWizardTasksStep,
} from "@/components/onboarding/onboarding-wizard-task-budget-steps";

import type { OnboardingWizardStepPanelProps } from "@/components/onboarding/onboarding-wizard.types";

const STEP_DESCRIPTIONS = [
  "Выберите управленческую роль для будущего workspace.",
  "Подберите проектный шаблон — он задаст направление, бюджет и сроки.",
  "Соберите 2–3 стартовые задачи, чтобы команда начала с ясным планом.",
  "Уточните бюджет и timeline — эти данные попадут в проект сразу.",
  "Сформулируйте вопрос к AI и получите ответ с учетом выбранного контекста.",
] as const;

export function OnboardingWizardStepPanel(
  props: OnboardingWizardStepPanelProps
) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-[var(--line)]/70 bg-[var(--surface-muted)]/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{props.steps[props.currentStep]?.title}</CardTitle>
            <CardDescription>{STEP_DESCRIPTIONS[props.currentStep]}</CardDescription>
          </div>
          <Badge variant="info" className="gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            Lite onboarding
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {props.error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {props.error}
          </div>
        )}

        {props.warning && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            {props.warning}
          </div>
        )}

        {props.currentStep === 0 && <OnboardingWizardRoleStep {...props} />}
        {props.currentStep === 1 && <OnboardingWizardTemplateStep {...props} />}
        {props.currentStep === 2 && <OnboardingWizardTasksStep {...props} />}
        {props.currentStep === 3 && <OnboardingWizardBudgetStep {...props} />}
        {props.currentStep === 4 && <OnboardingWizardAiStep {...props} />}
      </CardContent>
    </Card>
  );
}

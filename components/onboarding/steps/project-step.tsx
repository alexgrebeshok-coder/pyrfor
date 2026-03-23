"use client";

import type { Dispatch, SetStateAction } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  applyOnboardingTemplate,
  formatOnboardingCurrency,
  getTemplateById,
  ONBOARDING_TEMPLATES,
  type OnboardingDraft,
} from "@/lib/onboarding";

interface ProjectStepProps {
  draft: OnboardingDraft;
  onChange: Dispatch<SetStateAction<OnboardingDraft>>;
  disabled?: boolean;
}

export function ProjectStep({ draft, onChange, disabled = false }: ProjectStepProps) {
  const selectedTemplate = getTemplateById(draft.templateId);

  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
      <CardHeader className="space-y-2">
        <Badge variant="info">Шаг 2 из 5</Badge>
        <CardTitle className="text-2xl tracking-[-0.06em]">Выберите шаблон первого проекта</CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
          Шаблон задаёт направление, типичные риски и стартовые задачи. Это ускоряет запуск и
          делает первый AI-ответ сразу полезным.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ONBOARDING_TEMPLATES.map((template) => {
            const isSelected = template.id === draft.templateId;

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
                key={template.id}
                onClick={() => onChange((current) => applyOnboardingTemplate(current, template.id))}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--ink)]">{template.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{template.summary}</p>
                  </div>
                  {isSelected ? <Badge variant="info">Выбрано</Badge> : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
                  <span className="rounded-full bg-white/70 px-2.5 py-1 dark:bg-black/10">
                    {formatOnboardingCurrency(template.plannedBudget, template.currency)}
                  </span>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 dark:bg-black/10">
                    {template.durationDays} дн.
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Название проекта</Label>
                <Input
                  id="project-name"
                  disabled={disabled}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      projectName: event.target.value,
                      aiAnswer: undefined,
                    }))
                  }
                placeholder={selectedTemplate.defaultProjectName}
                value={draft.projectName}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">Короткое описание</Label>
                <Textarea
                  id="project-description"
                  disabled={disabled}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      projectDescription: event.target.value,
                      aiAnswer: undefined,
                    }))
                  }
                placeholder={selectedTemplate.defaultProjectDescription}
                rows={5}
                value={draft.projectDescription}
              />
            </div>
          </div>

          <Card className="border-[color:var(--line)] bg-[var(--panel-soft)]">
            <CardHeader className="space-y-2">
              <CardTitle className="text-lg tracking-[-0.04em]">Что попадёт в первый workspace</CardTitle>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                Шаблон уже подставляет направление, локацию и риск, чтобы dashboard не был пустым.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-[var(--ink-soft)]">
              <div className="flex items-center justify-between gap-3">
                <span>Направление</span>
                <span className="font-medium text-[var(--ink)]">{selectedTemplate.direction}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Локация</span>
                <span className="font-medium text-[var(--ink)]">{selectedTemplate.location}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Фокус AI</span>
                <span className="max-w-[60%] text-right font-medium text-[var(--ink)]">
                  {selectedTemplate.aiFocus}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Ключевой риск</span>
                <span className="max-w-[60%] text-right font-medium text-[var(--ink)]">
                  {selectedTemplate.riskTitle}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

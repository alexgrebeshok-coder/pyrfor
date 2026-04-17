import {
  CheckCircle2,
  ClipboardList,
  MessageSquareText,
  Rocket,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getRoleLabel } from "@/lib/onboarding";

import type { OnboardingWizardSidebarProps } from "@/components/onboarding/onboarding-wizard.types";

export function OnboardingWizardSidebar({
  draft,
  dashboardPreview,
  template,
}: OnboardingWizardSidebarProps) {
  return (
    <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <CardDescription>
            Локальная DashboardState-подсказка на основе текущего draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm text-[var(--ink-muted)]">Роль</div>
                <div className="font-semibold">{getRoleLabel(draft.role)}</div>
              </div>
              <Badge variant="info">{template.label}</Badge>
            </div>

            <Separator className="my-4" />

            <div className="space-y-2 text-sm text-[var(--ink-muted)]">
              <div className="flex items-center justify-between gap-3">
                <span>Проект</span>
                <span className="font-medium text-[var(--ink)]">
                  {draft.projectName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Бюджет</span>
                <span className="font-medium text-[var(--ink)]">
                  {draft.plannedBudget.toLocaleString("ru-RU")} {draft.currency}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Срок</span>
                <span className="font-medium text-[var(--ink)]">
                  {draft.startDate} → {draft.endDate}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>AI вопрос</span>
                <span className="ml-4 max-w-[180px] text-right font-medium text-[var(--ink)]">
                  {draft.aiQuestion || "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
              <Users className="h-4 w-4 text-blue-600" />
              Команда
            </div>
            <div className="mt-3 space-y-2">
              {dashboardPreview.team.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--ink)]">
                      {member.name}
                    </div>
                    <div className="truncate text-[var(--ink-muted)]">
                      {member.role}
                    </div>
                  </div>
                  <Badge variant="neutral">{member.capacity}%</Badge>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-panel)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
              <ClipboardList className="h-4 w-4 text-blue-600" />
              Задачи
            </div>
            <div className="mt-3 space-y-2">
              {dashboardPreview.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--ink)]">
                      {task.title}
                    </div>
                    <div className="truncate text-[var(--ink-muted)]">
                      {task.assignee?.name ?? "Без исполнителя"}
                    </div>
                  </div>
                  <Badge variant="neutral">{task.priority}</Badge>
                </div>
              ))}
            </div>
          </div>

          {draft.createdProjectId && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-50">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Workspace уже создан
              </div>
              <p className="mt-2 leading-relaxed">
                Project ID:{" "}
                <span className="font-mono text-xs">{draft.createdProjectId}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Что произойдёт дальше</CardTitle>
          <CardDescription>
            Пошагово создаём рабочее пространство из выбранного draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--ink-muted)]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <div className="font-medium text-[var(--ink)]">Team members</div>
              <p>Создаем несколько участников команды через /api/team.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Rocket className="h-4 w-4" />
            </div>
            <div>
              <div className="font-medium text-[var(--ink)]">Project</div>
              <p>Собираем project payload и подставляем созданные teamIds.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div>
              <div className="font-medium text-[var(--ink)]">Starter tasks</div>
              <p>
                Создаем 2–3 стартовые задачи с assigneeIds, если участники доступны.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div>
              <div className="font-medium text-[var(--ink)]">AI answer</div>
              <p>
                Отправляем prompt в /api/ai/chat с projectId, если он уже создан.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}

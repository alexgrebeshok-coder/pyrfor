"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea, fieldStyles } from "@/components/ui/field";
import { VoiceFillButton } from "@/components/work-reports/voice-fill-button";
import type {
  WorkReportMemberOption,
  WorkReportProjectOption,
} from "@/lib/work-reports/types";

export function ReportBuilderForm({
  members,
  projects,
}: {
  members: WorkReportMemberOption[];
  projects: WorkReportProjectOption[];
}) {
  const router = useRouter();
  const { accessProfile, allowed: canCreateReport } = usePlatformPermission(
    "CREATE_WORK_REPORTS",
    "delivery"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      projectId: String(formData.get("projectId") ?? ""),
      authorId: String(formData.get("authorId") ?? ""),
      section: String(formData.get("section") ?? ""),
      reportDate: String(formData.get("reportDate") ?? ""),
      workDescription: String(formData.get("workDescription") ?? ""),
      personnelCount: formData.get("personnelCount")
        ? Number(formData.get("personnelCount"))
        : undefined,
      issues: String(formData.get("issues") ?? ""),
      nextDayPlan: String(formData.get("nextDayPlan") ?? ""),
    };

    try {
      const response = await fetch("/api/work-reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | { reportNumber?: string }
        | { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(
          "error" in data && data.error?.message
            ? data.error.message
            : "Не удалось создать отчёт."
        );
      }

      setMessage(
        `Отчёт ${"reportNumber" in data && data.reportNumber ? data.reportNumber : ""} создан и отправлен на review.`
      );
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Не удалось создать отчёт."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const disabled = projects.length === 0 || members.length === 0 || isSubmitting;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Новый полевой отчёт</CardTitle>
        <CardDescription>
          Минимальный create-flow уже подключён к живому backend: проект, автор, смена и факт выполненных работ.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!canCreateReport ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Роль {accessProfile.role} может читать отчёты, но не может создавать новые записи в
            delivery workspace.
          </div>
        ) : null}

        {projects.length === 0 || members.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Для создания отчёта нужны проекты и участники команды в базе.
          </div>
        ) : null}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-[var(--ink)]">Проект</span>
            <select
              className={fieldStyles}
              defaultValue={projects[0]?.id}
              disabled={!canCreateReport}
              name="projectId"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="font-medium text-[var(--ink)]">Автор отчёта</span>
            <select
              className={fieldStyles}
              defaultValue={members[0]?.id}
              disabled={!canCreateReport}
              name="authorId"
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.role ? ` · ${member.role}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-[var(--ink)]">Участок / секция</span>
              <Input defaultValue="Секция А" disabled={!canCreateReport} name="section" />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-[var(--ink)]">Дата смены</span>
              <Input defaultValue={today} disabled={!canCreateReport} name="reportDate" type="date" />
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--ink)]">Что выполнено</span>
              <VoiceFillButton
                targetName="workDescription"
                prompt="Полевой отчёт строительной бригады. Что выполнено за смену."
              />
            </span>
            <Textarea
              defaultValue="Кратко опишите выполненные работы, прогресс и факт по участку."
              disabled={!canCreateReport}
              name="workDescription"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-[var(--ink)]">Людей на смене</span>
              <Input
                defaultValue="8"
                disabled={!canCreateReport}
                min={0}
                name="personnelCount"
                type="number"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-[var(--ink)]">План на следующий день</span>
              <Input
                defaultValue="Продолжить работы на участке"
                disabled={!canCreateReport}
                name="nextDayPlan"
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--ink)]">Проблемы / блокеры</span>
              <VoiceFillButton
                targetName="issues"
                prompt="Полевой отчёт. Проблемы, блокеры, что мешало работе."
              />
            </span>
            <Textarea
              defaultValue=""
              disabled={!canCreateReport}
              name="issues"
              placeholder="Что мешало выполнению, чего не хватает, что нужно эскалировать."
            />
          </label>

          {message ? (
            <div className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button disabled={disabled || !canCreateReport} type="submit">
              {isSubmitting ? "Создание..." : "Создать отчёт"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

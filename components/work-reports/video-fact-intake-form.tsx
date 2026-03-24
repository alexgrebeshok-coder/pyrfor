"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea, fieldStyles } from "@/components/ui/field";
import type { WorkReportView } from "@/lib/work-reports/types";

const observationOptions = [
  { value: "progress_visible", label: "Progress visible" },
  { value: "blocked_area", label: "Blocked area" },
  { value: "idle_equipment", label: "Idle equipment" },
  { value: "safety_issue", label: "Safety issue" },
] as const;

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function VideoFactIntakeForm({
  reports,
}: {
  reports: WorkReportView[];
}) {
  const router = useRouter();
  const { accessProfile, allowed: canCreateFact } = usePlatformPermission(
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
      reportId: String(formData.get("reportId") ?? ""),
      title: String(formData.get("title") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      url: String(formData.get("url") ?? ""),
      capturedAt: String(formData.get("capturedAt") ?? ""),
      observationType: String(formData.get("observationType") ?? ""),
    };

    try {
      const response = await fetch("/api/work-reports/video-facts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | { title?: string; verificationStatus?: string }
        | { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(
          "error" in data && data.error?.message
            ? data.error.message
            : "Не удалось зарегистрировать video fact."
        );
      }

      setMessage(
        `Visual fact ${"title" in data && data.title ? `«${data.title}»` : ""} сохранён со статусом ${"verificationStatus" in data ? data.verificationStatus : "observed"}.`
      );
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Не удалось зарегистрировать video fact."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const disabled = reports.length === 0 || isSubmitting;
  const latestReport = reports[0];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Video fact intake</CardTitle>
        <CardDescription>
          Metadata-only visual evidence intake. Он сохраняет video reference и сразу проверяет, можно ли связать факт с approved work report того же дня.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!canCreateFact ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Роль {accessProfile.role} не может добавлять visual facts в delivery workspace.
          </div>
        ) : null}

        {reports.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Для visual evidence intake нужен хотя бы один полевой отчёт в базе.
          </div>
        ) : null}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-[var(--ink)]">Связанный work report</span>
            <select
              className={fieldStyles}
              defaultValue={latestReport?.id}
              disabled={!canCreateFact}
              name="reportId"
            >
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.reportNumber} · {report.project.name} · {report.section}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="font-medium text-[var(--ink)]">Тип наблюдения</span>
            <select
              className={fieldStyles}
              defaultValue="progress_visible"
              disabled={!canCreateFact}
              name="observationType"
            >
              {observationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="font-medium text-[var(--ink)]">Ссылка на видео</span>
            <Input
              defaultValue="https://example.com/evidence/site-shift-clip.mp4"
              disabled={!canCreateFact}
              name="url"
              placeholder="https://..."
              type="url"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-[var(--ink)]">Время съёмки</span>
              <Input
                defaultValue={
                  latestReport ? toDatetimeLocal(latestReport.reportDate) : toDatetimeLocal(new Date().toISOString())
                }
                disabled={!canCreateFact}
                name="capturedAt"
                type="datetime-local"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-[var(--ink)]">Название</span>
              <Input
                defaultValue=""
                disabled={!canCreateFact}
                name="title"
                placeholder="Опциональное название для оператора"
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="font-medium text-[var(--ink)]">Summary</span>
            <Textarea
              defaultValue=""
              disabled={!canCreateFact}
              name="summary"
              placeholder="Что видно на видео и почему это важно для delivery signal."
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
            <Button disabled={disabled || !canCreateFact} type="submit">
              {isSubmitting ? "Сохраняю..." : "Зафиксировать visual fact"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

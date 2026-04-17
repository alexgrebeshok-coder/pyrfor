"use client";

import { useEffect, useMemo, useState } from "react";

import { useDashboard } from "@/components/dashboard-provider";
import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea, fieldStyles } from "@/components/ui/field";
import { getProposalItemCount } from "@/lib/ai/action-engine";
import type { AIRunRecord } from "@/lib/ai/types";
import type { MeetingToActionPacket } from "@/lib/meetings/types";

import {
  expectedEndpoints,
  mapStatusLabel,
  mapStatusVariant,
} from "./meeting-to-action-page-helpers";

export function MeetingToActionPage() {
  const { projects } = useDashboard();
  const defaultProjectId = useMemo(
    () => projects.find((project) => project.status !== "completed")?.id ?? projects[0]?.id ?? "",
    [projects]
  );
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [title, setTitle] = useState("Weekly delivery sync");
  const [participants, setParticipants] = useState("PM, снабжение, стройконтроль");
  const [notes, setNotes] = useState(
    [
      "Подрядчик подтвердил задержку поставки металлоконструкций на 5 дней.",
      "Мария берет на себя обновление графика до пятницы.",
      "Нужно отдельно проверить резерв бюджета на зимний контур и влияние на следующий milestone.",
      "До среды команда должна закрыть вопрос по допуску техники на площадку.",
    ].join("\n")
  );
  const [packet, setPacket] = useState<MeetingToActionPacket | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingRunIds, setApplyingRunIds] = useState<string[]>([]);

  useEffect(() => {
    if (!projectId && defaultProjectId) {
      setProjectId(defaultProjectId);
    }
  }, [defaultProjectId, projectId]);

  useEffect(() => {
    if (!packet) return;

    const pendingRuns = packet.runs.filter(
      (entry) => entry.run.status === "queued" || entry.run.status === "running"
    );
    if (pendingRuns.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const nextRuns = await Promise.all(
          packet.runs.map(async (entry) => {
            if (entry.run.status !== "queued" && entry.run.status !== "running") {
              return entry;
            }

            const response = await fetch(entry.pollPath, { cache: "no-store" });
            if (!response.ok) {
              return entry;
            }

            const run = (await response.json()) as AIRunRecord;
            return {
              ...entry,
              run,
            };
          })
        );

        setPacket((current) =>
          current
            ? {
                ...current,
                runs: nextRuns,
              }
            : current
        );
      } catch {
        // Keep the last visible packet state and let the operator retry manually.
      }
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [packet]);

  const submitPacket = async () => {
    if (!projectId || notes.trim().length < 30) {
      setError("Выберите проект и вставьте заметки встречи минимум на 30 символов.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/meetings/to-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          title: title.trim() || undefined,
          participants: participants
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          notes,
          locale: "ru",
          interfaceLocale: "ru",
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось запустить meeting packet.");
      }

      setPacket(payload as MeetingToActionPacket);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Не удалось запустить meeting packet."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const applyProposal = async (runId: string, proposalId: string) => {
    setApplyingRunIds((current) => [...current, runId]);

    try {
      const response = await fetch(`/api/ai/runs/${runId}/proposals/${proposalId}/apply`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось применить proposal.");
      }

      const nextRun = payload as AIRunRecord;
      setPacket((current) =>
        current
          ? {
              ...current,
              runs: current.runs.map((entry) =>
                entry.run.id === runId
                  ? {
                      ...entry,
                      run: nextRun,
                    }
                  : entry
              ),
            }
          : current
      );
    } catch (applyError) {
      setError(
        applyError instanceof Error ? applyError.message : "Не удалось применить proposal."
      );
    } finally {
      setApplyingRunIds((current) => current.filter((item) => item !== runId));
    }
  };

  return (
    <div className="grid gap-4">
      <DomainPageHeader
        chips={[
          { label: "Пилотный поток", variant: "success" },
          { label: "Задачи + риски + статус", variant: "info" },
          { label: "Применять после проверки", variant: "warning" },
        ]}
        description="Вставьте заметки встречи, и CEOClaw запустит пакет запусков: задачи, добавление рисков и черновик статуса в одном проектном контексте."
        eyebrow="Разбор встречи"
        title="Встреча → действия"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <Card className="border-[var(--line)] bg-[var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Входящие заметки встречи</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Проект</span>
              <select
                className={fieldStyles}
                onChange={(event) => setProjectId(event.target.value)}
                value={projectId}
              >
                <option value="" disabled>
                  Выберите проект
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Название встречи</span>
              <Input
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Еженедельная синхронизация по поставкам"
                value={title}
              />
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Участники</span>
              <Input
                onChange={(event) => setParticipants(event.target.value)}
                placeholder="PM, снабжение, стройконтроль"
                value={participants}
              />
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Заметки встречи</span>
              <Textarea
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Вставьте протокол, краткое содержание звонка или рукописные заметки."
                value={notes}
              />
            </label>

            {error ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-100">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button disabled={isSubmitting || !projectId} onClick={submitPacket}>
                {isSubmitting ? "Запускаем пакет..." : "Запустить пакет встречи"}
              </Button>
              <Button
                disabled={isSubmitting}
                onClick={() => setPacket(null)}
                variant="outline"
              >
                Очистить результаты
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--line)] bg-[var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Заметки оператора</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm leading-7 text-[var(--ink-soft)]">
            <p>
              Этот pilot flow не пытается “понять всё”. Он раскладывает meeting notes в три
              управляемых пакета: задачи, риски и status draft.
            </p>
            <p>
              Каждый пакет идёт через текущий AI run/proposal engine, поэтому pending proposals
              можно review и apply без отдельной ad-hoc логики.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">Project-scoped context</Badge>
              <Badge variant="neutral">Proposal-safe execution</Badge>
              <Badge variant="neutral">Reusable for Telegram/email notes</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {packet ? (
        <div className="grid gap-4">
          <Card className="border-[var(--line)] bg-[var(--surface-panel)]">
            <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <CardTitle>{packet.title}</CardTitle>
                <p className="text-sm text-[var(--ink-soft)]">
                  {packet.projectName} · {packet.participants.length || 0} участников ·{" "}
                  {packet.noteStats.lines} строк / {packet.noteStats.characters} символов
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {packet.runs.map((entry) => (
                  <Badge key={entry.run.id} variant={mapStatusVariant(entry.run.status)}>
                    {entry.purpose}: {mapStatusLabel(entry.run.status)}
                  </Badge>
                ))}
              </div>
            </CardHeader>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            {packet.runs.map((entry) => {
              const proposal = entry.run.result?.proposal ?? null;
              const isApplying = applyingRunIds.includes(entry.run.id);

              return (
                <Card key={entry.run.id} className="border-[var(--line)] bg-[var(--surface-panel)]">
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-lg">{entry.label}</CardTitle>
                      <Badge variant={mapStatusVariant(entry.run.status)}>{mapStatusLabel(entry.run.status)}</Badge>
                    </div>
                    <div className="space-y-1 text-sm text-[var(--ink-soft)]">
                      <p>{entry.run.title}</p>
                      <p className="font-mono text-xs text-[var(--ink-muted)]">{entry.run.id}</p>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <p className="text-sm leading-7 text-[var(--ink-soft)]">
                      {entry.run.result?.summary ?? "Запуск ещё обрабатывает пакет встречи."}
                    </p>

                    {entry.run.result?.highlights?.length ? (
                      <ul className="grid gap-2 text-sm text-[var(--ink-soft)]">
                        {entry.run.result.highlights.slice(0, 3).map((highlight) => (
                          <li key={highlight} className="rounded-md bg-[var(--panel-soft)] px-3 py-2">
                            {highlight}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {proposal ? (
                      <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-[var(--ink)]">
                              {proposal.title}
                            </p>
                            <p className="text-xs text-[var(--ink-muted)]">{proposal.summary}</p>
                          </div>
                          <Badge variant={proposal.state === "applied" ? "success" : "warning"}>
                            {proposal.state}
                          </Badge>
                        </div>
                        <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          {getProposalItemCount(proposal)} элементов
                        </p>
                        {proposal.state === "pending" ? (
                          <Button
                            disabled={isApplying}
                            onClick={() => applyProposal(entry.run.id, proposal.id)}
                            size="sm"
                          >
                            {isApplying ? "Применяем..." : "Применить предложение"}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      <DomainApiCard
        description="Пакет встречи управляет несколькими AI-запусками в одном и том же проектном контексте вместо выдумывания параллельной модели согласования."
        endpoints={expectedEndpoints}
        title="API-эндпоинты"
      />
    </div>
  );
}

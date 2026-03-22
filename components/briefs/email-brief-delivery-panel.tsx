"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, fieldStyles } from "@/components/ui/field";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";

type DeliveryScope = "portfolio" | "project";
type DeliveryLocale = "ru" | "en";

function ledgerStatusLabel(status: BriefDeliveryLedgerRecord["status"]) {
  switch (status) {
    case "delivered":
      return "отправлено";
    case "failed":
      return "сбой";
    case "pending":
      return "в очереди";
    case "preview":
    default:
      return "предпросмотр";
  }
}

function retryPostureLabel(value: BriefDeliveryLedgerRecord["retryPosture"]) {
  switch (value) {
    case "sealed":
      return "зафиксирован";
    case "retryable":
      return "повторяемый";
    case "preview_only":
    default:
      return "только предпросмотр";
  }
}

function createDeliveryKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `email-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface DeliveryResponse {
  scope: DeliveryScope;
  locale: DeliveryLocale;
  recipient: string | null;
  headline: string;
  delivered: boolean;
  dryRun: boolean;
  subject: string;
  previewText: string;
  bodyText: string;
  messageId?: string;
  replayed?: boolean;
  ledger?: BriefDeliveryLedgerRecord | null;
}

export function EmailBriefDeliveryPanel({
  projectOptions,
}: {
  projectOptions: Array<{ id: string; name: string }>;
}) {
  const [scope, setScope] = useState<DeliveryScope>("portfolio");
  const [projectId, setProjectId] = useState(projectOptions[0]?.id ?? "");
  const [locale, setLocale] = useState<DeliveryLocale>("ru");
  const [recipient, setRecipient] = useState("");
  const [result, setResult] = useState<DeliveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createDeliveryKey);
  const selectedProject = projectOptions.find((project) => project.id === projectId) ?? null;
  const scopeOptions = useMemo(
    () =>
      projectOptions.length > 0
        ? [
            { value: "portfolio" as const, label: "Сводка портфеля" },
            {
              value: "project" as const,
              label: selectedProject
                ? `Сводка по проекту · ${selectedProject.name}`
                : "Сводка по проекту",
            },
          ]
        : [{ value: "portfolio" as const, label: "Сводка портфеля" }],
    [projectOptions.length, selectedProject]
  );

  useEffect(() => {
    if (!projectId && projectOptions[0]?.id) {
      setProjectId(projectOptions[0].id);
    }

    if (scope === "project" && projectOptions.length === 0) {
      setScope("portfolio");
    }
  }, [projectId, projectOptions, scope]);

  useEffect(() => {
    setIdempotencyKey(createDeliveryKey());
  }, [scope, projectId, locale, recipient]);

  const submit = async (dryRun: boolean) => {
    setError(null);

    if (dryRun) {
      setIsPreviewing(true);
    } else {
      setIsSending(true);
    }

    try {
      const response = await fetch("/api/connectors/email/briefs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope,
          projectId: scope === "project" ? projectId : undefined,
          locale,
          recipient: recipient.trim() || undefined,
          idempotencyKey,
          dryRun,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to deliver email brief.");
      }

      setResult(payload as DeliveryResponse);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Failed to deliver email brief."
      );
    } finally {
      setIsPreviewing(false);
      setIsSending(false);
    }
  };

  return (
    <div className="mt-4 grid gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--ink)]">Доставка по email</div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            Предпросмотр или отправка текущей руководительской сводки через живой SMTP-коннектор.
          </div>
        </div>
        <Badge variant="success">Живой коннектор</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Область</span>
          <select
            className={fieldStyles}
            onChange={(event) => setScope(event.target.value as DeliveryScope)}
            value={scope}
          >
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Язык</span>
          <select
            className={fieldStyles}
            onChange={(event) => setLocale(event.target.value as DeliveryLocale)}
            value={locale}
          >
            <option value="ru">ru</option>
            <option value="en">en</option>
          </select>
        </label>
      </div>

      {scope === "project" && projectOptions.length > 0 ? (
        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Проект</span>
          <select
            className={fieldStyles}
            onChange={(event) => setProjectId(event.target.value)}
            value={projectId}
          >
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
        <span>Email получателя</span>
        <Input
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="Необязательно, если задан EMAIL_DEFAULT_TO"
          value={recipient}
        />
      </label>

      {error ? (
        <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={isPreviewing || isSending || (scope === "project" && !projectId)}
          onClick={() => submit(true)}
          variant="secondary"
        >
          {isPreviewing ? "Готовим предпросмотр..." : "Предпросмотр письма"}
        </Button>
        <Button
          disabled={isPreviewing || isSending || (scope === "project" && !projectId)}
          onClick={() => submit(false)}
        >
          {isSending ? "Отправляем..." : "Отправить письмо"}
        </Button>
      </div>

      {result ? (
        <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.delivered ? "success" : "info"}>
              {result.delivered ? "Отправлено" : "Предпросмотр"}
            </Badge>
            {result.replayed ? <Badge variant="warning">Повтор без дубля</Badge> : null}
            <span className="text-xs text-[var(--ink-soft)]">
              {result.scope === "portfolio" ? "Портфель" : "Проект"} · {result.locale} · {result.recipient ?? "значение из окружения не задано"}
            </span>
          </div>
          <div className="text-sm font-medium text-[var(--ink)]">{result.subject}</div>
          {result.ledger ? (
            <div className="text-xs text-[var(--ink-soft)]">
              Журнал {ledgerStatusLabel(result.ledger.status)} · попыток {result.ledger.attemptCount} · повтор{" "}
              {retryPostureLabel(result.ledger.retryPosture)}
              {result.ledger.providerMessageId ? ` · провайдер ${result.ledger.providerMessageId}` : ""}
            </div>
          ) : null}
          <div className="text-xs text-[var(--ink-soft)]">{result.previewText}</div>
          <pre className="whitespace-pre-wrap text-xs leading-6 text-[var(--ink-soft)]">
            {result.bodyText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

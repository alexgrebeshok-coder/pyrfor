"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, fieldStyles } from "@/components/ui/field";

type DeliveryScope = "portfolio" | "project";
type DeliveryLocale = "ru" | "en";
type DeliveryCadence = "daily" | "weekdays";

interface ProjectOption {
  id: string;
  name: string;
}

interface PolicyRecord {
  id: string;
  scope: DeliveryScope;
  projectId: string | null;
  projectName: string | null;
  locale: DeliveryLocale;
  chatId: string | null;
  cadence: DeliveryCadence;
  timezone: string;
  deliveryHour: number;
  active: boolean;
  lastAttemptAt: string | null;
  lastDeliveredAt: string | null;
  lastMessageId: number | null;
  lastError: string | null;
}

export function TelegramBriefPolicyPanel({
  projectOptions,
}: {
  projectOptions: ProjectOption[];
}) {
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [scope, setScope] = useState<DeliveryScope>("portfolio");
  const [projectId, setProjectId] = useState(projectOptions[0]?.id ?? "");
  const [locale, setLocale] = useState<DeliveryLocale>("ru");
  const [cadence, setCadence] = useState<DeliveryCadence>("daily");
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [deliveryHour, setDeliveryHour] = useState("9");
  const [chatId, setChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingPolicyId, setTogglingPolicyId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId && projectOptions[0]?.id) {
      setProjectId(projectOptions[0].id);
    }
  }, [projectId, projectOptions]);

  useEffect(() => {
    void loadPolicies();
  }, []);

  async function loadPolicies() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/connectors/telegram/briefs/policies", {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось загрузить правила доставки в Telegram.");
      }

      setPolicies((payload.policies ?? []) as PolicyRecord[]);
      setError(null);
    } catch (loadingError) {
      setError(
        loadingError instanceof Error
          ? loadingError.message
          : "Не удалось загрузить правила доставки в Telegram."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function createPolicy() {
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/connectors/telegram/briefs/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope,
          projectId: scope === "project" ? projectId : null,
          locale,
          cadence,
          timezone: timezone.trim(),
          deliveryHour: Number(deliveryHour),
          chatId: chatId.trim() || null,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось создать правило доставки в Telegram.");
      }

      setError(null);
      setChatId("");
      await loadPolicies();
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : "Не удалось создать правило доставки в Telegram."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function togglePolicy(policy: PolicyRecord) {
    setTogglingPolicyId(policy.id);

    try {
      const response = await fetch(`/api/connectors/telegram/briefs/policies/${policy.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          active: !policy.active,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось обновить правило доставки в Telegram.");
      }

      setPolicies((current) =>
        current.map((entry) => (entry.id === policy.id ? (payload as PolicyRecord) : entry))
      );
      setError(null);
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Не удалось обновить правило доставки в Telegram."
      );
    } finally {
      setTogglingPolicyId(null);
    }
  }

  const canCreatePolicy =
    !isSubmitting &&
    timezone.trim().length > 0 &&
    deliveryHour.trim().length > 0 &&
    (scope === "portfolio" || projectId.length > 0);

  return (
    <div className="mt-4 grid gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel-strong)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--ink)]">Плановые Telegram-сводки</div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            Сохраняйте правила доставки для почасового cron-запуска. Текущий слой честно держит только один канал: Telegram.
          </div>
        </div>
        <Badge variant="info">На cron</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Область</span>
          <select
            className={fieldStyles}
            onChange={(event) => setScope(event.target.value as DeliveryScope)}
            value={scope}
          >
            <option value="portfolio">Сводка портфеля</option>
            <option disabled={projectOptions.length === 0} value="project">
              Сводка по проекту
            </option>
          </select>
        </label>

        {scope === "project" ? (
          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Проект</span>
            <select
              className={fieldStyles}
              onChange={(event) => setProjectId(event.target.value)}
              value={projectId}
            >
              {projectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

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

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Периодичность</span>
          <select
            className={fieldStyles}
            onChange={(event) => setCadence(event.target.value as DeliveryCadence)}
            value={cadence}
          >
            <option value="daily">Ежедневно</option>
            <option value="weekdays">Только будни</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Часовой пояс</span>
          <Input onChange={(event) => setTimezone(event.target.value)} value={timezone} />
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Час отправки</span>
          <Input
            max={23}
            min={0}
            onChange={(event) => setDeliveryHour(event.target.value)}
            type="number"
            value={deliveryHour}
          />
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>ID Telegram-чата</span>
          <Input
            onChange={(event) => setChatId(event.target.value)}
            placeholder="Необязательно, если задан TELEGRAM_DEFAULT_CHAT_ID"
            value={chatId}
          />
        </label>
      </div>

      {error ? (
        <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!canCreatePolicy} onClick={createPolicy}>
          {isSubmitting ? "Сохраняем правило..." : "Сохранить правило доставки"}
        </Button>
        <div className="text-xs text-[var(--ink-soft)]">
          Запуск по часу через `POST /api/connectors/telegram/briefs/policies/run-due`.
        </div>
      </div>

      <div className="grid gap-3">
        <div className="text-sm font-medium text-[var(--ink)]">Список активных правил</div>
        {isLoading ? (
          <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
            Загружаем правила доставки...
          </div>
        ) : policies.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
            Пока нет запланированных правил Telegram-сводок.
          </div>
        ) : (
          policies.map((policy) => (
            <div
              key={policy.id}
              className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={policy.active ? "success" : "neutral"}>
                    {policy.active ? "Активно" : "На паузе"}
                  </Badge>
                  <Badge variant="info">
                    {policy.scope === "portfolio"
                      ? "Портфель"
                      : `Проект${policy.projectName ? ` · ${policy.projectName}` : ""}`}
                  </Badge>
                  <span className="text-xs text-[var(--ink-soft)]">{formatPolicySchedule(policy)}</span>
                </div>
                <Button
                  disabled={togglingPolicyId === policy.id}
                  onClick={() => togglePolicy(policy)}
                  size="sm"
                  variant="secondary"
                >
                  {togglingPolicyId === policy.id
                    ? "Обновляем..."
                    : policy.active
                      ? "Пауза"
                      : "Возобновить"}
                </Button>
              </div>

              <div className="grid gap-1 text-xs text-[var(--ink-soft)]">
                <div>Цель: {policy.chatId ?? "TELEGRAM_DEFAULT_CHAT_ID"}</div>
                <div>Язык: {policy.locale}</div>
                <div>Последняя попытка: {formatTimestamp(policy.lastAttemptAt)}</div>
                <div>Последняя доставка: {formatTimestamp(policy.lastDeliveredAt)}</div>
                <div>
                  ID последнего сообщения: {policy.lastMessageId !== null ? policy.lastMessageId : "ещё не отправлено"}
                </div>
              </div>

              {policy.lastError ? (
                <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  {policy.lastError}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatPolicySchedule(policy: PolicyRecord) {
  const hourLabel = `${String(policy.deliveryHour).padStart(2, "0")}:00`;
  if (policy.cadence === "weekdays") {
    return `Будни в ${hourLabel} ${policy.timezone}`;
  }

  return `Ежедневно в ${hourLabel} ${policy.timezone}`;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "ещё не запускалось";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

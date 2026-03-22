"use client";

import { History, MessageSquareText, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import { cn } from "@/lib/utils";

export function ChatHistoryList({
  onAction,
  showCreateButton = true,
}: {
  onAction?: () => void;
  showCreateButton?: boolean;
}) {
  const { locale, t } = useLocale();
  const { createSession, currentSessionId, selectSession, sessions } = useAIWorkspace();
  const orderedSessions = [...sessions].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );

  return (
    <div className="grid gap-[var(--spacing-sm)]">
      {showCreateButton ? (
        <Button
          className="w-full justify-start"
          onClick={() => {
            createSession();
            onAction?.();
          }}
          variant="secondary"
        >
          <Plus className="h-4 w-4" />
          {t("chat.newChat")}
        </Button>
      ) : null}

      {!orderedSessions.length ? (
        <div className="rounded-[10px] border border-dashed border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-6 text-sm text-[var(--ink-muted)]">
          {t("chat.historyEmpty")}
        </div>
      ) : (
        orderedSessions.map((session) => (
          <button
            aria-label={`${t("chat.sidebar.history")}: ${session.title || t("chat.sessionUntitled")}`}
            key={session.id}
            className={cn(
              "rounded-[16px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-3 py-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--brand)]/25 hover:bg-[color:var(--surface-panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 ring-offset-[var(--surface)]",
              currentSessionId === session.id &&
                "border-[var(--brand)]/35 bg-[var(--panel-soft)] shadow-[0_10px_22px_rgba(37,99,235,0.08)]"
            )}
            onClick={() => {
              selectSession(session.id);
              onAction?.();
            }}
            type="button"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--panel-soft)] text-[var(--brand)]">
                <MessageSquareText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--ink)]">
                  {session.title || t("chat.sessionUntitled")}
                </p>
                <p className="truncate text-xs text-[var(--ink-muted)]">
                  {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                  }).format(new Date(session.updatedAt))}
                </p>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              <History className="h-3.5 w-3.5" />
              <span className="rounded-full bg-[var(--panel-soft)] px-2 py-0.5 text-[10px]">
                {session.runIds.length}
              </span>
              {currentSessionId === session.id ? (
                <Badge variant="info">{t("chat.sessionCurrent")}</Badge>
              ) : null}
            </div>
          </button>
        ))
      )}
    </div>
  );
}

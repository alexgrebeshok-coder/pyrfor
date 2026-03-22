"use client";

import { useMemo } from "react";
import { Bot, MessageSquareText, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { AgentSelector } from "@/components/chat/agent-selector";
import { ChatHistoryList } from "@/components/chat/chat-history-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import type { AIWorkspaceMode } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const modeLabelKey: Record<
  AIWorkspaceMode,
  "ai.mode.auto" | "ai.mode.mock" | "ai.mode.local" | "ai.mode.gateway" | "ai.mode.provider"
> = {
  auto: "ai.mode.auto",
  mock: "ai.mode.mock",
  local: "ai.mode.local",
  gateway: "ai.mode.gateway",
  provider: "ai.mode.provider",
};

export function ChatSidebar({
  className,
  onClose,
}: {
  className?: string;
  onClose?: () => void;
}) {
  const {
    activeContext,
    agents,
    currentSession,
    createSession,
    preferredMode,
    quickActions,
    runQuickAction,
    selectedAgentId,
    sessions,
  } = useAIWorkspace();
  const { t } = useLocale();

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  const handleNewChat = () => {
    createSession();
    onClose?.();
  };

  const handleClearHistory = () => {
    if (
      confirm(
        "Вы уверены, что хотите удалить всю историю чатов? Это действие нельзя отменить."
      )
    ) {
      localStorage.removeItem("ceoclaw-chat-sessions-v1");
      createSession();
      toast.success("История очищена");
      onClose?.();
    }
  };

  return (
    <div className={cn("flex h-full flex-col bg-[color:var(--surface-sidebar-mobile)]", className)}>
      <div className="flex items-center justify-between border-b border-[color:var(--line-strong)] px-3 py-3 md:hidden">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            {t("page.chat.eyebrow")}
          </p>
          <p className="mt-1 font-medium text-[var(--ink)]">{t("page.chat.title")}</p>
        </div>
        <Button aria-label={t("action.close")} onClick={onClose} size="icon" variant="secondary">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="grid gap-3">
          <Card className="overflow-hidden border-none bg-[linear-gradient(180deg,rgba(15,23,42,.96)_0%,rgba(30,41,59,.96)_100%)] text-white shadow-[0_24px_70px_rgba(15,23,42,.18)]">
            <CardContent className="space-y-3 p-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-100">
                <Sparkles className="h-3.5 w-3.5" />
                {t("page.chat.title")}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300/90">
                  {activeContext.subtitle}
                </p>
                <h3 className="font-heading text-xl font-semibold tracking-[-0.05em] text-white">
                  {activeContext.title}
                </h3>
                <p className="text-xs leading-5 text-slate-300">
                  {t("chat.sidebar.agentSelectorHelp")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge
                  className="border-white/10 bg-white/10 text-white ring-white/15"
                  variant="neutral"
                >
                  {currentSession?.title || t("chat.sessionUntitled")}
                </Badge>
                <Badge
                  className="border-sky-300/20 bg-sky-500/15 text-sky-100 ring-sky-300/25"
                  variant="info"
                >
                  {t(modeLabelKey[preferredMode])}
                </Badge>
                <Badge
                  className="border-white/10 bg-white/10 text-white ring-white/15"
                  variant="neutral"
                >
                  {selectedAgent ? t(selectedAgent.nameKey) : t("agent.autoRouting")}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  onClick={handleNewChat}
                  variant="ghost"
                >
                  <MessageSquareText className="h-4 w-4" />
                  {t("chat.newChat")}
                </Button>
                <Button
                  className="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  onClick={() =>
                    toast(t("chat.sidebar.settingsSoon"), {
                      description: t("chat.sidebar.settingsSoonDesc"),
                    })
                  }
                  variant="ghost"
                >
                  <Settings2 className="h-4 w-4" />
                  {t("chat.sidebar.settings")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] shadow-[0_16px_30px_rgba(15,23,42,.04)]">
            <CardContent className="p-3">
              <AgentSelector />
            </CardContent>
          </Card>

          <Card className="border border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] shadow-[0_16px_30px_rgba(15,23,42,.04)]">
            <CardContent className="space-y-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    {t("chat.sidebar.quickActions")}
                  </p>
                  <p className="text-xs leading-5 text-[var(--ink-soft)]">
                    {t("chat.sidebar.quickActionsHelp")}
                  </p>
                </div>
                <Badge variant="neutral">{quickActions.length}</Badge>
              </div>

              <div className="grid gap-2">
                {quickActions.slice(0, 4).map((action) => (
                  <button
                    key={action.id}
                    aria-label={t(action.labelKey)}
                    className="rounded-[16px] border border-[var(--line)] bg-[color:var(--surface-panel-strong)] p-2.5 text-left transition hover:-translate-y-0.5 hover:border-[var(--brand)]/25 hover:bg-[var(--panel-soft)]"
                    onClick={async () => {
                      await runQuickAction(action.id);
                      onClose?.();
                    }}
                    type="button"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-[var(--panel-soft)] text-[var(--brand)]">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--ink)]">{t(action.labelKey)}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                          {t(action.descriptionKey)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] shadow-[0_16px_30px_rgba(15,23,42,.04)]">
            <CardContent className="space-y-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    {t("chat.sidebar.history")}
                  </p>
                  <p className="text-xs leading-5 text-[var(--ink-soft)]">
                    {t("chat.sidebar.historyHelp")}
                  </p>
                </div>
                <Badge variant="neutral">{sessions.length}</Badge>
              </div>

              <ChatHistoryList onAction={onClose} showCreateButton={false} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="border-t border-[color:var(--line-strong)] px-3 py-2.5">
        <div className="flex flex-wrap gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          <span>⌘/ — скрыть панель</span>
          <span>Enter — отправить</span>
          <span>Shift+Enter — новая строка</span>
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1"
            onClick={handleClearHistory}
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
            {t("chat.sidebar.clearHistory")}
          </Button>
        </div>
      </div>
    </div>
  );
}

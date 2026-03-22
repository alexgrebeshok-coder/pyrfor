"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquareMore, PanelLeftOpen, PanelRightClose, Sparkles } from "lucide-react";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function ChatLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const {
    activeContext,
    agents,
    currentSession,
    isChatStateReady,
    preferredMode,
    quickActions,
    runQuickAction,
    selectedAgentId,
  } = useAIWorkspace();
  const { t } = useLocale();

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key !== "/" && event.code !== "Slash") return;

      event.preventDefault();

      if (window.matchMedia("(min-width: 768px)").matches) {
        setSidebarOpen((current) => !current);
        return;
      }

      setMobileSidebarOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!isChatStateReady) {
    return (
      <div className="relative h-[calc(100vh-8rem)] min-h-[720px] overflow-hidden rounded-[18px] border border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] shadow-[0_30px_80px_rgba(15,23,42,.05)]">
        <div className="flex h-full items-center justify-center px-4 py-6 sm:px-6">
          <div className="w-full max-w-3xl rounded-[24px] border border-[color:var(--line-strong)] bg-[color:var(--surface-panel-strong)] p-6 shadow-[0_18px_48px_rgba(15,23,42,.06)]">
            <div className="space-y-3">
              <div className="h-4 w-32 animate-pulse rounded-full bg-[var(--panel-soft)]" />
              <div className="h-8 w-64 animate-pulse rounded-full bg-[var(--panel-soft)]" />
              <div className="h-4 w-full animate-pulse rounded-full bg-[var(--panel-soft)]" />
              <div className="h-4 w-5/6 animate-pulse rounded-full bg-[var(--panel-soft)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-8rem)] min-h-[720px] overflow-hidden rounded-[18px] border border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] shadow-[0_30px_80px_rgba(15,23,42,.05)]">
      <div className="flex h-full">
        <aside
          className={cn(
            "hidden h-full border-r border-[color:var(--line-strong)] bg-[color:var(--surface-sidebar)] md:block",
            sidebarOpen ? "w-[24rem]" : "w-0 overflow-hidden border-r-0"
          )}
          id="chat-sidebar-panel"
        >
          {sidebarOpen ? <ChatSidebar /> : null}
        </aside>

        {mobileSidebarOpen ? (
          <div
            className="absolute inset-0 z-20 bg-black/60 backdrop-blur-[2px] md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <div
              className="h-full w-[88vw] max-w-[360px] border-r border-[color:var(--line-strong)] bg-[color:var(--surface-sidebar-mobile)] shadow-xl"
              id="chat-sidebar-panel-mobile"
              onClick={(event) => event.stopPropagation()}
            >
              <ChatSidebar onClose={() => setMobileSidebarOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Button
                  aria-controls="chat-sidebar-panel-mobile"
                  aria-expanded={mobileSidebarOpen}
                  aria-label={t("chat.sidebar.toggle")}
                  className="md:hidden"
                  onClick={() => setMobileSidebarOpen(true)}
                  size="icon"
                  variant="secondary"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
                <Button
                  aria-controls="chat-sidebar-panel"
                  aria-expanded={sidebarOpen}
                  aria-label={t("chat.sidebar.toggle")}
                  className="hidden md:inline-flex"
                  onClick={() => setSidebarOpen((current) => !current)}
                  size="icon"
                  variant="secondary"
                >
                  {sidebarOpen ? (
                    <PanelRightClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </Button>

                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-[var(--panel-soft)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)] ring-1 ring-[color:var(--line)]">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("page.chat.eyebrow")}
                  </div>
                  <p className="max-w-3xl text-xs leading-5 text-[var(--ink-soft)]">
                    {activeContext.title} · {activeContext.subtitle}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">
                  <MessageSquareMore className="h-3.5 w-3.5" />
                  {currentSession?.title || t("chat.sessionUntitled")}
                </Badge>
                <Badge variant="info">{t(modeLabelKey[preferredMode])}</Badge>
                <Badge variant="neutral">
                  {selectedAgent ? t(selectedAgent.nameKey) : t("agent.autoRouting")}
                </Badge>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {quickActions.slice(0, 3).map((action) => (
                <Button
                  key={action.id}
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() => void runQuickAction(action.id)}
                  variant="secondary"
                >
                  {t(action.labelKey)}
                </Button>
              ))}
              <span className="rounded-full bg-[var(--panel-soft)] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                ⌘/ · {t("chat.sidebar.toggle")}
              </span>
            </div>
          </header>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ChatMessages />
          </div>

          <ChatInput />
        </div>
      </div>
    </div>
  );
}

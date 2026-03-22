"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";

import { ChatMessage } from "@/components/chat/chat-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import type { AIWorkspaceMode } from "@/lib/ai/types";

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

const AUTO_SCROLL_BOTTOM_THRESHOLD = 96;

export function ChatMessages() {
  const {
    agents,
    createSession,
    quickActions,
    runs,
    runQuickAction,
    selectedAgentId,
    selectedRunId,
    preferredMode,
  } = useAIWorkspace();
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousRunCountRef = useRef(0);
  const previousSelectedRunIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const orderedRuns = useMemo(
    () =>
      [...runs].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      ),
    [runs]
  );

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const updateStickToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);

  useEffect(() => {
    updateStickToBottom();
  }, [orderedRuns.length, updateStickToBottom]);

  useEffect(() => {
    const runCountChanged = previousRunCountRef.current !== orderedRuns.length;
    const shouldAutoScroll =
      previousRunCountRef.current === 0 || (runCountChanged && stickToBottomRef.current);

    previousRunCountRef.current = orderedRuns.length;

    if (!shouldAutoScroll) {
      return;
    }

    scrollToBottom(runCountChanged ? "smooth" : "auto");
  }, [orderedRuns.length, scrollToBottom]);

  useEffect(() => {
    if (!selectedRunId || previousSelectedRunIdRef.current === selectedRunId) {
      previousSelectedRunIdRef.current = selectedRunId;
      return;
    }

    const selectedIsLatestRun = orderedRuns[orderedRuns.length - 1]?.id === selectedRunId;
    if (selectedIsLatestRun) {
      if (stickToBottomRef.current) {
        scrollToBottom("smooth");
      }
      previousSelectedRunIdRef.current = selectedRunId;
      return;
    }

    const element = document.getElementById(`assistant-message-${selectedRunId}`);
    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }

    previousSelectedRunIdRef.current = selectedRunId;
  }, [orderedRuns, scrollToBottom, selectedRunId]);

  if (!orderedRuns.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-4 py-6 sm:px-6">
        <Card className="w-full max-w-4xl overflow-hidden border border-[color:var(--line-strong)] bg-[linear-gradient(180deg,rgba(15,23,42,.96)_0%,rgba(17,24,39,.97)_100%)] text-white shadow-[0_30px_80px_rgba(15,23,42,.22)]">
          <CardContent className="grid gap-6 p-6 sm:p-7 xl:grid-cols-[1.15fr_.85fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className="border-white/10 bg-white/10 text-white ring-white/15"
                  variant="info"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("ai.emptyBadge")}
                </Badge>
                <Badge className="border-white/10 bg-white/10 text-white ring-white/15" variant="neutral">
                  {selectedAgent ? t(selectedAgent.nameKey) : t("agent.autoRouting")}
                </Badge>
                <Badge className="border-white/10 bg-white/10 text-white ring-white/15" variant="neutral">
                  {t(modeLabelKey[preferredMode])}
                </Badge>
              </div>

              <div className="space-y-2">
                <h3 className="font-heading text-2xl font-semibold tracking-[-0.05em] text-white">
                  {t("chat.emptyTitle")}
                </h3>
                <p className="max-w-2xl text-sm leading-7 text-slate-300">
                  {t("chat.emptyDescription")}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                {quickActions.slice(0, 3).map((action) => (
                  <button
                    key={action.id}
                    className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--brand)]/35 hover:bg-white/[0.07]"
                    onClick={() => void runQuickAction(action.id)}
                    type="button"
                  >
                    <p className="font-medium text-white">{t(action.labelKey)}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      {t(action.descriptionKey)}
                    </p>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  className="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  onClick={() => createSession()}
                  variant="ghost"
                >
                  {t("chat.newChat")}
                </Button>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-300">
                  Enter — {t("chat.input.send")}
                </span>
              </div>
            </div>

            <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {t("chat.sidebar.agent")}
                </p>
                <p className="text-lg font-semibold text-white">
                  {selectedAgent ? t(selectedAgent.nameKey) : t("agent.autoRouting")}
                </p>
                <p className="text-sm leading-6 text-slate-300">
                  {t("chat.sidebar.agentSelectorHelp")}
                </p>
              </div>

              <div className="space-y-2 rounded-[18px] border border-white/10 bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {t("chat.sidebar.mode")}
                </p>
                <p className="text-sm font-medium text-white">{t(modeLabelKey[preferredMode])}</p>
                <p className="text-sm leading-6 text-slate-300">{t("chat.sidebar.modeHelp")}</p>
              </div>

              <div className="space-y-2 rounded-[18px] border border-white/10 bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {t("chat.sidebar.quickActions")}
                </p>
                <p className="text-sm leading-6 text-slate-300">
                  {t("chat.sidebar.quickActionsHelp")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="app-shell-scroll-region absolute inset-0 overflow-y-auto overscroll-contain touch-pan-y"
      onScroll={updateStickToBottom}
      ref={containerRef}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        {orderedRuns.map((run) => (
          <ChatMessage key={run.id} run={run} selected={selectedRunId === run.id} />
        ))}
        <div className="flex items-center justify-center pb-2 text-xs text-[var(--ink-muted)]">
          <span className="rounded-full border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-1.5">
            <ArrowUpRight className="mr-1 inline h-3.5 w-3.5" />
            {t("chat.input.shortcuts")}
          </span>
        </div>
      </div>
    </div>
  );
}

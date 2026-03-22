"use client";

import { Bot, Sparkles, X } from "lucide-react";

import { AIComposer } from "@/components/ai/ai-composer";
import { AIResultView } from "@/components/ai/ai-result-view";
import { AIRunFeed } from "@/components/ai/ai-run-feed";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import { cn } from "@/lib/utils";

function getAdapterModeHint(mode: "auto" | "mock" | "local" | "gateway" | "provider") {
  switch (mode) {
    case "auto":
      return "Auto routing включён. CEOClaw сам выберет local model, live provider или mock fallback по доступности.";
    case "local":
      return "Локальная MLX-модель активна. CEOClaw поднимает локальный server и использует fine-tuned adapter.";
    case "gateway":
      return "Gateway adapter активен. Если это локальный MLX server или OpenAI-compatible endpoint, AI уже должен отвечать через него.";
    case "provider":
      return "Живой provider активен. Ответы идут через API-ключи выбранного сервиса.";
    case "mock":
    default:
      return "Dev fallback активен. AI будет отвечать даже без ключей, но это не local model.";
  }
}

export function AIDrawer() {
  const {
    activeContext,
    agents,
    closeDrawer,
    isDrawerOpen,
    preferredMode,
    selectedAgentId,
    setSelectedAgentId,
  } = useAIWorkspace();
  const { t } = useLocale();

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-[60] transition",
        isDrawerOpen && "pointer-events-auto"
      )}
    >
      <button
        aria-label={t("action.close")}
        className={cn(
          "absolute inset-0 bg-slate-950/38 backdrop-blur-sm transition-opacity duration-300",
          isDrawerOpen ? "opacity-100" : "opacity-0"
        )}
        onClick={closeDrawer}
      />

      <aside
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-[920px] flex-col overflow-hidden border-l border-[color:var(--line-strong)] bg-[color:var(--surface-sidebar-mobile)] shadow-[0_40px_120px_rgba(15,23,42,.22)] transition-transform duration-300 ease-out",
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="border-b border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] px-5 py-5 backdrop-blur-xl sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--panel-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)] ring-1 ring-[color:var(--line)]">
                <Sparkles className="h-3.5 w-3.5" />
                {t("ai.drawerBadge")}
              </div>
              <div>
                <h2 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
                  {t("ai.drawerTitle")}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
                  {t("ai.drawerDescription")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="rounded-full border border-[var(--line)] bg-[color:var(--surface-panel-strong)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                  {preferredMode === "auto"
                    ? t("ai.mode.auto")
                    : preferredMode === "local"
                      ? t("ai.mode.local")
                      : preferredMode === "mock"
                        ? t("ai.mode.mock")
                        : preferredMode === "provider"
                          ? "Live provider"
                          : t("ai.mode.gateway")}
                </span>
                <p className="mt-2 max-w-xs text-right text-[11px] leading-5 text-[var(--ink-muted)]">
                  {getAdapterModeHint(preferredMode)}
                </p>
              </div>
              <Button onClick={closeDrawer} size="icon" variant="secondary">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="border-b border-[color:var(--line-strong)] bg-[color:var(--surface-panel)]/60 p-5 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-6">
            <div className="grid gap-5">
              <Card className="border-none bg-[linear-gradient(135deg,#0f172a_0%,#1e3a8a_100%)] text-white shadow-[0_24px_70px_rgba(15,23,42,.18)]">
                <CardContent className="space-y-3 p-5">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">
                    <Bot className="h-3.5 w-3.5" />
                    {t("ai.currentContext")}
                  </div>
                  <div>
                    <p className="font-heading text-2xl font-semibold tracking-[-0.05em]">
                      {activeContext.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">{activeContext.subtitle}</p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <div>
                  <h3 className="font-heading text-lg font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    {t("ai.runFeedTitle")}
                  </h3>
                  <p className="text-sm text-[var(--ink-muted)]">{t("ai.runFeedDescription")}</p>
                </div>
                <AIRunFeed />
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="font-heading text-lg font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    {t("ai.agentPanelTitle")}
                  </h3>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {t("ai.agentPanelDescription")}
                  </p>
                </div>
                <div className="grid gap-3">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      className={cn(
                        "rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,.06)]",
                        agent.accentClass,
                        selectedAgentId === agent.id
                          ? "ring-2 ring-[var(--brand)]/20"
                          : "hover:border-[var(--brand)]/30"
                      )}
                      onClick={() => setSelectedAgentId(agent.id)}
                    >
                      <p className="font-medium text-[var(--ink)]">{t(agent.nameKey)}</p>
                      {agent.descriptionKey ? (
                        <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                          {t(agent.descriptionKey)}
                        </p>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              <AIResultView />
            </div>
            <AIComposer />
          </div>
        </div>
      </aside>
    </div>
  );
}

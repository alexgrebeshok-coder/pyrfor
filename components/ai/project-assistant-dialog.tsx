"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Send } from "lucide-react";

import { ChatMessage } from "@/components/ai/chat-message";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAIContext } from "@/lib/ai/context-provider";
import type { Project } from "@/lib/types";
import { useLocale } from "@/contexts/locale-context";

interface ProjectAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
}

export function ProjectAssistantDialog({
  open,
  onOpenChange,
  project,
}: ProjectAssistantDialogProps) {
  const { t } = useLocale();
  const {
    activeConversation,
    activeTarget,
    closeAssistant,
    features,
    isSending,
    openAssistant,
    providerRegistry,
    runPreset,
    selectedProvider,
    selectedModel,
    sendMessage,
    setSelectedProvider,
  } = useAIContext();
  const [draft, setDraft] = useState("");

  const selectedProviderModels = useMemo(
    () =>
      providerRegistry.find((provider) => provider.id === selectedProvider)?.models ?? [],
    [providerRegistry, selectedProvider]
  );

  useEffect(() => {
    if (!open) {
      closeAssistant();
      return;
    }

    void openAssistant({
      id: project?.id ?? null,
      name: project?.name ?? t("ai.assistant.portfolioTitle"),
    });
  }, [closeAssistant, open, openAssistant, project?.id, project?.name, t]);

  const handleSend = async () => {
    if (!draft.trim()) {
      return;
    }

    const nextDraft = draft;
    setDraft("");
    await sendMessage(nextDraft);
  };

  const title = project?.name ?? t("ai.assistant.portfolioTitle");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[min(100%-1rem,960px)] max-w-4xl p-0">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-[70vh] flex-col">
            <DialogHeader className="border-b border-[var(--line)] px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="info">{selectedProvider}</Badge>
                {selectedModel ? (
                  <Badge variant="neutral">{selectedModel}</Badge>
                ) : null}
              </div>
              <DialogTitle>{t("ai.assistant.title", { name: title })}</DialogTitle>
              <DialogDescription>
                {project
                  ? t("ai.assistant.projectDescription")
                  : t("ai.assistant.portfolioDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {activeConversation?.messages.length ? (
                activeConversation.messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    id={message.id}
                    role={message.role === "system" ? "assistant" : message.role}
                    content={
                      message.pending && !message.content
                        ? t("ai.assistant.loading")
                        : message.content
                    }
                    timestamp={message.createdAt}
                    facts={message.facts}
                    confidence={message.confidence}
                  />
                ))
              ) : (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/45 p-6 text-center">
                  <Bot className="h-8 w-8 text-[var(--brand)]" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-[var(--ink)]">
                      {t("ai.assistant.emptyTitle")}
                    </p>
                    <p className="text-sm text-[var(--ink-soft)]">
                      {project
                        ? t("ai.assistant.emptyProjectDescription")
                        : t("ai.assistant.emptyPortfolioDescription")}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-[var(--line)] px-5 py-4">
              <div className="flex flex-col gap-3">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  {t("ai.assistant.messageLabel")}
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    className="h-11 flex-1 rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] px-4 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)]"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={
                      project
                        ? t("ai.assistant.projectPlaceholder")
                        : t("ai.assistant.portfolioPlaceholder")
                    }
                    value={draft}
                  />
                  <Button disabled={isSending || !draft.trim()} onClick={() => void handleSend()}>
                    {isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {t("ai.assistant.send")}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <aside className="border-t border-[var(--line)] bg-[var(--panel-soft)]/35 px-5 py-4 lg:border-l lg:border-t-0">
            <div className="space-y-5">
              <section className="space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {t("ai.assistant.providerLabel")}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {t("ai.assistant.providerDescription")}
                  </p>
                </div>
                <select
                  className="h-11 w-full rounded-[14px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--ink)]"
                  onChange={(event) =>
                    void setSelectedProvider(
                      event.target.value as "local" | "openai" | "openrouter" | "zai"
                    )
                  }
                  value={selectedProvider}
                >
                  {providerRegistry.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  {selectedProviderModels.slice(0, 4).map((model) => (
                    <Badge key={model} variant={model === selectedModel ? "success" : "neutral"}>
                      {model}
                    </Badge>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {t("ai.assistant.quickActions")}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {activeTarget?.id
                      ? t("ai.assistant.projectQuickActionsDescription")
                      : t("ai.assistant.portfolioQuickActionsDescription")}
                  </p>
                </div>

                {features.taskSuggestions ? (
                  <Button
                    className="w-full justify-start"
                    disabled={isSending}
                    variant="outline"
                    onClick={() => void runPreset("taskSuggestions")}
                  >
                    {t("ai.action.taskSuggestions")}
                  </Button>
                ) : null}
                {features.riskAnalysis ? (
                  <Button
                    className="w-full justify-start"
                    disabled={isSending}
                    variant="outline"
                    onClick={() => void runPreset("riskAnalysis")}
                  >
                    {t("ai.action.riskAnalysis")}
                  </Button>
                ) : null}
                {features.budgetForecast ? (
                  <Button
                    className="w-full justify-start"
                    disabled={isSending}
                    variant="outline"
                    onClick={() => void runPreset("budgetForecast")}
                  >
                    {t("ai.action.budgetForecast")}
                  </Button>
                ) : null}
              </section>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

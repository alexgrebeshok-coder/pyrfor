"use client";

import { Bot, LoaderCircle, Sparkles } from "lucide-react";

import { EvidenceSummaryBlock } from "@/components/ai/evidence-summary-block";
import { AIProposalCard } from "@/components/ai/ai-proposal-card";
import { AIRunInspector } from "@/components/ai/ai-run-inspector";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import { getAgentById } from "@/lib/ai/agents";
import { getQuickActionById } from "@/lib/ai/quick-actions";
import type { MessageKey } from "@/lib/translations";

const statusTone = {
  queued: "neutral" as const,
  running: "info" as const,
  needs_approval: "warning" as const,
  done: "success" as const,
  failed: "danger" as const,
};

const statusLabelKey: Record<keyof typeof statusTone, MessageKey> = {
  queued: "ai.runStatus.queued",
  running: "ai.runStatus.running",
  needs_approval: "ai.runStatus.needs_approval",
  done: "ai.runStatus.done",
  failed: "ai.runStatus.failed",
};

function prettyAgentId(agentId: string) {
  return agentId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function AIResultView() {
  const { selectedRun, quickActions, runQuickAction } = useAIWorkspace();
  const { locale, t } = useLocale();
  const factsTitle = locale === "en" ? "Facts" : locale === "zh" ? "事实" : "Факты";

  if (!selectedRun) {
    return (
      <Card className="border-dashed border-[var(--line)] bg-[color:var(--surface-panel)]/88">
        <CardContent className="grid gap-5 p-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--panel-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
              <Sparkles className="h-3.5 w-3.5" />
              {t("ai.emptyBadge")}
            </div>
            <h3 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
              {t("ai.emptyTitle")}
            </h3>
            <p className="max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
              {t("ai.emptyDescription")}
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {quickActions.map((action) => (
              <button
                key={action.id}
                className="rounded-[24px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-4 text-left transition hover:border-[var(--brand)]/35 hover:bg-[color:var(--surface-panel-strong)]"
                onClick={() => void runQuickAction(action.id)}
              >
                <p className="font-medium text-[var(--ink)]">{t(action.labelKey)}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                  {t(action.descriptionKey)}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const runAgent = getAgentById(selectedRun.agentId);
  const triggerAction = getQuickActionById(selectedRun.quickActionId);
  const updatedAt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(selectedRun.updatedAt));

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="space-y-5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                {selectedRun.context.subtitle}
              </p>
              <h3 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
                {selectedRun.result?.title ?? selectedRun.title}
              </h3>
            </div>
            <Badge variant={statusTone[selectedRun.status]}>
              {t(statusLabelKey[selectedRun.status])}
            </Badge>
          </div>

          <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              {t("ai.originalPrompt")}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink)]">{selectedRun.prompt}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[22px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {t("ai.meta.agent")}
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                {runAgent ? t(runAgent.nameKey) : t("agent.autoRouting")}
              </p>
            </div>
            <div className="rounded-[22px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {t("ai.meta.trigger")}
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                {triggerAction ? t(triggerAction.labelKey) : t("chat.run.manual")}
              </p>
            </div>
            <div className="rounded-[22px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {t("ai.meta.context")}
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--ink)]">{selectedRun.context.title}</p>
            </div>
            <div className="rounded-[22px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {t("ai.meta.updated")}
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--ink)]">{updatedAt}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedRun.status === "queued" || selectedRun.status === "running" ? (
        <Card className="overflow-hidden">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--panel-soft)] text-[var(--brand)]">
                <LoaderCircle className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <p className="font-medium text-[var(--ink)]">{t("ai.loadingTitle")}</p>
                <p className="text-sm text-[var(--ink-soft)]">{t("ai.loadingDescription")}</p>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-soft)]">
              <div className="h-full w-1/2 animate-[pulse_1.6s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,var(--brand)_0%,#60a5fa_100%)]" />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {selectedRun.status === "failed" ? (
        <Card className="border-rose-300/60 bg-rose-500/10 dark:border-rose-400/25 dark:bg-rose-500/12">
          <CardContent className="space-y-3 p-4">
            <div className="inline-flex items-center gap-2 text-rose-700 dark:text-rose-300">
              <Bot className="h-4 w-4" />
              <span className="font-medium">{t("ai.failedTitle")}</span>
            </div>
            <p className="text-sm text-rose-700/90 dark:text-rose-200/90">
              {selectedRun.errorMessage ?? t("toast.aiRunFailedDesc")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {selectedRun.result ? (
        <>
          <Card>
            <CardContent className="grid gap-5 p-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  {t("ai.summary")}
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--ink)]">
                  {selectedRun.result.summary}
                </p>
              </div>

              <EvidenceSummaryBlock
                confidence={selectedRun.result.confidence}
                facts={selectedRun.result.facts}
                title={factsTitle}
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[24px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">{t("ai.highlights")}</p>
                  <div className="mt-3 grid gap-2">
                    {selectedRun.result.highlights.map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl bg-[var(--panel-soft)] px-3 py-3 text-sm text-[var(--ink-soft)]"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">{t("ai.nextSteps")}</p>
                  <div className="mt-3 grid gap-2">
                    {selectedRun.result.nextSteps.map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl bg-[var(--panel-soft)] px-3 py-3 text-sm text-[var(--ink-soft)]"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {selectedRun.result.collaboration ? (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      Multi-agent council
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      {selectedRun.result.collaboration.reason}
                    </p>
                  </div>
                  <Badge variant="info">{selectedRun.result.collaboration.mode}</Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="success">
                    Leader: {prettyAgentId(selectedRun.result.collaboration.leaderAgentId)}
                  </Badge>
                  {selectedRun.result.collaboration.supportAgentIds.map((agentId) => (
                    <Badge key={agentId} variant="neutral">
                      {prettyAgentId(agentId)}
                    </Badge>
                  ))}
                </div>

                <div className="grid gap-2">
                  {selectedRun.result.collaboration.steps.map((step) => (
                    <div
                      key={`${step.agentId}-${step.runtime.provider}-${step.runtime.model}`}
                      className="grid gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--ink)]">
                          {prettyAgentId(step.agentId)}
                        </p>
                        <Badge
                          variant={step.status === "done" ? "success" : "danger"}
                        >
                          {step.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-[var(--ink-soft)]">{step.summary}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {step.runtime.provider} · {step.runtime.model}
                      </p>
                    </div>
                  ))}
                </div>

                {selectedRun.result.collaboration.consensus.length > 0 ? (
                  <div className="rounded-[20px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      Council consensus
                    </p>
                    <div className="mt-3 grid gap-2">
                      {selectedRun.result.collaboration.consensus.map((item) => (
                        <div
                          key={item}
                          className="rounded-2xl bg-[var(--panel-soft)] px-3 py-3 text-sm text-[var(--ink-soft)]"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {selectedRun.result.proposal ? (
            <AIProposalCard proposal={selectedRun.result.proposal} runId={selectedRun.id} />
          ) : null}

          {selectedRun.result.actionResult ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Action result
                </p>
                <p className="text-sm leading-7 text-[var(--ink)]">
                  {selectedRun.result.actionResult.summary}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <AIRunInspector
        locale={locale === "zh" ? "zh-CN" : locale}
        runId={selectedRun.id}
      />
    </div>
  );
}

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AIProposalCard } from "@/components/ai/ai-proposal-card";
import { EvidenceSummaryBlock } from "@/components/ai/evidence-summary-block";
import { AgentAvatar } from "@/components/chat/agent-avatar";
import { ThinkingIndicator } from "@/components/chat/thinking-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import { getAgentById } from "@/lib/ai/agents";
import type { AIRunRecord } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const runStatusVariant = {
  queued: "warning" as const,
  running: "info" as const,
  needs_approval: "warning" as const,
  done: "success" as const,
  failed: "danger" as const,
};

const runStatusLabelKey = {
  queued: "ai.runStatus.queued" as const,
  running: "ai.runStatus.running" as const,
  needs_approval: "ai.runStatus.needs_approval" as const,
  done: "ai.runStatus.done" as const,
  failed: "ai.runStatus.failed" as const,
};

function ChatMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (keyPrefix: string) => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`${keyPrefix}-list`} className="list-disc space-y-1 pl-5 text-sm leading-7">
        {listItems.map((item, index) => (
          <li key={`${keyPrefix}-${index}`}>{item}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList(`space-${index}`);
      return;
    }

    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
      return;
    }

    flushList(`line-${index}`);

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4 key={`heading-${index}`} className="text-sm font-semibold text-[var(--ink)]">
          {trimmed.slice(4)}
        </h4>
      );
      return;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="text-sm leading-7 text-[var(--ink-soft)]">
        {trimmed}
      </p>
    );
  });

  flushList("tail");

  return <div className="space-y-3">{blocks}</div>;
}

function buildAssistantContent(run: AIRunRecord, highlightsLabel: string, nextStepsLabel: string) {
  if (run.status === "failed") {
    return `### ${run.title}\n\n${run.errorMessage ?? ""}`;
  }

  if (!run.result) {
    return "";
  }

  const sections = [run.result.summary];

  if (run.result.highlights.length) {
    sections.push(`### ${highlightsLabel}\n${run.result.highlights.map((item) => `- ${item}`).join("\n")}`);
  }

  if (run.result.nextSteps.length) {
    sections.push(`### ${nextStepsLabel}\n${run.result.nextSteps.map((item) => `- ${item}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

export function ChatMessage({
  run,
  selected,
}: {
  run: AIRunRecord;
  selected?: boolean;
}) {
  const { locale, t } = useLocale();
  const { regenerateRun } = useAIWorkspace();
  const factsTitle = locale === "en" ? "Facts" : locale === "zh" ? "事实" : "Факты";
  const [copied, setCopied] = useState(false);
  const agent = getAgentById(run.agentId);
  const assistantContent = useMemo(
    () => buildAssistantContent(run, t("ai.highlights"), t("ai.nextSteps")),
    [run, t]
  );
  const timestamp = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(run.updatedAt));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(run.prompt);
      setCopied(true);
      toast.success("Скопировано в буфер обмена");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Не удалось скопировать");
    }
  };

  const handleRegenerate = () => {
    regenerateRun(run.id);
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-3">
        <div className="max-w-3xl text-right">
          <div className="mb-2 flex items-center justify-end gap-2 text-xs text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink)]">{t("chat.you")}</span>
            <span>{timestamp}</span>
          </div>
          <div className="rounded-[12px] rounded-tr-[4px] bg-[linear-gradient(135deg,var(--brand)_0%,var(--brand-strong)_100%)] px-4 py-3 text-left text-sm leading-7 text-white shadow-[0_12px_28px_rgba(37,99,235,0.28)]">
            {run.prompt}
          </div>
        </div>
        <AgentAvatar icon="🧑" label={t("chat.you")} tone="user" />
      </div>

      <div className="flex gap-3" id={`assistant-message-${run.id}`}>
        <AgentAvatar icon={agent?.icon ?? "🤖"} label={agent ? t(agent.nameKey) : t("agent.autoRouting")} />
        <div className="max-w-4xl flex-1">
          <div className="mb-2 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink)]">
              {agent ? t(agent.nameKey) : t("agent.autoRouting")}
            </span>
            <span>{timestamp}</span>
            <Badge variant={runStatusVariant[run.status]}>{t(runStatusLabelKey[run.status])}</Badge>
          </div>

          {(run.status === "queued" || run.status === "running") && !run.result ? (
            <ThinkingIndicator progress={run.status === "queued" ? 28 : 68} />
          ) : null}

          <div
            className={cn(
              "rounded-[12px] rounded-tl-[4px] border border-[var(--line-strong)] bg-[color:var(--surface-panel-strong)] px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.12)]",
              selected && "border-[var(--brand)]/45"
            )}
          >
            {assistantContent ? (
              <div className="space-y-3">
                <ChatMarkdown content={assistantContent} />
                <EvidenceSummaryBlock
                  confidence={run.result?.confidence}
                  facts={run.result?.facts}
                  title={factsTitle}
                />
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">{t("chat.awaitingResponse")}</p>
            )}
          </div>

          {/* Message Actions */}
          {run.status === "done" && (
            <div className="mt-2 flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleCopy}
                className="h-6 w-6"
                title="Скопировать"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRegenerate}
                className="h-6 w-6"
                title="Повторить генерацию"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          )}

          {run.result?.proposal ? (
            <div className="mt-4">
              <AIProposalCard proposal={run.result.proposal} runId={run.id} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

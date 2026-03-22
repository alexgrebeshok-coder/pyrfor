"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import { AUTO_AGENT_ID, aiAgentCategories } from "@/lib/ai/agents";
import { cn } from "@/lib/utils";

const featuredAgentIds = [
  AUTO_AGENT_ID,
  "pmo-director",
  "portfolio-analyst",
  "execution-planner",
  "risk-researcher",
  "budget-controller",
  "status-reporter",
  "document-writer",
] as const;

function getCategoryLabel(agentCategory: string, t: ReturnType<typeof useLocale>["t"]) {
  const category = aiAgentCategories.find((item) => item.id === agentCategory);
  return category ? t(category.labelKey) : agentCategory;
}

export function AgentSelector() {
  const [searchQuery, setSearchQuery] = useState("");
  const { agents, selectedAgentId, setSelectedAgentId } = useAIWorkspace();
  const { t } = useLocale();

  const featuredAgents = useMemo(
    () => agents.filter((agent) => featuredAgentIds.includes(agent.id as (typeof featuredAgentIds)[number])),
    [agents]
  );

  const visibleAgents = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return featuredAgents;
    }

    return agents.filter((agent) => {
      const searchableText = [
        agent.id,
        t(agent.nameKey),
        t(agent.descriptionKey ?? "agent.autoRoutingDescription"),
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [agents, featuredAgents, searchQuery, t]);

  const selectedCount = visibleAgents.length;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
      <Input
        aria-label={t("chat.sidebar.searchAgents")}
        className="h-9 rounded-[14px] border-[var(--line-strong)] bg-[color:var(--surface-panel)] pl-10 text-sm"
        id="chat-agent-search"
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder={t("chat.sidebar.searchPlaceholder")}
        value={searchQuery}
      />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            {t("ai.agentsTitle")}
          </p>
          <p className="text-xs leading-5 text-[var(--ink-soft)]">
            {searchQuery.trim()
              ? t("chat.sidebar.agentSelectorHelp")
              : t("chat.sidebar.agentSelectorHelp")}
          </p>
        </div>
        <Badge variant="neutral">{selectedCount}</Badge>
      </div>

      <div className="grid gap-1.5">
        {visibleAgents.map((agent) => {
          const selected = selectedAgentId === agent.id;
          const description = t(agent.descriptionKey ?? "agent.autoRoutingDescription");

          return (
            <button
              key={agent.id}
              aria-label={`${t("chat.sidebar.agent")}: ${t(agent.nameKey)}`}
              aria-pressed={selected}
              className={cn(
                "flex min-h-[6.5rem] flex-col overflow-hidden rounded-[18px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--brand)]/30 hover:bg-[color:var(--surface-panel-strong)]",
                selected && "border-[var(--brand)]/35 bg-[var(--panel-soft)] shadow-[0_12px_28px_rgba(37,99,235,0.08)]"
              )}
              title={description}
              onClick={() => {
                setSelectedAgentId(agent.id);
                setSearchQuery("");
              }}
              type="button"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-[var(--panel-soft)] text-base shadow-[0_8px_18px_rgba(15,23,42,.06)]">
                  <span aria-hidden>{agent.icon}</span>
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <Tooltip
                      content={
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-white">{t(agent.nameKey)}</p>
                          <p className="text-[11px] leading-5 text-slate-200">{description}</p>
                          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-300">
                            {getCategoryLabel(agent.category, t)}
                          </p>
                        </div>
                      }
                      delay={180}
                    >
                      <p className="line-clamp-2 text-[13px] font-semibold leading-4 text-[var(--ink)]">
                        {t(agent.nameKey)}
                      </p>
                    </Tooltip>
                    {agent.recommended ? (
                      <Badge
                        variant="info"
                        className="shrink-0 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em]"
                      >
                        {t("chat.sidebar.recommended")}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    <span className="truncate">{getCategoryLabel(agent.category, t)}</span>
                    <span className={cn("shrink-0", selected ? "text-[var(--brand)]" : "")}>
                      {selected ? "Выбран" : "Выбрать"}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!visibleAgents.length ? (
        <div className="rounded-[18px] border border-dashed border-[var(--line)] bg-[color:var(--surface-panel-strong)] px-4 py-5 text-sm text-[var(--ink-muted)]">
          {t("chat.sidebar.noAgents")}
        </div>
      ) : null}
    </div>
  );
}

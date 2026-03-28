import type { AIAgentDefinition, AIAgentCategory } from "@/lib/ai/types";
import type { MessageKey } from "@/lib/translations";

export const AUTO_AGENT_ID = "auto-routing";

export const aiAgentCategories: Array<{
  id: AIAgentCategory;
  labelKey: MessageKey;
}> = [
  { id: "auto", labelKey: "agent.category.auto" },
  { id: "strategic", labelKey: "agent.category.strategic" },
  { id: "planning", labelKey: "agent.category.planning" },
  { id: "monitoring", labelKey: "agent.category.monitoring" },
  { id: "financial", labelKey: "agent.category.financial" },
  { id: "knowledge", labelKey: "agent.category.knowledge" },
  { id: "communication", labelKey: "agent.category.communication" },
  { id: "special", labelKey: "agent.category.special" },
];

export const aiAgents: AIAgentDefinition[] = [
  {
    id: AUTO_AGENT_ID,
    kind: "analyst",
    descriptionKey: "agent.autoRoutingDescription",
    nameKey: "agent.autoRouting",
    accentClass:
      "border-[var(--line)] bg-[color:var(--surface-panel-strong)] dark:border-[var(--line)]",
    icon: "🤖",
    category: "auto",
    recommended: true,
  },
  {
    id: "pmo-director",
    kind: "analyst",
    descriptionKey: "agent.directorDescription",
    nameKey: "agent.director",
    accentClass:
      "border-indigo-200/80 bg-[linear-gradient(135deg,rgba(224,231,255,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-indigo-400/20 dark:bg-indigo-500/10",
    icon: "👔",
    category: "strategic",
  },
  {
    id: "portfolio-analyst",
    kind: "analyst",
    descriptionKey: "agent.analystDescription",
    nameKey: "agent.analyst",
    accentClass:
      "border-sky-200/80 bg-[linear-gradient(135deg,rgba(224,242,254,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-sky-400/20 dark:bg-sky-500/10",
    icon: "📊",
    category: "strategic",
  },
  {
    id: "strategy-advisor",
    kind: "analyst",
    descriptionKey: "agent.strategyDescription",
    nameKey: "agent.strategy",
    accentClass:
      "border-violet-200/80 bg-[linear-gradient(135deg,rgba(237,233,254,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-violet-400/20 dark:bg-violet-500/10",
    icon: "🎯",
    category: "strategic",
  },
  {
    id: "execution-planner",
    kind: "planner",
    descriptionKey: "agent.plannerDescription",
    nameKey: "agent.planner",
    accentClass:
      "border-amber-200/80 bg-[linear-gradient(135deg,rgba(254,243,199,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-amber-400/20 dark:bg-amber-500/10",
    icon: "📋",
    category: "planning",
  },
  {
    id: "resource-allocator",
    kind: "planner",
    descriptionKey: "agent.resourceDescription",
    nameKey: "agent.resource",
    accentClass:
      "border-emerald-200/80 bg-[linear-gradient(135deg,rgba(220,252,231,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-emerald-400/20 dark:bg-emerald-500/10",
    icon: "👥",
    category: "planning",
  },
  {
    id: "timeline-optimizer",
    kind: "planner",
    descriptionKey: "agent.timelineDescription",
    nameKey: "agent.timeline",
    accentClass:
      "border-cyan-200/80 bg-[linear-gradient(135deg,rgba(207,250,254,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-cyan-400/20 dark:bg-cyan-500/10",
    icon: "⏱",
    category: "planning",
  },
  {
    id: "status-reporter",
    kind: "reporter",
    descriptionKey: "agent.statusDescription",
    nameKey: "agent.status",
    accentClass:
      "border-blue-200/80 bg-[linear-gradient(135deg,rgba(219,234,254,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-blue-400/20 dark:bg-blue-500/10",
    icon: "📝",
    category: "monitoring",
  },
  {
    id: "risk-researcher",
    kind: "researcher",
    descriptionKey: "agent.riskDescription",
    nameKey: "agent.risk",
    accentClass:
      "border-rose-200/80 bg-[linear-gradient(135deg,rgba(255,228,230,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-rose-400/20 dark:bg-rose-500/10",
    icon: "⚠️",
    category: "monitoring",
  },
  {
    id: "quality-guardian",
    kind: "researcher",
    descriptionKey: "agent.qualityDescription",
    nameKey: "agent.quality",
    accentClass:
      "border-lime-200/80 bg-[linear-gradient(135deg,rgba(236,252,203,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-lime-400/20 dark:bg-lime-500/10",
    icon: "✅",
    category: "monitoring",
  },
  {
    id: "ux-guardian",
    kind: "researcher",
    descriptionKey: "agent.uxDescription",
    nameKey: "agent.ux",
    accentClass:
      "border-purple-200/80 bg-[linear-gradient(135deg,rgba(243,232,255,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-purple-400/20 dark:bg-purple-500/10",
    icon: "🛡️",
    category: "monitoring",
  },
  {
    id: "budget-controller",
    kind: "analyst",
    descriptionKey: "agent.budgetDescription",
    nameKey: "agent.budget",
    accentClass:
      "border-amber-300/80 bg-[linear-gradient(135deg,rgba(254,249,195,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-amber-400/20 dark:bg-yellow-500/10",
    icon: "💰",
    category: "financial",
  },
  {
    id: "evm-analyst",
    kind: "analyst",
    descriptionKey: "agent.evmDescription",
    nameKey: "agent.evm",
    accentClass:
      "border-orange-200/80 bg-[linear-gradient(135deg,rgba(255,237,213,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-orange-400/20 dark:bg-orange-500/10",
    icon: "📈",
    category: "financial",
  },
  {
    id: "cost-predictor",
    kind: "analyst",
    descriptionKey: "agent.costDescription",
    nameKey: "agent.cost",
    accentClass:
      "border-fuchsia-200/80 bg-[linear-gradient(135deg,rgba(250,232,255,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-fuchsia-400/20 dark:bg-fuchsia-500/10",
    icon: "💵",
    category: "financial",
  },
  {
    id: "knowledge-keeper",
    kind: "researcher",
    descriptionKey: "agent.knowledgeDescription",
    nameKey: "agent.knowledge",
    accentClass:
      "border-teal-200/80 bg-[linear-gradient(135deg,rgba(204,251,241,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-teal-400/20 dark:bg-teal-500/10",
    icon: "📚",
    category: "knowledge",
  },
  {
    id: "best-practices",
    kind: "researcher",
    descriptionKey: "agent.practicesDescription",
    nameKey: "agent.practices",
    accentClass:
      "border-violet-200/80 bg-[linear-gradient(135deg,rgba(243,232,255,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-violet-400/20 dark:bg-violet-500/10",
    icon: "💡",
    category: "knowledge",
  },
  {
    id: "search-agent",
    kind: "researcher",
    descriptionKey: "agent.searchDescription",
    nameKey: "agent.search",
    accentClass:
      "border-slate-200/80 bg-[linear-gradient(135deg,rgba(241,245,249,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-slate-400/20 dark:bg-slate-500/10",
    icon: "🔍",
    category: "knowledge",
  },
  {
    id: "telegram-bridge",
    kind: "reporter",
    descriptionKey: "agent.telegramDescription",
    nameKey: "agent.telegram",
    accentClass:
      "border-sky-200/80 bg-[linear-gradient(135deg,rgba(224,242,254,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-sky-400/20 dark:bg-sky-500/10",
    icon: "📱",
    category: "communication",
  },
  {
    id: "email-digest",
    kind: "reporter",
    descriptionKey: "agent.emailDescription",
    nameKey: "agent.email",
    accentClass:
      "border-indigo-200/80 bg-[linear-gradient(135deg,rgba(224,231,255,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-indigo-400/20 dark:bg-indigo-500/10",
    icon: "📧",
    category: "communication",
  },
  {
    id: "meeting-notes",
    kind: "reporter",
    descriptionKey: "agent.meetingDescription",
    nameKey: "agent.meeting",
    accentClass:
      "border-cyan-200/80 bg-[linear-gradient(135deg,rgba(236,254,255,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-cyan-400/20 dark:bg-cyan-500/10",
    icon: "🗓",
    category: "communication",
  },
  {
    id: "document-writer",
    kind: "reporter",
    descriptionKey: "agent.documentDescription",
    nameKey: "agent.document",
    accentClass:
      "border-zinc-200/80 bg-[linear-gradient(135deg,rgba(244,244,245,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-zinc-400/20 dark:bg-zinc-500/10",
    icon: "📄",
    category: "special",
  },
  {
    id: "data-analyst",
    kind: "analyst",
    descriptionKey: "agent.dataDescription",
    nameKey: "agent.data",
    accentClass:
      "border-blue-200/80 bg-[linear-gradient(135deg,rgba(219,234,254,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-blue-400/20 dark:bg-blue-500/10",
    icon: "📊",
    category: "special",
  },
  {
    id: "translator",
    kind: "reporter",
    descriptionKey: "agent.translateDescription",
    nameKey: "agent.translate",
    accentClass:
      "border-emerald-200/80 bg-[linear-gradient(135deg,rgba(220,252,231,.95)_0%,rgba(255,255,255,.92)_100%)] dark:border-emerald-400/20 dark:bg-emerald-500/10",
    icon: "🌍",
    category: "special",
  },
];

export function getAgentById(agentId: string) {
  return aiAgents.find((agent) => agent.id === agentId) ?? null;
}

/**
 * Get an enriched agent definition with on-disk config merged in.
 * Returns null if the agent ID is not found.
 */
export async function getEnrichedAgentById(agentId: string) {
  const base = getAgentById(agentId);
  if (!base) return null;
  const { getEnrichedAgent } = await import("@/lib/ai/agent-loader");
  return getEnrichedAgent(base);
}

import { AUTO_AGENT_ID, getAgentById } from "@/lib/ai/agents";
import type { AIContextSnapshot } from "@/lib/ai/types";

function hasAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function routeToAgentId(message: string, context: AIContextSnapshot) {
  const normalized = message.toLowerCase();
  const overdueTasks = context.tasks.filter(
    (task) => task.status !== "done" && task.dueDate <= new Date().toISOString().slice(0, 10)
  );
  const activeProject = context.project;
  const hasAtRiskProject =
    activeProject?.status === "at-risk" ||
    context.projects.some((project) => project.status === "at-risk");

  if (hasAnyKeyword(normalized, ["@director", "@pmo"])) return "pmo-director";
  if (hasAnyKeyword(normalized, ["@analyst"])) return "portfolio-analyst";
  if (hasAnyKeyword(normalized, ["@strategy"])) return "strategy-advisor";
  if (hasAnyKeyword(normalized, ["@planner"])) return "execution-planner";
  if (hasAnyKeyword(normalized, ["@resource"])) return "resource-allocator";
  if (hasAnyKeyword(normalized, ["@timeline"])) return "timeline-optimizer";
  if (hasAnyKeyword(normalized, ["@status"])) return "status-reporter";
  if (hasAnyKeyword(normalized, ["@risk"])) return "risk-researcher";
  if (hasAnyKeyword(normalized, ["@quality"])) return "quality-guardian";
  if (hasAnyKeyword(normalized, ["@budget"])) return "budget-controller";
  if (hasAnyKeyword(normalized, ["@evm"])) return "evm-analyst";
  if (hasAnyKeyword(normalized, ["@cost"])) return "cost-predictor";
  if (hasAnyKeyword(normalized, ["@knowledge"])) return "knowledge-keeper";
  if (hasAnyKeyword(normalized, ["@practices"])) return "best-practices";
  if (hasAnyKeyword(normalized, ["@search"])) return "search-agent";
  if (hasAnyKeyword(normalized, ["@telegram"])) return "telegram-bridge";
  if (hasAnyKeyword(normalized, ["@email"])) return "email-digest";
  if (hasAnyKeyword(normalized, ["@meeting"])) return "meeting-notes";
  if (hasAnyKeyword(normalized, ["@document"])) return "document-writer";
  if (hasAnyKeyword(normalized, ["@data"])) return "data-analyst";
  if (hasAnyKeyword(normalized, ["@translate"])) return "translator";

  if (
    hasAnyKeyword(normalized, [
      "status",
      "report",
      "summary",
      "weekly",
      "статус",
      "отчет",
      "отчёт",
      "сводк",
      "报告",
      "总结",
    ])
  ) {
    return "status-reporter";
  }

  if (
    hasAnyKeyword(normalized, [
      "risk",
      "blocker",
      "issue",
      "problem",
      "рис",
      "блок",
      "проблем",
      "风险",
      "阻塞",
    ])
  ) {
    return "risk-researcher";
  }

  if (
    hasAnyKeyword(normalized, [
      "budget",
      "cost",
      "evm",
      "money",
      "finance",
      "бюдж",
      "деньг",
      "затрат",
      "预算",
      "成本",
    ])
  ) {
    return "budget-controller";
  }

  if (
    hasAnyKeyword(normalized, [
      "task",
      "create",
      "plan",
      "assign",
      "resour",
      "задач",
      "созд",
      "план",
      "ресурс",
      "任务",
      "创建",
      "计划",
    ])
  ) {
    return activeProject ? "execution-planner" : "resource-allocator";
  }

  if (
    hasAnyKeyword(normalized, [
      "deadline",
      "timeline",
      "schedule",
      "acceler",
      "срок",
      "дедлайн",
      "ускор",
      "时间线",
      "进度",
    ])
  ) {
    return "timeline-optimizer";
  }

  if (
    hasAnyKeyword(normalized, [
      "quality",
      "qa",
      "audit",
      "проверь",
      "качеств",
      "质量",
      "检查",
    ])
  ) {
    return "quality-guardian";
  }

  if (
    hasAnyKeyword(normalized, [
      "ux",
      "design",
      "usability",
      "accessibility",
      "interface",
      "ui",
      "cognitive",
      "user experience",
      "дизайн",
      "удобство",
      "интерфейс",
      "доступност",
      "用户体验",
      "界面",
      "可用性",
    ])
  ) {
    return "ux-guardian";
  }

  if (
    hasAnyKeyword(normalized, ["search", "find", "lookup", "найд", "поищ", "搜索", "查找"])
  ) {
    return "search-agent";
  }

  if (hasAtRiskProject) {
    return "risk-researcher";
  }

  if (overdueTasks.length) {
    return "status-reporter";
  }

  return "portfolio-analyst";
}

export function resolveAgentId(agentId: string, context: AIContextSnapshot, prompt: string) {
  if (agentId === AUTO_AGENT_ID) {
    return routeToAgentId(prompt, context);
  }

  return getAgentById(agentId)?.id ?? "portfolio-analyst";
}

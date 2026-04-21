import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveActor, requireUser } from "@/lib/orchestration/actor";
import { logger } from "@/lib/logger";
import { runAgentExecution } from "@/lib/ai/agent-executor";
import { getRouter } from "@/lib/ai/providers";
import type { Message } from "@/lib/ai/providers";

const ASK_PROJECT_PROVIDER_CHAIN = ["openrouter", "zai", "mock"] as const;
const ASK_PROJECT_MODEL_HINTS: Record<string, string> = {
  openrouter: "google/gemini-3.1-flash-lite-preview",
  zai: "glm-5",
  openai: "gpt-5.2",
  mock: "mock",
};
const ASK_PROJECT_TIMEOUT_MS = 30_000;
const ASK_PROJECT_RETRYABLE = [
  "econnreset",
  "etimedout",
  "rate limit",
  "rate_limit",
  "overloaded",
  "timeout",
  "429",
  "502",
  "503",
  "504",
];

function isAskProjectRetryable(message: string): boolean {
  const lower = message.toLowerCase();
  return ASK_PROJECT_RETRYABLE.some((t) => lower.includes(t));
}

async function runAskProjectAttempt(
  systemPrompt: string,
  question: string,
  provider: string,
  runId: string,
  workspaceId: string
): Promise<{
  content: string;
  tokens: number;
  model: string;
  provider: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_PROJECT_TIMEOUT_MS);

  try {
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ];
    const result = await runAgentExecution(messages, {
      router: getRouter(),
      provider,
      agentId: "search-agent",
      runId,
      workspaceId,
      enableTools: false,
      signal: controller.signal,
    });
    if (result.aborted) {
      throw new Error(`Execution aborted (duration=${result.durationMs}ms)`);
    }
    const content = result.finalContent ?? "";
    return {
      content,
      tokens: Math.ceil((systemPrompt.length + question.length + content.length) / 4),
      model: ASK_PROJECT_MODEL_HINTS[provider] ?? "unknown",
      provider,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runAskProjectWithFallback(
  systemPrompt: string,
  question: string,
  workspaceId: string
): Promise<{
  content: string;
  tokens: number;
  model: string;
  provider: string;
  success: boolean;
  error?: string;
}> {
  const runId = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let lastError: string | undefined;

  for (const provider of ASK_PROJECT_PROVIDER_CHAIN) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await runAskProjectAttempt(
          systemPrompt,
          question,
          provider,
          runId,
          workspaceId
        );
        return { ...res, success: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn("ask-project: attempt failed", {
          provider,
          attempt,
          error: lastError,
        });
        if (!isAskProjectRetryable(lastError)) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  return {
    content: "",
    tokens: 0,
    model: "unknown",
    provider: "none",
    success: false,
    error: lastError,
  };
}

/**
 * POST /api/orchestration/ask-project
 * "Спроси проект" — natural language query over project data.
 *
 * Body: { projectId, question, workspaceId? }
 * Returns: structured answer with data context.
 */
export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);

  const { projectId, question, workspaceId } = await req.json();

  if (!projectId || !question) {
    return NextResponse.json({ error: "projectId and question required" }, { status: 400 });
  }

  try {
    // 1. Gather project context
    const context = await buildProjectContext(projectId);

    if (!context.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 2. Build prompt with context
    const systemPrompt = buildSystemPrompt(context);

    // 3. Execute via the canonical `runAgentExecution` kernel (Wave F —
    // migrated off the deprecated `ImprovedAgentExecutor`). Cost is
    // tracked automatically by the kernel via `trackCost`.
    const result = await runAskProjectWithFallback(
      systemPrompt,
      question,
      workspaceId ?? "default"
    );

    return NextResponse.json({
      answer: result.content,
      success: result.success,
      tokens: result.tokens,
      model: result.model,
      context: {
        projectName: context.project.name,
        taskCount: context.tasks.length,
        riskCount: context.risks.length,
        membersCount: context.members.length,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("ask-project: failed", { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Context builder ──

interface ProjectContext {
  project: {
    name: string;
    status: string;
    budgetPlan: number | null;
    budgetFact: number | null;
    start: Date;
    end: Date;
    progress: number;
  } | null;
  tasks: Array<{
    title: string;
    status: string;
    priority: string;
    assigneeName: string | null;
    dueDate: Date | null;
  }>;
  risks: Array<{
    title: string;
    probability: string;
    impact: string;
    status: string;
  }>;
  members: Array<{
    displayName: string;
    role: string;
  }>;
  recentActivity: string[];
  evm: {
    cpi: number | null;
    spi: number | null;
    percentComplete: number;
  };
}

async function buildProjectContext(projectId: string): Promise<ProjectContext> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      status: true,
      budgetPlan: true,
      budgetFact: true,
      start: true,
      end: true,
      progress: true,
    },
  });

  const emptyCtx: ProjectContext = { project: null, tasks: [], risks: [], members: [], recentActivity: [], evm: { cpi: null, spi: null, percentComplete: 0 } };
  if (!project) return emptyCtx;

  const [tasks, risks] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      select: {
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        assignee: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.risk.findMany({
      where: { projectId },
      select: { title: true, probability: true, impact: true, status: true },
      take: 20,
    }),
  ]);

  // Get members via project → boards → memberships or direct workspace lookup
  // Use a simple approach: get task assignees as team proxy
  const assigneeNames = new Set<string>();
  for (const t of tasks) {
    if (t.assignee?.name) assigneeNames.add(t.assignee.name);
  }

  // Calculate EVM metrics
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const percentComplete = project.progress ?? (totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0);

  // Basic CPI approximation
  const budgetPlan = project.budgetPlan ?? 0;
  const budgetFact = project.budgetFact ?? 0;
  const cpi = budgetFact > 0 && budgetPlan > 0 ? Number(((budgetPlan * percentComplete / 100) / budgetFact).toFixed(2)) : null;

  // SPI: compare schedule vs actual
  let spi: number | null = null;
  if (project.start && project.end) {
    const totalDays = (project.end.getTime() - project.start.getTime()) / (1000 * 60 * 60 * 24);
    const elapsedDays = (Date.now() - project.start.getTime()) / (1000 * 60 * 60 * 24);
    const plannedPct = totalDays > 0 ? Math.min(100, (elapsedDays / totalDays) * 100) : 0;
    spi = plannedPct > 0 ? Number((percentComplete / plannedPct).toFixed(2)) : null;
  }

  return {
    project,
    tasks: tasks.map((t) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      assigneeName: t.assignee?.name ?? null,
      dueDate: t.dueDate,
    })),
    risks: risks.map((r) => ({
      title: r.title,
      probability: r.probability,
      impact: r.impact,
      status: r.status,
    })),
    members: [...assigneeNames].map((name) => ({ displayName: name, role: "member" })),
    recentActivity: [],
    evm: { cpi, spi, percentComplete },
  };
}

function buildSystemPrompt(ctx: ProjectContext): string {
  const p = ctx.project!;
  const lines: string[] = [
    `Ты — аналитик проекта "${p.name}". Отвечай на русском языке, кратко и по существу.`,
    ``,
    `== Проект ==`,
    `Название: ${p.name}`,
    `Статус: ${p.status}`,
    `Бюджет: ${p.budgetPlan?.toLocaleString() ?? "не задан"} ₽, факт: ${p.budgetFact?.toLocaleString() ?? 0} ₽`,
    `Даты: ${p.start.toLocaleDateString("ru")} — ${p.end.toLocaleDateString("ru")}`,
    ``,
    `== EVM метрики ==`,
    `Выполнено: ${ctx.evm.percentComplete}%`,
    ctx.evm.cpi !== null ? `CPI: ${ctx.evm.cpi} ${ctx.evm.cpi < 0.9 ? "⚠️ КРАСНАЯ ЗОНА" : ctx.evm.cpi < 1.0 ? "⚡ ЖЁЛТАЯ ЗОНА" : "✅"}` : "",
    ctx.evm.spi !== null ? `SPI: ${ctx.evm.spi} ${ctx.evm.spi < 0.9 ? "⚠️ ОТСТАВАНИЕ" : ctx.evm.spi < 1.0 ? "⚡ ЗАМЕДЛЕНИЕ" : "✅"}` : "",
    ``,
    `== Задачи (${ctx.tasks.length}) ==`,
  ];

  const byStatus: Record<string, number> = {};
  for (const t of ctx.tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }
  for (const [s, c] of Object.entries(byStatus)) {
    lines.push(`  ${s}: ${c}`);
  }

  const overdue = ctx.tasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done"
  );
  if (overdue.length > 0) {
    lines.push(``, `⚠️ Просроченные (${overdue.length}):`);
    for (const t of overdue.slice(0, 10)) {
      lines.push(`  - "${t.title}" (${t.assigneeName ?? "без исполнителя"})`);
    }
  }

  if (ctx.risks.length > 0) {
    lines.push(``, `== Риски (${ctx.risks.length}) ==`);
    for (const r of ctx.risks.slice(0, 10)) {
      lines.push(`  - ${r.title} [${r.probability}/${r.impact}] — ${r.status}`);
    }
  }

  if (ctx.members.length > 0) {
    lines.push(``, `== Команда (${ctx.members.length}) ==`);
    for (const m of ctx.members) {
      lines.push(`  - ${m.displayName} (${m.role})`);
    }
  }

  lines.push(
    ``,
    `Используй эти данные для ответа. Если данных недостаточно — скажи об этом.`,
    `Включай конкретные цифры, имена и статусы в ответ.`
  );

  return lines.filter(Boolean).join("\n");
}

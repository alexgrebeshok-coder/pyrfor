import { addDays, format } from "date-fns";

import type {
  AIActionProposal,
  AIActionType,
  AIRunInput,
  AIRunResult,
} from './types';
import { attachRunGrounding } from './grounding';
import { normalizeChatConfidence, normalizeChatFacts } from './chat-response';
import type { Priority } from '../types/types';

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789/v1/chat/completions";
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

type ParsedGatewayResult = {
  title: string;
  summary: string;
  highlights: string[];
  nextSteps: string[];
  facts?: Array<Record<string, unknown>>;
  confidence?: Record<string, unknown> | null;
  proposal?: {
    type?: string;
    title?: string;
    summary?: string;
    tasks?: Array<Record<string, unknown>>;
    taskUpdates?: Array<Record<string, unknown>>;
    taskReschedules?: Array<Record<string, unknown>>;
    risks?: Array<Record<string, unknown>>;
    statusReport?: Record<string, unknown> | null;
    notifications?: Array<Record<string, unknown>>;
  } | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

function normalizeGatewayUrl(input?: string | null) {
  const raw = input?.trim() || DEFAULT_GATEWAY_URL;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    if (parsed.pathname === "/" || parsed.pathname.length === 0) {
      parsed.pathname = CHAT_COMPLETIONS_PATH;
    } else if (!parsed.pathname.endsWith(CHAT_COMPLETIONS_PATH)) {
      parsed.pathname = CHAT_COMPLETIONS_PATH;
    }
    return parsed.toString();
  } catch {
    return DEFAULT_GATEWAY_URL;
  }
}

function parseObject(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function stripCodeFences(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function stripModelMarkers(text: string) {
  let result = text.trim();
  const markers = [
    /(?:<\|im_end\|>)+\s*$/i,
    /(?:<\|endoftext\|>)+\s*$/i,
    /(?:<\|eot_id\|>)+\s*$/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of markers) {
      const next = result.replace(pattern, "").trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }

  return result;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizePriority(value: unknown): Priority {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }

  return "medium";
}

function normalizeDueDate(value: unknown, index: number) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return format(addDays(new Date(), index + 2), "yyyy-MM-dd");
}

function normalizeActionType(value: unknown): AIActionType | null {
  return value === "create_tasks" ||
    value === "update_tasks" ||
    value === "reschedule_tasks" ||
    value === "raise_risks" ||
    value === "draft_status_report" ||
    value === "notify_team"
    ? value
    : null;
}

function ensureStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;

  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 4);

  return normalized.length ? normalized : fallback;
}

function collectOutputText(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim().length ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectOutputText(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const text: string[] = [];

  if (typeof record.text === "string" && record.text.trim().length) {
    text.push(record.text);
  }

  if (typeof record.delta === "string" && record.delta.trim().length) {
    text.push(record.delta);
  }

  // OpenAI Chat Completions format: choices[0].message.content
  if (Array.isArray(record.choices)) {
    const choice = record.choices[0] as Record<string, unknown> | undefined;
    if (choice?.message) {
      const msg = choice.message as Record<string, unknown>;
      if (typeof msg.content === "string" && msg.content.trim().length) {
        text.push(msg.content);
      }
    }
  }

  return [
    ...text,
    ...collectOutputText(record.output),
    ...collectOutputText(record.content),
    ...collectOutputText(record.response),
  ];
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (response.ok) {
        clearTimeout(timeoutId);
        return response;
      }

      const responseText = await response.text();
      lastError = new Error(
        responseText.trim().length
          ? `Gateway responded with ${response.status}: ${responseText.slice(0, 500)}`
          : `Gateway responded with ${response.status}`
      );

      if (response.status < 500 && response.status !== 429 && response.status !== 408) {
        clearTimeout(timeoutId);
        throw lastError;
      }
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.name === "AbortError"
            ? new Error("Gateway request timed out.")
            : error
          : new Error(String(error));
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < retries - 1) {
      await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }
  }

  throw lastError ?? new Error("Gateway request failed after retries.");
}

async function consumeSseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Gateway returned an empty SSE body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "message";
  let dataLines: string[] = [];
  let terminal = false;
  let failed = false;
  let errorMessage: string | null = null;
  let lastPayload: Record<string, unknown> | null = null;
  const deltas: string[] = [];

  const dispatch = () => {
    if (!dataLines.length) {
      eventType = "message";
      return;
    }

    const data = dataLines.join("\n");
    const trimmed = data.trim();
    const payload = parseObject(trimmed);
    if (payload) {
      lastPayload = payload;
    }

    const payloadType =
      typeof payload?.type === "string" ? payload.type.toLowerCase() : eventType.toLowerCase();
    const payloadStatus =
      typeof payload?.status === "string" ? payload.status.toLowerCase() : null;

    if (trimmed === "[DONE]") {
      terminal = true;
    } else if (
      payloadType.includes("response.output_text.delta") &&
      typeof payload?.delta === "string"
    ) {
      deltas.push(payload.delta);
    } else if (payload && Array.isArray(payload.choices)) {
      // OpenAI Chat Completions SSE format: choices[0].delta.content
      const choice = payload.choices[0] as Record<string, unknown> | undefined;
      const delta = choice?.delta as Record<string, unknown> | undefined;
      const content = delta?.content;
      if (typeof content === "string") {
        deltas.push(content);
      }
      // Check finish_reason
      if (choice?.finish_reason) {
        terminal = true;
      }
    } else if (
      payloadType.includes("failed") ||
      payloadType.includes("error") ||
      payloadStatus === "failed" ||
      payloadStatus === "error"
    ) {
      terminal = true;
      failed = true;
      errorMessage =
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.message === "string" && payload.message) ||
        trimmed ||
        "Gateway SSE stream failed.";
    } else if (
      payloadType.includes("completed") ||
      payloadType.includes("done") ||
      payloadStatus === "completed" ||
      payloadStatus === "done"
    ) {
      terminal = true;
    }

    dataLines = [];
    eventType = "message";
  };

  while (!terminal) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line.length === 0) {
        dispatch();
        if (terminal) break;
        continue;
      }

      if (line.startsWith(":")) continue;

      const separatorIndex = line.indexOf(":");
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const rawValue =
        separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).replace(/^ /, "");

      if (field === "event") {
        eventType = rawValue || "message";
      } else if (field === "data") {
        dataLines.push(rawValue);
      }
    }
  }

  const streamedText = deltas.join("").trim();
  const payloadText = collectOutputText(lastPayload).join("\n").trim();

  if (failed) {
    throw new Error(errorMessage ?? "Gateway SSE stream failed.");
  }

  const text = streamedText || payloadText;
  if (!text) {
    throw new Error("Gateway completed without returning text.");
  }

  return text;
}

function buildContextDigest(input: AIRunInput) {
  const { context } = input;
  const project = context.project;
  const relevantTasks = (project ? context.projectTasks : context.tasks)
    ?.slice(0, 10)
    .map((task) => ({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      assignee: task.assignee,
      dueDate: task.dueDate,
      priority: task.priority,
      blockedReason: task.blockedReason ?? null,
    }));

  const relevantRisks = context.risks
    .filter((risk) => (project ? risk.projectId === project.id : true))
    .slice(0, 8)
    .map((risk) => ({
      id: risk.id,
      projectId: risk.projectId,
      title: risk.title,
      owner: risk.owner,
      probability: risk.probability,
      impact: risk.impact,
      status: risk.status,
      mitigation: risk.mitigation,
    }));

  return {
    locale: context.locale,
    activeContext: context.activeContext,
    agent: {
      id: input.agent.id,
      kind: input.agent.kind,
    },
    quickAction: input.quickAction
      ? {
          id: input.quickAction.id,
          kind: input.quickAction.kind,
        }
      : null,
    source: input.source ?? null,
    currentProject: project
      ? {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          progress: project.progress,
          health: project.health,
          priority: project.priority,
          location: project.location,
          dates: project.dates,
          nextMilestone: project.nextMilestone,
          team: project.team,
          objectives: project.objectives,
          budget: project.budget,
        }
      : null,
    portfolio: context.projects.slice(0, 6).map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      progress: item.progress,
      health: item.health,
      priority: item.priority,
      nextMilestone: item.nextMilestone,
    })),
    tasks: relevantTasks ?? [],
    risks: relevantRisks,
    team: context.team.slice(0, 8).map((member) => ({
      name: member.name,
      role: member.role,
      capacity: member.capacity,
      allocated: member.allocated,
      projects: member.projects,
    })),
    notifications: context.notifications.slice(0, 6).map((item) => ({
      title: item.title,
      description: item.description,
      severity: item.severity,
    })),
  };
}

export function buildGatewayPrompt(input: AIRunInput, runId: string) {
  const localeLabel =
    input.context.locale === "zh"
      ? "Simplified Chinese"
      : input.context.locale === "en"
        ? "English"
        : "Russian";

  return `
You are CEOClaw AI Workspace inside a project management dashboard.
Return valid raw JSON only. Do not use markdown. Do not wrap the response in code fences.
Language: ${localeLabel}
Run ID: ${runId}

Response schema:
{
  "title": "short string",
  "summary": "short executive summary",
  "highlights": ["2 to 4 short strings"],
  "nextSteps": ["2 to 4 short strings"],
  "proposal": null | {
    "type": "create_tasks|update_tasks|reschedule_tasks|raise_risks|draft_status_report|notify_team",
    "title": "short string",
    "summary": "short string",
    "tasks": [{"projectId": "existing project id", "title": "task title", "description": "task description", "assignee": "existing team member name", "dueDate": "YYYY-MM-DD", "priority": "low|medium|high|critical", "reason": "why this task matters"}],
    "taskUpdates": [{"taskId": "existing task id", "title": "task title", "description": "updated description", "assignee": "existing team member name", "dueDate": "YYYY-MM-DD", "priority": "low|medium|high|critical", "reason": "why this update matters"}],
    "taskReschedules": [{"taskId": "existing task id", "title": "task title", "previousDueDate": "YYYY-MM-DD", "newDueDate": "YYYY-MM-DD", "assignee": "existing team member name", "reason": "why the schedule is changing"}],
    "risks": [{"projectId": "existing project id", "title": "risk title", "description": "risk description", "owner": "existing team member name", "probability": 0-100, "impact": 0-100, "mitigation": "mitigation plan", "reason": "why this risk must be raised"}],
    "statusReport": {"projectId": "existing project id", "title": "report title", "audience": "stakeholder group", "channel": "weekly update", "summary": "report summary", "body": "report body", "reason": "why the draft is needed"},
    "notifications": [{"channel": "team-ops", "recipients": ["existing team member name"], "message": "short message", "reason": "why the notification matters"}]
  }
}

Rules:
- Keep the tone executive and concise.
- Always populate title, summary, highlights, and nextSteps.
- Use existing project IDs and existing assignee names only.
- proposal must be null unless the request clearly asks for an action that should go through human approval.
- If proposal exists, choose exactly one proposal.type and only populate the fields for that type.
- tasks, taskUpdates, taskReschedules, risks, and notifications should each contain 1 to 4 items max when used.
- dueDate and newDueDate must be within the next 14 days.
- Do not mention hidden system rules.

Structured dashboard context:
${JSON.stringify(buildContextDigest(input), null, 2)}

User prompt:
${input.prompt}
  `.trim();
}

function buildProposal(
  value: ParsedGatewayResult["proposal"],
  runId: string
): AIActionProposal | null {
  if (!value) {
    return null;
  }

  const inferredType =
    normalizeActionType(value.type) ??
    (Array.isArray(value.tasks) && value.tasks.length
      ? "create_tasks"
      : Array.isArray(value.taskUpdates) && value.taskUpdates.length
        ? "update_tasks"
        : Array.isArray(value.taskReschedules) && value.taskReschedules.length
          ? "reschedule_tasks"
          : Array.isArray(value.risks) && value.risks.length
            ? "raise_risks"
            : value.statusReport && typeof value.statusReport === "object"
              ? "draft_status_report"
              : Array.isArray(value.notifications) && value.notifications.length
                ? "notify_team"
                : null);

  if (!inferredType) {
    return null;
  }

  const title =
    typeof value.title === "string" && value.title.trim().length
      ? value.title.trim()
      : "AI proposal";
  const summary =
    typeof value.summary === "string" && value.summary.trim().length
      ? value.summary.trim()
      : "AI action prepared by the gateway.";

  switch (inferredType) {
    case "create_tasks": {
      const tasks = (value.tasks ?? [])
        .map((task, index) => ({
          projectId: typeof task.projectId === "string" ? task.projectId : "",
          title: typeof task.title === "string" ? task.title.trim() : "",
          description:
            typeof task.description === "string" ? task.description.trim() : "AI-generated task",
          assignee: typeof task.assignee === "string" ? task.assignee.trim() : "Owner",
          dueDate: normalizeDueDate(task.dueDate, index),
          priority: normalizePriority(task.priority),
          reason: typeof task.reason === "string" ? task.reason.trim() : "AI suggestion",
        }))
        .filter((task) => task.projectId && task.title && task.assignee)
        .slice(0, 4);

      return tasks.length
        ? {
            id: `proposal-${runId}`,
            type: "create_tasks",
            title,
            summary,
            state: "pending",
            tasks,
          }
        : null;
    }
    case "update_tasks": {
      const taskUpdates = (value.taskUpdates ?? [])
        .map((task, index) => ({
          taskId: typeof task.taskId === "string" ? task.taskId : "",
          title: typeof task.title === "string" ? task.title.trim() : "",
          description:
            typeof task.description === "string" ? task.description.trim() : undefined,
          assignee:
            typeof task.assignee === "string" && task.assignee.trim().length
              ? task.assignee.trim()
              : undefined,
          dueDate: task.dueDate ? normalizeDueDate(task.dueDate, index) : undefined,
          priority: task.priority ? normalizePriority(task.priority) : undefined,
          reason: typeof task.reason === "string" ? task.reason.trim() : "AI suggestion",
        }))
        .filter((task) => task.taskId && task.title)
        .slice(0, 4);

      return taskUpdates.length
        ? {
            id: `proposal-${runId}`,
            type: "update_tasks",
            title,
            summary,
            state: "pending",
            tasks: [],
            taskUpdates,
          }
        : null;
    }
    case "reschedule_tasks": {
      const taskReschedules = (value.taskReschedules ?? [])
        .map((task, index) => ({
          taskId: typeof task.taskId === "string" ? task.taskId : "",
          title: typeof task.title === "string" ? task.title.trim() : "",
          previousDueDate:
            typeof task.previousDueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.previousDueDate)
              ? task.previousDueDate
              : normalizeDueDate(task.previousDueDate, index),
          newDueDate: normalizeDueDate(task.newDueDate, index + 1),
          assignee:
            typeof task.assignee === "string" && task.assignee.trim().length
              ? task.assignee.trim()
              : undefined,
          reason: typeof task.reason === "string" ? task.reason.trim() : "AI suggestion",
        }))
        .filter((task) => task.taskId && task.title)
        .slice(0, 4);

      return taskReschedules.length
        ? {
            id: `proposal-${runId}`,
            type: "reschedule_tasks",
            title,
            summary,
            state: "pending",
            tasks: [],
            taskReschedules,
          }
        : null;
    }
    case "raise_risks": {
      const risks = (value.risks ?? [])
        .map((risk) => ({
          projectId: typeof risk.projectId === "string" ? risk.projectId : "",
          title: typeof risk.title === "string" ? risk.title.trim() : "",
          description:
            typeof risk.description === "string" ? risk.description.trim() : "AI-generated risk",
          owner: typeof risk.owner === "string" ? risk.owner.trim() : "Owner",
          probability:
            typeof risk.probability === "number" ? Math.max(0, Math.min(100, risk.probability)) : 60,
          impact: typeof risk.impact === "number" ? Math.max(0, Math.min(100, risk.impact)) : 60,
          mitigation:
            typeof risk.mitigation === "string" ? risk.mitigation.trim() : "Mitigation pending.",
          reason: typeof risk.reason === "string" ? risk.reason.trim() : "AI suggestion",
        }))
        .filter((risk) => risk.projectId && risk.title && risk.owner)
        .slice(0, 4);

      return risks.length
        ? {
            id: `proposal-${runId}`,
            type: "raise_risks",
            title,
            summary,
            state: "pending",
            tasks: [],
            risks,
          }
        : null;
    }
    case "draft_status_report": {
      const report = value.statusReport;
      if (!report || typeof report !== "object") {
        return null;
      }

      const projectId =
        typeof report.projectId === "string" && report.projectId.trim().length
          ? report.projectId.trim()
          : undefined;
      const reportTitle =
        typeof report.title === "string" && report.title.trim().length
          ? report.title.trim()
          : "Status draft";
      const audience =
        typeof report.audience === "string" && report.audience.trim().length
          ? report.audience.trim()
          : "Stakeholders";
      const channel =
        typeof report.channel === "string" && report.channel.trim().length
          ? report.channel.trim()
          : "weekly update";
      const reportSummary =
        typeof report.summary === "string" && report.summary.trim().length
          ? report.summary.trim()
          : summary;
      const body =
        typeof report.body === "string" && report.body.trim().length
          ? report.body.trim()
          : reportSummary;

      return {
        id: `proposal-${runId}`,
        type: "draft_status_report",
        title,
        summary,
        state: "pending",
        tasks: [],
        statusReport: {
          projectId,
          title: reportTitle,
          audience,
          channel,
          summary: reportSummary,
          body,
          reason:
            typeof report.reason === "string" && report.reason.trim().length
              ? report.reason.trim()
              : "AI suggestion",
        },
      };
    }
    case "notify_team": {
      const notifications = (value.notifications ?? [])
        .map((item) => ({
          channel:
            typeof item.channel === "string" && item.channel.trim().length
              ? item.channel.trim()
              : "team-ops",
          recipients: Array.isArray(item.recipients)
            ? item.recipients
                .filter(
                  (recipient): recipient is string =>
                    typeof recipient === "string" && recipient.trim().length > 0
                )
                .map((recipient) => recipient.trim())
                .slice(0, 6)
            : [],
          message:
            typeof item.message === "string" && item.message.trim().length
              ? item.message.trim()
              : "",
          reason:
            typeof item.reason === "string" && item.reason.trim().length
              ? item.reason.trim()
              : "AI suggestion",
        }))
        .filter((item) => item.recipients.length > 0 && item.message.length > 0)
        .slice(0, 4);

      return notifications.length
        ? {
            id: `proposal-${runId}`,
            type: "notify_team",
            title,
            summary,
            state: "pending",
            tasks: [],
            notifications,
          }
        : null;
    }
  }
}

export function parseGatewayResult(rawText: string, runId: string): AIRunResult {
  const normalizedText = stripModelMarkers(stripCodeFences(rawText));
  const parsed = parseObject(normalizedText);
  if (!parsed) {
    const fallbackSummary = normalizedText || "Gateway returned an empty response.";
    const fallbackLine =
      fallbackSummary
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "Gateway response";

    return {
      title: truncateText(fallbackLine, 96),
      summary: fallbackSummary,
      highlights: [truncateText(fallbackLine, 240)],
      nextSteps: [],
      proposal: null,
    };
  }

  const result = parsed as ParsedGatewayResult;
  if (
    typeof result.title !== "string" ||
    typeof result.summary !== "string" ||
    !Array.isArray(result.highlights) ||
    !Array.isArray(result.nextSteps)
  ) {
    const fallbackSummary =
      collectOutputText(result).join("\n").trim() || normalizedText || "Gateway returned an empty response.";
    const fallbackLine =
      fallbackSummary
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "Gateway response";

    return {
      title:
        typeof result.title === "string" && result.title.trim().length > 0
          ? result.title.trim()
          : truncateText(fallbackLine, 96),
      summary:
        typeof result.summary === "string" && result.summary.trim().length > 0
          ? result.summary.trim()
          : fallbackSummary,
      highlights: Array.isArray(result.highlights)
        ? ensureStringArray(result.highlights, [truncateText(fallbackLine, 240)])
        : [truncateText(fallbackLine, 240)],
      nextSteps: Array.isArray(result.nextSteps)
        ? ensureStringArray(result.nextSteps, [])
        : [],
      facts: normalizeChatFacts(result.facts),
      confidence: normalizeChatConfidence(result.confidence),
      proposal: buildProposal(result.proposal ?? null, runId),
    };
  }

  return {
    title: result.title.trim(),
    summary: result.summary.trim(),
    highlights: ensureStringArray(result.highlights, ["No highlights returned by gateway."]),
    nextSteps: ensureStringArray(result.nextSteps, ["No next steps returned by gateway."]),
    facts: normalizeChatFacts(result.facts),
    confidence: normalizeChatConfidence(result.confidence),
    proposal: buildProposal(result.proposal ?? null, runId),
  };
}

export async function invokeOpenClawGateway(
  input: AIRunInput,
  runId: string,
  options?: { promptOverride?: string }
) {
  const gatewayUrl = normalizeGatewayUrl(process.env.OPENCLAW_GATEWAY_URL);
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  const prompt = options?.promptOverride ?? buildGatewayPrompt(input, runId);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "text/event-stream",
    "x-openclaw-session-key": `pm-dashboard:${runId}`,
  };

  if (token) {
    headers["x-openclaw-auth"] = token;
    headers.authorization = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  }

  const response = await fetchWithRetry(gatewayUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw:main",
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const outputText = await consumeSseText(response);
  return attachRunGrounding(parseGatewayResult(outputText, runId), input);
}

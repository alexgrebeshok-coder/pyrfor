import { buildAIRunTrace } from "@/lib/ai/trace";
import { getServerAIRunEntry, listServerAIRunEntries, type ServerAIRunEntry } from "@/lib/ai/server-runs";
import type { AIActionProposal, AIApplyResult } from "@/lib/ai/types";
import {
  getEvidenceFusionOverview,
  getEvidenceLedgerOverview,
  type EvidenceFusionOverview,
  type EvidenceListResult,
} from "@/lib/evidence";
import { getWorkReportById } from "@/lib/work-reports/service";
import type { WorkReportView } from "@/lib/work-reports/types";

import type {
  WorkflowAuditPack,
  WorkflowAuditPackCandidate,
  WorkflowAuditPackDecisionContext,
} from "./types";

const WORKFLOW_ID = "work_report_signal_packet";

interface AuditPackServiceDeps {
  getEvidenceFusion?: (input: {
    projectId?: string;
    limit?: number;
  }) => Promise<EvidenceFusionOverview>;
  getEvidenceLedger?: (input: {
    entityRef?: string;
    entityType?: string;
    limit?: number;
    projectId?: string;
  }) => Promise<EvidenceListResult>;
  getRunEntry?: (runId: string) => Promise<ServerAIRunEntry>;
  getWorkReport?: (reportId: string) => Promise<WorkReportView | null>;
  listRunEntries?: () => Promise<ServerAIRunEntry[]>;
  now?: () => Date;
}

export async function listWorkflowAuditPackCandidates(
  input: { limit?: number } = {},
  deps: AuditPackServiceDeps = {}
) {
  const listRunEntries = deps.listRunEntries ?? listServerAIRunEntries;
  const entries = await listRunEntries();

  return entries
    .filter(isSupportedWorkflowEntry)
    .sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt))
    .slice(0, input.limit ?? 12)
    .map(mapEntryToCandidate);
}

export async function getWorkflowAuditPack(
  runId: string,
  deps: AuditPackServiceDeps = {}
): Promise<WorkflowAuditPack> {
  const getRunEntry = deps.getRunEntry ?? getServerAIRunEntry;
  const getEvidenceLedger = deps.getEvidenceLedger ?? getEvidenceLedgerOverview;
  const getEvidenceFusion = deps.getEvidenceFusion ?? getEvidenceFusionOverview;
  const getWorkReport = deps.getWorkReport ?? getWorkReportById;
  const now = deps.now ?? (() => new Date());

  const entry = await getRunEntry(runId);
  if (!isSupportedWorkflowEntry(entry)) {
    throw new Error(`AI run ${runId} is not a supported audit-pack workflow.`);
  }

  const source = entry.input.source;
  const trace = buildAIRunTrace(entry);
  const [workReport, evidence, corroboration] = await Promise.all([
    source.entityType === "work_report" ? getWorkReport(source.entityId) : Promise.resolve(null),
    getEvidenceLedger({
      entityType: source.entityType,
      entityRef: source.entityId,
      limit: 12,
      ...(source.projectId ? { projectId: source.projectId } : {}),
    }),
    getEvidenceFusion({
      ...(source.projectId ? { projectId: source.projectId } : {}),
      limit: 6,
    }),
  ]);

  const generatedAt = now().toISOString();
  const decision = buildDecisionContext(
    entry.run.result?.proposal ?? null,
    entry.run.result?.actionResult ?? null
  );

  const pack: WorkflowAuditPack = {
    artifact: {
      content: "",
      fileName: buildAuditPackFileName(entry, generatedAt),
      format: "markdown",
      mediaType: "text/markdown",
    },
    corroborationFacts: corroboration.facts,
    decision,
    evidence: {
      records: evidence.records,
      summary: evidence.summary,
      sync: evidence.sync,
    },
    scope: {
      workflow: source.workflow,
      generatedAt,
      runId: entry.run.id,
      packetId: source.packetId ?? null,
      packetLabel: source.packetLabel ?? null,
      projectId: source.projectId ?? null,
      projectName: source.projectName ?? null,
      sourceEntityType: source.entityType,
      sourceEntityId: source.entityId,
      sourceEntityLabel: source.entityLabel,
    },
    sourceLinks: buildSourceLinks(entry),
    trace,
    workReport,
  };

  pack.artifact.content = buildWorkflowAuditPackMarkdown(pack);
  return pack;
}

export function buildWorkflowAuditPackMarkdown(pack: WorkflowAuditPack) {
  const lines = [
    "# CEOClaw Audit Pack",
    "",
    `Generated at: ${pack.scope.generatedAt}`,
    `Workflow: ${pack.scope.workflow}`,
    `Run ID: ${pack.scope.runId}`,
    `Packet ID: ${pack.scope.packetId ?? "n/a"}`,
    `Packet label: ${pack.scope.packetLabel ?? "n/a"}`,
    `Project: ${pack.scope.projectName ?? "n/a"}`,
    `Source entity: ${pack.scope.sourceEntityType} ${pack.scope.sourceEntityLabel}`,
    "",
    "## Scope",
    "",
    `- Evidence records included: ${pack.evidence.records.length}`,
    `- Corroboration facts included: ${pack.corroborationFacts.length}`,
    `- Trace status: ${pack.trace.status}`,
    `- Decision state: ${pack.decision.status}`,
    "",
    "## Work Report Context",
    "",
    ...buildWorkReportSection(pack.workReport),
    "",
    "## Evidence Ledger",
    "",
    `Evidence sync status: ${pack.evidence.sync?.status ?? "idle"}`,
    `Last evidence sync: ${pack.evidence.sync?.lastCompletedAt ?? "n/a"}`,
    ...buildEvidenceSection(pack.evidence.records),
    "",
    "## Corroboration Facts",
    "",
    ...buildCorroborationSection(pack.corroborationFacts),
    "",
    "## AI Trace",
    "",
    `Model: ${pack.trace.model.name}`,
    `Model status: ${pack.trace.model.status}`,
    `Prompt preview: ${pack.trace.promptPreview}`,
    "",
    "### Trace Steps",
    "",
    ...pack.trace.steps.flatMap((step, index) => [
      `${index + 1}. ${step.label}`,
      `Status: ${step.status}`,
      `Summary: ${step.summary}`,
      `Started: ${step.startedAt ?? "n/a"}`,
      `Ended: ${step.endedAt ?? "n/a"}`,
      "",
    ]),
    "## Decision Context",
    "",
    `Decision state: ${pack.decision.status}`,
    `Operator summary: ${pack.decision.operatorSummary}`,
    ...buildDecisionSection(pack.decision),
    "",
    "## Source Links",
    "",
    ...pack.sourceLinks.map((link) => `- ${link.label}: ${link.href}`),
  ];

  return lines.join("\n").trimEnd().concat("\n");
}

function buildWorkReportSection(workReport: WorkReportView | null) {
  if (!workReport) {
    return ["No linked work report could be loaded for this audit pack."];
  }

  return [
    `Report: ${workReport.reportNumber}`,
    `Status: ${workReport.status}`,
    `Section: ${workReport.section}`,
    `Shift date: ${workReport.reportDate}`,
    `Submitted at: ${workReport.submittedAt}`,
    `Reviewed at: ${workReport.reviewedAt ?? "n/a"}`,
    `Author: ${workReport.author.name}`,
    `Reviewer: ${workReport.reviewer?.name ?? "n/a"}`,
    `Summary: ${workReport.workDescription}`,
  ];
}

function buildEvidenceSection(records: WorkflowAuditPack["evidence"]["records"]) {
  if (records.length === 0) {
    return ["No persisted evidence records matched the selected source entity."];
  }

  return records.flatMap((record) => [
    `- ${record.verificationStatus.toUpperCase()} · ${record.title}`,
    `  Source: ${record.sourceType}`,
    `  Confidence: ${record.confidence}`,
    `  Observed at: ${record.observedAt}`,
    `  Summary: ${record.summary ?? "n/a"}`,
  ]);
}

function buildCorroborationSection(facts: WorkflowAuditPack["corroborationFacts"]) {
  if (facts.length === 0) {
    return ["No corroboration facts were available for the selected project scope."];
  }

  return facts.flatMap((fact) => [
    `- ${fact.verificationStatus.toUpperCase()} · ${fact.title}`,
    `  Confidence: ${fact.confidence}`,
    `  Sources: ${fact.sourceCount}`,
    `  Explanation: ${fact.explanation}`,
  ]);
}

function buildDecisionSection(decision: WorkflowAuditPackDecisionContext) {
  const lines: string[] = [];

  if (decision.proposal) {
    lines.push(`Proposal: ${decision.proposal.title}`);
    lines.push(`Proposal type: ${decision.proposal.type}`);
    lines.push(`Proposal state: ${decision.proposal.state}`);
    lines.push(`Proposal summary: ${decision.proposal.summary}`);
  } else {
    lines.push("Proposal: none");
  }

  if (decision.applyResult) {
    lines.push(`Applied at: ${decision.applyResult.appliedAt}`);
    lines.push(`Apply summary: ${decision.applyResult.summary}`);
    lines.push(`Apply item count: ${decision.applyResult.itemCount}`);
    lines.push(`Compensation: ${decision.applyResult.safety.compensationSummary}`);
  } else {
    lines.push("Applied result: none");
  }

  return lines;
}

function buildDecisionContext(
  proposal: AIActionProposal | null,
  applyResult: AIApplyResult | null
): WorkflowAuditPackDecisionContext {
  if (applyResult) {
    return {
      status: "applied",
      proposal,
      applyResult,
      operatorSummary: applyResult.summary,
    };
  }

  if (proposal?.state === "dismissed") {
    return {
      status: "dismissed",
      proposal,
      applyResult: null,
      operatorSummary: "The operator dismissed this proposal without applying any changes.",
    };
  }

  if (proposal?.state === "pending") {
    return {
      status: "pending",
      proposal,
      applyResult: null,
      operatorSummary:
        "The workflow produced an approval-gated proposal, but no operator apply decision is recorded yet.",
    };
  }

  return {
    status: "none",
    proposal,
    applyResult: null,
    operatorSummary: "No explicit operator proposal or apply artifact is attached to this run.",
  };
}

function buildAuditPackFileName(entry: ServerAIRunEntry, generatedAt: string) {
  const source = entry.input.source;
  const packetPart = sanitizeFilePart(source?.packetId ?? "workflow");
  const generatedPart = generatedAt.replace(/[:]/g, "-");
  return `ceoclaw-audit-pack-${packetPart}-${generatedPart}.md`;
}

function buildSourceLinks(entry: ServerAIRunEntry) {
  const source = entry.input.source;
  const links = [
    { href: `/api/ai/runs/${entry.run.id}`, label: "Run API" },
    { href: `/api/ai/runs/${entry.run.id}/trace`, label: "Trace API" },
    { href: "/audit-packs", label: "Audit packs" },
    { href: "/work-reports", label: "Work reports" },
  ];

  if (source?.projectId) {
    links.push({ href: `/projects/${source.projectId}`, label: "Project detail" });
  }

  return links;
}

function isSupportedWorkflowEntry(entry: ServerAIRunEntry): entry is ServerAIRunEntry & {
  input: ServerAIRunEntry["input"] & { source: NonNullable<ServerAIRunEntry["input"]["source"]> };
} {
  return entry.input.source?.workflow === WORKFLOW_ID;
}

function mapEntryToCandidate(entry: ServerAIRunEntry): WorkflowAuditPackCandidate {
  const source = entry.input.source;
  const proposal = entry.run.result?.proposal ?? null;

  return {
    runId: entry.run.id,
    packetId: source?.packetId ?? null,
    packetLabel: source?.packetLabel ?? null,
    projectId: source?.projectId ?? null,
    projectName: source?.projectName ?? null,
    purpose: source?.purpose ?? null,
    purposeLabel: formatPurposeLabel(source?.purpose),
    sourceEntityId: source?.entityId ?? entry.run.id,
    sourceEntityLabel: source?.entityLabel ?? entry.run.title,
    status: entry.run.status,
    proposalState: proposal?.state ?? null,
    hasAppliedDecision: Boolean(entry.run.result?.actionResult),
    createdAt: entry.run.createdAt,
    updatedAt: entry.run.updatedAt,
  };
}

function formatPurposeLabel(purpose?: string) {
  if (!purpose) {
    return null;
  }

  switch (purpose) {
    case "tasks":
      return "Execution patch";
    case "risks":
      return "Risk additions";
    case "status":
      return "Executive status draft";
    default:
      return purpose.replace(/[_-]+/g, " ");
  }
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}


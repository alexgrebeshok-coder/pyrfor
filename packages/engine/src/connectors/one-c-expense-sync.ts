import { randomUUID } from "crypto";

import { prisma } from '../prisma';

import {
  getOneCFinanceTruthSnapshot,
  type OneCFinanceTruthSnapshot,
  type OneCProjectFinanceTruth,
} from "./one-c-client";

const ONE_C_EXPENSE_CATEGORY = {
  code: "one_c_actual_budget",
  name: "1C Actual Budget",
  color: "#0ea5e9",
  icon: "database",
} as const;

export interface OneCExpenseSyncItem {
  oneCRef: string;
  sourceProjectKey: string;
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  matchedProjectId: string | null;
  matchedProjectName: string | null;
  categoryCode: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  status: "approved";
  variance: number | null;
  paymentGap: number | null;
  actGap: number | null;
  budgetDeltaStatus: OneCProjectFinanceTruth["budgetDeltaStatus"];
  action: "upsert" | "skip";
  reason?: string;
}

export interface OneCExpenseSyncPreview {
  sourceStatus: OneCFinanceTruthSnapshot["status"];
  configured: boolean;
  checkedAt: string;
  missingSecrets: string[];
  summary: {
    sourceProjectCount: number;
    matchedProjectCount: number;
    readyToSyncCount: number;
    skippedCount: number;
  };
  items: OneCExpenseSyncItem[];
}

export interface OneCExpenseSyncResult extends OneCExpenseSyncPreview {
  created: number;
  updated: number;
  skipped: number;
}

export async function getOneCExpenseSyncPreview(): Promise<OneCExpenseSyncPreview> {
  const snapshot = await getOneCFinanceTruthSnapshot();
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });

  const items = snapshot.projects.map((record) => mapRecordToExpenseItem(record, projects));

  return {
    sourceStatus: snapshot.status,
    configured: snapshot.configured,
    checkedAt: snapshot.checkedAt,
    missingSecrets: snapshot.missingSecrets,
    summary: {
      sourceProjectCount: snapshot.projects.length,
      matchedProjectCount: items.filter((item) => item.matchedProjectId).length,
      readyToSyncCount: items.filter((item) => item.action === "upsert").length,
      skippedCount: items.filter((item) => item.action === "skip").length,
    },
    items,
  };
}

export async function syncOneCExpenses(): Promise<OneCExpenseSyncResult> {
  const preview = await getOneCExpenseSyncPreview();
  const readyItems = preview.items.filter((item) => item.action === "upsert" && item.matchedProjectId);

  const category = await prisma.expenseCategory.upsert({
    where: { code: ONE_C_EXPENSE_CATEGORY.code },
    update: {
      name: ONE_C_EXPENSE_CATEGORY.name,
      color: ONE_C_EXPENSE_CATEGORY.color,
      icon: ONE_C_EXPENSE_CATEGORY.icon,
    },
    create: {
      id: randomUUID(),
      code: ONE_C_EXPENSE_CATEGORY.code,
      name: ONE_C_EXPENSE_CATEGORY.name,
      color: ONE_C_EXPENSE_CATEGORY.color,
      icon: ONE_C_EXPENSE_CATEGORY.icon,
    },
  });

  let created = 0;
  let updated = 0;

  for (const item of readyItems) {
    const existing = await prisma.expense.findFirst({
      where: { oneCRef: item.oneCRef },
      select: { id: true },
    });

    if (existing) {
      await prisma.expense.update({
        where: { id: existing.id },
        data: {
          projectId: item.matchedProjectId!,
          categoryId: category.id,
          title: item.title,
          description: item.description,
          amount: item.amount,
          currency: item.currency,
          date: new Date(item.date),
          status: item.status,
          oneCRef: item.oneCRef,
        },
      });
      updated += 1;
    } else {
      await prisma.expense.create({
        data: {
          id: randomUUID(),
          projectId: item.matchedProjectId!,
          categoryId: category.id,
          title: item.title,
          description: item.description,
          amount: item.amount,
          currency: item.currency,
          date: new Date(item.date),
          status: item.status,
          oneCRef: item.oneCRef,
        },
      });
      created += 1;
    }
  }

  return {
    ...preview,
    created,
    updated,
    skipped: preview.summary.skippedCount,
  };
}

export function mapRecordToExpenseItem(
  record: OneCProjectFinanceTruth,
  projects: Array<{ id: string; name: string }>
): OneCExpenseSyncItem {
  const matchedProject =
    (record.projectId
      ? projects.find((project) => project.id === record.projectId)
      : undefined) ??
    (record.projectName
      ? projects.find(
          (project) => normalizeText(project.name) === normalizeText(record.projectName ?? "")
        )
      : undefined);

  const amount = record.actualBudget ?? 0;
  const date = record.reportDate ?? new Date().toISOString();
  const titleBase = record.projectName ?? record.projectId ?? record.projectKey;

  if (!matchedProject) {
    return {
      oneCRef: `one-c:${record.projectKey}:actual-budget`,
      sourceProjectKey: record.projectKey,
      sourceProjectId: record.projectId,
      sourceProjectName: record.projectName,
      matchedProjectId: null,
      matchedProjectName: null,
      categoryCode: ONE_C_EXPENSE_CATEGORY.code,
      title: `1C actual budget · ${titleBase}`,
      description: buildDescription(record),
      amount,
      currency: record.currency ?? "RUB",
      date,
      status: "approved",
      variance: record.variance,
      paymentGap: record.paymentGap,
      actGap: record.actGap,
      budgetDeltaStatus: record.budgetDeltaStatus,
      action: "skip",
      reason: "Project mapping not found",
    };
  }

  if (!(amount > 0)) {
    return {
      oneCRef: `one-c:${record.projectKey}:actual-budget`,
      sourceProjectKey: record.projectKey,
      sourceProjectId: record.projectId,
      sourceProjectName: record.projectName,
      matchedProjectId: matchedProject.id,
      matchedProjectName: matchedProject.name,
      categoryCode: ONE_C_EXPENSE_CATEGORY.code,
      title: `1C actual budget · ${titleBase}`,
      description: buildDescription(record),
      amount,
      currency: record.currency ?? "RUB",
      date,
      status: "approved",
      variance: record.variance,
      paymentGap: record.paymentGap,
      actGap: record.actGap,
      budgetDeltaStatus: record.budgetDeltaStatus,
      action: "skip",
      reason: "Actual budget is empty",
    };
  }

  return {
    oneCRef: `one-c:${record.projectKey}:actual-budget`,
    sourceProjectKey: record.projectKey,
    sourceProjectId: record.projectId,
    sourceProjectName: record.projectName,
    matchedProjectId: matchedProject.id,
    matchedProjectName: matchedProject.name,
    categoryCode: ONE_C_EXPENSE_CATEGORY.code,
    title: `1C actual budget · ${titleBase}`,
    description: buildDescription(record),
    amount,
    currency: record.currency ?? "RUB",
    date,
    status: "approved",
    variance: record.variance,
    paymentGap: record.paymentGap,
    actGap: record.actGap,
    budgetDeltaStatus: record.budgetDeltaStatus,
    action: "upsert",
  };
}

function buildDescription(record: OneCProjectFinanceTruth) {
  return [
    `1C source: ${record.projectId ?? record.projectKey}`,
    record.reportDate ? `Report date: ${record.reportDate}` : null,
    record.plannedBudget !== null ? `Planned budget: ${record.plannedBudget}` : null,
    record.actualBudget !== null ? `Actual budget: ${record.actualBudget}` : null,
    record.paymentsActual !== null ? `Payments actual: ${record.paymentsActual}` : null,
    record.actsActual !== null ? `Acts actual: ${record.actsActual}` : null,
    record.variance !== null ? `Variance: ${record.variance}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

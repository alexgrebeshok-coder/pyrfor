/**
 * Finance import service — reconciles canonical data into CEOClaw DB
 * Works with any importer (1C, QuickBooks, Xero, etc.)
 */

import { prisma } from "@/lib/db";
import { logSyncEntry } from "@/lib/connectors/oauth/oauth-service";
import type {
  CanonicalExpense,
  CanonicalVendor,
  ReconciliationResult,
} from "./canonical-model";

/**
 * Import expenses from canonical format into DB
 * Upserts based on externalId + source
 */
export async function reconcileExpenses(
  expenses: CanonicalExpense[],
  credentialId?: string
): Promise<ReconciliationResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ externalId: string; error: string }> = [];

  for (const exp of expenses) {
    try {
      // Find or create category
      const categoryCode = exp.categoryCode || "uncategorized";
      const category = await prisma.expenseCategory.upsert({
        where: { code: categoryCode },
        update: {},
        create: {
          id: `cat-${categoryCode}`,
          code: categoryCode,
          name: exp.categoryName || categoryCode,
        },
      });

      // Find matching project by reference
      let projectId: string | undefined;
      if (exp.projectRef) {
        const project = await prisma.project.findFirst({
          where: {
            OR: [
              { id: exp.projectRef },
              { name: { contains: exp.projectRef, mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });
        projectId = project?.id;
      }

      // Upsert expense by source reference
      const existing = await prisma.expense.findFirst({
        where: {
          oneCRef: `${exp.source}:${exp.externalId}`,
        },
      });

      if (existing) {
        await prisma.expense.update({
          where: { id: existing.id },
          data: {
            amount: exp.amount,
            currency: exp.currency,
            status: exp.status,
            date: exp.date,
            title: exp.description || existing.title,
          },
        });
        updated++;
      } else {
        if (!projectId) {
          skipped++;
          continue;
        }
        await prisma.expense.create({
          data: {
            id: `exp-${exp.source}-${exp.externalId}`,
            title: exp.description || `${exp.source} expense ${exp.externalId}`,
            amount: exp.amount,
            currency: exp.currency,
            status: exp.status,
            date: exp.date,
            categoryId: category.id,
            projectId,
            oneCRef: `${exp.source}:${exp.externalId}`,
          },
        });
        created++;
      }
    } catch (error) {
      errors.push({
        externalId: exp.externalId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Log sync entry if credential provided
  if (credentialId) {
    await logSyncEntry({
      credentialId,
      direction: "pull",
      entityType: "expenses",
      status: errors.length > 0 ? "completed" : "completed",
      recordsProcessed: created + updated,
      recordsFailed: errors.length,
      error: errors.length > 0 ? errors[0].error : undefined,
    });
  }

  return { created, updated, skipped, errors };
}

/**
 * Import vendors from canonical format into DB
 */
export async function reconcileVendors(
  vendors: CanonicalVendor[],
  credentialId?: string
): Promise<ReconciliationResult> {
  let created = 0;
  let updated = 0;
  const skipped = 0;
  const errors: Array<{ externalId: string; error: string }> = [];

  for (const vendor of vendors) {
    try {
      const existing = await prisma.supplier.findFirst({
        where: {
          OR: [
            { inn: vendor.taxId || undefined },
            { name: { equals: vendor.name, mode: "insensitive" } },
          ],
        },
      });

      if (existing) {
        await prisma.supplier.update({
          where: { id: existing.id },
          data: {
            name: vendor.name,
            inn: vendor.taxId || existing.inn,
            email: vendor.email || existing.email,
            phone: vendor.phone || existing.phone,
          },
        });
        updated++;
      } else {
        await prisma.supplier.create({
          data: {
            id: `sup-${vendor.source}-${vendor.externalId}`,
            name: vendor.name,
            inn: vendor.taxId,
            email: vendor.email,
            phone: vendor.phone,
          },
        });
        created++;
      }
    } catch (error) {
      errors.push({
        externalId: vendor.externalId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (credentialId) {
    await logSyncEntry({
      credentialId,
      direction: "pull",
      entityType: "vendors",
      status: "completed",
      recordsProcessed: created + updated,
      recordsFailed: errors.length,
    });
  }

  return { created, updated, skipped, errors };
}

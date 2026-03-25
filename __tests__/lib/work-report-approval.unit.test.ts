import assert from "node:assert/strict";
import type { Approval } from "@prisma/client";
import { describe, it } from "vitest";

import {
  buildWorkReportApprovalPath,
  syncWorkReportApprovalRecord,
  type WorkReportApprovalWriteInput,
} from "@/lib/approvals/work-report-approval";
import type { WorkReportView } from "@/lib/work-reports/types";

function createWorkReport(status: WorkReportView["status"]): WorkReportView {
  return {
    id: "wr-1",
    reportNumber: "#202603250001",
    projectId: "project-1",
    project: { id: "project-1", name: "Northern Rail Cutover" },
    authorId: "member-1",
    author: { id: "member-1", name: "Ирина П.", initials: "ИП", role: "PM" },
    reviewerId: status === "submitted" ? null : "member-2",
    reviewer:
      status === "submitted"
        ? null
        : { id: "member-2", name: "Олег Т.", initials: "ОТ", role: "PM" },
    section: "Секция А",
    reportDate: "2026-03-25T00:00:00.000Z",
    workDescription: "Площадка потеряла часть смены из-за запрета на въезд техники.",
    volumes: [],
    personnelCount: 12,
    personnelDetails: null,
    equipment: null,
    weather: null,
    issues: "Нет допуска на площадку.",
    nextDayPlan: "Эскалировать допуск и перепланировать смену.",
    attachments: [],
    status,
    reviewComment: status === "submitted" ? null : "Подтверждено после review evidence.",
    source: "manual",
    externalReporterTelegramId: null,
    externalReporterName: null,
    submittedAt: "2026-03-25T08:00:00.000Z",
    reviewedAt: status === "submitted" ? null : "2026-03-25T09:00:00.000Z",
    createdAt: "2026-03-25T08:00:00.000Z",
    updatedAt: "2026-03-25T08:30:00.000Z",
  };
}

function createApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: overrides.id ?? "approval-1",
    type: overrides.type ?? "work_report_review",
    entityType: overrides.entityType ?? "work_report",
    entityId: overrides.entityId ?? "wr-1",
    title: overrides.title ?? "Old title",
    description: overrides.description ?? null,
    status: overrides.status ?? "pending",
    requestedById: overrides.requestedById ?? "user-1",
    reviewedById: overrides.reviewedById ?? null,
    comment: overrides.comment ?? null,
    metadata: overrides.metadata ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-03-25T08:00:00.000Z"),
    reviewedAt: overrides.reviewedAt ?? null,
    expiresAt: overrides.expiresAt ?? null,
  };
}

describe("syncWorkReportApprovalRecord", () => {
  it("creates a pending approval for submitted work reports", async () => {
    let created: WorkReportApprovalWriteInput | null = null;

    await syncWorkReportApprovalRecord(
      createWorkReport("submitted"),
      {
        requestedByName: "Demo Operator",
        requestedByUserId: "user-1",
      },
      {
        createApproval: async (data) => {
          created = data;
          return createApproval(data);
        },
        createId: () => "approval-created",
        ensureActorUser: async (userId) => userId ?? null,
        findLatestPendingApproval: async () => null,
        updateApproval: async () => {
          throw new Error("should not update an existing approval");
        },
      }
    );

    assert.ok(created);
    const createdApproval = created as WorkReportApprovalWriteInput;
    assert.equal(createdApproval.id, "approval-created");
    assert.equal(createdApproval.status, "pending");
    assert.equal(createdApproval.type, "work_report_review");
    assert.equal(createdApproval.entityType, "work_report");

    const metadata = JSON.parse(createdApproval.metadata ?? "{}") as { canonicalPath?: string };
    assert.equal(metadata.canonicalPath, buildWorkReportApprovalPath("wr-1"));
  });

  it("updates the pending approval when the report is approved", async () => {
    let updated:
      | {
          id: string;
          data: Partial<WorkReportApprovalWriteInput>;
        }
      | null = null;

    await syncWorkReportApprovalRecord(
      createWorkReport("approved"),
      {
        reviewedByName: "Reviewer Operator",
        reviewedByUserId: "user-2",
      },
      {
        createApproval: async () => {
          throw new Error("should not create a new approval when pending exists");
        },
        ensureActorUser: async (userId) => userId ?? null,
        findLatestPendingApproval: async () => createApproval({ id: "approval-pending" }),
        updateApproval: async (id, data) => {
          updated = { id, data };
          return createApproval({
            ...data,
            id,
          });
        },
      }
    );

    assert.ok(updated);
    const updatedApproval = updated as { id: string; data: Partial<WorkReportApprovalWriteInput> };
    assert.equal(updatedApproval.id, "approval-pending");
    assert.equal(updatedApproval.data.status, "approved");
    assert.equal(updatedApproval.data.reviewedById, "user-2");
    assert.equal(updatedApproval.data.comment, "Подтверждено после review evidence.");
  });

  it("refreshes an existing pending approval on resubmission instead of duplicating it", async () => {
    let updated:
      | {
          id: string;
          data: Partial<WorkReportApprovalWriteInput>;
        }
      | null = null;

    await syncWorkReportApprovalRecord(
      createWorkReport("submitted"),
      {
        requestedByName: "Demo Operator",
        requestedByUserId: "user-3",
      },
      {
        createApproval: async () => {
          throw new Error("should not create a duplicate pending approval");
        },
        ensureActorUser: async (userId) => userId ?? null,
        findLatestPendingApproval: async () => createApproval({ id: "approval-existing" }),
        updateApproval: async (id, data) => {
          updated = { id, data };
          return createApproval({
            ...data,
            id,
          });
        },
      }
    );

    assert.ok(updated);
    const updatedApproval = updated as { id: string; data: Partial<WorkReportApprovalWriteInput> };
    assert.equal(updatedApproval.id, "approval-existing");
    assert.equal(updatedApproval.data.status, "pending");
    assert.equal(updatedApproval.data.requestedById, "user-3");
    assert.equal(updatedApproval.data.reviewedById, null);
    assert.equal(updatedApproval.data.comment, null);
  });
});

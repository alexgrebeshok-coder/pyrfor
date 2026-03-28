import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { analyzeEvidenceRecord } from "@/lib/evidence";
import type {
  EvidenceFusionOverview,
  EvidenceRecordView,
  EvidenceVerificationStatus,
} from "@/lib/evidence";

function createRecord(input: {
  id: string;
  title: string;
  sourceType: string;
  entityType: string;
  entityRef: string;
  confidence: number;
  verificationStatus: EvidenceVerificationStatus;
  observedAt: string;
  projectId?: string | null;
  sourceRef?: string | null;
  summary?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const sourceRef = input.sourceRef ?? input.entityRef;

  return {
    id: input.id,
    sourceType: input.sourceType,
    sourceRef,
    entityType: input.entityType,
    entityRef: input.entityRef,
    projectId: input.projectId ?? "project-1",
    title: input.title,
    summary: input.summary ?? null,
    observedAt: input.observedAt,
    reportedAt: input.observedAt,
    confidence: input.confidence,
    verificationStatus: input.verificationStatus,
    metadata: input.metadata ?? {},
    createdAt: input.observedAt,
    updatedAt: input.observedAt,
  } satisfies EvidenceRecordView;
}

function createFusionOverview(): EvidenceFusionOverview {
  return {
    syncedAt: "2026-03-11T14:00:00.000Z",
    summary: {
      total: 1,
      reported: 0,
      observed: 0,
      verified: 1,
      averageConfidence: 0.96,
      strongestFactTitle: "#20260311-001 · km 10+000",
    },
    facts: [
      {
        id: "fusion:report-1",
        projectId: "project-1",
        projectName: "Yamal Earthwork Package",
        title: "#20260311-001 · km 10+000",
        reportId: "report-1",
        reportNumber: "#20260311-001",
        reportDate: "2026-03-11T00:00:00.000Z",
        section: "km 10+000",
        observedAt: "2026-03-11T13:10:00.000Z",
        confidence: 0.96,
        verificationStatus: "verified",
        explanation:
          "The report is corroborated by visual evidence and GPS telemetry from the same section and day.",
        sourceCount: 3,
        sources: [
          {
            recordId: "record-work-report",
            sourceType: "work_report:manual",
            entityType: "work_report",
            entityRef: "report-1",
            title: "#20260311-001 · km 10+000",
            confidence: 0.82,
            verificationStatus: "verified",
            observedAt: "2026-03-11T12:00:00.000Z",
            matchReasons: ["anchor_work_report"],
          },
          {
            recordId: "record-video-fact",
            sourceType: "video_document:intake",
            entityType: "video_fact",
            entityRef: "video-1",
            title: "Compaction clip",
            confidence: 0.91,
            verificationStatus: "verified",
            observedAt: "2026-03-11T13:10:00.000Z",
            matchReasons: ["linked_report", "same_report_day"],
          },
          {
            recordId: "record-gps-session",
            sourceType: "gps_api:session_sample",
            entityType: "gps_session",
            entityRef: "gps-1",
            title: "EXC-KOM-01 · work",
            confidence: 0.95,
            verificationStatus: "observed",
            observedAt: "2026-03-11T10:15:00.000Z",
            matchReasons: ["same_report_day", "equipment_overlap", "location_overlap"],
          },
        ],
      },
    ],
  };
}

describe("analyzeEvidenceRecord", () => {
  it("explains cross-source confidence for corroborated work reports", async () => {
    const record = createRecord({
      id: "record-work-report",
      title: "#20260311-001 · km 10+000",
      sourceType: "work_report:manual",
      entityType: "work_report",
      entityRef: "report-1",
      confidence: 0.82,
      verificationStatus: "verified",
      observedAt: "2026-03-11T12:00:00.000Z",
      metadata: {
        reportNumber: "#20260311-001",
        reportStatus: "approved",
        section: "km 10+000",
      },
    });

    const analysis = await analyzeEvidenceRecord(record.id, {
      loadFusion: async () => createFusionOverview(),
      loadRecord: async () => record,
    });

    assert.ok(analysis);
    assert.equal(analysis.finalConfidence, 0.96);
    assert.equal(analysis.confidenceDelta, 0.14);
    assert.equal(analysis.relatedSources.length, 2);
    assert.ok(analysis.justifications.some((item) => item.code === "cross_source_fusion"));
    assert.ok(analysis.justifications.some((item) => item.code === "video_support"));
    assert.ok(analysis.justifications.some((item) => item.code === "gps_support"));
    assert.equal(analysis.gaps.some((item) => item.code === "pending_approval"), false);
  });

  it("flags missing corroboration for weak work reports", async () => {
    const record = createRecord({
      id: "record-work-report-missing-support",
      title: "#20260311-002 · km 12+500",
      sourceType: "work_report:manual",
      entityType: "work_report",
      entityRef: "report-2",
      confidence: 0.58,
      verificationStatus: "reported",
      observedAt: "2026-03-11T12:00:00.000Z",
      summary: "Manual report without supporting evidence.",
      metadata: {
        reportNumber: "#20260311-002",
        reportStatus: "submitted",
        section: "km 12+500",
      },
    });

    const analysis = await analyzeEvidenceRecord(record.id, {
      loadFusion: async () => ({
        syncedAt: "2026-03-11T14:00:00.000Z",
        summary: {
          total: 0,
          reported: 0,
          observed: 0,
          verified: 0,
          averageConfidence: null,
          strongestFactTitle: null,
        },
        facts: [],
      }),
      loadRecord: async () => record,
    });

    assert.ok(analysis);
    assert.equal(analysis.finalConfidence, 0.58);
    assert.equal(analysis.confidenceDelta, 0);
    assert.ok(analysis.gaps.some((item) => item.code === "missing_video_support"));
    assert.ok(analysis.gaps.some((item) => item.code === "missing_gps_support"));
    assert.ok(analysis.gaps.some((item) => item.code === "pending_approval"));
  });
});

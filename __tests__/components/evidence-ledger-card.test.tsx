import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceLedgerCard } from "@/components/integrations/evidence-ledger-card";
import type { EvidenceListResult } from "@/lib/evidence";

vi.mock("@/lib/hooks/use-platform-permission", () => ({
  usePlatformPermission: () => ({
    allowed: true,
  }),
}));

function createEvidence(): EvidenceListResult {
  return {
    syncedAt: "2026-03-25T03:20:00.000Z",
    summary: {
      total: 3,
      reported: 1,
      observed: 1,
      verified: 1,
      averageConfidence: 0.79,
      lastObservedAt: "2026-03-25T03:18:00.000Z",
    },
    records: [
      {
        id: "record-work-report",
        sourceType: "work_report:manual",
        sourceRef: "wr-1",
        entityType: "work_report",
        entityRef: "wr-1",
        projectId: "project-1",
        title: "WR-1 · Section A",
        summary: "Manual report without blockers.",
        observedAt: "2026-03-25T03:00:00.000Z",
        reportedAt: "2026-03-25T03:00:00.000Z",
        confidence: 0.82,
        verificationStatus: "verified",
        metadata: {
          reportNumber: "#202603250001",
        },
        createdAt: "2026-03-25T03:00:00.000Z",
        updatedAt: "2026-03-25T03:00:00.000Z",
      },
      {
        id: "record-video",
        sourceType: "video_document:intake",
        sourceRef: "video-1",
        entityType: "video_fact",
        entityRef: "video-1",
        projectId: "project-1",
        title: "Compaction clip",
        summary: "Visual fact linked to the same report.",
        observedAt: "2026-03-25T03:10:00.000Z",
        reportedAt: "2026-03-25T03:10:00.000Z",
        confidence: 0.77,
        verificationStatus: "reported",
        metadata: {
          reportId: "wr-1",
        },
        createdAt: "2026-03-25T03:10:00.000Z",
        updatedAt: "2026-03-25T03:10:00.000Z",
      },
      {
        id: "record-gps",
        sourceType: "gps_api:session_sample",
        sourceRef: "gps-1",
        entityType: "gps_session",
        entityRef: "gps-1",
        projectId: null,
        title: "EXC-01 · GPS session",
        summary: "Observed machine activity during the same operating window.",
        observedAt: "2026-03-25T03:18:00.000Z",
        reportedAt: null,
        confidence: 0.79,
        verificationStatus: "observed",
        metadata: {
          equipmentCode: "EXC-01",
        },
        createdAt: "2026-03-25T03:18:00.000Z",
        updatedAt: "2026-03-25T03:18:00.000Z",
      },
    ],
    sync: null,
  };
}

describe("EvidenceLedgerCard", () => {
  it("filters records by entity type and keeps the selected record in focus", () => {
    render(<EvidenceLedgerCard evidence={createEvidence()} />);

    expect(screen.getAllByText("WR-1 · Section A")).toHaveLength(2);
    expect(screen.getByText("Compaction clip")).toBeInTheDocument();
    expect(screen.getByText("EXC-01 · GPS session")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Entity type"), {
      target: { value: "gps_session" },
    });

    expect(screen.queryAllByText("WR-1 · Section A")).toHaveLength(0);
    expect(screen.queryAllByText("Compaction clip")).toHaveLength(0);
    expect(screen.getAllByText("EXC-01 · GPS session").length).toBeGreaterThan(0);
    expect(screen.getByText("Selected record")).toBeInTheDocument();
    expect(screen.getAllByText(/gps_api:session_sample/i).length).toBeGreaterThan(0);
  });

  it("filters records by verification status", () => {
    render(<EvidenceLedgerCard evidence={createEvidence()} />);

    fireEvent.change(screen.getByLabelText("Verification status"), {
      target: { value: "verified" },
    });

    expect(screen.getAllByText("WR-1 · Section A").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Compaction clip")).toHaveLength(0);
    expect(screen.queryAllByText("EXC-01 · GPS session")).toHaveLength(0);
    expect(screen.getByText(/1 matched/i)).toBeInTheDocument();
  });
});

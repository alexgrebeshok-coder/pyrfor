"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { VideoFactListResult } from "@/lib/video-facts/types";
import type { WorkReportMemberOption, WorkReportView } from "@/lib/work-reports/types";

import { ReportReviewCard } from "@/components/work-reports/report-review-card";
import { ReportRunsTable } from "@/components/work-reports/report-runs-table";

export function ReportReviewWorkspace({
  initialSelectedReportId,
  members,
  reports,
  videoFacts,
}: {
  initialSelectedReportId?: string;
  members: WorkReportMemberOption[];
  reports: WorkReportView[];
  videoFacts: VideoFactListResult;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedReportId = searchParams.get("reportId")?.trim() || initialSelectedReportId || "";
  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId]
  );

  const handleSelectReport = (reportId: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("reportId", reportId);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <ReportRunsTable
        highlightReportId={initialSelectedReportId}
        onSelectReport={handleSelectReport}
        reports={reports}
        selectedReportId={selectedReport?.id}
      />
      <ReportReviewCard members={members} report={selectedReport} videoFacts={videoFacts.items} />
    </div>
  );
}

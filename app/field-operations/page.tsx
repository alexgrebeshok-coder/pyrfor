import { ErrorBoundary } from "@/components/error-boundary";
import { FieldOperationsPage } from "@/components/field-operations/field-operations-page";
import { getEscalationQueueOverview } from "@/lib/escalations";
import { getEnterpriseTruthOverview } from "@/lib/enterprise-truth";
import { prisma } from "@/lib/prisma";
import { canReadLiveOperatorData, getServerRuntimeState } from "@/lib/server/runtime-mode";
import { getGpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";
import { getVideoFactOverview } from "@/lib/video-facts/service";
import type { VideoFactListResult } from "@/lib/video-facts/types";
import { listWorkReports } from "@/lib/work-reports/service";
import type { EnterpriseTruthOverview } from "@/lib/enterprise-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FieldOperationsRoute() {
  const runtimeState = getServerRuntimeState();
  const liveWorkflowReady = canReadLiveOperatorData(runtimeState);

  const gpsTelemetry = await getGpsTelemetryTruthSnapshot();

  const emptyVideoFacts: VideoFactListResult = {
    syncedAt: new Date().toISOString(),
    summary: {
      total: 0,
      observed: 0,
      verified: 0,
      averageConfidence: null,
      lastCapturedAt: null,
    },
    items: [],
  };

  const emptyEnterpriseTruth: EnterpriseTruthOverview = {
    syncedAt: new Date().toISOString(),
    summary: {
      totalProjects: 0,
      corroborated: 0,
      fieldOnly: 0,
      financeOnly: 0,
      telemetryGaps: 0,
      largestVarianceProject: null,
    },
    projects: [],
    telemetryGaps: [],
  };

  const [rawProjects, rawTeamMembers, reports, escalationQueue, videoFacts, enterpriseTruth] = liveWorkflowReady
    ? await Promise.all([
        prisma.project.findMany({
          select: {
            id: true,
            name: true,
            location: true,
            status: true,
            progress: true,
            health: true,
            team: {
              select: {
                id: true,
                name: true,
                role: true,
                initials: true,
                capacity: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 24,
        }),
        prisma.teamMember.findMany({
          select: {
            id: true,
            name: true,
            role: true,
            initials: true,
            capacity: true,
            projects: {
              select: {
                id: true,
                name: true,
                location: true,
                status: true,
                progress: true,
              },
            },
          },
          orderBy: { name: "asc" },
          take: 24,
        }),
        listWorkReports({ limit: 12 }),
        getEscalationQueueOverview({ limit: 8 }),
        getVideoFactOverview({ limit: 8 }),
        getEnterpriseTruthOverview({
          limit: 6,
          telemetryLimit: 6,
        }),
      ])
    : [
        [],
        [],
        [],
        null,
        emptyVideoFacts,
        emptyEnterpriseTruth,
      ];

  const projects = rawProjects.map((project) => ({
    ...project,
    team: project.team,
  }));

  const teamMembers = rawTeamMembers.map((member) => ({
    ...member,
    projects: member.projects,
  }));

  return (
    <ErrorBoundary resetKey="field-operations">
      <FieldOperationsPage
        escalationQueue={escalationQueue}
        enterpriseTruth={enterpriseTruth}
        gpsTelemetry={gpsTelemetry}
        liveWorkflowReady={liveWorkflowReady}
        projects={projects}
        reports={reports}
        teamMembers={teamMembers}
        videoFacts={videoFacts}
      />
    </ErrorBoundary>
  );
}

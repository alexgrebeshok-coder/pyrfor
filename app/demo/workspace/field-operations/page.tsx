"use client";

import { useMemo } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { FieldOperationsPage } from "@/components/field-operations/field-operations-page";
import {
  demoDashboardState,
  getDemoEnterpriseTruth,
  getDemoEscalationQueue,
  getDemoGpsTelemetry,
  getDemoVideoFacts,
  getDemoWorkReports,
} from "@/lib/demo/workspace-data";

export default function DemoFieldOperationsPage() {
  const escalationQueue = useMemo(() => getDemoEscalationQueue(), []);
  const enterpriseTruth = useMemo(() => getDemoEnterpriseTruth(), []);
  const gpsTelemetry = useMemo(() => getDemoGpsTelemetry(), []);
  const videoFacts = useMemo(() => getDemoVideoFacts(), []);
  const reports = useMemo(() => getDemoWorkReports(), []);

  const projects = useMemo(
    () =>
      demoDashboardState.projects.map((p) => ({
        id: p.id,
        name: p.name,
        location: p.location ?? null,
        status: p.status,
        progress: p.progress,
        health: String(p.health),
        team: p.team.map((name, i) => ({
          id: `${p.id}-member-${i}`,
          name,
          role: i === 0 ? "Руководитель работ" : "Специалист",
          initials: name.slice(0, 2).toUpperCase(),
          capacity: 80,
        })),
      })),
    []
  );

  const teamMembers = useMemo(
    () =>
      demoDashboardState.team.map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        initials: member.name.slice(0, 2).toUpperCase(),
        capacity: member.allocated,
        projects: demoDashboardState.projects
          .filter((p) => p.team.includes(member.name))
          .map((p) => ({
            id: p.id,
            name: p.name,
            location: p.location ?? null,
            status: p.status,
            progress: p.progress,
          })),
      })),
    []
  );

  return (
    <ErrorBoundary resetKey="demo-field-operations">
      <FieldOperationsPage
        escalationQueue={escalationQueue}
        enterpriseTruth={enterpriseTruth}
        gpsTelemetry={gpsTelemetry}
        liveWorkflowReady={true}
        projects={projects}
        reports={reports}
        teamMembers={teamMembers}
        videoFacts={videoFacts}
      />
    </ErrorBoundary>
  );
}

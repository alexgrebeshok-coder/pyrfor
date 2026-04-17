"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";

import { DomainMetricCard } from "@/components/layout/domain-metric-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldMapTab } from "@/components/field-operations/field-map-tab";
import { FieldOperationsEquipmentTab } from "@/components/field-operations/field-operations-equipment-tab";
import { FieldOperationsEventsTab } from "@/components/field-operations/field-operations-events-tab";
import { FieldOperationsGeofencesTab } from "@/components/field-operations/field-operations-geofences-tab";
import { FieldOperationsMediaTab } from "@/components/field-operations/field-operations-media-tab";
import { FieldOperationsPeopleTab } from "@/components/field-operations/field-operations-people-tab";
import type {
  FieldMapProject,
  FieldProject,
  FieldTeamMember,
} from "@/components/field-operations/field-operations.types";
import {
  PREVIEW_FIELD_PROJECTS,
  projectHealthScore,
} from "@/components/field-operations/field-operations-utils";
import { buildFieldMapMarkers, resolveFieldLocationAnchor } from "@/lib/field-operations/location-catalog";
import type { EnterpriseTruthOverview } from "@/lib/enterprise-truth";
import type { EscalationListResult } from "@/lib/escalations";
import type { GpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";
import type { VideoFactListResult } from "@/lib/video-facts/types";
import type { WorkReportView } from "@/lib/work-reports/types";
import { cn } from "@/lib/utils";

export function FieldOperationsPage({
  escalationQueue,
  enterpriseTruth,
  gpsTelemetry,
  liveWorkflowReady,
  projects,
  reports,
  teamMembers,
  videoFacts,
}: {
  escalationQueue: EscalationListResult | null;
  enterpriseTruth: EnterpriseTruthOverview;
  gpsTelemetry: GpsTelemetryTruthSnapshot;
  liveWorkflowReady: boolean;
  projects: FieldProject[];
  reports: WorkReportView[];
  teamMembers: FieldTeamMember[];
  videoFacts: VideoFactListResult;
}) {
  const fieldProjects = useMemo<FieldMapProject[]>(() => {
    if (liveWorkflowReady && projects.length > 0) {
      return projects.map((project) => ({
        id: project.id,
        name: project.name,
        location: project.location,
        status: project.status,
        progress: project.progress,
        health: projectHealthScore(project.health, project.status, project.progress),
      }));
    }

    return PREVIEW_FIELD_PROJECTS;
  }, [liveWorkflowReady, projects]);

  const mapMarkers = useMemo(
    () =>
      buildFieldMapMarkers({
        projects: fieldProjects,
        geofences: gpsTelemetry.geofences,
      }),
    [fieldProjects, gpsTelemetry.geofences]
  );

  const unresolvedLocations = useMemo(() => {
    const locations = new Set<string>();

    for (const project of fieldProjects) {
      if (project.location && !resolveFieldLocationAnchor(project.location)) {
        locations.add(project.location);
      }
    }

    for (const geofence of gpsTelemetry.geofences) {
      const label = geofence.geofenceName ?? geofence.geofenceId ?? geofence.geofenceKey;
      if (label && !resolveFieldLocationAnchor(label)) {
        locations.add(label);
      }
    }

    return Array.from(locations).slice(0, 8);
  }, [fieldProjects, gpsTelemetry.geofences]);

  const projectMarkers = mapMarkers.filter((marker) => marker.kind === "project");
  const geofenceMarkers = mapMarkers.filter((marker) => marker.kind === "geofence");
  const activeReports = reports.filter((report) => report.status === "submitted").length;
  const liveProjects = fieldProjects.filter(
    (project) => project.status === "active" || project.status === "at_risk"
  );
  const overloadedPeople = teamMembers.filter((member) => member.capacity > 80).length;
  const latestReports = reports.slice(0, 6);
  const recentVideoFacts = videoFacts.items.slice(0, 4);
  const telemetryGaps = enterpriseTruth.telemetryGaps.slice(0, 6);

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <div className="flex flex-wrap gap-3">
            <Link className={buttonVariants({ variant: "outline" })} href="/work-reports">
              Открыть рабочие отчёты
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/integrations">
              Открыть интеграции
            </Link>
          </div>
        }
        chips={[
          {
            label: liveWorkflowReady ? "Живые данные" : "Предпросмотр с проектами",
            variant: liveWorkflowReady ? "success" : "info",
          },
          {
            label: `${mapMarkers.length} якорей на карте`,
            variant: mapMarkers.length > 0 ? "info" : "neutral",
          },
          {
            label: `${gpsTelemetry.summary.equipmentCount} единиц техники`,
            variant: gpsTelemetry.summary.equipmentCount > 0 ? "success" : "warning",
          },
          {
            label: `${gpsTelemetry.summary.geofenceCount} геозон`,
            variant: gpsTelemetry.summary.geofenceCount > 0 ? "info" : "neutral",
          },
          {
            label:
              telemetryGaps.length > 0
                ? `${telemetryGaps.length} разрывов телеметрии`
                : "Разрывов телеметрии нет",
            variant: telemetryGaps.length > 0 ? "warning" : "success",
          },
          {
            label: `${videoFacts.summary.total} фото/видео фактов`,
            variant: videoFacts.summary.total > 0 ? "info" : "neutral",
          },
          {
            label: overloadedPeople > 0 ? `${overloadedPeople} перегруженных` : "Баланс нагрузки",
            variant: overloadedPeople > 0 ? "warning" : "success",
          },
        ]}
        description="Операционный центр для полевых команд: карта участков, люди, техника, геозоны, события и фото/видео собраны в один понятный рабочий хаб."
        eyebrow="Полевой контур"
        title="Поля и логистика"
      />

      <Tabs className="space-y-4" defaultValue="map">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="map">Карта</TabsTrigger>
          <TabsTrigger value="people">Люди</TabsTrigger>
          <TabsTrigger value="equipment">Техника</TabsTrigger>
          <TabsTrigger value="geofences">Геозоны</TabsTrigger>
          <TabsTrigger value="events">События</TabsTrigger>
          <TabsTrigger value="media">Фото и видео</TabsTrigger>
        </TabsList>

        <TabsContent value="map">
          <FieldMapTab markers={mapMarkers} unresolvedLocations={unresolvedLocations} />
        </TabsContent>

        <TabsContent value="people">
          <FieldOperationsPeopleTab teamMembers={teamMembers} />
        </TabsContent>

        <TabsContent value="equipment">
          <FieldOperationsEquipmentTab gpsTelemetry={gpsTelemetry} />
        </TabsContent>

        <TabsContent value="geofences">
          <FieldOperationsGeofencesTab gpsTelemetry={gpsTelemetry} />
        </TabsContent>

        <TabsContent value="events">
          <FieldOperationsEventsTab
            escalationQueue={escalationQueue}
            latestReports={latestReports}
            telemetryGaps={telemetryGaps}
          />
        </TabsContent>

        <TabsContent value="media">
          <FieldOperationsMediaTab
            recentVideoFacts={recentVideoFacts}
            videoFacts={videoFacts}
          />
        </TabsContent>
      </Tabs>

      <div className="grid gap-4 xl:grid-cols-4">
        <DomainMetricCard
          detail="Площадки и участки, которые уже можно показать на карте по известным опорным точкам."
          label="Активные площадки"
          status={{
            label: projectMarkers.length > 0 ? "Видно" : "Ждём",
            variant: projectMarkers.length > 0 ? "success" : "warning",
          }}
          value={String(liveProjects.length)}
        />
        <DomainMetricCard
          detail="Полевые отчёты, которые уже ждут проверки и могут превратиться в сигнал или эскалацию."
          label="Отчёты на проверке"
          status={{
            label: activeReports > 0 ? "Внимание" : "Тишина",
            variant: activeReports > 0 ? "warning" : "success",
          }}
          value={String(activeReports)}
        />
        <DomainMetricCard
          detail="Подтверждённые GPS-сущности из живой телеметрии: оборудование, которое уже видно в контуре."
          label="Живая техника"
          status={{
            label:
              gpsTelemetry.status === "ok"
                ? "Живой"
                : gpsTelemetry.status === "degraded"
                  ? "Шум"
                  : "Ожидание",
            variant:
              gpsTelemetry.status === "ok"
                ? "success"
                : gpsTelemetry.status === "degraded"
                  ? "warning"
                  : "neutral",
          }}
          value={String(gpsTelemetry.summary.equipmentCount)}
        />
        <DomainMetricCard
          detail="Геозоны, где уже есть подтверждённая активность и можно отслеживать её без ручного поиска."
          label="Геозоны"
          status={{
            label: geofenceMarkers.length > 0 ? "Отслеживаются" : "Ждём",
            variant: geofenceMarkers.length > 0 ? "info" : "warning",
          }}
          value={String(geofenceMarkers.length)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API полевого контура</CardTitle>
          <CardDescription>
            Этот хаб уже привязан к реальным backend endpoints, чтобы карта и поле всегда
            читали одни и те же живые факты.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-[var(--ink-soft)] sm:grid-cols-2 xl:grid-cols-3">
          <EndpointPill href="/api/connectors/gps/telemetry" label="Правда GPS-телеметрии" />
          <EndpointPill href="/api/work-reports" label="Рабочие отчёты" />
          <EndpointPill href="/api/work-reports/video-facts" label="Видео-факты" />
          <EndpointPill
            href="/api/enterprise-truth?limit=4&telemetryLimit=3"
            label="Единая сводка"
          />
          <EndpointPill href="/api/escalations" label="Очередь эскалаций" />
          <EndpointPill
            href="/api/command-center/exceptions"
            label="Входящие исключения"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function EndpointPill({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "justify-start border border-[var(--line)] bg-[var(--panel-soft)] text-left text-[var(--ink-soft)]"
      )}
      href={href}
    >
      <span className="truncate">{label}</span>
      <ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0" />
    </Link>
  );
}

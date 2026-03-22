"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";

import { DomainMetricCard } from "@/components/layout/domain-metric-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldMapTab } from "@/components/field-operations/field-map-tab";
import { buildFieldMapMarkers, resolveFieldLocationAnchor } from "@/lib/field-operations/location-catalog";
import { initialDashboardState } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { EnterpriseTruthOverview } from "@/lib/enterprise-truth";
import type { EscalationListResult } from "@/lib/escalations";
import type { GpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";
import type { VideoFactListResult } from "@/lib/video-facts/types";
import type { WorkReportView } from "@/lib/work-reports/types";

type FieldProject = {
  id: string;
  name: string;
  location: string | null;
  status: string;
  progress: number;
  health: string;
  team: Array<{
    id: string;
    name: string;
    role: string;
    initials: string | null;
    capacity: number;
  }>;
};

type FieldTeamMember = {
  id: string;
  name: string;
  role: string;
  initials: string | null;
  capacity: number;
  projects: Array<{
    id: string;
    name: string;
    location: string | null;
    status: string;
    progress: number;
  }>;
};

type FieldMapProject = {
  id: string;
  name: string;
  location: string | null;
  status: string;
  progress: number;
  health: number;
};

const PREVIEW_FIELD_PROJECTS: FieldMapProject[] = initialDashboardState.projects.map((project) => ({
  id: project.id,
  name: project.name,
  location: project.location,
  status: normalizePreviewProjectStatus(project.status),
  progress: project.progress,
  health: project.health,
}));

function normalizePreviewProjectStatus(value: string) {
  return value === "at-risk" ? "at_risk" : value;
}

function formatShortDate(value: string | null) {
  if (!value) return "нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPercent(value: number | null) {
  if (value === null) return "нет данных";
  return `${Math.round(value * 100)}%`;
}

function formatEquipmentStatus(value: string | null | undefined) {
  switch (value) {
    case "work":
      return "В работе";
    case "idle":
      return "Простой";
    case "travel":
      return "В пути";
    case "pending":
      return "Ожидание";
    case "unknown":
    case null:
    case undefined:
    default:
      return "Неизвестно";
  }
}

function formatReportStatus(value: string) {
  switch (value) {
    case "approved":
      return "Одобрен";
    case "rejected":
      return "Отклонён";
    case "submitted":
      return "На проверке";
    default:
      return value;
  }
}

function formatVerificationStatus(value: string) {
  switch (value) {
    case "verified":
      return "Подтверждён";
    case "observed":
      return "Зафиксирован";
    default:
      return value;
  }
}

function projectHealthScore(health: string, status: string, progress: number) {
  if (status === "completed" || progress >= 100) {
    return 95;
  }

  if (status === "at_risk") {
    return 35;
  }

  if (status === "on_hold") {
    return 48;
  }

  switch (health) {
    case "good":
      return 82;
    case "warning":
      return 62;
    case "critical":
      return 32;
    default:
      return 65;
  }
}

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
  const liveProjects = fieldProjects.filter((project) => project.status === "active" || project.status === "at_risk");
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
          { label: liveWorkflowReady ? "Живые данные" : "Предпросмотр с проектами", variant: liveWorkflowReady ? "success" : "info" },
          { label: `${mapMarkers.length} якорей на карте`, variant: mapMarkers.length > 0 ? "info" : "neutral" },
          { label: `${gpsTelemetry.summary.equipmentCount} единиц техники`, variant: gpsTelemetry.summary.equipmentCount > 0 ? "success" : "warning" },
          { label: `${gpsTelemetry.summary.geofenceCount} геозон`, variant: gpsTelemetry.summary.geofenceCount > 0 ? "info" : "neutral" },
          { label: telemetryGaps.length > 0 ? `${telemetryGaps.length} разрывов телеметрии` : "Разрывов телеметрии нет", variant: telemetryGaps.length > 0 ? "warning" : "success" },
          { label: `${videoFacts.summary.total} фото/видео фактов`, variant: videoFacts.summary.total > 0 ? "info" : "neutral" },
          { label: overloadedPeople > 0 ? `${overloadedPeople} перегруженных` : "Баланс нагрузки", variant: overloadedPeople > 0 ? "warning" : "success" },
        ]}
        description="Операционный центр для полевых команд: карта участков, люди, техника, геозоны, события и фото/видео собраны в один понятный рабочий хаб."
        eyebrow="Полевой контур"
        title="Поля и логистика"
      />

      <Tabs className="space-y-4" defaultValue="map">
        <TabsContent value="map">
          <FieldMapTab markers={mapMarkers} unresolvedLocations={unresolvedLocations} />
        </TabsContent>

        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="map">Карта</TabsTrigger>
          <TabsTrigger value="people">Люди</TabsTrigger>
          <TabsTrigger value="equipment">Техника</TabsTrigger>
          <TabsTrigger value="geofences">Геозоны</TabsTrigger>
          <TabsTrigger value="events">События</TabsTrigger>
          <TabsTrigger value="media">Фото и видео</TabsTrigger>
        </TabsList>

        <TabsContent value="people">
          <Card>
            <CardHeader>
              <CardTitle>Люди и покрытие</CardTitle>
              <CardDescription>
                Кто в поле, у кого перегрузка, и какие проекты уже живут в одном полевом контуре.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 xl:grid-cols-3">
              {teamMembers.length > 0 ? (
                teamMembers.map((member) => {
                  const activeProjectNames = member.projects
                    .filter((project) => project.status === "active" || project.status === "at_risk")
                    .slice(0, 3)
                    .map((project) => project.name);

                  return (
                    <div
                      className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                      key={member.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-[var(--ink)]">
                            {member.name}
                          </div>
                          <div className="mt-1 text-sm text-[var(--ink-soft)]">{member.role}</div>
                        </div>
                        <Badge variant={member.capacity > 80 ? "warning" : "success"}>
                          {member.capacity}% загрузки
                        </Badge>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-[var(--ink-muted)]">
                        <div>Проектов: {member.projects.length}</div>
                        <div>
                          Покрытие:{" "}
                          {activeProjectNames.length > 0 ? activeProjectNames.join(", ") : "пока без активного поля"}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <Card className="border-dashed xl:col-span-3">
                  <CardContent className="p-4 text-sm text-[var(--ink-soft)]">
                    Список людей появится, когда live database отдаст team members.
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipment">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Сводка телеметрии</CardTitle>
                <CardDescription>
                  Короткая оперативная панель по GPS/GLONASS: кто в движении, кто стоит, и где техника была замечена в последний раз.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Состояние коннектора</div>
                    <div className="mt-2 font-medium text-[var(--ink)]">{gpsTelemetry.message}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Связано техники</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ink)]">{gpsTelemetry.summary.equipmentCount}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Связано геозон</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ink)]">{gpsTelemetry.summary.geofenceCount}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Общая длительность</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
                      {gpsTelemetry.summary.totalDurationSeconds
                        ? `${Math.round(gpsTelemetry.summary.totalDurationSeconds / 3600)} ч`
                        : "нет данных"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Сессий без завершения</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
                      {gpsTelemetry.summary.openEndedSessionCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Обновлено</div>
                    <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
                      {formatShortDate(gpsTelemetry.checkedAt)}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="text-sm font-medium text-[var(--ink)]">Техника в контуре</div>
                  {gpsTelemetry.equipment.length > 0 ? (
                    gpsTelemetry.equipment.map((equipment) => (
                      <div
                        className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                        key={equipment.equipmentKey}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--ink)]">
                              {equipment.equipmentId ?? equipment.equipmentKey}
                            </div>
                            <div className="mt-1 text-xs text-[var(--ink-soft)]">
                              {equipment.equipmentType ?? "Тип не задан"}
                            </div>
                          </div>
                          <Badge variant={equipment.latestStatus === "work" ? "success" : "warning"}>
                            {formatEquipmentStatus(equipment.latestStatus)}
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-1 text-sm text-[var(--ink-muted)]">
                          <div>Сессий: {equipment.sessionCount}</div>
                          <div>
                            Время:{" "}
                            {equipment.totalDurationSeconds ? `${Math.round(equipment.totalDurationSeconds / 3600)} ч` : "0 ч"}
                          </div>
                          <div>Геозона: {equipment.latestGeofenceName ?? "нет данных"}</div>
                          <div>Обновлено: {formatShortDate(equipment.latestObservedAt)}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
                    Живая техника появится, когда GPS/GLONASS начнёт отдавать сессии.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="geofences">
          <Card>
            <CardHeader>
              <CardTitle>Геозоны</CardTitle>
              <CardDescription>
                Геозоны показывают, где накопилась активность оборудования и как давно зона была подтверждена.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 xl:grid-cols-2">
              {gpsTelemetry.geofences.length > 0 ? (
                gpsTelemetry.geofences.map((geofence) => (
                  <div
                    className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                    key={geofence.geofenceKey}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-[var(--ink)]">
                          {geofence.geofenceName ?? geofence.geofenceId ?? geofence.geofenceKey}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          {geofence.geofenceId ?? "ID не задан"}
                        </div>
                      </div>
                      <Badge variant={geofence.sessionCount > 0 ? "success" : "warning"}>
                        {geofence.sessionCount} {formatRussianQueueItem(geofence.sessionCount)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-1 text-sm text-[var(--ink-muted)]">
                      <div>Техники: {geofence.equipmentCount}</div>
                      <div>Последняя фиксация: {formatShortDate(geofence.latestObservedAt)}</div>
                      <div>
                        Привязанные машины:{" "}
                        {geofence.equipmentIds.length > 0 ? geofence.equipmentIds.join(", ") : "нет данных"}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)] xl:col-span-2">
                  Геозоны появятся, когда GPS/GLONASS провайдер вернёт сессии с геозонной привязкой.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <Card>
              <CardHeader>
                <CardTitle>События поля</CardTitle>
                <CardDescription>
                  Последние отчёты, разрывы телеметрии и точки, где управленческое внимание нужно уже сейчас.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {latestReports.length > 0 ? (
                  latestReports.map((report) => (
                    <div
                      className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                      key={report.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-[var(--ink)]">
                            {report.reportNumber}
                          </div>
                          <div className="mt-1 text-sm text-[var(--ink-soft)]">
                            {report.project.name} · {report.section}
                          </div>
                        </div>
                        <Badge variant={report.status === "approved" ? "success" : report.status === "rejected" ? "danger" : "warning"}>
                          {formatReportStatus(report.status)}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-1 text-sm text-[var(--ink-muted)]">
                        <div>Дата: {formatShortDate(report.reportDate)}</div>
                        <div>Людей: {report.personnelCount ?? "—"}</div>
                        <div>Техника: {report.equipment ?? "—"}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[18px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
                    Пока нет свежих отчётов для показа.
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Разрывы телеметрии</CardTitle>
                  <CardDescription>
                    Объекты, по которым GPS и поле ещё не сходятся в единый слой правды.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {telemetryGaps.length > 0 ? (
                    telemetryGaps.map((gap) => (
                      <div
                        className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                        key={gap.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--ink)]">
                              {gap.equipmentId ?? "Без идентификатора техники"}
                            </div>
                            <div className="mt-1 text-xs text-[var(--ink-soft)]">
                              {gap.geofenceName ?? "Геозона не указана"}
                            </div>
                          </div>
                          <Badge variant="warning">разрыв</Badge>
                        </div>
                        <div className="mt-3 text-sm text-[var(--ink-muted)]">{gap.explanation}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
                      Пока разрывов телеметрии не обнаружено.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Эскалации</CardTitle>
                  <CardDescription>Текущая очередь для управленческой реакции.</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-[var(--ink-soft)]">
                  {escalationQueue && escalationQueue.summary.total > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span>Очередь</span>
                        <Badge variant="warning">
                          {escalationQueue.summary.total} {formatRussianQueueItem(escalationQueue.summary.total)}
                        </Badge>
                      </div>
                      <div>Открыто: {escalationQueue.summary.open}</div>
                      <div>Принято: {escalationQueue.summary.acknowledged}</div>
                      <div>Закрыто: {escalationQueue.summary.resolved}</div>
                      <div>Критических: {escalationQueue.summary.critical}</div>
                    </div>
                  ) : (
                    <div>Очередь эскалаций пуста или ещё не синхронизирована.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="media">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Фото и видео</CardTitle>
                <CardDescription>
                  Визуальные факты помогают быстро подтвердить прогресс, блокеры и безопасность на площадке.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {recentVideoFacts.length > 0 ? (
                  recentVideoFacts.map((item) => (
                    <div
                      className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[var(--ink)]">{item.title}</div>
                          <div className="mt-1 text-xs text-[var(--ink-soft)]">
                            {item.projectName ?? "Проект не указан"}
                            {item.section ? ` · ${item.section}` : ""}
                          </div>
                        </div>
                        <Badge variant={item.verificationStatus === "verified" ? "success" : "info"}>
                          {formatVerificationStatus(item.verificationStatus)}
                        </Badge>
                      </div>
                      {item.summary ? <div className="mt-3 text-sm text-[var(--ink-muted)]">{item.summary}</div> : null}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                        <Badge variant="neutral">{formatObservationTypeLabel(item.observationType)}</Badge>
                        <Badge variant="info">{formatPercent(item.confidence)}</Badge>
                        <span>{formatShortDate(item.capturedAt)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[18px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
                    Пока нет визуальных фактов. Добавьте видео или фото к рабочему отчёту, и эта вкладка оживёт.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle>Сводка визуальных фактов</CardTitle>
                    <CardDescription>
                      Первый контур визуальных подтверждений: фотографии и видео, связанные с отчётами, площадками и статусом проверки.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="info">Зафиксировано {videoFacts.summary.observed}</Badge>
                    <Badge variant="success">Подтверждено {videoFacts.summary.verified}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] sm:grid-cols-3">
                  <div>
                    <div className="font-medium text-[var(--ink)]">Всего фактов</div>
                    <div className="mt-1">{videoFacts.summary.total}</div>
                  </div>
                  <div>
                    <div className="font-medium text-[var(--ink)]">Средняя уверенность</div>
                    <div className="mt-1">{formatPercent(videoFacts.summary.averageConfidence)}</div>
                  </div>
                  <div>
                    <div className="font-medium text-[var(--ink)]">Последняя съёмка</div>
                    <div className="mt-1">{formatShortDate(videoFacts.summary.lastCapturedAt)}</div>
                  </div>
                </div>

                {videoFacts.items.length > 0 ? (
                  <div className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                    Последний факт: <span className="font-medium text-[var(--ink)]">{videoFacts.items[0]?.title}</span>
                  </div>
                ) : (
                  <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                    Визуальные факты пока не поступают. Когда появятся фото или видео, эта сводка оживёт.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <div className="grid gap-4 xl:grid-cols-4">
        <DomainMetricCard
          detail="Площадки и участки, которые уже можно показать на карте по известным опорным точкам."
          label="Активные площадки"
          status={{ label: projectMarkers.length > 0 ? "Видно" : "Ждём", variant: projectMarkers.length > 0 ? "success" : "warning" }}
          value={String(liveProjects.length)}
        />
        <DomainMetricCard
          detail="Полевые отчёты, которые уже ждут проверки и могут превратиться в сигнал или эскалацию."
          label="Отчёты на проверке"
          status={{ label: activeReports > 0 ? "Внимание" : "Тишина", variant: activeReports > 0 ? "warning" : "success" }}
          value={String(activeReports)}
        />
        <DomainMetricCard
          detail="Подтверждённые GPS-сущности из живой телеметрии: оборудование, которое уже видно в контуре."
          label="Живая техника"
          status={{ label: gpsTelemetry.status === "ok" ? "Живой" : gpsTelemetry.status === "degraded" ? "Шум" : "Ожидание", variant: gpsTelemetry.status === "ok" ? "success" : gpsTelemetry.status === "degraded" ? "warning" : "neutral" }}
          value={String(gpsTelemetry.summary.equipmentCount)}
        />
        <DomainMetricCard
          detail="Геозоны, где уже есть подтверждённая активность и можно отслеживать её без ручного поиска."
          label="Геозоны"
          status={{ label: geofenceMarkers.length > 0 ? "Отслеживаются" : "Ждём", variant: geofenceMarkers.length > 0 ? "info" : "warning" }}
          value={String(geofenceMarkers.length)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API полевого контура</CardTitle>
          <CardDescription>
            Этот хаб уже привязан к реальным backend endpoints, чтобы карта и поле всегда читали одни и те же живые факты.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-[var(--ink-soft)] sm:grid-cols-2 xl:grid-cols-3">
          <EndpointPill href="/api/connectors/gps/telemetry" label="Правда GPS-телеметрии" />
          <EndpointPill href="/api/work-reports" label="Рабочие отчёты" />
          <EndpointPill href="/api/work-reports/video-facts" label="Видео-факты" />
          <EndpointPill href="/api/enterprise-truth?limit=4&telemetryLimit=3" label="Единая сводка" />
          <EndpointPill href="/api/escalations" label="Очередь эскалаций" />
          <EndpointPill href="/api/command-center/exceptions" label="Входящие исключения" />
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

function formatRussianQueueItem(value: number) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return "элементов";
  }

  if (remainder10 === 1) {
    return "элемент";
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return "элемента";
  }

  return "элементов";
}

function formatObservationTypeLabel(value: string) {
  switch (value) {
    case "progress_visible":
      return "Прогресс виден";
    case "blocked_area":
      return "Заблокированная зона";
    case "idle_equipment":
      return "Простой техники";
    case "safety_issue":
      return "Вопрос безопасности";
    default:
      return value;
  }
}

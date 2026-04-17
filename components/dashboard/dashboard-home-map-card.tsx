"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowUpRight, MapPinned } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { buttonVariants } from "@/components/ui/button";
import type { FieldMapMarker } from "@/lib/field-operations/location-catalog";
import type { DashboardLocationContour } from "@/components/dashboard/dashboard-home-utils";
import { formatRussianCount } from "@/components/dashboard/dashboard-home-utils";
import type { MessageKey } from "@/lib/translations";

function DashboardMapLoading() {
  return (
    <div
      aria-hidden="true"
      className="min-h-[520px] animate-pulse rounded-[22px] border border-[var(--line)] bg-[var(--surface-secondary)]/40"
    />
  );
}

const FieldMapCanvas = dynamic(
  () =>
    import("@/components/field-operations/field-map-canvas").then(
      (module) => module.FieldMapCanvas
    ),
  {
    ssr: false,
    loading: () => <DashboardMapLoading />,
  }
);

export function DashboardHomeMapCard({
  dashboardFieldCenter,
  dashboardFieldMarkers,
  locationContours,
  locationSummaryCount,
  projectsWithLocationsCount,
  t,
}: {
  dashboardFieldCenter: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
  dashboardFieldMarkers: FieldMapMarker[];
  locationContours: DashboardLocationContour[];
  locationSummaryCount: number;
  projectsWithLocationsCount: number;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <Card className="p-3" data-testid="dashboard-map">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <MapPinned className="h-4 w-4 text-[var(--brand)]" />
                <h3 className="text-xs font-medium">{t("dashboard.map")}</h3>
              </div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.mapDescription")}</p>
            </div>
            <Badge variant="neutral">{locationSummaryCount} локаций</Badge>
          </div>

          {dashboardFieldMarkers.length > 0 ? (
            <div className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)] p-2">
              <FieldMapCanvas initialCenter={dashboardFieldCenter} markers={dashboardFieldMarkers} />
            </div>
          ) : (
            <div className="rounded-lg border bg-[var(--panel-soft)]/40 p-3 text-sm text-muted-foreground">
              Добавьте локации в проекты, чтобы карта показала точки работ.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Активные контуры
            </p>
            <span className="text-[10px] text-muted-foreground">
              {projectsWithLocationsCount} проектов с локациями
            </span>
          </div>
          {locationContours.length === 0 ? (
            <div className="rounded-lg border bg-[var(--panel-soft)]/40 p-3 text-xs text-muted-foreground">
              Локации появятся, когда проекты получат город или площадку.
            </div>
          ) : (
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {locationContours.slice(0, 6).map((entry) => (
                <div
                  key={entry.location}
                  className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/55 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--ink)]">
                        {entry.location}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--ink-soft)]">{entry.summary}</p>
                    </div>
                    <Badge variant={entry.tone}>
                      {entry.attentionCount > 0 ? entry.attentionCount : entry.projectCount}
                    </Badge>
                  </div>

                  <div className="mt-3 space-y-2">
                    <Progress
                      aria-label={`Прогресс по локации ${entry.location}`}
                      className="h-2.5 bg-[var(--line)]/70"
                      value={entry.progress}
                    />
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ink-soft)]">
                      <span>
                        {entry.projectCount}{" "}
                        {formatRussianCount(
                          entry.projectCount,
                          "проект",
                          "проекта",
                          "проектов"
                        )}
                      </span>
                      <span>{entry.progress}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Link
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "h-8 text-xs",
              })}
              href="/field-operations"
            >
              {t("dashboard.mapOpen")}
              <ArrowUpRight className="ml-auto h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

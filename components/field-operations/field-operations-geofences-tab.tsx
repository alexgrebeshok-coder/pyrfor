import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";

import {
  formatRussianQueueItem,
  formatShortDate,
} from "@/components/field-operations/field-operations-utils";

export function FieldOperationsGeofencesTab({
  gpsTelemetry,
}: {
  gpsTelemetry: GpsTelemetryTruthSnapshot;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Геозоны</CardTitle>
        <CardDescription>
          Геозоны показывают, где накопилась активность оборудования и как давно зона
          была подтверждена.
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
                  {geofence.equipmentIds.length > 0
                    ? geofence.equipmentIds.join(", ")
                    : "нет данных"}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-[20px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)] xl:col-span-2">
            Геозоны появятся, когда GPS/GLONASS провайдер вернёт сессии с геозонной
            привязкой.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

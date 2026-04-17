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
  formatEquipmentStatus,
  formatShortDate,
} from "@/components/field-operations/field-operations-utils";

export function FieldOperationsEquipmentTab({
  gpsTelemetry,
}: {
  gpsTelemetry: GpsTelemetryTruthSnapshot;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Сводка телеметрии</CardTitle>
        <CardDescription>
          Короткая оперативная панель по GPS/GLONASS: кто в движении, кто стоит, и
          где техника была замечена в последний раз.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              Состояние коннектора
            </div>
            <div className="mt-2 font-medium text-[var(--ink)]">{gpsTelemetry.message}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              Связано техники
            </div>
            <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
              {gpsTelemetry.summary.equipmentCount}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              Связано геозон
            </div>
            <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
              {gpsTelemetry.summary.geofenceCount}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              Общая длительность
            </div>
            <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
              {gpsTelemetry.summary.totalDurationSeconds
                ? `${Math.round(gpsTelemetry.summary.totalDurationSeconds / 3600)} ч`
                : "нет данных"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              Сессий без завершения
            </div>
            <div className="mt-2 text-lg font-semibold text-[var(--ink)]">
              {gpsTelemetry.summary.openEndedSessionCount}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              Обновлено
            </div>
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
                  <Badge
                    variant={equipment.latestStatus === "work" ? "success" : "warning"}
                  >
                    {formatEquipmentStatus(equipment.latestStatus)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-1 text-sm text-[var(--ink-muted)]">
                  <div>Сессий: {equipment.sessionCount}</div>
                  <div>
                    Время:{" "}
                    {equipment.totalDurationSeconds
                      ? `${Math.round(equipment.totalDurationSeconds / 3600)} ч`
                      : "0 ч"}
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
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, MapPinned } from "lucide-react";

import { FieldMapCanvas, getFieldMapProvider, getFieldMapProviderLabel } from "@/components/field-operations/field-map-canvas";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { FieldMapMarker } from "@/lib/field-operations/location-catalog";
import { cn } from "@/lib/utils";

type MapFilter = "all" | "project" | "geofence" | "live" | "watch" | "pending";

const MAP_FILTERS: Array<{
  value: MapFilter;
  label: string;
}> = [
  { value: "all", label: "Все" },
  { value: "project", label: "Площадки" },
  { value: "geofence", label: "Геозоны" },
  { value: "live", label: "Живые" },
  { value: "watch", label: "Под наблюдением" },
  { value: "pending", label: "В ожидании" },
];

function statusVariant(status: FieldMapMarker["status"]) {
  switch (status) {
    case "watch":
      return "warning";
    case "pending":
      return "neutral";
    case "neutral":
      return "info";
    case "live":
    default:
      return "success";
  }
}

function markerAccent(kind: FieldMapMarker["kind"]) {
  return kind === "project" ? "Площадка" : "Геозона";
}

function markerSummary(marker: FieldMapMarker) {
  return marker.kind === "project"
    ? `${marker.count} ${formatRussianPlural(marker.count, "площадка", "площадки", "площадок")}`
    : `${marker.count} ${formatRussianPlural(marker.count, "геозона", "геозоны", "геозон")}`;
}

function formatObservedAt(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
}

function formatRussianPlural(value: number, one: string, few: string, many: string) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return many;
  }

  if (remainder10 === 1) {
    return one;
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return few;
  }

  return many;
}

export function FieldMapTab({
  markers,
  unresolvedLocations,
}: {
  markers: FieldMapMarker[];
  unresolvedLocations: string[];
}) {
  const [mapReady, setMapReady] = useState(false);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [focusMarkerId, setFocusMarkerId] = useState<string | null>(null);
  const [resolvedProvider, setResolvedProvider] = useState(getFieldMapProvider());

  const initialCenter = useMemo(() => {
    if (markers.length === 0) {
      return { latitude: 61.5, longitude: 65.0, zoom: 2.6 };
    }

    const totalLatitude = markers.reduce((sum, marker) => sum + marker.latitude, 0);
    const totalLongitude = markers.reduce((sum, marker) => sum + marker.longitude, 0);
    return {
      latitude: totalLatitude / markers.length,
      longitude: totalLongitude / markers.length,
      zoom: markers.length > 1 ? 2.9 : 4,
    };
  }, [markers]);

  const visibleMarkers = useMemo(() => {
    switch (filter) {
      case "project":
        return markers.filter((marker) => marker.kind === "project");
      case "geofence":
        return markers.filter((marker) => marker.kind === "geofence");
      case "live":
        return markers.filter((marker) => marker.status === "live");
      case "watch":
        return markers.filter((marker) => marker.status === "watch");
      case "pending":
        return markers.filter((marker) => marker.status === "pending");
      case "all":
      default:
        return markers;
    }
  }, [filter, markers]);

  const mapProvider = getFieldMapProvider();
  const mapProviderLabel = getFieldMapProviderLabel(resolvedProvider);
  const mapFilterCount = visibleMarkers.length;
  const focusedMarker = focusMarkerId ? visibleMarkers.find((marker) => marker.id === focusMarkerId) ?? null : null;
  const latestObservedAt = useMemo(() => {
    const latest = visibleMarkers
      .map((marker) => marker.observedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

    return formatObservedAt(latest);
  }, [visibleMarkers]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-[var(--line)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Карта участков</CardTitle>
            <CardDescription>
              Карта строится по курируемым опорным точкам из проектов и геозон. Если задан ключ Яндекс.Карт,
              используется он. Если нет, включается MapLibre / OSM. Мы не подменяем карту выдуманными координатами.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={mapReady ? "success" : "warning"}>{mapReady ? "Карта готова" : "Загрузка карты"}</Badge>
            <Badge variant="info">{mapProviderLabel}</Badge>
            <Badge variant="info">{mapFilterCount} из {markers.length} маркеров</Badge>
            {latestObservedAt ? <Badge variant="success">Свежесть: {latestObservedAt}</Badge> : null}
            {unresolvedLocations.length > 0 ? (
              <Badge variant="warning">{unresolvedLocations.length} без привязки</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(290px,0.6fr)] xl:p-4">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {MAP_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-semibold transition",
                  filter === item.value
                    ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                    : "border-[var(--line)] bg-[var(--panel-soft)] text-[var(--ink-soft)] hover:border-[var(--brand)]/40 hover:text-[var(--ink)]"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="rounded-[28px] border border-[var(--line)] bg-[var(--panel-soft)] p-3">
            <FieldMapCanvas
              initialCenter={initialCenter}
              focusMarkerId={focusMarkerId}
              markers={visibleMarkers}
              onReadyChange={setMapReady}
              onProviderChange={setResolvedProvider}
              provider={mapProvider}
            />
          </div>

          {unresolvedLocations.length > 0 ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>Точки без карты</CardTitle>
                <CardDescription>
                  Эти значения пока живут как текстовые записи о локации. Когда появятся координаты, они автоматически
                  попадут в карту.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {unresolvedLocations.map((location) => (
                  <Badge key={location} variant="neutral">
                    {location}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <MapPinned className="h-4 w-4 text-[var(--brand)]" />
            Маркеры
            <span className="text-xs font-medium text-[var(--ink-soft)]">
              {visibleMarkers.length} из {markers.length}
            </span>
            {focusedMarker ? <span className="text-xs font-medium text-[var(--ink-soft)]">Фокус: {focusedMarker.label}</span> : null}
          </div>

          {focusedMarker ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 text-xs text-[var(--ink-soft)]">
              <span>
                Фокус на <span className="font-semibold text-[var(--ink)]">{focusedMarker.label}</span>
              </span>
              <button
                type="button"
                onClick={() => setFocusMarkerId(null)}
                className="rounded-full border border-[var(--line)] px-2 py-1 font-semibold text-[var(--ink-soft)] transition hover:border-[var(--brand)]/40 hover:text-[var(--ink)]"
              >
                Сбросить
              </button>
            </div>
          ) : null}

          {visibleMarkers.length > 0 ? (
            <div className="grid gap-3">
              {visibleMarkers.map((marker) => (
                <div
                  className={cn(
                    "rounded-[20px] border bg-[var(--panel-soft)] p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]",
                    focusMarkerId === marker.id ? "border-[var(--brand)] ring-1 ring-[var(--brand)]/25" : "border-[var(--line)]"
                  )}
                  data-active-marker={focusMarkerId === marker.id ? "true" : "false"}
                  key={marker.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-[var(--ink)]">{marker.label}</div>
                      <div className="mt-1 line-clamp-2 text-sm text-[var(--ink-soft)]">{marker.subtitle}</div>
                    </div>
                    <Badge variant={statusVariant(marker.status)}>{markerAccent(marker.kind)}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <Badge variant="neutral">{markerSummary(marker)}</Badge>
                    <span>{formatCoordinates(marker.latitude, marker.longitude)}</span>
                    {formatObservedAt(marker.observedAt) ? (
                      <span>Обновлено {formatObservedAt(marker.observedAt)}</span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 text-xs text-[var(--ink-muted)]">
                      <div className="truncate">
                        {marker.items.length > 1
                          ? `${marker.items.length} вложенных сущностей`
                          : marker.items[0] ?? "Без дополнительных связей"}
                      </div>
                      {marker.observedAt ? (
                        <div className="mt-1">Свежесть: {formatObservedAt(marker.observedAt)}</div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFocusMarkerId(marker.id)}
                        className={cn(
                          buttonVariants({ variant: focusMarkerId === marker.id ? "secondary" : "ghost", size: "sm" }),
                          "h-8 px-2 text-xs"
                        )}
                      >
                        {focusMarkerId === marker.id ? "В фокусе" : "Показать на карте"}
                      </button>
                      {marker.href ? (
                        <Link
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}
                          href={marker.href}
                        >
                          Открыть
                          <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="space-y-3 p-4 text-sm text-[var(--ink-soft)]">
                <div>
                  По этому фильтру пока нет маркеров. Попробуйте другой фильтр или добавьте проект с локацией / GPS-геозону,
                  и карта станет активной.
                </div>
                <div className="text-xs text-[var(--ink-muted)]">
                  Мы специально не подменяем карту фейковыми координатами.
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

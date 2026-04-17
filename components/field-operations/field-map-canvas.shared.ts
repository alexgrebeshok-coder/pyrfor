import type { StyleSpecification } from "maplibre-gl";

import type { FieldMapMarker } from "@/lib/field-operations/location-catalog";

export type FieldMapProvider = "maplibre" | "yandex";

export interface FieldMapCenter {
  latitude: number;
  longitude: number;
  zoom: number;
}

export interface FieldMapCanvasBaseProps {
  markers: FieldMapMarker[];
  initialCenter: FieldMapCenter;
  focusMarkerId?: string | null;
  onReadyChange?: (ready: boolean) => void;
  onProviderChange?: (provider: FieldMapProvider) => void;
}

export interface FieldMapCanvasProps extends FieldMapCanvasBaseProps {
  provider?: FieldMapProvider;
}

export const YANDEX_MAPS_API_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY?.trim() ?? null;

export const FIELD_MAP_CANVAS_CLASSNAME =
  "min-h-[520px] overflow-hidden rounded-[22px] border border-[var(--line)] bg-[radial-gradient(circle_at_top,#27344c_0%,#111827_58%,#0b1220_100%)]";

export const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

export function markerTone(status: FieldMapMarker["status"], kind: FieldMapMarker["kind"]) {
  if (kind === "project") {
    switch (status) {
      case "watch":
        return "#f59e0b";
      case "pending":
        return "#94a3b8";
      case "neutral":
        return "#38bdf8";
      case "live":
      default:
        return "#2563eb";
    }
  }

  switch (status) {
    case "watch":
      return "#f97316";
    case "pending":
      return "#94a3b8";
    case "neutral":
      return "#22c55e";
    case "live":
    default:
      return "#10b981";
  }
}

export function markerAccent(kind: FieldMapMarker["kind"]) {
  return kind === "project" ? "Площадка" : "Геозона";
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

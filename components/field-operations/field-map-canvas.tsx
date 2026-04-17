"use client";

import {
  type FieldMapCanvasProps,
  type FieldMapProvider,
  YANDEX_MAPS_API_KEY,
} from "./field-map-canvas.shared";
import { MapLibreFieldMapCanvas } from "./field-map-canvas-maplibre";
import { YandexFieldMapCanvas } from "./field-map-canvas-yandex";

export type { FieldMapProvider } from "./field-map-canvas.shared";

export function getFieldMapProvider(): FieldMapProvider {
  return YANDEX_MAPS_API_KEY ? "yandex" : "maplibre";
}

export function getFieldMapProviderLabel(provider: FieldMapProvider) {
  return provider === "yandex" ? "Яндекс Карты" : "MapLibre / OSM";
}

export function FieldMapCanvas({
  provider = getFieldMapProvider(),
  ...props
}: FieldMapCanvasProps) {
  if (provider === "yandex") {
    return <YandexFieldMapCanvas {...props} />;
  }

  return <MapLibreFieldMapCanvas {...props} />;
}

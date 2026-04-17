"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";

import {
  escapeHtml,
  FIELD_MAP_CANVAS_CLASSNAME,
  MAP_STYLE,
  markerAccent,
  markerTone,
  type FieldMapCanvasBaseProps,
} from "./field-map-canvas.shared";

export function MapLibreFieldMapCanvas({
  markers,
  initialCenter,
  focusMarkerId,
  onReadyChange,
  onProviderChange,
}: FieldMapCanvasBaseProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const markerLookupRef = useRef(new Map<string, MapLibreMarker>());
  const mapApiRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef(markers);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    onProviderChange?.("maplibre");
  }, [onProviderChange]);

  useEffect(() => {
    let active = true;
    const markerLookup = markerLookupRef.current;
    onReadyChange?.(false);

    async function initMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      const maplibre = await import("maplibre-gl");
      if (!active || !mapContainerRef.current) {
        return;
      }

      mapApiRef.current = maplibre;
      const map = new maplibre.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        center: [initialCenter.longitude, initialCenter.latitude],
        zoom: initialCenter.zoom,
        attributionControl: false,
      });

      map.addControl(new maplibre.NavigationControl({ showCompass: true }), "top-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");

      map.on("load", () => {
        if (!active) {
          return;
        }

        onReadyChange?.(true);
        syncMapLibreMarkers(map, maplibre, markersRef.current, markerRefs, markerLookupRef);
      });

      mapRef.current = map;
    }

    initMap().catch(() => {
      onReadyChange?.(false);
    });

    return () => {
      active = false;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      markerLookup.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      mapApiRef.current = null;
    };
  }, [initialCenter.latitude, initialCenter.longitude, initialCenter.zoom, onReadyChange]);

  useEffect(() => {
    if (!mapRef.current || !mapApiRef.current) {
      return;
    }

    syncMapLibreMarkers(mapRef.current, mapApiRef.current, markers, markerRefs, markerLookupRef);
  }, [markers]);

  useEffect(() => {
    if (!mapRef.current || !focusMarkerId) {
      return;
    }

    const target = markers.find((marker) => marker.id === focusMarkerId);
    if (!target) {
      return;
    }

    mapRef.current.easeTo({
      center: [target.longitude, target.latitude],
      zoom: Math.max(initialCenter.zoom, 5),
      duration: 700,
    });

    const targetMarker = markerLookupRef.current.get(focusMarkerId);
    targetMarker?.togglePopup?.();
  }, [focusMarkerId, initialCenter.zoom, markers]);

  return (
    <div
      aria-label="Карта полевого контура"
      className={FIELD_MAP_CANVAS_CLASSNAME}
      ref={mapContainerRef}
    />
  );
}

function syncMapLibreMarkers(
  map: MapLibreMap,
  maplibre: typeof import("maplibre-gl"),
  markers: FieldMapCanvasBaseProps["markers"],
  markerRefs: MutableRefObject<MapLibreMarker[]>,
  markerLookupRef: MutableRefObject<Map<string, MapLibreMarker>>
) {
  markerRefs.current.forEach((marker) => marker.remove());
  markerRefs.current = [];
  markerLookupRef.current.clear();

  if (markers.length === 0) {
    return;
  }

  const bounds = new maplibre.LngLatBounds();

  for (const marker of markers) {
    const element = document.createElement("div");
    element.style.width = "18px";
    element.style.height = "18px";
    element.style.borderRadius = "9999px";
    element.style.border = "2px solid rgba(255,255,255,0.9)";
    element.style.background = markerTone(marker.status, marker.kind);
    element.style.boxShadow =
      "0 0 0 6px rgba(255,255,255,0.08), 0 10px 20px rgba(15,23,42,0.35)";
    element.style.cursor = "pointer";

    const markerPopup = new maplibre.Popup({ offset: 22 }).setHTML(`
      <div style="min-width: 180px;">
        <div style="font-size: 13px; font-weight: 700; margin-bottom: 4px;">${escapeHtml(marker.label)}</div>
        <div style="font-size: 12px; opacity: 0.78; margin-bottom: 6px;">${escapeHtml(marker.subtitle)}</div>
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; opacity: .7;">${escapeHtml(
          markerAccent(marker.kind)
        )}</div>
      </div>
    `);

    const mapMarker = new maplibre.Marker({ element, anchor: "bottom" })
      .setLngLat([marker.longitude, marker.latitude])
      .setPopup(markerPopup)
      .addTo(map);

    markerRefs.current.push(mapMarker);
    markerLookupRef.current.set(marker.id, mapMarker);
    bounds.extend([marker.longitude, marker.latitude]);
  }

  if (markers.length === 1) {
    map.easeTo({
      center: [markers[0].longitude, markers[0].latitude],
      zoom: 4.5,
      duration: 600,
    });
    return;
  }

  map.fitBounds(bounds, {
    padding: 56,
    duration: 700,
    maxZoom: 6.25,
  });
}

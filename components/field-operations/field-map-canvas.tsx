"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import type { FieldMapMarker } from "@/lib/field-operations/location-catalog";

export type FieldMapProvider = "maplibre" | "yandex";

const YANDEX_MAPS_API_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY?.trim() ?? null;
let yandexMapsLoadPromise: Promise<YandexMapsApi> | null = null;

const MAP_STYLE: StyleSpecification = {
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

interface YandexMapsApi {
  ready: (callback: () => void) => void;
  Map: new (
    element: HTMLElement,
    options: {
      center: [number, number];
      zoom: number;
    }
  ) => YandexMapInstance;
  Placemark: new (
    coords: [number, number],
    properties: {
      hintContent?: string;
      balloonContent?: string;
    },
    options?: {
      preset?: string;
    }
  ) => YandexPlacemarkInstance;
}

interface YandexMapInstance {
  geoObjects: {
    add: (object: YandexPlacemarkInstance) => void;
    remove: (object: YandexPlacemarkInstance) => void;
  };
  destroy: () => void;
  setCenter: (coords: [number, number]) => void;
  setZoom: (zoom: number) => void;
}

interface YandexPlacemarkInstance {
  events: {
    add: (event: string, callback: () => void) => void;
  };
}

declare global {
  interface Window {
    ymaps?: YandexMapsApi;
  }
}

export function getFieldMapProvider(): FieldMapProvider {
  return YANDEX_MAPS_API_KEY ? "yandex" : "maplibre";
}

export function getFieldMapProviderLabel(provider: FieldMapProvider) {
  return provider === "yandex" ? "Яндекс Карты" : "MapLibre / OSM";
}

export function FieldMapCanvas({
  provider = getFieldMapProvider(),
  markers,
  initialCenter,
  focusMarkerId,
  onReadyChange,
  onProviderChange,
}: {
  provider?: FieldMapProvider;
  markers: FieldMapMarker[];
  initialCenter: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
  focusMarkerId?: string | null;
  onReadyChange?: (ready: boolean) => void;
  onProviderChange?: (provider: FieldMapProvider) => void;
}) {
  if (provider === "yandex") {
    return (
      <YandexFieldMapCanvas
        initialCenter={initialCenter}
        focusMarkerId={focusMarkerId}
        markers={markers}
        onReadyChange={onReadyChange}
        onProviderChange={onProviderChange}
      />
    );
  }

  return (
    <MapLibreFieldMapCanvas
      initialCenter={initialCenter}
      focusMarkerId={focusMarkerId}
      markers={markers}
      onReadyChange={onReadyChange}
      onProviderChange={onProviderChange}
    />
  );
}

function loadYandexMaps() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Yandex Maps can only be loaded in the browser."));
  }

  if (window.ymaps) {
    return Promise.resolve(window.ymaps);
  }

  if (!YANDEX_MAPS_API_KEY) {
    return Promise.reject(new Error("Yandex Maps API key is not configured."));
  }

  if (!yandexMapsLoadPromise) {
    yandexMapsLoadPromise = new Promise<YandexMapsApi>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>("script[data-ceoclaw-yandex-maps='true']");
      const finish = () => {
        const ymaps = window.ymaps;
        if (!ymaps) {
          reject(new Error("Yandex Maps script loaded without the ymaps runtime."));
          return;
        }

        ymaps.ready(() => resolve(ymaps));
      };

      if (existingScript) {
        existingScript.addEventListener("load", finish, { once: true });
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Yandex Maps script failed to load.")),
          { once: true }
        );
        finish();
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.dataset.ceoclawYandexMaps = "true";
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(YANDEX_MAPS_API_KEY)}&lang=ru_RU`;
      script.onload = finish;
      script.onerror = () => reject(new Error("Yandex Maps script failed to load."));
      document.head.appendChild(script);
    }).catch((error) => {
      yandexMapsLoadPromise = null;
      throw error;
    });
  }

  return yandexMapsLoadPromise;
}

function MapLibreFieldMapCanvas({
  markers,
  initialCenter,
  focusMarkerId,
  onReadyChange,
  onProviderChange,
}: {
  markers: FieldMapMarker[];
  initialCenter: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
  focusMarkerId?: string | null;
  onReadyChange?: (ready: boolean) => void;
  onProviderChange?: (provider: FieldMapProvider) => void;
}) {
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
      markerLookupRef.current.clear();
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
      className="min-h-[520px] overflow-hidden rounded-[22px] border border-[var(--line)] bg-[radial-gradient(circle_at_top,#27344c_0%,#111827_58%,#0b1220_100%)]"
      ref={mapContainerRef}
    />
  );
}

function YandexFieldMapCanvas({
  markers,
  initialCenter,
  focusMarkerId,
  onReadyChange,
  onProviderChange,
}: {
  markers: FieldMapMarker[];
  initialCenter: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
  focusMarkerId?: string | null;
  onReadyChange?: (ready: boolean) => void;
  onProviderChange?: (provider: FieldMapProvider) => void;
}) {
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">(
    YANDEX_MAPS_API_KEY ? "loading" : "error"
  );

  useEffect(() => {
    onReadyChange?.(false);
    onProviderChange?.("maplibre");

    if (!YANDEX_MAPS_API_KEY) {
      return;
    }

    let active = true;
    loadYandexMaps()
      .then(() => {
        if (!active) {
          return;
        }

        setLoadStatus("ready");
        onProviderChange?.("yandex");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setLoadStatus("error");
        onProviderChange?.("maplibre");
      });

    return () => {
      active = false;
    };
  }, [onProviderChange, onReadyChange]);

  if (loadStatus === "error") {
    return (
      <MapLibreFieldMapCanvas
        focusMarkerId={focusMarkerId}
        initialCenter={initialCenter}
        markers={markers}
        onReadyChange={onReadyChange}
        onProviderChange={onProviderChange}
      />
    );
  }

  if (loadStatus !== "ready") {
    return (
      <div className="relative">
        <MapLibreFieldMapCanvas
          focusMarkerId={focusMarkerId}
          initialCenter={initialCenter}
          markers={markers}
          onReadyChange={onReadyChange}
          onProviderChange={onProviderChange}
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/20 bg-black/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur">
          Подключаем Яндекс.Карты
        </div>
      </div>
    );
  }

  return (
    <YandexFieldMapReadyCanvas
      focusMarkerId={focusMarkerId}
      initialCenter={initialCenter}
      markers={markers}
      onReadyChange={onReadyChange}
      onProviderChange={onProviderChange}
    />
  );
}

function YandexFieldMapReadyCanvas({
  markers,
  initialCenter,
  focusMarkerId,
  onReadyChange,
  onProviderChange,
}: {
  markers: FieldMapMarker[];
  initialCenter: {
    latitude: number;
    longitude: number;
    zoom: number;
  };
  focusMarkerId?: string | null;
  onReadyChange?: (ready: boolean) => void;
  onProviderChange?: (provider: FieldMapProvider) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<YandexMapInstance | null>(null);
  const markerRefs = useRef<YandexPlacemarkInstance[]>([]);
  const markerLookupRef = useRef(new Map<string, { marker: FieldMapMarker; placemark: YandexPlacemarkInstance }>());
  const markersRef = useRef(markers);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    onProviderChange?.("yandex");
  }, [onProviderChange]);

  useEffect(() => {
    let active = true;
    onReadyChange?.(false);

    async function initMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      const ymaps = window.ymaps;
      if (!ymaps) {
        throw new Error("Yandex Maps script is not available.");
      }

      ymaps.ready(() => {
        if (!active || !mapContainerRef.current) {
          return;
        }

        const map = new ymaps.Map(mapContainerRef.current, {
          center: [initialCenter.latitude, initialCenter.longitude],
          zoom: initialCenter.zoom,
        });

        mapRef.current = map;
        onReadyChange?.(true);
        syncYandexMarkers(map, ymaps, markersRef.current, markerRefs, markerLookupRef);
      });
    }

    initMap().catch(() => {
      onReadyChange?.(false);
    });

    return () => {
      active = false;
      const map = mapRef.current;
      if (map) {
        for (const placemark of markerRefs.current) {
          map.geoObjects.remove(placemark);
        }
        map.destroy();
      }
      markerRefs.current = [];
      markerLookupRef.current.clear();
      mapRef.current = null;
    };
  }, [initialCenter.latitude, initialCenter.longitude, initialCenter.zoom, onReadyChange]);

  useEffect(() => {
    if (!mapRef.current || !window.ymaps) {
      return;
    }

    syncYandexMarkers(mapRef.current, window.ymaps, markers, markerRefs, markerLookupRef);
  }, [markers]);

  useEffect(() => {
    if (!mapRef.current || !focusMarkerId || !window.ymaps) {
      return;
    }

    const target = markers.find((marker) => marker.id === focusMarkerId);
    if (!target) {
      return;
    }

    mapRef.current.setCenter([target.latitude, target.longitude]);
    mapRef.current.setZoom(Math.max(initialCenter.zoom, 5));
  }, [focusMarkerId, initialCenter.zoom, markers]);

  return (
    <div
      aria-label="Карта полевого контура"
      className="min-h-[520px] overflow-hidden rounded-[22px] border border-[var(--line)] bg-[radial-gradient(circle_at_top,#27344c_0%,#111827_58%,#0b1220_100%)]"
      ref={mapContainerRef}
    />
  );
}

function syncMapLibreMarkers(
  map: MapLibreMap,
  maplibre: typeof import("maplibre-gl"),
  markers: FieldMapMarker[],
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
    element.style.boxShadow = "0 0 0 6px rgba(255,255,255,0.08), 0 10px 20px rgba(15,23,42,0.35)";
    element.style.cursor = "pointer";

    const markerPopup = new maplibre.Popup({ offset: 22 }).setHTML(
      `
        <div style="min-width: 180px;">
          <div style="font-size: 13px; font-weight: 700; margin-bottom: 4px;">${escapeHtml(marker.label)}</div>
          <div style="font-size: 12px; opacity: 0.78; margin-bottom: 6px;">${escapeHtml(marker.subtitle)}</div>
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; opacity: .7;">${escapeHtml(
            markerAccent(marker.kind)
          )}</div>
        </div>
      `
    );

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

function syncYandexMarkers(
  map: YandexMapInstance,
  ymaps: YandexMapsApi,
  markers: FieldMapMarker[],
  markerRefs: MutableRefObject<YandexPlacemarkInstance[]>,
  markerLookupRef: MutableRefObject<Map<string, { marker: FieldMapMarker; placemark: YandexPlacemarkInstance }>>
) {
  for (const placemark of markerRefs.current) {
    map.geoObjects.remove(placemark);
  }
  markerRefs.current = [];
  markerLookupRef.current.clear();

  if (markers.length === 0) {
    return;
  }

  for (const marker of markers) {
    const placemark = new ymaps.Placemark(
      [marker.latitude, marker.longitude],
      {
        hintContent: marker.label,
        balloonContent: `${marker.label}<br />${marker.subtitle}`,
      },
      {
        preset: marker.kind === "project" ? "islands#blueDotIcon" : "islands#greenDotIcon",
      }
    );

    map.geoObjects.add(placemark);
    markerRefs.current.push(placemark);
    markerLookupRef.current.set(marker.id, { marker, placemark });
  }
}

function markerTone(status: FieldMapMarker["status"], kind: FieldMapMarker["kind"]) {
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

function markerAccent(kind: FieldMapMarker["kind"]) {
  return kind === "project" ? "Площадка" : "Геозона";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

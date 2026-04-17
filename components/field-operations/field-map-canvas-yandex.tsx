"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";

import type { FieldMapMarker } from "@/lib/field-operations/location-catalog";

import {
  FIELD_MAP_CANVAS_CLASSNAME,
  YANDEX_MAPS_API_KEY,
  type FieldMapCanvasBaseProps,
} from "./field-map-canvas.shared";
import { MapLibreFieldMapCanvas } from "./field-map-canvas-maplibre";

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

let yandexMapsLoadPromise: Promise<YandexMapsApi> | null = null;

function loadYandexMaps() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Yandex Maps can only be loaded in the browser."));
  }

  const apiKey = YANDEX_MAPS_API_KEY;

  if (window.ymaps) {
    return Promise.resolve(window.ymaps);
  }

  if (!apiKey) {
    return Promise.reject(new Error("Yandex Maps API key is not configured."));
  }

  if (!yandexMapsLoadPromise) {
    yandexMapsLoadPromise = new Promise<YandexMapsApi>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        "script[data-ceoclaw-yandex-maps='true']"
      );
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
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
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

export function YandexFieldMapCanvas({
  markers,
  initialCenter,
  focusMarkerId,
  onReadyChange,
  onProviderChange,
}: FieldMapCanvasBaseProps) {
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
        onProviderChange={onProviderChange}
        onReadyChange={onReadyChange}
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
          onProviderChange={onProviderChange}
          onReadyChange={onReadyChange}
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
      onProviderChange={onProviderChange}
      onReadyChange={onReadyChange}
    />
  );
}

function YandexFieldMapReadyCanvas({
  markers,
  initialCenter,
  focusMarkerId,
  onReadyChange,
  onProviderChange,
}: FieldMapCanvasBaseProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<YandexMapInstance | null>(null);
  const markerRefs = useRef<YandexPlacemarkInstance[]>([]);
  const markerLookupRef = useRef(
    new Map<string, { marker: FieldMapMarker; placemark: YandexPlacemarkInstance }>()
  );
  const markersRef = useRef(markers);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    onProviderChange?.("yandex");
  }, [onProviderChange]);

  useEffect(() => {
    let active = true;
    const markerLookup = markerLookupRef.current;
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
      markerLookup.clear();
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
      className={FIELD_MAP_CANVAS_CLASSNAME}
      ref={mapContainerRef}
    />
  );
}

function syncYandexMarkers(
  map: YandexMapInstance,
  ymaps: YandexMapsApi,
  markers: FieldMapMarker[],
  markerRefs: MutableRefObject<YandexPlacemarkInstance[]>,
  markerLookupRef: MutableRefObject<
    Map<string, { marker: FieldMapMarker; placemark: YandexPlacemarkInstance }>
  >
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

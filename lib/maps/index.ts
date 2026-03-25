/**
 * Map provider factory — selects map provider based on environment/region
 */

import type { MapProvider } from "./map-provider";
import { YandexMapsProvider } from "./adapters/yandex-maps";
import { GoogleMapsProvider } from "./adapters/google-maps";

let cachedProvider: MapProvider | null = null;

/**
 * Get map provider.
 * Priority: explicit region → env detection → fallback
 */
export function getMapProvider(
  region?: "ru" | "global"
): MapProvider {
  if (cachedProvider) return cachedProvider;

  if (region === "ru" || process.env.YANDEX_MAPS_API_KEY || process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY) {
    if (region !== "global") {
      cachedProvider = new YandexMapsProvider();
      return cachedProvider;
    }
  }

  if (process.env.GOOGLE_MAPS_API_KEY) {
    cachedProvider = new GoogleMapsProvider();
    return cachedProvider;
  }

  // Fallback: Yandex if available, else Google stub
  cachedProvider = new YandexMapsProvider();
  return cachedProvider;
}

export function resetMapProviderCache() {
  cachedProvider = null;
}

export type { MapProvider, GeoPoint, GeocodeResult, RouteResult, Place } from "./map-provider";

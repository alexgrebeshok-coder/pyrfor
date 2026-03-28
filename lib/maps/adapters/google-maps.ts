/**
 * Google Maps adapter — geocoding, routing, place search via Google APIs
 * Requires: GOOGLE_MAPS_API_KEY
 */

import type {
  MapProvider,
  GeoPoint,
  GeocodeResult,
  RouteResult,
  Place,
} from "../map-provider";

const getApiKey = () => process.env.GOOGLE_MAPS_API_KEY || "";

export class GoogleMapsProvider implements MapProvider {
  readonly id = "google";
  readonly name = "Google Maps";

  async geocode(address: string): Promise<GeocodeResult | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = new URL(
      "https://maps.googleapis.com/maps/api/geocode/json"
    );
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return null;

    return {
      point: {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
      },
      address: result.formatted_address,
      formattedAddress: result.formatted_address,
      confidence:
        result.geometry.location_type === "ROOFTOP" ? 1.0 : 0.7,
    };
  }

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = new URL(
      "https://maps.googleapis.com/maps/api/geocode/json"
    );
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    return data?.results?.[0]?.formatted_address || null;
  }

  async route(from: GeoPoint, to: GeoPoint): Promise<RouteResult | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = new URL(
      "https://maps.googleapis.com/maps/api/directions/json"
    );
    url.searchParams.set("origin", `${from.lat},${from.lng}`);
    url.searchParams.set("destination", `${to.lat},${to.lng}`);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    const leg = data?.routes?.[0]?.legs?.[0];
    if (!leg) return null;

    return {
      distanceMeters: leg.distance?.value ?? 0,
      durationSeconds: leg.duration?.value ?? 0,
      polyline: data?.routes?.[0]?.overview_polyline?.points,
      summary: data?.routes?.[0]?.summary,
    };
  }

  async searchPlaces(
    query: string,
    near?: GeoPoint,
    limit = 5
  ): Promise<Place[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/textsearch/json"
    );
    url.searchParams.set("query", query);
    url.searchParams.set("key", apiKey);
    if (near) {
      url.searchParams.set("location", `${near.lat},${near.lng}`);
      url.searchParams.set("radius", "50000");
    }

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data = await res.json();
    return (data?.results ?? []).slice(0, limit).map(
      (r: {
        place_id?: string;
        name?: string;
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
        types?: string[];
      }) => ({
        id: r.place_id || crypto.randomUUID(),
        name: r.name || "",
        address: r.formatted_address || "",
        point: {
          lat: r.geometry?.location?.lat ?? 0,
          lng: r.geometry?.location?.lng ?? 0,
        },
        category: r.types?.[0],
      })
    );
  }
}

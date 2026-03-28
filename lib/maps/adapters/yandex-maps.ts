/**
 * Yandex Maps adapter — geocoding, routing, place search via Yandex HTTP APIs
 * Requires: YANDEX_MAPS_API_KEY (or NEXT_PUBLIC_YANDEX_MAPS_API_KEY)
 */

import type {
  MapProvider,
  GeoPoint,
  GeocodeResult,
  RouteResult,
  Place,
} from "../map-provider";

const getApiKey = () =>
  process.env.YANDEX_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ||
  "";

export class YandexMapsProvider implements MapProvider {
  readonly id = "yandex";
  readonly name = "Yandex Maps";

  async geocode(address: string): Promise<GeocodeResult | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = new URL("https://geocode-maps.yandex.ru/1.x/");
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("geocode", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("results", "1");

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    const member =
      data?.response?.GeoObjectCollection?.featureMember?.[0]
        ?.GeoObject;
    if (!member) return null;

    const pos = member.Point?.pos?.split(" ");
    if (!pos || pos.length < 2) return null;

    return {
      point: { lat: parseFloat(pos[1]), lng: parseFloat(pos[0]) },
      address: member.metaDataProperty?.GeocoderMetaData?.text || address,
      formattedAddress:
        member.metaDataProperty?.GeocoderMetaData?.Address
          ?.formatted || "",
      confidence:
        member.metaDataProperty?.GeocoderMetaData?.precision === "exact"
          ? 1.0
          : 0.7,
    };
  }

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = new URL("https://geocode-maps.yandex.ru/1.x/");
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("geocode", `${lng},${lat}`);
    url.searchParams.set("format", "json");
    url.searchParams.set("results", "1");

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    return (
      data?.response?.GeoObjectCollection?.featureMember?.[0]
        ?.GeoObject?.metaDataProperty?.GeocoderMetaData?.text || null
    );
  }

  async route(from: GeoPoint, to: GeoPoint): Promise<RouteResult | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = new URL("https://api.routing.yandex.net/v2/route");
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set(
      "waypoints",
      `${from.lat},${from.lng}|${to.lat},${to.lng}`
    );
    url.searchParams.set("mode", "driving");

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    const route = data?.route?.legs?.[0];
    if (!route) return null;

    return {
      distanceMeters: route.distance?.value ?? 0,
      durationSeconds: route.duration?.value ?? 0,
      summary: route.distance?.text,
    };
  }

  async searchPlaces(
    query: string,
    near?: GeoPoint,
    limit = 5
  ): Promise<Place[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const url = new URL("https://search-maps.yandex.ru/v1/");
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("text", query);
    url.searchParams.set("lang", "ru_RU");
    url.searchParams.set("results", String(limit));
    if (near) {
      url.searchParams.set("ll", `${near.lng},${near.lat}`);
      url.searchParams.set("spn", "0.5,0.5");
    }

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data = await res.json();
    return (data?.features ?? []).map(
      (f: {
        properties?: { CompanyMetaData?: { id?: string; name?: string; Categories?: Array<{ name?: string }>; address?: string } };
        geometry?: { coordinates?: number[] };
      }) => ({
        id: f.properties?.CompanyMetaData?.id || crypto.randomUUID(),
        name: f.properties?.CompanyMetaData?.name || "",
        address: f.properties?.CompanyMetaData?.address || "",
        point: {
          lat: f.geometry?.coordinates?.[1] ?? 0,
          lng: f.geometry?.coordinates?.[0] ?? 0,
        },
        category: f.properties?.CompanyMetaData?.Categories?.[0]?.name,
      })
    );
  }
}

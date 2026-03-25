/**
 * Map provider abstraction — unified interface for geocoding, routing, search
 * Supports: Yandex Maps (Russia), Google Maps (global)
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  point: GeoPoint;
  address: string;
  formattedAddress: string;
  confidence: number; // 0-1
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline?: string;
  summary?: string;
}

export interface Place {
  id: string;
  name: string;
  address: string;
  point: GeoPoint;
  category?: string;
}

export interface DistanceMatrixEntry {
  originIndex: number;
  destinationIndex: number;
  distanceMeters: number;
  durationSeconds: number;
}

export interface MapProvider {
  readonly id: string;
  readonly name: string;

  geocode(address: string): Promise<GeocodeResult | null>;
  reverseGeocode(lat: number, lng: number): Promise<string | null>;
  route(from: GeoPoint, to: GeoPoint): Promise<RouteResult | null>;
  searchPlaces(
    query: string,
    near?: GeoPoint,
    limit?: number
  ): Promise<Place[]>;
}

/**
 * Country-level geolocation lookups for feature engineering.
 * Coordinates are country centroids (matching the synthetic data generator).
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const COUNTRY_COORDS: Record<string, GeoPoint> = {
  US: { lat: 37.0, lng: -95.0 },
  NG: { lat: 9.0, lng: 8.0 },
  UK: { lat: 55.0, lng: -3.0 },
  DE: { lat: 51.0, lng: 10.0 },
  BR: { lat: -14.0, lng: -51.0 },
  IN: { lat: 20.0, lng: 77.0 },
  JP: { lat: 36.0, lng: 138.0 },
  ES: { lat: 40.0, lng: -3.0 },
  PT: { lat: 39.0, lng: -8.0 },
  KR: { lat: 35.0, lng: 128.0 },
  RU: { lat: 55.75, lng: 37.62 },
};

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function countryDistanceKm(countryA: string, countryB: string): number {
  const a = COUNTRY_COORDS[countryA];
  const b = COUNTRY_COORDS[countryB];
  if (!a || !b) {
    return 0;
  }
  return haversineKm(a, b);
}

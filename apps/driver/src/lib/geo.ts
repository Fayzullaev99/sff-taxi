export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle (haversine) distance in metres. */
export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

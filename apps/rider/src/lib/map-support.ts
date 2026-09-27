/**
 * Whether react-native-maps can draw a map (pure, unit-tested).
 *
 * Android renders Google Maps, whose SDK throws a fatal "API key not found" as soon as a
 * MapView mounts when the app was built without `GOOGLE_MAPS_API_KEY` (the tiles may come
 * from OSM, but the view itself is Google's): the app closed on the map right after the
 * sign-in. app.config.ts records whether a key was baked in (`extra.androidMapsKey`);
 * without one the screens use their map-less fallbacks. iOS uses Apple Maps (no key).
 */
export function canShowNativeMap(os: string, extra: Record<string, unknown> | null | undefined) {
  if (os === 'web') return false;
  if (os === 'android') return extra?.androidMapsKey === true;
  return true;
}

/**
 * Parses a coordinate typed by hand ("40.4959", "40,4959"); null unless it is a number
 * within the given bound (90 for latitude, 180 for longitude).
 */
export function parseCoordinate(text: string, bound: 90 | 180): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^-?\d{1,3}(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= bound ? n : null;
}

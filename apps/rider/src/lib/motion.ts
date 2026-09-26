import { useEffect, useRef, useState } from 'react';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

/** Ease-out cubic: fast start, gentle arrival. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

export function interpolate(from: LatLngPoint, to: LatLngPoint, t: number): LatLngPoint {
  const k = easeOut(t);
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
}

/** Where a moving marker should be: the newest trail point, else the last known location. */
export function latestPosition(
  trail: readonly LatLngPoint[],
  location: LatLngPoint | null,
): LatLngPoint | null {
  return trail.length ? trail[trail.length - 1]! : location;
}

/**
 * A position that glides to each new target instead of jumping, so the car marker
 * moves smoothly between GPS fixes that arrive every few seconds.
 */
export function useGlidingPoint(target: LatLngPoint | null, durationMs = 1200): LatLngPoint | null {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const lat = target?.lat;
  const lng = target?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    const to = { lat, lng };
    const from = current.current;
    if (!from || (from.lat === lat && from.lng === lng)) {
      current.current = to;
      setShown(to);
      return;
    }
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const t = (Date.now() - start) / durationMs;
      const p = interpolate(from, to, t);
      current.current = p;
      setShown(p);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [lat, lng, durationMs]);
  return shown;
}

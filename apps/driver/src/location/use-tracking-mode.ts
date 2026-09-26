import { useEffect, useState, useSyncExternalStore } from 'react';
import { gpsQuality, type GpsQuality } from '../lib/gps-quality';
import {
  getGpsState,
  getTrackingMode,
  subscribeGps,
  subscribeTracking,
  type TrackingMode,
} from './tracker';

export function useTrackingMode(): TrackingMode {
  return useSyncExternalStore(subscribeTracking, getTrackingMode);
}

/** The GPS indicator's state; re-evaluated every few seconds so a silent GPS shows up. */
export function useGpsQuality(): GpsQuality {
  const state = useSyncExternalStore(subscribeGps, getGpsState);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  return gpsQuality(state, Math.max(now, state.lastFix?.at ?? 0));
}

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { gpsQuality, type GpsQuality, sameQuality } from '../lib/gps-quality';
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

function current(): GpsQuality {
  const state = getGpsState();
  return gpsQuality(state, Math.max(Date.now(), state.lastFix?.at ?? 0));
}

/**
 * The GPS indicator's state. It re-renders only when what it shows changes (not on every
 * fix), and is re-evaluated every few seconds so a silent GPS shows up.
 */
export function useGpsQuality(): GpsQuality {
  const [quality, setQuality] = useState(current);
  useEffect(() => {
    const update = () => setQuality((q) => (sameQuality(q, current()) ? q : current()));
    const unsubscribe = subscribeGps(update);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') update();
    }, 5_000);
    update();
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  return quality;
}

/** Low-battery mode is on (positions are sent half as often). */
export function useSavingBattery(): boolean {
  return useSyncExternalStore(subscribeGps, () => getGpsState().saving ?? false);
}

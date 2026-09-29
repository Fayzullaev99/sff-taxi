import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Whether the app is in the foreground: GPS layers and animations stop when it is not. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Android draws a custom marker from a snapshot of its view: taken too early (before the
 * icon font or the layout is ready) the marker stays blank, taken on every frame it costs
 * a lot. Track changes for a short while after mount, then freeze the snapshot.
 */
export function useSettledTracking(ms = 800): boolean {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return tracking;
}

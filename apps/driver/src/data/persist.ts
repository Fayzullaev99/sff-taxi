import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { buildSnapshot, persistRule, restorableEntries, type SnapshotEntry } from '../lib/snapshot';

const STORAGE_KEY = 'sff.taxi.driver.snapshot';
/** Writes are grouped: a burst of refetches costs one write. */
const SAVE_DELAY_MS = 3_000;

/**
 * Puts the last known profile, ride and rules back into the query cache at start-up
 * (lib/snapshot), so a restarted app shows the driver's state at once and resumes GPS
 * while the network catches up. Restored data is stale: every screen refetches it.
 * Gives up after `timeoutMs` so a slow disk never delays the start.
 */
export async function restoreSnapshot(qc: QueryClient, timeoutMs = 400): Promise<void> {
  const read = AsyncStorage.getItem(STORAGE_KEY)
    .then((text) => (text ? (JSON.parse(text) as unknown) : null))
    .catch(() => null);
  const raw = await Promise.race([
    read,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  for (const e of restorableEntries(raw, Date.now())) {
    // never over data fetched meanwhile
    if (qc.getQueryState(e.key)?.dataUpdatedAt) continue;
    qc.setQueryData(e.key, e.data, { updatedAt: e.updatedAt });
    // shown at once, but refetched as soon as a screen uses it
    void qc.invalidateQueries({ queryKey: e.key, exact: true, refetchType: 'none' });
  }
}

/** Keeps the snapshot up to date while the app runs. Returns the unsubscribe function. */
export function persistSnapshots(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const entries: SnapshotEntry[] = [];
    for (const q of qc.getQueryCache().getAll()) {
      if (!persistRule(q.queryKey) || q.state.status !== 'success') continue;
      entries.push({ key: q.queryKey, data: q.state.data, updatedAt: q.state.dataUpdatedAt });
    }
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot(entries))).catch(
      () => undefined,
    );
  };
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (!persistRule(event.query.queryKey)) return;
    timer ??= setTimeout(save, SAVE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}

/** Forgets the snapshot (signing out: the next account must not see this one's state). */
export function clearSnapshot(): Promise<void> {
  return AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
}

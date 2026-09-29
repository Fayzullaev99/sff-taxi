/**
 * A small on-disk copy of the state the driver needs to see at once after a cold start
 * (the OS killed the app mid-shift, or there is no network yet): the profile, the ride in
 * progress, the rules. It is shown immediately, marked stale, and refetched. Pure logic;
 * the storage lives in data/persist.ts.
 */

export const SNAPSHOT_VERSION = 1;

export interface SnapshotEntry {
  key: readonly unknown[];
  data: unknown;
  /** When the data was fetched (ms). */
  updatedAt: number;
}

export interface Snapshot {
  v: number;
  entries: SnapshotEntry[];
}

export interface PersistRule {
  key: readonly unknown[];
  /** Older data is not shown at all. */
  maxAgeMs: number;
}

const HOUR = 60 * 60_000;

/** What is kept, and for how long it is still worth showing. */
export const PERSISTED: readonly PersistRule[] = [
  { key: ['driver', 'me'], maxAgeMs: 24 * HOUR },
  { key: ['driver', 'current'], maxAgeMs: 6 * HOUR },
  { key: ['driver', 'balance'], maxAgeMs: 24 * HOUR },
  { key: ['driver', 'earnings', 'day'], maxAgeMs: 6 * HOUR },
  { key: ['driver', 'config'], maxAgeMs: 7 * 24 * HOUR },
  { key: ['config'], maxAgeMs: 7 * 24 * HOUR },
];

export function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function persistRule(key: readonly unknown[]): PersistRule | null {
  return PERSISTED.find((r) => sameKey(r.key, key)) ?? null;
}

/** The entries of a stored snapshot still worth showing (anything malformed is ignored). */
export function restorableEntries(raw: unknown, now: number): SnapshotEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const s = raw as Partial<Snapshot>;
  if (s.v !== SNAPSHOT_VERSION || !Array.isArray(s.entries)) return [];
  const out: SnapshotEntry[] = [];
  for (const e of s.entries as Partial<SnapshotEntry>[]) {
    if (!e || !Array.isArray(e.key) || typeof e.updatedAt !== 'number' || e.data === undefined) {
      continue;
    }
    const rule = persistRule(e.key);
    if (!rule) continue;
    const age = now - e.updatedAt;
    if (age < 0 || age > rule.maxAgeMs) continue;
    out.push({ key: rule.key, data: e.data, updatedAt: e.updatedAt });
  }
  return out;
}

/** The snapshot to store from what the app holds now. */
export function buildSnapshot(entries: readonly SnapshotEntry[]): Snapshot {
  return {
    v: SNAPSHOT_VERSION,
    entries: entries.filter((e) => persistRule(e.key) !== null && e.data !== undefined),
  };
}

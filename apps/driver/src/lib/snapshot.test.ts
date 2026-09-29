import { describe, expect, it } from 'vitest';
import { buildSnapshot, restorableEntries, SNAPSHOT_VERSION } from './snapshot';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

describe('snapshot', () => {
  it('keeps only the listed queries', () => {
    const s = buildSnapshot([
      { key: ['driver', 'me'], data: { id: 'd' }, updatedAt: NOW },
      { key: ['driver', 'ledger'], data: [], updatedAt: NOW },
      { key: ['driver', 'current'], data: null, updatedAt: NOW },
      { key: ['config'], data: undefined, updatedAt: NOW },
    ]);
    expect(s.v).toBe(SNAPSHOT_VERSION);
    expect(s.entries.map((e) => e.key)).toEqual([
      ['driver', 'me'],
      ['driver', 'current'],
    ]);
  });

  it('restores fresh enough entries, including "no ride" (null)', () => {
    const raw = JSON.parse(
      JSON.stringify(
        buildSnapshot([
          { key: ['driver', 'me'], data: { id: 'd' }, updatedAt: NOW - 2 * HOUR },
          { key: ['driver', 'current'], data: null, updatedAt: NOW - HOUR },
          { key: ['driver', 'earnings', 'day'], data: { rides: 3 }, updatedAt: NOW - 7 * HOUR },
        ]),
      ),
    );
    const back = restorableEntries(raw, NOW);
    expect(back.map((e) => [e.key, e.data])).toEqual([
      [['driver', 'me'], { id: 'd' }],
      [['driver', 'current'], null],
    ]);
  });

  it('ignores other versions, junk and entries from the future', () => {
    expect(restorableEntries(null, NOW)).toEqual([]);
    expect(restorableEntries('x', NOW)).toEqual([]);
    expect(restorableEntries({ v: 99, entries: [] }, NOW)).toEqual([]);
    expect(
      restorableEntries(
        {
          v: SNAPSHOT_VERSION,
          entries: [
            null,
            { key: 'driver', data: 1, updatedAt: NOW },
            { key: ['driver', 'me'], data: 1, updatedAt: NOW + HOUR },
          ],
        },
        NOW,
      ),
    ).toEqual([]);
  });
});

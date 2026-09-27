import { describe, expect, it } from 'vitest';
import type { RecentPlace, SavedPlace } from '../api/types';
import {
  groupSaved,
  parseLegacyPlaces,
  type Place,
  placesToMigrate,
  recentPlaces,
  savedToPlace,
} from './places';

const place = (i: number, title = `Joy ${i}`): Place => ({
  lat: 40.49 + i * 0.01,
  lng: 68.77,
  title,
  subtitle: null,
});

const saved = (
  kind: SavedPlace['kind'],
  i: number,
  extra: Partial<SavedPlace> = {},
): SavedPlace => ({
  id: `p${i}`,
  kind,
  label: null,
  address: `Manzil ${i}`,
  landmark: null,
  lat: 40.49 + i * 0.01,
  lng: 68.77,
  updatedAt: '2026-09-01T00:00:00Z',
  ...extra,
});

const recent = (i: number, address: string | null = `Joy ${i}`): RecentPlace => ({
  address,
  landmark: null,
  lat: 40.49 + i * 0.01,
  lng: 68.77,
  lastUsedAt: '2026-09-01T00:00:00Z',
});

describe('saved places', () => {
  it('groups home, work and the others', () => {
    const g = groupSaved([saved('other', 3), saved('work', 2), saved('home', 1)]);
    expect(g.home?.id).toBe('p1');
    expect(g.work?.id).toBe('p2');
    expect(g.others.map((p) => p.id)).toEqual(['p3']);
    expect(groupSaved(undefined)).toEqual({ home: null, work: null, others: [] });
  });

  it('names a saved place by its address with its label underneath', () => {
    expect(savedToPlace(saved('home', 1))).toMatchObject({ title: 'Manzil 1', subtitle: 'Uy' });
    expect(savedToPlace(saved('other', 2, { label: 'Onam' }))).toMatchObject({
      title: 'Manzil 2',
      subtitle: 'Onam',
    });
    expect(savedToPlace(saved('other', 3, { address: null, label: 'Bog‘' }))).toMatchObject({
      title: 'Bog‘',
      subtitle: null,
    });
  });

  it('offers recent destinations that are not saved places', () => {
    const list = recentPlaces([recent(1), recent(2), recent(4, null)], [saved('home', 1)]);
    expect(list.map((p) => p.title)).toEqual(['Joy 2', '40.53000, 68.77000']);
    expect(recentPlaces(undefined, undefined)).toEqual([]);
  });
});

describe('places kept on the phone by older versions', () => {
  it('reads what was stored and drops anything malformed', () => {
    expect(parseLegacyPlaces(null)).toEqual({ home: null, work: null });
    expect(parseLegacyPlaces('{oops')).toEqual({ home: null, work: null });
    const stored = JSON.stringify({
      home: place(1, 'Uyim'),
      work: { lat: 'x' },
      recent: [place(2)],
    });
    expect(parseLegacyPlaces(stored)).toEqual({ home: place(1, 'Uyim'), work: null });
  });

  it('moves home and work to the account only where the account has none', () => {
    const legacy = { home: place(1, 'Uyim'), work: place(2, 'Ofis') };
    expect(placesToMigrate(legacy, [])).toEqual([
      { kind: 'home', label: null, address: 'Uyim', lat: place(1).lat, lng: 68.77 },
      { kind: 'work', label: null, address: 'Ofis', lat: place(2).lat, lng: 68.77 },
    ]);
    // home was saved from another phone: that one wins
    expect(placesToMigrate(legacy, [saved('home', 5)]).map((p) => p.kind)).toEqual(['work']);
    expect(placesToMigrate({ home: null, work: null }, [])).toEqual([]);
  });
});

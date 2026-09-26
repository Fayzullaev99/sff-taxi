import { describe, expect, it } from 'vitest';
import { addRecent, EMPTY_PLACES, MAX_RECENT, parsePlaces, type Place } from './places';

const place = (i: number, title = `Joy ${i}`): Place => ({
  lat: 40.49 + i * 0.01,
  lng: 68.77,
  title,
  subtitle: null,
});

describe('recent destinations', () => {
  it('puts the latest first without duplicates of the same spot', () => {
    let recent: Place[] = [];
    recent = addRecent(recent, place(1));
    recent = addRecent(recent, place(2));
    // the same gate again, a few metres off and under another name
    recent = addRecent(recent, { ...place(1, 'Bozor'), lat: place(1).lat + 0.0001 });
    expect(recent.map((p) => p.title)).toEqual(['Bozor', 'Joy 2']);
  });

  it('keeps at most MAX_RECENT', () => {
    let recent: Place[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) recent = addRecent(recent, place(i));
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]!.title).toBe(`Joy ${MAX_RECENT + 2}`);
  });
});

describe('stored places', () => {
  it('reads what was stored and drops anything malformed', () => {
    expect(parsePlaces(null)).toEqual(EMPTY_PLACES);
    expect(parsePlaces('{oops')).toEqual(EMPTY_PLACES);
    const stored = JSON.stringify({
      home: place(1, 'Uyim'),
      work: { lat: 'x' },
      recent: [place(2), null, { title: 'no coords' }],
    });
    expect(parsePlaces(stored)).toEqual({ home: place(1, 'Uyim'), work: null, recent: [place(2)] });
  });
});

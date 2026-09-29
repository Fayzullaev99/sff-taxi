import { describe, expect, it } from 'vitest';
import { coordKey, LruCache } from './lru';

describe('LRU cache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>(2, 60_000);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1); // a is now the most recent
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('forgets entries older than the age limit', () => {
    let now = 0;
    const c = new LruCache<string>(10, 1_000, () => now);
    c.set('k', 'v');
    now = 999;
    expect(c.get('k')).toBe('v');
    now = 2_500;
    expect(c.get('k')).toBeUndefined();
  });

  it('shares a load in flight and caches what is worth keeping', async () => {
    const c = new LruCache<string | null>(10, 60_000);
    let calls = 0;
    const load = async () => {
      calls++;
      return 'Navoiy ko‘chasi';
    };
    const [a, b] = await Promise.all([c.getOrLoad('x', load), c.getOrLoad('x', load)]);
    expect([a, b, calls]).toEqual(['Navoiy ko‘chasi', 'Navoiy ko‘chasi', 1]);
    await c.getOrLoad('x', load);
    expect(calls).toBe(1);

    // an empty answer (offline) is not kept: the next lookup asks again
    let misses = 0;
    const empty = async () => {
      misses++;
      return null;
    };
    await c.getOrLoad('y', empty, (v) => v !== null);
    await c.getOrLoad('y', empty, (v) => v !== null);
    expect(misses).toBe(2);
  });

  it('does not keep a failed load', async () => {
    const c = new LruCache<string>(10, 60_000);
    await expect(c.getOrLoad('z', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await c.getOrLoad('z', async () => 'ok')).toBe('ok');
  });
});

describe('coordinate keys', () => {
  it('round to about ten metres', () => {
    expect(coordKey(40.495981, 68.775871)).toBe('40.4960,68.7759');
    expect(coordKey(40.49601, 68.77589)).toBe(coordKey(40.49598, 68.77587));
    expect(coordKey(40.4966, 68.7759)).not.toBe(coordKey(40.496, 68.7759));
  });
});

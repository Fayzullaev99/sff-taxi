/**
 * A small least-recently-used cache with an age limit (pure, unit-tested), plus sharing of
 * requests in flight: two lookups of the same key while the first is running make one call.
 */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; at: number }>();
  private readonly pending = new Map<string, Promise<V>>();

  constructor(
    private readonly max: number,
    private readonly maxAgeMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.maxAgeMs) {
      this.map.delete(key);
      return undefined;
    }
    // most recently used goes last
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  /**
   * The cached value, else the one `load` resolves to (shared by concurrent callers).
   * `keep` decides whether a result is worth caching (e.g. not an offline "no address").
   */
  async getOrLoad(key: string, load: () => Promise<V>, keep: (v: V) => boolean = () => true) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const running = this.pending.get(key);
    if (running) return running;
    const p = load()
      .then((value) => {
        if (keep(value)) this.set(key, value);
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * A coordinate key rounded to 4 decimals (~11 m north–south, ~8 m east–west here): a pin
 * nudged by a few metres, or the same place asked twice, reuses the address.
 */
export function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

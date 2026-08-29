export interface BoundedLruCacheOptions<Key, Value> {
  maxEntries: number;
  maxBytes: number;
  sizeOf: (key: Key, value: Value) => number;
}

type CacheEntry<Value> = {
  value: Value;
  bytes: number;
};

/**
 * Small deterministic LRU for rebuildable session artifacts. Entry order is
 * recency order; persistence and canonical output must never depend on it.
 */
export class BoundedLruCache<Key, Value> {
  readonly #entries = new Map<Key, CacheEntry<Value>>();
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #sizeOf: (key: Key, value: Value) => number;
  #totalBytes = 0;

  constructor(options: BoundedLruCacheOptions<Key, Value>) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("LRU maxEntries must be a positive integer");
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
      throw new Error("LRU maxBytes must be a positive integer");
    }
    this.#maxEntries = options.maxEntries;
    this.#maxBytes = options.maxBytes;
    this.#sizeOf = options.sizeOf;
  }

  get size(): number {
    return this.#entries.size;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  get(key: Key): Value | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value): boolean {
    const measured = this.#sizeOf(key, value);
    if (!Number.isFinite(measured) || measured < 0) {
      throw new Error("LRU entry size must be a non-negative finite number");
    }
    const bytes = Math.ceil(measured);
    const previous = this.#entries.get(key);
    if (previous) {
      this.#entries.delete(key);
      this.#totalBytes -= previous.bytes;
    }
    if (bytes > this.#maxBytes) return false;

    this.#entries.set(key, { value, bytes });
    this.#totalBytes += bytes;
    while (
      this.#entries.size > this.#maxEntries ||
      this.#totalBytes > this.#maxBytes
    ) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.#entries.get(oldestKey)!;
      this.#entries.delete(oldestKey);
      this.#totalBytes -= oldest.bytes;
    }
    return this.#entries.has(key);
  }

  clear(): void {
    this.#entries.clear();
    this.#totalBytes = 0;
  }
}

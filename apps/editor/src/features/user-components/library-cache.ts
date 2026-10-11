/** Disposable read projections. Never cache authorization or executable writes. */
export class LibraryCache<T> {
  private entries = new Map<
    string,
    { value: T; bytes: number; expires: number }
  >();
  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return;
    this.entries.delete(key);
    if (item.expires < Date.now()) return;
    this.entries.set(key, item);
    return item.value;
  }
  set(key: string, value: T): void {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    this.entries.delete(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes, expires: Date.now() + 60_000 });
    while (
      this.entries.size > this.maxEntries ||
      [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0) >
        this.maxBytes
    ) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
  clear(): void {
    this.entries.clear();
  }
}

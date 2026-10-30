import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryCache } from "./library-cache";

afterEach(() => vi.useRealTimers());
describe("LibraryCache", () => {
  it("evicts the least recently read entry and refreshes replacement order", () => {
    const cache = new LibraryCache<string>(2, 100);
    expect(cache.get("missing")).toBeUndefined();
    cache.set("a", "first");
    cache.set("b", "second");
    expect(cache.get("a")).toBe("first");
    cache.set("c", "third");
    expect(cache.get("b")).toBeUndefined();
    cache.set("a", "replacement");
    cache.set("d", "fourth");
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("a")).toBe("replacement");
  });
  it("counts UTF-8 JSON bytes cumulatively and accepts the exact byte boundary", () => {
    const cache = new LibraryCache<string>(10, 8);
    cache.set("a", "中"); // Five JSON bytes, not three characters.
    cache.set("b", "x"); // Three JSON bytes.
    expect(cache.get("a")).toBe("中");
    cache.set("c", "y");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("中");
    expect(cache.get("c")).toBe("y");
  });
  it("drops an oversized replacement without evicting unrelated values", () => {
    const cache = new LibraryCache<string>(2, 8);
    cache.set("a", "x");
    cache.set("b", "y");
    cache.set("a", "too large");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("y");
  });
  it("uses a fixed TTL including the expiry instant, and does not renew it on reads", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = new LibraryCache<string>(2, 100);
    cache.set("a", "value");
    vi.setSystemTime(59_999);
    expect(cache.get("a")).toBe("value");
    vi.setSystemTime(60_000);
    expect(cache.get("a")).toBe("value");
    vi.setSystemTime(60_001);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("a")).toBeUndefined();
  });
  it("renews TTL on replacement, supports non-expiring catalogs, and clears all entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = new LibraryCache<string>(2, 100, 10);
    cache.set("a", "old");
    vi.setSystemTime(9);
    cache.set("a", "new");
    vi.setSystemTime(11);
    expect(cache.get("a")).toBe("new");
    const retained = new LibraryCache<string>(2, 100, Infinity);
    retained.set("a", "catalog");
    vi.setSystemTime(1_000_000);
    expect(retained.get("a")).toBe("catalog");
    retained.clear();
    expect(retained.get("a")).toBeUndefined();
    retained.set("b", "next");
    expect(retained.get("b")).toBe("next");
  });
});

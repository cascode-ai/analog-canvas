import { describe, expect, it } from "vitest";

import { BoundedLruCache } from "./bounded-lru.js";

function cache(maxEntries = 3, maxBytes = 10) {
  return new BoundedLruCache<string, string>({
    maxEntries,
    maxBytes,
    sizeOf: (_key, value) => value.length,
  });
}

describe("BoundedLruCache", () => {
  it("evicts the least recently used entry at the count boundary", () => {
    const subject = cache();
    subject.set("a", "a");
    subject.set("b", "b");
    subject.set("c", "c");
    expect(subject.get("a")).toBe("a");

    subject.set("d", "d");

    expect(subject.get("b")).toBeUndefined();
    expect(subject.get("a")).toBe("a");
    expect(subject.size).toBe(3);
  });

  it("evicts enough old entries to stay within the byte budget", () => {
    const subject = cache(5, 6);
    subject.set("a", "aaa");
    subject.set("b", "bb");
    subject.set("c", "cccc");

    expect(subject.get("a")).toBeUndefined();
    expect(subject.get("b")).toBe("bb");
    expect(subject.get("c")).toBe("cccc");
    expect(subject.totalBytes).toBe(6);
  });

  it("does not retain one artifact larger than the entire byte budget", () => {
    const subject = cache(3, 4);
    subject.set("same", "ok");

    expect(subject.set("same", "oversized")).toBe(false);
    expect(subject.get("same")).toBeUndefined();
    expect(subject.totalBytes).toBe(0);
  });
});

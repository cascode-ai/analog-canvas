import { describe, expect, it } from "vitest";
import { sourceDraftCache } from "./source-draft-cache";

describe("uncommitted Code buffers", () => {
  it("recovers exact draft/base bytes only within the same working copy and Project", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };
    const cache = sourceDraftCache(storage, "tab1", "p1");
    const drafts = new Map([
      [
        "s\u0000run.cir",
        {
          base: "* before\r\n",
          text: "* incomplete 🧪\r\n.control\r\ntran",
          committed: 7,
        },
      ],
    ]);
    expect(cache.write(drafts)).toBe(true);
    expect(sourceDraftCache(storage, "tab1", "p1").read()).toEqual(drafts);
    expect(sourceDraftCache(storage, "tab2", "p1").read().size).toBe(0);
    expect(sourceDraftCache(storage, "tab1", "p2").read().size).toBe(0);
    expect(cache.write(new Map())).toBe(true);
    expect(cache.read().size).toBe(0);
  });
  it("reports storage failure without discarding in-memory input", () => {
    const drafts = new Map([
      ["s\u0000run.cir", { base: "", text: "text", committed: 0 }],
    ]);
    expect(sourceDraftCache(undefined, "tab", "p").write(drafts)).toBe(false);
    expect(drafts.get("s\u0000run.cir")?.text).toBe("text");
  });
  it("does not replace an unreadable recovery with empty data", () => {
    let stored = "{broken draft";
    const cache = sourceDraftCache(
      {
        getItem: () => stored,
        setItem: (_key, value) => {
          stored = value;
        },
        removeItem: () => {
          stored = "";
        },
      },
      "tab",
      "p",
    );
    expect(cache.read().size).toBe(0);
    expect(cache.write(new Map())).toBe(false);
    expect(stored).toBe("{broken draft");
  });
});

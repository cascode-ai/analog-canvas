import { describe, expect, it } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import {
  componentLibraryHarness,
  nativePackage,
} from "./component-library.test-support";

describe("public component catalog queries", () => {
  it("bounds accumulated summary bytes without truncating metadata or skipping the next row", async () => {
    const route = componentLibraryHarness();
    const symbol = { symbol: builtInSymbols.find((s) => s.id === "resistor")! };
    // Historical bylines can be larger than today's editor permits.
    for (let i = 0; i < 6; i++)
      route.seed({
        id: `wide-${i}`,
        authorId: "alice",
        author: "长".repeat(24000),
        definition: symbol,
      });
    const first = await (
      await route("GET", "?view=summary&catalog=1&limit=128")
    ).json();
    expect(first.entries).toHaveLength(3);
    expect(
      new TextEncoder().encode(JSON.stringify(first.entries)).length,
    ).toBeLessThanOrEqual(256 * 1024);
    const second = await (
      await route(
        "GET",
        `?view=summary&catalog=1&limit=128&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).json();
    expect(
      [...first.entries, ...second.entries].map((e: { id: string }) => e.id),
    ).toEqual(["wide-0", "wide-1", "wide-2", "wide-3", "wide-4", "wide-5"]);
    expect(second.nextCursor).toBeNull();
    expect(first.entries[0].author).toBe("长".repeat(24000));
  });
  it("returns the same complete catalog with bounded larger pages and unchanged cursors", async () => {
    const route = componentLibraryHarness();
    const symbol = { symbol: builtInSymbols.find((s) => s.id === "resistor")! };
    for (let i = 0; i < 121; i++)
      route.seed({
        id: `summary-${String(i).padStart(3, "0")}`,
        authorId: "alice",
        definition: symbol,
      });
    const read = async (limit: number) => {
      const entries: unknown[] = [];
      let cursor: string | null = null;
      let requests = 0;
      do {
        const page = await (
          await route(
            "GET",
            `?view=summary&catalog=1&limit=${limit}` +
              (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
          )
        ).json();
        entries.push(...page.entries);
        cursor = page.nextCursor;
        requests++;
      } while (cursor);
      return { entries, requests };
    };
    const before = await read(20);
    const after = await read(128);
    expect(after.entries).toEqual(before.entries);
    expect(before.requests).toBe(7);
    expect(after.requests).toBe(1);
    for (let i = 121; i < 129; i++)
      route.seed({
        id: `summary-${String(i).padStart(3, "0")}`,
        authorId: "alice",
        definition: symbol,
      });
    const capped = await (
      await route("GET", "?view=summary&catalog=1&limit=99999")
    ).json();
    expect(capped.entries).toHaveLength(128);
    expect(capped.entries.slice(0, 121)).toEqual(after.entries);
    const tail = await (
      await route(
        "GET",
        `?view=summary&catalog=1&cursor=${encodeURIComponent(capped.nextCursor)}`,
      )
    ).json();
    expect(tail.entries.map((e: { id: string }) => e.id)).toEqual([
      "summary-128",
    ]);
    expect(tail.nextCursor).toBeNull();
  });
  it("advances past one oversized historical row without dropping it or its successor", async () => {
    const route = componentLibraryHarness();
    const definition = {
      symbol: builtInSymbols.find((s) => s.id === "resistor")!,
    };
    const author = "长".repeat(90000);
    route.seed({ id: "a-large", authorId: "alice", author, definition });
    route.seed({ id: "b-small", authorId: "bob", definition });
    const first = await (
      await route("GET", "?view=summary&catalog=1&limit=128")
    ).json();
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0]).toMatchObject({ id: "a-large", author });
    expect(
      new TextEncoder().encode(JSON.stringify(first.entries)).length,
    ).toBeGreaterThan(256 * 1024);
    expect(first.nextCursor).toEqual(expect.any(String));
    const next = await (
      await route(
        "GET",
        `?view=summary&catalog=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).json();
    expect(next.entries.map((e: { id: string }) => e.id)).toEqual(["b-small"]);
    expect(next.nextCursor).toBeNull();
  });
  it("keeps creation order, same-name author identities and administrator visibility distinct", async () => {
    const route = componentLibraryHarness();
    const symbol = { symbol: builtInSymbols.find((s) => s.id === "resistor")! };
    route.seed({
      id: "early-native",
      authorId: "alice-one",
      author: "Alice",
      definition: nativePackage(),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    });
    route.seed({
      id: "late-symbol-a",
      authorId: "alice-two",
      author: "Alice",
      definition: symbol,
      createdAt: "2026-05-01T00:00:00Z",
    });
    route.seed({
      id: "late-symbol-b",
      authorId: "alice-one",
      author: "Alice",
      definition: symbol,
      createdAt: "2026-05-01T00:00:00Z",
    });
    route.seed({
      id: "hidden-symbol",
      authorId: "alice-one",
      author: "Alice",
      status: "deleted",
      definition: symbol,
    });
    const ids = (page: { entries: { id: string }[] }) =>
      page.entries.map((entry) => entry.id);
    const query = "?view=summary&catalog=1";
    const first = await (await route("GET", query + "&order=newest")).json();
    expect(ids(first)).toEqual([
      "late-symbol-a",
      "late-symbol-b",
      "early-native",
    ]);
    expect(first.authors).toEqual([
      { authorId: "alice-one", author: "Alice", count: 2 },
      { authorId: "alice-two", author: "Alice", count: 1 },
    ]);
    expect(
      ids(await (await route("GET", query + "&order=oldest")).json()),
    ).toEqual(["early-native", "late-symbol-a", "late-symbol-b"]);
    expect(
      ids(await (await route("GET", query + "&author=alice-two")).json()),
    ).toEqual(["late-symbol-a"]);
    expect((await route("GET", query + "&status=deleted")).status).toBe(403);
    expect(
      ids(
        await (
          await route("GET", query + "&status=deleted", undefined, "admin")
        ).json(),
      ),
    ).toEqual(["hidden-symbol"]);
    expect(
      (
        await route(
          "PATCH",
          "/late-symbol-a",
          { revision: 1, status: "deleted" },
          "admin",
        )
      ).status,
    ).toBe(200);
    const after = await (
      await route("GET", query + "&since=" + first.catalogRevision)
    ).json();
    expect(ids(after)).toEqual(["early-native", "late-symbol-b"]);
    expect(after.catalogRevision).toBeGreaterThan(first.catalogRevision);
    expect(after.authors).toEqual([
      { authorId: "alice-one", author: "Alice", count: 2 },
    ]);
  });
  it("orders and filters the whole library before paging, keeping legacy cursors unchanged", async () => {
    const route = componentLibraryHarness();
    const symbol = { symbol: builtInSymbols.find((s) => s.id === "resistor")! };
    for (let index = 0; index < 35; index++)
      route.seed({
        id: "symbol-" + String(index).padStart(3, "0"),
        authorId: "alice",
        definition: symbol,
      });
    route.seed({
      id: "zz-native-one",
      authorId: "bob",
      definition: nativePackage(),
    });
    route.seed({
      id: "zz-native-two",
      authorId: "alice",
      definition: nativePackage(),
    });
    route.seed({
      id: "broken-history",
      authorId: "bob",
      definition: { symbol: {} },
    });
    const query = "?view=summary&catalog=1&order=circuit-first&limit=20";
    const first = await (await route("GET", query)).json();
    expect(first.entries.slice(0, 2).map((e: { id: string }) => e.id)).toEqual([
      "zz-native-one",
      "zz-native-two",
    ]);
    expect(first.authors).toEqual([
      { authorId: "alice", author: "alice", count: 36 },
      { authorId: "bob", author: "bob", count: 2 },
    ]);
    const second = await (
      await route(
        "GET",
        query + "&cursor=" + encodeURIComponent(first.nextCursor),
      )
    ).json();
    expect([...first.entries, ...second.entries]).toHaveLength(38);
    expect(second.entries.at(-1)).toMatchObject({
      id: "broken-history",
      capability: "needs-repair",
    });
    expect(second.nextCursor).toBeNull();
    const filtered = await (
      await route("GET", query + "&type=with-circuit&author=alice")
    ).json();
    expect(filtered.entries.map((e: { id: string }) => e.id)).toEqual([
      "zz-native-two",
    ]);
    const legacy = await (await route("GET", "?view=summary&limit=20")).json();
    expect(legacy.entries[0].id).toBe("broken-history");
    expect(legacy.nextCursor).toBe("symbol-018");
    expect(
      (
        await route(
          "GET",
          query.replace("order=circuit-first", "order=oldest") +
            "&cursor=" +
            encodeURIComponent(first.nextCursor),
        )
      ).status,
    ).toBe(400);
  });
  it("revalidates without resending definitions and refuses to mix catalog generations", async () => {
    const route = componentLibraryHarness();
    const symbol = { symbol: builtInSymbols.find((s) => s.id === "resistor")! };
    for (let index = 0; index < 25; index++)
      route.seed({
        id: "catalog-" + index,
        authorId: "alice",
        definition: symbol,
      });
    const query = "?view=summary&catalog=1&order=newest&limit=20";
    const first = await (await route("GET", query)).json();
    const unchanged = await (
      await route("GET", query + "&since=" + first.catalogRevision)
    ).json();
    expect(unchanged).toEqual({
      entries: [],
      nextCursor: null,
      catalogRevision: first.catalogRevision,
      notModified: true,
    });
    route.seed({
      id: "new-circuit",
      authorId: "bob",
      definition: nativePackage(),
    });
    const stale = await route(
      "GET",
      query + "&cursor=" + encodeURIComponent(first.nextCursor),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "COMPONENT_CATALOG_CHANGED",
    });
    const changed = await (
      await route("GET", query + "&since=" + first.catalogRevision)
    ).json();
    expect(changed.notModified).toBeUndefined();
    expect(changed.catalogRevision).toBeGreaterThan(first.catalogRevision);
    expect(JSON.stringify(changed)).not.toContain("files");
    expect((await route("GET", "?catalog=1&type=unknown")).status).toBe(400);
  });
});

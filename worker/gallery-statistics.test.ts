import { expect, it } from "vitest";
import {
  type Harness,
  ORIGIN,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  route,
  submitOne,
} from "./gallery.test-support";

function aggregateQueries(env: Harness, store = "source:analoggenie") {
  return (env.galleryStoreQueries.get(store) ?? []).filter((query) =>
    /^\s*SELECT (?:COUNT|MAX|json_extract)/iu.test(query),
  );
}

async function wallFixture() {
  const env = environment();
  const owner = await ownerAccountOf(env);
  const importEntry = async (
    name = "Dataset",
    tags = ["amplifier"],
    id = "ag-1",
    source = "analoggenie",
  ) => {
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/sources/${source}/entries`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: owner,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entries: [{ id, name, tags, projectText: projectText(name) }],
        }),
      }),
    );
    expect(response.status).toBe(200);
  };
  const read = async (query = "", cookie = owner) => {
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?${query}`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      entries: { id: string }[];
      nextCursor: string | null;
      total?: number;
      search?: string;
      authors?: { author: string; count: number }[];
      sources?: Record<string, number>;
      filterCounts?: Record<string, unknown>;
    }>;
  };
  await importEntry();
  return { env, owner, read, importEntry };
}

it("reads only community entries for human pages while keeping the first page's dataset facet", async () => {
  const { env, owner, read } = await wallFixture();
  const ids = [];
  for (let index = 0; index < 3; index++)
    ids.push(await submitOne(env, `Human ${index}`, { cookie: owner }));
  env.galleryStoreCalls.length = 0;
  const first = await read("ai=0&limit=2");
  expect(first.total).toBe(3);
  expect(first.filterCounts).toMatchObject({ human: 3, datasets: 1 });
  expect(first.sources?.analoggenie).toBe(0);
  const calls = env.galleryStoreCalls.filter(
    (call) => call.operation === "list",
  );
  expect(calls).toHaveLength(5);
  expect(calls.find((call) => call.store === "gallery")?.body).toMatchObject({
    entries: true,
    statistics: true,
  });
  for (const call of calls.filter((call) => call.store !== "gallery"))
    expect(call.body).toMatchObject({ entries: false, statistics: true });
  for (const [store, queries] of env.galleryStoreQueries)
    if (store !== "gallery")
      expect(
        queries.filter((query) => /^\s*SELECT e.id FROM/u.test(query)),
      ).toEqual([]);

  env.galleryStoreCalls.length = 0;
  for (const queries of env.galleryStoreQueries.values()) queries.length = 0;
  const second = await read(
    `ai=0&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
  );
  expect(
    [...first.entries, ...second.entries].map((entry) => entry.id).sort(),
  ).toEqual(ids.sort());
  expect(env.galleryStoreCalls).toMatchObject([
    {
      store: "gallery",
      operation: "list",
      body: { entries: true, statistics: false },
    },
  ]);
  for (const field of ["total", "filterCounts", "authors", "sources"])
    expect(second).not.toHaveProperty(field);
  for (const [store, queries] of env.galleryStoreQueries) {
    if (store !== "gallery") expect(queries).toEqual([]);
    expect(
      queries.filter((query) => /^\s*SELECT (?:COUNT|MAX)/iu.test(query)),
    ).toEqual([]);
  }
});

it("keeps search and primary-wall semantics when dataset cursors skip community", async () => {
  const { env, read, importEntry } = await wallFixture();
  await importEntry("Dataset second", ["amplifier"], "ag-2");
  const first = await read("ai=dataset&q=dataset&limit=1");
  expect(first.authors).toEqual([]);
  expect(first.search).toBe("dataset");
  env.galleryStoreCalls.length = 0;
  const second = await read(
    `ai=dataset&q=dataset&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
  );
  expect(second.search).toBe("dataset");
  expect(second.entries).toHaveLength(1);
  expect(env.galleryStoreCalls.every((call) => call.store !== "gallery")).toBe(
    true,
  );

  const namespace = env.GALLERY;
  env.GALLERY = {
    getByName(name: string) {
      if (name === "source:analoggenie")
        return {
          fetch: async () => {
            throw new Error("dataset offline");
          },
        };
      return namespace.getByName(name);
    },
  };
  expect((await read("ai=dataset")).total).toBe(0);
  await expect(read("ai=dataset&cursor=2020-01-01|x")).resolves.toMatchObject({
    entries: [],
  });
  await expect(read("source=analoggenie")).rejects.toThrow("dataset offline");
});

it("invalidates cached marks after recomputation without another import", async () => {
  const { env, read } = await wallFixture();
  const state = env.galleryStoreStates.get("source:analoggenie")!;
  state.storage.sql.exec(
    "UPDATE gallery_entries SET netlistable = 0, netlistable_version = 0",
  );
  const query = "source=analoggenie&netlistable=1";
  expect((await read(query)).total).toBe(0);
  env.galleryStoreQueries.get("source:analoggenie")!.length = 0;
  expect((await read(query)).total).toBe(0);
  expect(aggregateQueries(env)).toEqual([]);
  const refresh = await env.GALLERY.getByName("source:analoggenie").fetch(
    "https://gallery/netlistable-refresh",
    { method: "POST", body: "{}" },
  );
  expect(await refresh.json()).toMatchObject({ changed: 1, remaining: 0 });
  env.galleryStoreQueries.get("source:analoggenie")!.length = 0;
  expect((await read(query)).total).toBe(1);
  expect(aggregateQueries(env).length).toBeGreaterThan(0);
});

it("keeps a warm revision after a transaction rolls back and separates viewers", async () => {
  const { env, read } = await wallFixture();
  const query = "source=analoggenie&tags=amplifier";
  expect((await read(query)).total).toBe(1);
  const state = env.galleryStoreStates.get("source:analoggenie")!;
  expect(() =>
    state.storage.transactionSync(() => {
      state.storage.sql.exec("UPDATE gallery_entries SET tags = ',other,'");
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  env.galleryStoreQueries.get("source:analoggenie")!.length = 0;
  expect((await read(query)).total).toBe(1);
  expect(aggregateQueries(env)).toEqual([]);
  const member = await makerOf(env);
  expect((await read(query, member)).total).toBe(1);
  expect(aggregateQueries(env).length).toBeGreaterThan(0);
});

it("reuses normalized dataset statistics and invalidates a replaced import", async () => {
  const { env, read, importEntry } = await wallFixture();
  const queries = env.galleryStoreQueries.get("source:analoggenie")!;
  queries.length = 0;
  const first = await read("tags=amplifier,amplifier&q=DaTaSeT&limit=1");
  expect(first.total).toBe(1);
  expect(aggregateQueries(env).length).toBeGreaterThan(0);
  queries.length = 0;
  const warm = await read("tags=AMPLIFIER&q=dataset&limit=10&order=name");
  expect(warm.total).toBe(1);
  expect(warm.filterCounts).toEqual(first.filterCounts);
  expect(aggregateQueries(env)).toEqual([]);
  expect(queries.some((query) => /^\s*SELECT e.id FROM/u.test(query))).toBe(
    true,
  );
  await importEntry("Dataset replaced", ["other"]);
  queries.length = 0;
  const changed = await read("tags=amplifier&q=dataset");
  expect(changed.total).toBe(0);
  expect(changed.sources?.analoggenie).toBe(0);
  expect(aggregateQueries(env).length).toBeGreaterThan(0);
});

it("separates administrator visibility for the same reader", async () => {
  const { env } = await wallFixture();
  env.galleryStoreStates
    .get("source:analoggenie")!
    .storage.sql.exec(
      "UPDATE gallery_entries SET owner_user_id = 'someone-else', curation_json = ?",
      JSON.stringify({
        attention: {
          status: "needs-attention",
          issues: [{ kind: "other", detail: "Review" }],
        },
      }),
    );
  const read = async (isAdmin: boolean) => {
    const response = await env.GALLERY.getByName("source:analoggenie").fetch(
      "https://gallery/list",
      {
        method: "POST",
        body: JSON.stringify({
          viewerId: "reviewer",
          isAdmin,
          attention: true,
          entries: false,
          statistics: true,
          cacheStatistics: true,
        }),
      },
    );
    return response.json();
  };
  await expect(read(false)).resolves.toMatchObject({ total: 0 });
  await expect(read(true)).resolves.toMatchObject({ total: 1 });
  env.galleryStoreQueries.get("source:analoggenie")!.length = 0;
  await expect(read(false)).resolves.toMatchObject({ total: 0 });
  expect(aggregateQueries(env)).toEqual([]);
});

it("evicts old filter combinations from the bounded dataset cache", async () => {
  const { env, read } = await wallFixture();
  expect((await read("source=analoggenie")).total).toBe(1);
  for (let index = 0; index < 150; index++)
    await read(`source=analoggenie&q=missing${index}`);
  env.galleryStoreQueries.get("source:analoggenie")!.length = 0;
  expect((await read("source=analoggenie")).total).toBe(1);
  expect(aggregateQueries(env).length).toBeGreaterThan(0);
});

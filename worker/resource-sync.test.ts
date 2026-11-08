import { afterEach, expect, it, vi } from "vitest";
import { sha256Hex } from "@icm/derived";

import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import {
  environment as galleryEnvironment,
  makerOf,
  ownerAccountOf,
  sqliteState,
  ORIGIN,
  projectText,
  testbenchProjectText,
  wiredProjectText,
} from "./gallery.test-support";
import { routeComponentLibraryRequest } from "./component-library";
import { ComponentLibraryDO, GalleryDO } from "./index";
import { routeGalleryRequest } from "./gallery";
import { routeResourceSync } from "./resource-sync";
import { RegionalSessionDO } from "./regional-session";

afterEach(() => vi.unstubAllGlobals());

const IDENTITY_SECRET = "resource-identity-secret-0123456789abcdef";
const AUTHORITY = JSON.stringify({
  origin: ORIGIN,
  clientOrigin: "https://cn.test",
  secret: IDENTITY_SECRET,
});
/** One identity authority both regions consult, as in Production. */
function environment(config: Parameters<typeof galleryEnvironment>[0] = {}) {
  const auth = galleryEnvironment({
    AUTH_REGIONAL_AUTHORITY: AUTHORITY,
    ...config,
  });
  // China reaches the authority over HTTPS; overseas uses its AUTH binding.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    auth.authDurable.fetch(new Request(input, init)),
  );
  return auth;
}

async function region(
  origin: "cn" | "overseas",
  auth = environment(),
  enabled = true,
) {
  const cookie = await makerOf(auth);
  const admin = await ownerAccountOf(auth);
  const states = new Map<string, ReturnType<typeof sqliteState>>();
  const stores = new Map<
    string,
    { fetch(request: Request): Promise<Response> }
  >();
  const get = (name: string) => {
    if (!states.has(name)) states.set(name, sqliteState());
    if (!stores.has(name))
      stores.set(
        name,
        name === "components"
          ? new ComponentLibraryDO(states.get(name)!, env)
          : new GalleryDO(states.get(name)!, env),
      );
    return stores.get(name)!;
  };
  const env = {
    ...auth,
    ...(enabled ? { RESOURCE_REGION: origin } : {}),
    RESOURCE_WRITES_ENABLED: "true",
    RESOURCE_SYNC_TOKEN: "peer-secret",
    RESOURCE_SYNC_ADMIN_TOKEN: "admin-secret",
    PROJECT_IDENTITY_URL: `${ORIGIN}/api/auth/regional/identities`,
    PROJECT_IDENTITY_TOKEN: IDENTITY_SECRET,
    ...(origin === "overseas" ? { AUTH_REGIONAL_AUTHORITY: AUTHORITY } : {}),
    GALLERY: {
      getByName: (name: string) => ({
        fetch: (url: string, init?: RequestInit) =>
          get(name).fetch(new Request(url, init)),
      }),
    },
    COMPONENT_LIBRARY: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          get("components").fetch(new Request(url, init)),
      }),
    },
  };
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    owner = false,
  ) => {
    const request = new Request(ORIGIN + path, {
      method,
      headers: {
        origin: ORIGIN,
        cookie: owner ? admin : cookie,
        ...(token ? { authorization: "Bearer " + token } : {}),
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (
      (await routeResourceSync(request, env)) ??
      (await routeComponentLibraryRequest(request, env)) ??
      (await routeGalleryRequest(request, env))!
    );
  };
  return {
    env,
    call,
    restart: () => stores.clear(),
    /** A store's SQL, as a migration or another release would change it. */
    sql: (name = "gallery") => {
      get(name);
      return states.get(name)!.storage.sql;
    },
    cookie,
    admin,
    enable: () => {
      env.RESOURCE_REGION = origin;
      stores.clear();
    },
    closeWrites: () => {
      env.RESOURCE_WRITES_ENABLED = "false";
      stores.clear();
    },
  };
}
it("copies a publication with its identity; only its publishing region can change it", async () => {
  const auth = environment();
  const source = await region("overseas", auth),
    destination = await region("cn", auth);
  const definition = {
    symbol: {
      ...builtInSymbols.find((s) => s.id === "resistor")!,
      name: "Regional resistor",
    },
    electrical: deviceDescriptor("resistor"),
  };
  const created = await source.call("/api/components/replica-test", "PUT", {
    definition,
    revision: 0,
  });
  expect(created.status).toBe(200);
  const before = await created.json();
  const feed = await source.call(
    "/api/resource-sync/components/changes?after=0",
    "GET",
    undefined,
    "peer-secret",
  );
  expect(feed.status).toBe(200);
  const change = await feed.json();
  const copied = await destination.call(
    "/api/resource-sync/components/changes",
    "POST",
    change,
    "peer-secret",
  );
  expect(copied.status).toBe(200);
  const received = await (
    await destination.call("/api/components/replica-test")
  ).json();
  expect(received.entry).toMatchObject({
    id: "replica-test",
    revision: 1,
    authorId: before.entry.authorId,
    definition: {
      symbol: { id: "user-replica-test-r1", name: "Regional resistor" },
    },
  });
  const changed = {
    ...definition,
    symbol: { ...definition.symbol, name: "Forbidden edit" },
  };
  const refused = await destination.call(
    "/api/components/replica-test",
    "PUT",
    { definition: changed, revision: 1 },
  );
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({
    code: "RESOURCE_SOURCE_READ_ONLY",
  });
  expect(
    (await (await source.call("/api/components/replica-test")).json()).entry
      .revision,
  ).toBe(1);
});

async function transfer(
  source: Awaited<ReturnType<typeof region>>,
  target: Awaited<ReturnType<typeof region>>,
  stream: string,
) {
  const status = await (
    await target.call(
      "/api/resource-sync/" + stream + "/status",
      "GET",
      undefined,
      "peer-secret",
    )
  ).json();
  const after = status.received?.sequence ?? 0;
  const feed = await source.call(
    "/api/resource-sync/" + stream + "/changes?after=" + after,
    "GET",
    undefined,
    "peer-secret",
  );
  expect(feed.status).toBe(200);
  const event = await feed.json();
  if (event.event === null) return event;
  const result = await target.call(
    "/api/resource-sync/" + stream + "/changes",
    "POST",
    event,
    "peer-secret",
  );
  expect(result.status, JSON.stringify(await result.clone().json())).toBe(200);
  return event;
}
it("copies migrated publication schemas whose named columns have a different physical order", async () => {
  const auth = environment();
  const overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const created = await overseas.call("/api/gallery/submissions", "POST", {
    name: "Migrated publication",
    projectText: projectText(),
  });
  expect(created.status).toBe(201);
  const published = await created.json();
  const feed = await overseas.call(
    "/api/resource-sync/gallery/changes?after=0",
    "GET",
    undefined,
    "peer-secret",
  );
  const envelope = await feed.json();
  const event = JSON.parse(envelope.payload);
  // ALTER TABLE appends columns; an older store need not have CREATE TABLE's order.
  event.schema[0].columns.reverse();
  const payload = JSON.stringify(event);
  const copied = await cn.call(
    "/api/resource-sync/gallery/changes",
    "POST",
    { payload, digest: sha256Hex(payload) },
    "peer-secret",
  );
  expect(copied.status).toBe(200);
  expect(
    await (await cn.call("/api/gallery/" + published.id)).json(),
  ).toMatchObject({
    entry: { id: published.id, name: "Migrated publication" },
  });
  // Different tables or keys are still incompatible, even with a valid hash.
  for (const change of [
    (e: typeof event) => (e.schema[1].name = "unrecognized_table"),
    (e: typeof event) => (e.schema[1].key = "id"),
    (e: typeof event) => e.schema.pop(),
  ]) {
    const altered = JSON.parse(payload);
    change(altered);
    const invalid = JSON.stringify(altered);
    const refused = await cn.call(
      "/api/resource-sync/gallery/changes",
      "POST",
      { payload: invalid, digest: sha256Hex(invalid) },
      "peer-secret",
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid-resource-event" });
  }
});
it("copies Gallery and Dataset publications through separate streams without publishing private Projects", async () => {
  const auth = environment();
  const overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const created = await cn.call("/api/gallery/submissions", "POST", {
    name: "China publication",
    projectText: projectText(),
  });
  expect(created.status).toBe(201);
  const published = await created.json();
  await transfer(cn, overseas, "gallery");
  const read = await (
    await overseas.call("/api/gallery/" + published.id)
  ).json();
  expect(read).toMatchObject({
    entry: { id: published.id, name: "China publication" },
  });
  const imported = await overseas.call(
    "/api/gallery/sources/analoggenie/entries",
    "POST",
    {
      entries: [
        {
          id: "ag-regional-fixture",
          name: "Dataset fixture",
          projectText: projectText(),
        },
      ],
    },
    undefined,
    true,
  );
  expect(await imported.json()).toMatchObject({ results: [{ ok: true }] });
  await transfer(overseas, cn, "analoggenie");
  expect(
    (await (await cn.call("/api/gallery?source=analoggenie")).json()).entries,
  ).toContainEqual(
    expect.objectContaining({
      id: "ag-regional-fixture",
      name: "Dataset fixture",
    }),
  );
  expect(
    await (
      await cn.call(
        "/api/gallery/sources/analoggenie/entries",
        "POST",
        {
          entries: [
            {
              id: "ag-regional-fixture",
              name: "Forbidden",
              projectText: projectText(),
            },
          ],
        },
        undefined,
        true,
      )
    ).json(),
  ).toMatchObject({ results: [{ ok: false, error: "http-409" }] });
  expect((await (await cn.call("/api/projects")).json()).projects).toEqual([]);
});

it("retries safely across restart, propagates withdrawal, and rejects tampering, reordering and a local ID collision", async () => {
  const auth = environment(),
    source = await region("cn", auth),
    peer = await region("overseas", auth);
  const body = {
    definition: {
      symbol: {
        ...builtInSymbols.find((s) => s.id === "resistor")!,
        name: "First",
      },
      electrical: deviceDescriptor("resistor"),
    },
    revision: 0,
  };
  expect(
    (await source.call("/api/components/first-fixture", "PUT", body)).status,
  ).toBe(200);
  const first = await transfer(source, peer, "components");
  peer.restart();
  source.restart();
  expect(
    (
      await peer.call(
        "/api/resource-sync/components/changes",
        "POST",
        first,
        "peer-secret",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await peer.call(
        "/api/resource-sync/components/changes",
        "POST",
        { ...first, payload: first.payload.replace("First", "Tampered") },
        "peer-secret",
      )
    ).status,
  ).toBe(400);
  expect((await peer.call("/api/resource-sync/components/status")).status).toBe(
    401,
  );
  expect(
    (
      await source.call("/api/components/first-fixture", "PATCH", {
        action: "delete",
        revision: 1,
      })
    ).status,
  ).toBe(200);
  const withdrawn = await transfer(source, peer, "components");
  expect(
    (await (await peer.call("/api/components/first-fixture")).json()).entry
      .status,
  ).toBe("deleted");
  await peer.call(
    "/api/resource-sync/components/changes",
    "POST",
    first,
    "peer-secret",
  );
  expect(
    (await (await peer.call("/api/components/first-fixture")).json()).entry
      .status,
  ).toBe("deleted");
  expect(
    (await source.call("/api/components/second-fixture", "PUT", body)).status,
  ).toBe(200);
  const later = await (
    await source.call(
      "/api/resource-sync/components/changes?after=" +
        JSON.parse(withdrawn.payload).sequence,
      "GET",
      undefined,
      "peer-secret",
    )
  ).json();
  const fresh = await region("overseas", auth);
  expect(
    (
      await fresh.call(
        "/api/resource-sync/components/changes",
        "POST",
        later,
        "peer-secret",
      )
    ).status,
  ).toBe(409);
  expect(
    (await fresh.call("/api/components/first-fixture", "PUT", body)).status,
  ).toBe(200);
  expect(
    (
      await fresh.call(
        "/api/resource-sync/components/changes",
        "POST",
        first,
        "peer-secret",
      )
    ).status,
  ).toBe(409);
  expect(
    (await (await fresh.call("/api/components/first-fixture")).json()).entry
      .status,
  ).toBe("shared");
});

it("seeds historical publications without rewriting them; closed writes still accept replica catch-up", async () => {
  const auth = environment(),
    source = await region("overseas", auth, false),
    target = await region("cn", auth);
  const body = {
    definition: {
      symbol: {
        ...builtInSymbols.find((s) => s.id === "resistor")!,
        name: "Historical",
      },
      electrical: deviceDescriptor("resistor"),
    },
    revision: 0,
  };
  const created = await (
    await source.call("/api/components/historical-fixture", "PUT", body)
  ).json();
  expect(
    (
      await source.call(
        "/api/resource-sync/components/status",
        "GET",
        undefined,
        "peer-secret",
      )
    ).status,
  ).toBe(404);
  source.enable();
  expect(
    (
      await source.call(
        "/api/resource-sync/components/seed",
        "POST",
        {},
        "peer-secret",
      )
    ).status,
  ).toBe(401);
  expect(
    await (
      await source.call(
        "/api/resource-sync/components/seed",
        "POST",
        {},
        "admin-secret",
      )
    ).json(),
  ).toMatchObject({ seeded: 1 });
  expect(
    (await (await source.call("/api/components/historical-fixture")).json())
      .entry,
  ).toEqual(created.entry);
  target.closeWrites();
  await transfer(source, target, "components");
  expect(
    (await (await target.call("/api/components/historical-fixture")).json())
      .entry,
  ).toEqual(created.entry);
  expect(
    (
      await target.call("/api/components/new-fixture", "PUT", {
        ...body,
        definition: {
          ...body.definition,
          symbol: { ...body.definition.symbol, name: "New local" },
        },
      })
    ).status,
  ).toBe(503);
  expect(
    await (
      await target.call(
        "/api/resource-sync/components/changes?after=0",
        "GET",
        undefined,
        "peer-secret",
      )
    ).json(),
  ).toMatchObject({ event: null, sequence: 0 });
});

it("retains local recycled publications independently of foreign copies", async () => {
  const auth = environment(),
    source = await region("cn", auth),
    peer = await region("overseas", auth);
  const publish = async (site: typeof source, name: string) => {
    const result = await site.call("/api/gallery/submissions", "POST", {
      name,
      projectText: projectText(name),
    });
    expect(result.status).toBe(201);
    return (await result.json()).id as string;
  };
  const foreign = await publish(source, "Foreign retained");
  expect(
    (await source.call(`/api/gallery/${foreign}/recycle`, "POST", {})).status,
  ).toBe(200);
  await transfer(source, peer, "gallery");
  const local: string[] = [];
  for (let i = 0; i < 26; i++) {
    const id = await publish(peer, `Local retained ${i}`);
    expect(
      (await peer.call(`/api/gallery/${id}/recycle`, "POST", {})).status,
    ).toBe(200);
    local.push(id);
  }
  const entries = (await (await peer.call("/api/gallery/mine")).json()).entries;
  expect(
    entries.filter((e: { id: string }) => local.includes(e.id)),
  ).toHaveLength(25);
  expect(entries).toContainEqual(
    expect.objectContaining({ id: foreign, status: "recycled" }),
  );
});

it("renames the account and local bylines without editing foreign publications", async () => {
  let destination: Awaited<ReturnType<typeof region>>;
  const auth = environment({
    GALLERY: {
      getByName: (name: string) => ({
        fetch: (url: string, init?: RequestInit) =>
          destination.env.GALLERY.getByName(name).fetch(url, init),
      }),
    },
  });
  const source = await region("cn", auth);
  destination = await region("overseas", auth);
  const publish = async (site: typeof source, name: string) =>
    (
      await (
        await site.call("/api/gallery/submissions", "POST", {
          name,
          projectText: projectText(name),
        })
      ).json()
    ).id;
  const foreign = await publish(source, "Foreign byline");
  await transfer(source, destination, "gallery");
  const local = await publish(destination, "Local byline");
  const before = await (
    await destination.call(`/api/gallery/${foreign}`)
  ).json();
  const renamed = await auth.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/profile", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: destination.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Regional author" }),
    }),
  );
  expect(renamed.status).toBe(200);
  expect((await renamed.json()).user.displayName).toBe("Regional author");
  expect(
    (await (await destination.call(`/api/gallery/${local}`)).json()).entry
      .author,
  ).toBe("Regional author");
  expect(
    (await (await destination.call(`/api/gallery/${foreign}`)).json()).entry
      .author,
  ).toBe(before.entry.author);
});

it("queues simulation checks only at the publishing region", async () => {
  const auth = environment(),
    source = await region("cn", auth),
    peer = await region("overseas", auth);
  const foreign = (
    await (
      await source.call("/api/gallery/submissions", "POST", {
        name: "Foreign checked",
        projectText: testbenchProjectText(),
      })
    ).json()
  ).id;
  await transfer(source, peer, "gallery");
  const local = (
    await (
      await peer.call("/api/gallery/submissions", "POST", {
        name: "Local checked",
        projectText: testbenchProjectText("Local checked"),
      })
    ).json()
  ).id;
  const result = await peer.call(
    "/api/gallery/simulation-checks",
    "POST",
    { all: true },
    undefined,
    true,
  );
  expect(result.status).toBe(202);
  expect(await result.json()).toMatchObject({ queued: [local], waiting: 1 });
  const named = await peer.call(
    "/api/gallery/simulation-checks",
    "POST",
    { ids: [foreign] },
    undefined,
    true,
  );
  expect(await named.json()).toMatchObject({
    queued: [],
    missing: [foreign],
    waiting: 1,
  });
});

it("replicates hard deletion without reviving it on a stale receipt", async () => {
  const auth = environment(),
    source = await region("cn", auth),
    peer = await region("overseas", auth);
  const created = await source.call("/api/gallery/submissions", "POST", {
    name: "Delete fixture",
    projectText: projectText(),
  });
  expect(created.status).toBe(201);
  const id = (await created.json()).id;
  const original = await transfer(source, peer, "gallery");
  expect((await peer.call(`/api/gallery/${id}`)).status).toBe(200);
  expect((await source.call(`/api/gallery/${id}`, "DELETE")).status).toBe(200);
  await transfer(source, peer, "gallery");
  peer.restart();
  expect((await peer.call(`/api/gallery/${id}`)).status).toBe(404);
  expect(
    (
      await peer.call(
        "/api/resource-sync/gallery/changes",
        "POST",
        original,
        "peer-secret",
      )
    ).status,
  ).toBe(200);
  expect((await peer.call(`/api/gallery/${id}`)).status).toBe(404);
});

it("copies reference images, blind reviews and fix history with their publication", async () => {
  const auth = environment(),
    source = await region("cn", auth),
    peer = await region("overseas", auth);
  const created = await source.call("/api/gallery/submissions", "POST", {
    name: "Reviewed fixture",
    projectText: projectText(),
  });
  const id = (await created.json()).id;
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 2]);
  const image = { type: "image/png", data: bytes.toString("base64") };
  expect(
    (
      await source.call(`/api/gallery/${id}/reference`, "PUT", {
        image,
        rights: true,
      })
    ).status,
  ).toBe(200);
  const revision = (await (await source.call(`/api/gallery/${id}`)).json())
    .entry.previewRevision;
  const reviewed = await source.call(
    `/api/gallery/${id}/reviews`,
    "POST",
    { revision, verdict: "issue", flags: ["wiring"], note: "Synthetic review" },
    undefined,
    true,
  );
  expect(reviewed.status).toBe(200);
  await transfer(source, peer, "gallery");
  await transfer(source, peer, "gallery-interactions");
  const read = await peer.call(`/api/gallery/${id}/reference`);
  expect(read.status).toBe(200);
  expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);
  expect(
    await (await peer.call(`/api/gallery/${id}/reviews`)).json(),
  ).toMatchObject({ blind: true });
  expect(
    await (
      await peer.call(
        `/api/gallery/${id}/reviews`,
        "GET",
        undefined,
        undefined,
        true,
      )
    ).json(),
  ).toMatchObject({
    current: [
      expect.objectContaining({ verdict: "issue", note: "Synthetic review" }),
    ],
  });
  expect(
    (await peer.call(`/api/gallery/${id}/reference`, "DELETE")).status,
  ).toBe(409);
  expect(
    (
      await source.call(`/api/gallery/${id}`, "PUT", {
        name: "Updated fixture",
        projectText: wiredProjectText("Updated fixture"),
      })
    ).status,
  ).toBe(200);
  await transfer(source, peer, "gallery");
  const history = await (
    await peer.call(
      `/api/gallery/${id}/reviews`,
      "GET",
      undefined,
      undefined,
      true,
    )
  ).json();
  expect(history).toMatchObject({
    current: [],
    history: [expect.objectContaining({ current: false })],
    fixes: [expect.objectContaining({ addressed: 1 })],
  });
  expect((await source.call(`/api/gallery/${id}`, "DELETE")).status).toBe(200);
  await transfer(source, peer, "gallery");
  expect((await peer.call(`/api/gallery/${id}`)).status).toBe(404);
  expect((await peer.call(`/api/gallery/${id}/reference`)).status).toBe(404);
  expect(
    await (
      await peer.call(
        "/api/gallery/review/community/people",
        "GET",
        undefined,
        undefined,
        true,
      )
    ).json(),
  ).toEqual(
    await (
      await source.call(
        "/api/gallery/review/community/people",
        "GET",
        undefined,
        undefined,
        true,
      )
    ).json(),
  );
});

it("seeds historical drawings and rootless figures in bounded, deduplicated batches", async () => {
  const source = await region("overseas", environment(), false);
  for (let i = 0; i < 49; i++) {
    const result = await source.call(
      "/api/gallery/sources/analoggenie/entries",
      "POST",
      {
        entries: [
          {
            id: `ag-batch-${i}`,
            name: `Drawing ${i}`,
            projectText: projectText(),
          },
        ],
      },
      undefined,
      true,
    );
    expect(await result.json()).toMatchObject({ results: [{ ok: true }] });
  }
  const figure = {
    type: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 2]).toString(
      "base64",
    ),
  };
  const imported = await source.call(
    "/api/gallery/sources/analoggenie/comparisons",
    "POST",
    {
      comparisons: ["ag-batch-0", "ag-orphan-a", "ag-orphan-b"].map((id) => ({
        id,
        verdict: "match",
        figure,
      })),
    },
    undefined,
    true,
  );
  expect(await imported.json()).toMatchObject({
    results: [{ ok: true }, { ok: true }, { ok: true }],
  });
  source.enable();
  for (const expected of [
    { seeded: 50, more: true },
    { seeded: 1, more: false },
    { seeded: 0, more: false },
  ]) {
    const response = await source.call(
      "/api/resource-sync/analoggenie/seed",
      "POST",
      {},
      "admin-secret",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  }
  const ids = [];
  let after = 0;
  while (true) {
    const response = await source.call(
      `/api/resource-sync/analoggenie/changes?after=${after}`,
      "GET",
      undefined,
      "peer-secret",
    );
    const envelope = await response.json();
    if (envelope.event === null) break;
    const event = JSON.parse(envelope.payload);
    ids.push(event.id);
    after = event.sequence;
  }
  expect(ids).toHaveLength(51);
  expect(new Set(ids).size).toBe(51);
  expect(ids).toContain("ag-orphan-a");
  expect(ids).toContain("ag-orphan-b");
});

it("seeds Dataset figures imported before their drawings, and reserves their origin", async () => {
  const auth = environment(),
    source = await region("overseas", auth, false),
    peer = await region("cn", auth);
  const id = "ag-early-figure";
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 2]);
  const figure = { type: "image/png", data: bytes.toString("base64") };
  const imported = await source.call(
    "/api/gallery/sources/analoggenie/comparisons",
    "POST",
    {
      comparisons: [
        { id, verdict: "match", sourceNetlist: "* synthetic", figure },
      ],
    },
    undefined,
    true,
  );
  expect(await imported.json()).toMatchObject({ results: [{ ok: true }] });
  source.enable();
  expect(
    await (
      await source.call(
        "/api/resource-sync/analoggenie/seed",
        "POST",
        {},
        "admin-secret",
      )
    ).json(),
  ).toMatchObject({ seeded: 1 });
  const orphan = await transfer(source, peer, "analoggenie");
  const unseeded = await region("cn", auth, false);
  expect(
    await (
      await unseeded.call(
        "/api/gallery/sources/analoggenie/comparisons",
        "POST",
        { comparisons: [{ id, verdict: "match", figure }] },
        undefined,
        true,
      )
    ).json(),
  ).toMatchObject({ results: [{ ok: true }] });
  unseeded.enable();
  expect(
    (
      await unseeded.call(
        "/api/resource-sync/analoggenie/changes",
        "POST",
        orphan,
        "peer-secret",
      )
    ).status,
  ).toBe(409);
  expect(
    await (
      await peer.call("/api/gallery/sources/analoggenie/comparisons")
    ).json(),
  ).toMatchObject({ comparisons: [] });
  const entry = {
    id,
    name: "Early figure fixture",
    projectText: projectText(),
  };
  expect(
    await (
      await peer.call(
        "/api/gallery/sources/analoggenie/entries",
        "POST",
        { entries: [entry] },
        undefined,
        true,
      )
    ).json(),
  ).toMatchObject({ results: [{ ok: false }] });
  expect(
    await (
      await source.call(
        "/api/gallery/sources/analoggenie/entries",
        "POST",
        { entries: [entry] },
        undefined,
        true,
      )
    ).json(),
  ).toMatchObject({ results: [{ ok: true }] });
  await transfer(source, peer, "analoggenie");
  expect(
    await (
      await peer.call("/api/gallery/sources/analoggenie/comparisons")
    ).json(),
  ).toMatchObject({
    comparisons: [expect.objectContaining({ id, verdict: "match" })],
  });
  const image = await peer.call(
    `/api/gallery/sources/analoggenie/comparisons/${id}/figure`,
  );
  expect(image.status).toBe(200);
  expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
});

type Site = Awaited<ReturnType<typeof region>>;
async function drain(source: Site, target: Site, stream: string) {
  for (let i = 0; i < 20; i++)
    if ((await transfer(source, target, stream)).event === null) return;
  throw new Error("Unexpected unbounded test stream");
}
async function publish(site: Site, name: string, owner = false) {
  const created = await site.call(
    "/api/gallery/submissions",
    "POST",
    { name, projectText: projectText(name) },
    undefined,
    owner,
  );
  expect(created.status).toBe(201);
  return (await created.json()).id as string;
}
async function receivedBy(site: Site, stream = "gallery") {
  return (
    await (
      await site.call(
        `/api/resource-sync/${stream}/status`,
        "GET",
        undefined,
        "peer-secret",
      )
    ).json()
  ).received;
}
async function firstChange(site: Site, stream = "gallery", after = 0) {
  return (
    await site.call(
      `/api/resource-sync/${stream}/changes?after=${after}`,
      "GET",
      undefined,
      "peer-secret",
    )
  ).json();
}
const deliver = (site: Site, envelope: unknown, stream = "gallery") =>
  site.call(
    `/api/resource-sync/${stream}/changes`,
    "POST",
    envelope,
    "peer-secret",
  );
const resign = (event: unknown) => {
  const payload = JSON.stringify(event);
  return { payload, digest: sha256Hex(payload) };
};

it("holds a newer release's extra column until the receiver upgrades, and fills an older release's absent column with the local default", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  overseas
    .sql()
    .exec(
      "ALTER TABLE gallery_entries ADD COLUMN future_note TEXT NOT NULL DEFAULT ''",
    );
  overseas.restart();
  const id = await publish(overseas, "Newer release");
  overseas
    .sql()
    .exec(
      "UPDATE gallery_entries SET future_note='from the newer release' WHERE id=?",
      id,
    );
  const envelope = await firstChange(overseas);
  const refused = await deliver(cn, envelope);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({ error: "resource-schema-newer" });
  expect(await receivedBy(cn)).toBeNull();
  expect((await cn.call(`/api/gallery/${id}`)).status).toBe(404);
  // Snapshot versions never mix: a version-1 sender blocks the same way.
  const old = await deliver(
    cn,
    resign({ ...JSON.parse(envelope.payload), version: 1 }),
  );
  expect(old.status).toBe(409);
  expect(await old.json()).toEqual({ error: "resource-version-unsupported" });
  cn.sql().exec(
    "ALTER TABLE gallery_entries ADD COLUMN future_note TEXT NOT NULL DEFAULT ''",
  );
  cn.restart();
  expect((await deliver(cn, envelope)).status).toBe(200);
  expect(
    cn
      .sql()
      .exec<{
        future_note: string;
      }>("SELECT future_note FROM gallery_entries WHERE id=?", id)
      .toArray()[0]?.future_note,
  ).toBe("from the newer release");
  cn.sql().exec(
    "ALTER TABLE gallery_entries ADD COLUMN local_rank INTEGER NOT NULL DEFAULT 7",
  );
  cn.restart();
  const older = await publish(overseas, "Older release");
  await transfer(overseas, cn, "gallery");
  expect(
    cn
      .sql()
      .exec<{
        local_rank: number;
      }>("SELECT local_rank FROM gallery_entries WHERE id=?", older)
      .toArray()[0]?.local_rank,
  ).toBe(7);
});

it("recreates replica triggers after a migration adds a column, so the column is replicated and guarded", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const id = await publish(overseas, "Migrated triggers");
  await transfer(overseas, cn, "gallery");
  for (const site of [overseas, cn]) {
    site.sql().exec("ALTER TABLE gallery_entries ADD COLUMN later_flag TEXT");
    site.restart();
  }
  const { sequence } = await (
    await overseas.call(
      "/api/resource-sync/gallery/status",
      "GET",
      undefined,
      "peer-secret",
    )
  ).json();
  overseas
    .sql()
    .exec("UPDATE gallery_entries SET later_flag='changed' WHERE id=?", id);
  const change = await firstChange(overseas, "gallery", sequence);
  const event = JSON.parse(change.payload);
  expect(event.id).toBe(id);
  expect(event.rows[0][0].later_flag).toBe("changed");
  expect(() =>
    cn
      .sql()
      .exec("UPDATE gallery_entries SET later_flag='local' WHERE id=?", id),
  ).toThrow("RESOURCE_SOURCE_READ_ONLY");
  expect((await deliver(cn, change)).status).toBe(200);
});

it("keeps the previous release's replica SQL working after this release ran, and recovers when rolled forward again", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const id = await publish(overseas, "Rollback fixture", true);
  await drain(overseas, cn, "gallery");
  // The previous release's constructor and receipt statements, verbatim.
  for (const sql of [overseas.sql(), cn.sql()]) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_meta (id INTEGER PRIMARY KEY, region TEXT NOT NULL, epoch TEXT NOT NULL, sequence INTEGER NOT NULL, importing INTEGER NOT NULL, writable INTEGER NOT NULL)",
    );
    sql.exec(
      "INSERT OR IGNORE INTO resource_replica_meta VALUES (1,?,?,0,0,0)",
      "overseas",
      crypto.randomUUID(),
    );
    sql.exec(
      "SELECT region,epoch,sequence FROM resource_replica_meta WHERE id=1",
    );
    sql.exec("UPDATE resource_replica_meta SET writable=? WHERE id=1", 1);
    sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_keys (id TEXT PRIMARY KEY, origin TEXT NOT NULL) WITHOUT ROWID",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_changes (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE) WITHOUT ROWID",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_peer (id INTEGER PRIMARY KEY, epoch TEXT NOT NULL, sequence INTEGER NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS resource_replica_receipts (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL)",
    );
    // It still guards likes with their entry.
    sql.exec(`CREATE TRIGGER IF NOT EXISTS replica_guard_gallery_likes_INSERT
        BEFORE INSERT ON gallery_likes
        WHEN (SELECT importing FROM resource_replica_meta WHERE id=1)=0
        BEGIN
          SELECT CASE WHEN (SELECT writable FROM resource_replica_meta WHERE id=1)=0
            THEN RAISE(ABORT,'RESOURCE_WRITES_DISABLED') END;
          SELECT CASE WHEN EXISTS(SELECT 1 FROM resource_replica_keys WHERE id=NEW.entry_id
            AND origin<>(SELECT region FROM resource_replica_meta WHERE id=1))
            THEN RAISE(ABORT,'RESOURCE_SOURCE_READ_ONLY') END;
        END`);
    sql.exec(
      "INSERT OR IGNORE INTO resource_replica_keys VALUES (?,?)",
      "rollback-key",
      "cn",
    );
    sql.exec(
      "INSERT INTO resource_replica_changes VALUES (?,?)",
      "rollback-key",
      900,
    );
    sql.exec(
      "INSERT OR REPLACE INTO resource_replica_peer VALUES (1,?,?)",
      "e",
      1,
    );
    sql.exec(
      "INSERT INTO resource_replica_receipts VALUES (?,?)",
      900,
      "digest",
    );
  }
  // Rolled forward: this release replaces the old likes guard again.
  cn.restart();
  expect(
    cn
      .sql()
      .exec(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'replica_*_gallery_likes_*'",
      )
      .toArray(),
  ).toEqual([]);
  expect((await cn.call(`/api/gallery/${id}/like`, "POST", {})).status).toBe(
    200,
  );
});

it("keeps submitter email and provider in the publishing region; copies keep owner IDs and private testbenches", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const created = await overseas.call("/api/gallery/submissions", "POST", {
    name: "Private fields",
    projectText: testbenchProjectText("Private fields"),
  });
  expect(created.status).toBe(201);
  const id = (await created.json()).id;
  const columns =
    "submitter_email,submitter_provider,owner_user_id,testbench_text";
  const [source] = overseas
    .sql()
    .exec<Record<string, string | null>>(
      `SELECT ${columns} FROM gallery_entries WHERE id=?`,
      id,
    )
    .toArray();
  expect(source).toMatchObject({ submitter_email: "maker@example.com" });
  const envelope = await firstChange(overseas);
  expect(envelope.payload).not.toContain("maker@example.com");
  expect(JSON.parse(envelope.payload).schema[0].columns).not.toContain(
    "submitter_provider",
  );
  const event = JSON.parse(envelope.payload);
  event.schema[0].columns.push("submitter_email");
  event.rows[0][0].submitter_email = "forged@example.com";
  const forged = await deliver(cn, resign(event));
  expect(forged.status).toBe(400);
  expect(await forged.json()).toEqual({ error: "invalid-resource-event" });
  expect((await deliver(cn, envelope)).status).toBe(200);
  const [copy] = cn
    .sql()
    .exec<Record<string, string | null>>(
      `SELECT ${columns} FROM gallery_entries WHERE id=?`,
      id,
    )
    .toArray();
  expect(copy).toEqual({
    ...source,
    submitter_email: null,
    submitter_provider: null,
  });
  expect(copy!.testbench_text).toBeTruthy();
});

it("looks up copied accounts: an unavailable authority is retried, a deleted account is counted, not blocking", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  await publish(overseas, "Verified owner");
  const envelope = await firstChange(overseas);
  const offline = () =>
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Identity authority unreachable");
    });
  offline();
  const unavailable = await deliver(cn, envelope);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "identity-unavailable" });
  expect(await receivedBy(cn)).toBeNull();
  // The overseas region reaches its own authority through the AUTH binding.
  await publish(cn, "Domestic owner");
  expect((await deliver(overseas, await firstChange(cn))).status).toBe(200);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    auth.authDurable.fetch(new Request(input, init)),
  );
  expect((await deliver(cn, envelope)).status).toBe(200);
  // A redelivered receipt answers before any lookup.
  offline();
  expect(await (await deliver(cn, envelope)).json()).toMatchObject({
    duplicate: true,
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    auth.authDurable.fetch(new Request(input, init)),
  );
  // Publications and reviews of since-deleted accounts still copy.
  await publish(overseas, "Deleted owner");
  const next = JSON.parse(
    (
      await firstChange(
        overseas,
        "gallery",
        JSON.parse(envelope.payload).sequence,
      )
    ).payload,
  );
  next.rows[0][0].owner_user_id = 424242;
  expect((await deliver(cn, resign(next))).status).toBe(200);
  const status = await (
    await cn.call(
      "/api/resource-sync/gallery/status",
      "GET",
      undefined,
      "peer-secret",
    )
  ).json();
  expect(status).toMatchObject({
    received: { sequence: next.sequence },
    missingAccounts: 1,
  });
});

it("copies likes and reviews written before replication was enabled, without a release step", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth, false),
    cn = await region("cn", auth);
  const id = await publish(overseas, "Liked before replication", true);
  expect(
    (await overseas.call(`/api/gallery/${id}/like`, "POST", {})).status,
  ).toBe(200);
  const revision = (await (await overseas.call(`/api/gallery/${id}`)).json())
    .entry.previewRevision;
  expect(
    (
      await overseas.call(`/api/gallery/${id}/reviews`, "POST", {
        revision,
        verdict: "issue",
        flags: ["wiring"],
        note: "Before replication",
      })
    ).status,
  ).toBe(200);
  overseas.enable();
  expect(
    await (
      await overseas.call(
        "/api/resource-sync/gallery/seed",
        "POST",
        {},
        "admin-secret",
      )
    ).json(),
  ).toMatchObject({ seeded: 1 });
  await drain(overseas, cn, "gallery");
  await drain(overseas, cn, "gallery-interactions");
  const queue = await (
    await cn.call("/api/gallery/review/community/queue")
  ).json();
  expect(
    queue.entries.find((card: { id: string }) => card.id === id),
  ).toMatchObject({
    likes: 1,
    likedByViewer: true,
    mine: { verdict: "issue", note: "Before replication" },
  });
});

it("lets the next region to like re-claim a like withdrawn elsewhere, both ways", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const id = await publish(overseas, "Liked again", true);
  await drain(overseas, cn, "gallery");
  const toggle = async (site: Site) =>
    (await site.call(`/api/gallery/${id}/like`, "POST", {})).json();
  const sync = async () => {
    await drain(overseas, cn, "gallery-interactions");
    await drain(cn, overseas, "gallery-interactions");
  };
  const likes = async (site: Site) =>
    (
      await (await site.call("/api/gallery/review/community/queue")).json()
    ).entries.find((card: { id: string }) => card.id === id).likes;
  for (const [writer, other] of [
    [overseas, cn],
    [cn, overseas],
    [overseas, cn],
  ] as const) {
    expect(await toggle(writer)).toEqual({ likes: 1, likedByViewer: true });
    await sync();
    expect(await likes(other)).toBe(1);
    expect(await toggle(writer)).toEqual({ likes: 0, likedByViewer: false });
    await sync();
    expect(await likes(other)).toBe(0);
  }
});

it("removes only locally owned publications with a deleted account; copies wait for their origin", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const foreign = await publish(overseas, "Copied abroad");
  await drain(overseas, cn, "gallery");
  const local = await publish(cn, "Published at home");
  const [{ owner_user_id: userId }] = cn
    .sql()
    .exec<{
      owner_user_id: string;
    }>("SELECT owner_user_id FROM gallery_entries WHERE id=?", local)
    .toArray() as [{ owner_user_id: string }];
  const deleted = await cn.env.GALLERY.getByName("gallery").fetch(
    "https://gallery/delete-account",
    { method: "POST", body: JSON.stringify({ userId }) },
  );
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toMatchObject({ entries: 1 });
  expect((await cn.call(`/api/gallery/${local}`)).status).toBe(404);
  expect((await cn.call(`/api/gallery/${foreign}`)).status).toBe(200);
});

it("lets either region like and review any entry; each record stays with its writer and both regions converge", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const queue = async (site: Site, owner = false) =>
    (
      await (
        await site.call(
          "/api/gallery/review/community/queue",
          "GET",
          undefined,
          undefined,
          owner,
        )
      ).json()
    ).entries as {
      id: string;
      likes: number;
      likedByViewer: boolean;
      mine: { verdict: string } | null;
    }[];
  const foreign = await publish(overseas, "Liked abroad", true);
  await drain(overseas, cn, "gallery");
  const liked = await cn.call(`/api/gallery/${foreign}/like`, "POST", {});
  expect(await liked.json()).toEqual({ likes: 1, likedByViewer: true });
  const revision = (await (await cn.call(`/api/gallery/${foreign}`)).json())
    .entry.previewRevision;
  const reviewed = await cn.call(`/api/gallery/${foreign}/reviews`, "POST", {
    revision,
    verdict: "issue",
    flags: ["wiring"],
    note: "Written in China",
  });
  expect(reviewed.status).toBe(200);
  // The entry stream no longer carries them; their own stream does.
  expect((await firstChange(cn)).event).toBeNull();
  await drain(cn, overseas, "gallery-interactions");
  expect(
    (await queue(overseas)).find((card) => card.id === foreign),
  ).toMatchObject({
    likes: 1,
    likedByViewer: true,
    mine: { verdict: "issue" },
  });
  expect(
    await (
      await overseas.call(
        `/api/gallery/${foreign}/reviews`,
        "GET",
        undefined,
        undefined,
        true,
      )
    ).json(),
  ).toMatchObject({
    current: [expect.objectContaining({ note: "Written in China" })],
  });
  const unlike = await overseas.call(
    `/api/gallery/${foreign}/like`,
    "POST",
    {},
  );
  expect(unlike.status).toBe(409);
  expect(await unlike.json()).toMatchObject({
    code: "RESOURCE_SOURCE_READ_ONLY",
  });
  // The other direction: an overseas like of a China entry.
  const domestic = await publish(cn, "Liked from abroad");
  await drain(cn, overseas, "gallery");
  expect(
    (
      await overseas.call(
        `/api/gallery/${domestic}/like`,
        "POST",
        {},
        undefined,
        true,
      )
    ).status,
  ).toBe(200);
  await drain(overseas, cn, "gallery-interactions");
  expect(
    (await queue(cn, true)).find((card) => card.id === domestic),
  ).toMatchObject({ likes: 1, likedByViewer: true });
  // The publishing region still deletes its entry; China keeps its own like.
  expect(
    (
      await overseas.call(
        `/api/gallery/${foreign}`,
        "DELETE",
        undefined,
        undefined,
        true,
      )
    ).status,
  ).toBe(200);
  await drain(overseas, cn, "gallery");
  expect((await cn.call(`/api/gallery/${foreign}`)).status).toBe(404);
});

it("converges when both regions write the same like before either copy arrives", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const id = await publish(overseas, "Liked twice");
  await drain(overseas, cn, "gallery");
  // The Owner's account reads the queue below; its press adds a heart, and
  // `take` takes one back.
  const like = (site: Site, take = false) =>
    site.call(
      `/api/gallery/${id}/like${take ? "?take=1" : ""}`,
      "POST",
      {},
      undefined,
      true,
    );
  expect((await like(overseas)).status).toBe(200);
  expect((await like(cn)).status).toBe(200);
  await drain(cn, overseas, "gallery-interactions");
  await drain(overseas, cn, "gallery-interactions");
  const likes = async (site: Site) =>
    (
      await (
        await site.call(
          "/api/gallery/review/community/queue",
          "GET",
          undefined,
          undefined,
          true,
        )
      ).json()
    ).entries.find((card: { id: string }) => card.id === id);
  for (const site of [overseas, cn])
    expect(await likes(site)).toMatchObject({ likes: 1, likedByViewer: true });
  // One record remains, the overseas one: only overseas can change it.
  expect((await like(cn)).status).toBe(409);
  expect((await like(cn, true)).status).toBe(409);
  expect(await (await like(overseas, true)).json()).toEqual({
    likes: 0,
    likedByViewer: false,
  });
  await drain(overseas, cn, "gallery-interactions");
  expect(await likes(cn)).toMatchObject({ likes: 0, likedByViewer: false });
});

it("keeps China's source tail reachable when it adopts the overseas copy of a like it had not sent yet", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const id = await publish(overseas, "Adopted like");
  await drain(overseas, cn, "gallery");
  for (const site of [overseas, cn])
    expect(
      (await site.call(`/api/gallery/${id}/like`, "POST", {})).status,
    ).toBe(200);
  // China's like is its newest change; it adopts the overseas record first.
  await drain(overseas, cn, "gallery-interactions");
  const tail = await (
    await cn.call(
      "/api/resource-sync/gallery-interactions/status",
      "GET",
      undefined,
      "peer-secret",
    )
  ).json();
  const noop = await firstChange(cn, "gallery-interactions");
  expect(JSON.parse(noop.payload)).toMatchObject({
    sequence: tail.sequence,
    noop: true,
    rows: [[], []],
  });
  await drain(cn, overseas, "gallery-interactions");
  expect(await receivedBy(overseas, "gallery-interactions")).toMatchObject({
    sequence: tail.sequence,
  });
  expect(
    await firstChange(cn, "gallery-interactions", tail.sequence),
  ).toMatchObject({ event: null, sequence: tail.sequence });
});

it("accepts gzip peer bodies and bounds their decompressed size", async () => {
  const auth = environment(),
    overseas = await region("overseas", auth),
    cn = await region("cn", auth);
  const id = await publish(overseas, "Compressed");
  const post = (body: BodyInit, encoding = "gzip") =>
    routeResourceSync(
      new Request(ORIGIN + "/api/resource-sync/gallery/changes", {
        method: "POST",
        headers: {
          authorization: "Bearer peer-secret",
          "content-encoding": encoding,
        },
        body,
      }),
      cn.env,
    );
  const gzip = (stream: ReadableStream<Uint8Array>) =>
    new Response(
      stream.pipeThrough(
        new CompressionStream("gzip") as unknown as TransformStream<
          Uint8Array,
          Uint8Array
        >,
      ),
    ).arrayBuffer();
  const chunk = new TextEncoder().encode("a".repeat(1 << 20));
  const bomb = await gzip(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"payload":"'));
        for (let i = 0; i < 49; i++) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
  expect(bomb.byteLength).toBeLessThan(1 << 20);
  expect((await post(bomb))!.status).toBe(413);
  expect((await post("{}", "br"))!.status).toBe(400);
  const envelope = JSON.stringify(await firstChange(overseas));
  const accepted = await post(
    await gzip(new Blob([envelope]).stream() as ReadableStream<Uint8Array>),
  );
  expect(accepted!.status).toBe(200);
  expect((await cn.call(`/api/gallery/${id}`)).status).toBe(200);
});

it("removes both regional copies and consumes stale publication and component snapshots", async () => {
  const enabled = JSON.stringify({
    ...JSON.parse(AUTHORITY),
    accountDeletion: true,
  });
  let source: Site;
  const auth = environment({
    AUTH_REGIONAL_AUTHORITY: enabled,
    GALLERY: { getByName: (name) => source.env.GALLERY.getByName(name) },
    COMPONENT_LIBRARY: {
      getByName: () => source.env.COMPONENT_LIBRARY.getByName(),
    },
  });
  source = await region("overseas", auth);
  const peer = await region("cn", auth);
  const id = await publish(source, "Retiring drawing");
  const kept = await publish(source, "Keep unrelated drawing", true);
  const component = "/api/components/retiring-component";
  const definition = {
    symbol: builtInSymbols.find((symbol) => symbol.id === "resistor")!,
    electrical: deviceDescriptor("resistor"),
  };
  expect(
    (await source.call(component, "PUT", { definition, revision: 0 })).status,
  ).toBe(200);
  const staleGallery = await firstChange(source);
  const staleComponent = await firstChange(source, "components");
  await drain(source, peer, "gallery");
  await drain(source, peer, "components");
  const like = await peer.call(
    "/api/gallery/" + id + "/like",
    "POST",
    {},
    undefined,
    true,
  );
  expect(await like.json()).toMatchObject({ likes: 1 });
  const staleLike = await firstChange(peer, "gallery-interactions");
  const restored = await region("overseas", auth);
  const restoredId = await publish(restored, "Prior source backup");
  const beforeReplay = await restored.call(
    "/api/resource-sync/gallery/status",
    "GET",
    undefined,
    "peer-secret",
  );
  const priorSequence = (await beforeReplay.json()).sequence;
  peer.closeWrites();

  const response = await auth.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/account/delete", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: source.cookie },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        confirm: "delete-account",
      }),
    }),
  );
  expect(response.status).toBe(202);
  const tick = new Request("https://auth/internal/account-deletion-tick", {
    method: "POST",
  });
  expect((await auth.authDurable.fetch(tick.clone())).status).toBe(200);
  // The publication deletion can arrive before the authority cleanup tick.
  await drain(source, peer, "gallery");
  const withdrawn = await firstChange(peer, "gallery-interactions");
  expect(JSON.parse(withdrawn.payload).rows[0]).toEqual([]);
  expect(JSON.parse(withdrawn.payload).sequence).toBe(
    JSON.parse(staleLike.payload).sequence,
  );
  const delayed = await source.call(
    "/api/resource-sync/gallery-interactions/changes",
    "POST",
    staleLike,
    "peer-secret",
  );
  expect(delayed.status).toBe(200);
  const storage = { ...sqliteState().storage, setAlarm: async () => {} };
  const session = new RegionalSessionDO(
    { storage },
    {
      ...peer.env,
      AUTH_REGIONAL_CLIENT: enabled,
    },
  );
  expect((await session.fetch(tick.clone())).status).toBe(200);
  for (const site of [source, peer]) {
    expect(
      (await site.call("/api/gallery/" + id, "GET", undefined, undefined, true))
        .status,
    ).toBe(404);
    expect((await site.call(component)).status).toBe(404);
    expect(
      (
        await site.call(
          "/api/gallery/" + kept,
          "GET",
          undefined,
          undefined,
          true,
        )
      ).status,
    ).toBe(200);
  }
  const rebuilt = await region("cn", auth);
  for (const [stream, stale] of [
    ["gallery", staleGallery],
    ["components", staleComponent],
  ]) {
    const applied = await rebuilt.call(
      "/api/resource-sync/" + stream + "/changes",
      "POST",
      stale,
      "peer-secret",
    );
    expect(applied.status).toBe(200);
  }
  expect((await rebuilt.call("/api/gallery/" + id)).status).toBe(404);
  expect((await rebuilt.call(component)).status).toBe(404);

  const restoredRuntime = {
    ...restored.env,
    PROJECT_REGION: "overseas" as const,
    PROJECT_SYNC_TOKEN: "restore-peer",
    PROJECT_SYNC_ADMIN_TOKEN: "restore-admin",
  };
  const replay = await routeGalleryRequest(
    new Request(ORIGIN + "/api/project-sync/recover-account-deletions", {
      method: "POST",
      headers: { authorization: "Bearer restore-admin" },
      body: JSON.stringify({ after: 0 }),
    }),
    restoredRuntime,
  );
  expect(replay?.status).toBe(200);
  const recovered = await restored.call(
    "/api/resource-sync/gallery/status",
    "GET",
    undefined,
    "peer-secret",
  );
  expect((await recovered.json()).sequence).toBe(priorSequence);
  expect(
    (
      await restored.call(
        "/api/gallery/" + restoredId,
        "GET",
        undefined,
        undefined,
        true,
      )
    ).status,
  ).toBe(404);
});

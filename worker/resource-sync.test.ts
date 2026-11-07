import { expect, it } from "vitest";

import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import {
  environment,
  makerOf,
  ownerAccountOf,
  sqliteState,
  ORIGIN,
  projectText,
  testbenchProjectText,
} from "./gallery.test-support";
import { routeComponentLibraryRequest } from "./component-library";
import { ComponentLibraryDO, GalleryDO } from "./index";
import { routeGalleryRequest } from "./gallery";
import { routeResourceSync } from "./resource-sync";

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
    cookie,
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

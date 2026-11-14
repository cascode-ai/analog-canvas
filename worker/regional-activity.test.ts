import { afterEach, expect, it, vi } from "vitest";
import { GalleryDO } from "./index";
import {
  accounts,
  config,
  transportOrigin,
} from "./regional-auth.test-support";
import { routeAuthRequest } from "./auth";
import {
  makerOf,
  adminOf,
  ORIGIN,
  sqliteState,
  wiredProjectText,
} from "./gallery.test-support";
import { routeGalleryRequest } from "./gallery";
import { routeBoardsRequest } from "./boards";
import { routeResourceSync } from "./resource-sync";
import { routeRegionalResourceActions } from "./regional-resource-actions";
import type { GalleryNamespaceLike } from "./gallery-store";

afterEach(() => vi.unstubAllGlobals());

async function pair(enabled = true) {
  let sourceGallery: GalleryNamespaceLike;
  let chinaGallery: GalleryNamespaceLike;
  const auth = accounts(
    {
      GALLERY: {
        getByName: (name) => ({
          fetch: async (url, init) => {
            const request = new Request(url, init);
            return sourceGallery.getByName(name).fetch(request.url, {
              method: request.method,
              headers: request.headers,
              ...(request.method === "GET" || request.method === "HEAD"
                ? {}
                : { body: await request.text() }),
            });
          },
        }),
      },
      AUTH_REGIONAL_AUTHORITY: JSON.stringify({
        ...JSON.parse(config),
        accountDeletion: true,
      }),
    },
    {
      GALLERY: {
        getByName: (name) => ({
          fetch: (url, init) => chinaGallery.getByName(name).fetch(url, init),
        }),
      },
    },
  );
  const cookie = await makerOf(auth.source),
    admin = await adminOf(auth.source);
  const cnCookie = await auth.connect(cookie),
    cnAdmin = await auth.connect(admin);
  const make = (region: "cn" | "overseas") => {
    const states = new Map<string, ReturnType<typeof sqliteState>>();
    const stores = new Map<string, InstanceType<typeof GalleryDO>>();
    const env = {
      ...(region === "cn" ? auth.resources : auth.source),
      ...(enabled
        ? {
            RESOURCE_REGION: region,
            RESOURCE_ACTION_PEER:
              region === "cn" ? transportOrigin : "https://china.test",
          }
        : {}),
      RESOURCE_WRITES_ENABLED: "true",
      RESOURCE_SYNC_TOKEN: "activity-sync",
      RESOURCE_SYNC_PEER_TOKEN: "activity-sync",
      STORE_BACKUP_TOKEN: "private-activity-backup",
      PROJECT_IDENTITY_URL: transportOrigin + "/api/auth/regional/identities",
      PROJECT_IDENTITY_TOKEN: "isolated-regional-account-service-secret",
    };
    env.GALLERY = {
      getByName: (name: string) => ({
        fetch: (url: string, init?: RequestInit) => {
          if (!states.has(name)) states.set(name, sqliteState());
          if (!stores.has(name))
            stores.set(name, new GalleryDO(states.get(name)!, env));
          return stores.get(name)!.fetch(new Request(url, init));
        },
      }),
    };
    const route = async (request: Request): Promise<Response> =>
      (await routeRegionalResourceActions(request, env)) ??
      (await routeResourceSync(request, env)) ??
      (await routeGalleryRequest(request, env)) ??
      (await routeBoardsRequest(request, env)) ??
      (await routeAuthRequest(request, { ...env, AUTH: env.AUTH! })) ??
      new Response(null, { status: 404 });
    const call = (
      path: string,
      method = "GET",
      body?: unknown,
      key?: string,
      administrator = false,
    ) =>
      route(
        new Request(ORIGIN + path, {
          method,
          headers: {
            origin: ORIGIN,
            cookie:
              region === "cn"
                ? administrator
                  ? cnAdmin
                  : cnCookie
                : administrator
                  ? admin
                  : cookie,
            ...(key ? { "idempotency-key": key } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    return {
      env,
      route,
      call,
      restart: () => stores.clear(),
      activate: () => {
        env.RESOURCE_REGION = region;
        env.RESOURCE_ACTION_PEER =
          region === "cn" ? transportOrigin : "https://china.test";
        stores.clear();
      },
    };
  };
  const overseas = make("overseas"),
    cn = make("cn");
  sourceGallery = overseas.env.GALLERY;
  chinaGallery = cn.env.GALLERY;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init),
      url = new URL(req.url);
    if (url.pathname.startsWith("/api/auth/"))
      return auth.source.authDurable.fetch(req);
    return (url.origin === transportOrigin ? overseas : cn).route(req);
  });
  const transfer = async (from: typeof cn, to: typeof cn, stream: string) => {
    const req = (path: string, method = "GET", body?: unknown) =>
      new Request(ORIGIN + path, {
        method,
        headers: { authorization: "Bearer activity-sync" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    for (let n = 0; n < 30; n++) {
      const status = await to.route(req(`/api/resource-sync/${stream}/status`));
      expect(status.status, await status.clone().text()).toBe(200);
      const after = (await status.json()).received?.sequence ?? 0;
      const changes = await from.route(
        req(`/api/resource-sync/${stream}/changes?after=${after}`),
      );
      expect(changes.status, await changes.clone().text()).toBe(200);
      const envelope = await changes.json();
      if (envelope.event === null) return;
      const received = await to.route(
        req(`/api/resource-sync/${stream}/changes`, "POST", envelope),
      );
      expect(received.status, await received.clone().text()).toBe(200);
    }
    throw new Error("Unbounded activity transfer");
  };
  const publish = async () => {
    const created = await overseas.call("/api/gallery/submissions", "POST", {
      name: "Activity circuit",
      projectText: wiredProjectText(),
    });
    expect(created.status).toBe(201);
    const id = (await created.json()).id as string;
    await transfer(overseas, cn, "gallery");
    return id;
  };
  return { overseas, cn, auth, transfer, publish };
}

it("keeps a private bookmark and its removal across both entrances and retries", async () => {
  const { cn, overseas, transfer, publish } = await pair();
  const id = await publish();
  const kept = await cn.call(
    `/api/gallery/${id}/bookmark`,
    "POST",
    { saved: true, expectedVersion: null },
    "keep-one",
  );
  expect(kept.status, await kept.clone().text()).toBe(200);
  const first = await kept.json();
  await transfer(cn, overseas, "gallery-activity");
  const visible = await overseas.call("/api/gallery/bookmarks");
  expect(visible.status).toBe(200);
  expect(await visible.json()).toMatchObject({ ids: [id] });
  const removed = await overseas.call(
    `/api/gallery/${id}/bookmark`,
    "POST",
    { saved: false, expectedVersion: first.version },
    "remove-one",
  );
  expect(removed.status).toBe(200);
  await transfer(overseas, cn, "gallery-activity");
  cn.restart();
  const repeated = await cn.call(
    `/api/gallery/${id}/bookmark`,
    "POST",
    { saved: true, expectedVersion: null },
    "keep-one",
  );
  expect(repeated.status).toBe(409);
  expect(await (await cn.call("/api/gallery/bookmarks")).json()).toMatchObject({
    ids: [],
  });
});

it("retirement deletes local bookmark rows and exports tombstones without a later incoming activity sync", async () => {
  const { overseas, cn, auth, publish, transfer } = await pair();
  const id = await publish();
  expect(
    (
      await overseas.call(
        `/api/gallery/${id}/bookmark`,
        "POST",
        { saved: true, expectedVersion: null },
        "before-retire",
      )
    ).status,
  ).toBe(200);
  await transfer(overseas, cn, "gallery-activity");
  const inventory = async (site: typeof cn) => {
    const response = await site.route(
      new Request(
        ORIGIN +
          "/api/gallery/maintenance/automated-backup?scope=activity&table=entryBookmarks",
        { headers: { authorization: "Bearer private-activity-backup" } },
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()).rows;
  };
  expect(await inventory(overseas)).toHaveLength(1);
  expect(await inventory(cn)).toHaveLength(1);
  expect(
    (
      await overseas.call("/api/auth/account/delete", "POST", {
        confirm: "delete-account",
        requestId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(202);
  const tick = new Request("https://auth/internal/account-deletion-tick", {
    method: "POST",
  });
  expect((await auth.source.authDurable.fetch(tick.clone())).status).toBe(200);
  expect((await auth.region.fetch(tick)).status).toBe(200);
  expect(await inventory(overseas)).toEqual([]);
  expect(await inventory(cn)).toEqual([]);
  for (const site of [overseas, cn]) {
    const response = await site.route(
      new Request(
        ORIGIN + "/api/resource-sync/gallery-activity/changes?after=0",
        { headers: { authorization: "Bearer activity-sync" } },
      ),
    );
    const envelope = await response.json();
    expect(JSON.parse(JSON.parse(envelope.payload).record.value).saved).toBe(
      false,
    );
  }
});

it("edits a foreign Board once and preserves its items, locks and event identities", async () => {
  const { cn, overseas, transfer, publish } = await pair();
  const entry = await publish();
  const created = await overseas.call(
    "/api/boards",
    "POST",
    { title: "Shared selection", entries: [entry] },
    "create-board",
    true,
  );
  expect(created.status, await created.clone().text()).toBe(200);
  const original = await created.json(),
    id = original.board.id;
  await transfer(overseas, cn, "gallery-activity");
  const read = await cn.call(`/api/boards/${id}`);
  expect(read.status, await read.clone().text()).toBe(200);
  expect(await read.json()).toMatchObject({
    board: original.board,
    items: original.items,
    events: original.events,
  });
  const changes = {
    expectedRevision: original.board.revision,
    changes: [
      { kind: "note", itemId: original.items[0].id, note: "Chosen in China" },
      { kind: "lock" },
    ],
  };
  const response = await cn.call(
    `/api/boards/${id}/changes`,
    "POST",
    changes,
    "board-note",
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const updated = await response.json();
  expect(updated.items[0].note).toBe("Chosen in China");
  expect(updated.board.lockedAt).not.toBeNull();
  cn.restart();
  overseas.restart();
  const replay = await cn.call(
    `/api/boards/${id}/changes`,
    "POST",
    changes,
    "board-note",
  );
  expect(replay.status, await replay.clone().text()).toBe(200);
  expect((await replay.json()).events).toEqual(updated.events);
  const refused = await cn.call(
    `/api/boards/${id}/changes`,
    "POST",
    { expectedRevision: updated.board.revision, changes: [{ kind: "unlock" }] },
    "not-the-maker",
  );
  expect(refused.status).toBe(403);
});

it("seeds legacy Boards from both regions without colliding event sequences or losing concurrent changes", async () => {
  const { cn, overseas, transfer } = await pair(false);
  const one = await (
    await overseas.call(
      "/api/boards",
      "POST",
      { title: "Existing overseas" },
      undefined,
      true,
    )
  ).json();
  const two = await (
    await cn.call(
      "/api/boards",
      "POST",
      { title: "Existing China" },
      undefined,
      true,
    )
  ).json();
  expect(one.events[0].seq).toBe(1);
  expect(two.events[0].seq).toBe(1);
  cn.activate();
  overseas.activate();
  const updated = await cn.call(
    `/api/boards/${two.board.id}/changes`,
    "POST",
    {
      expectedRevision: 1,
      changes: [{ kind: "rename", title: "Kept during seed" }],
    },
    "seed-edit",
  );
  expect(updated.status).toBe(200);
  await transfer(cn, overseas, "gallery-activity");
  await transfer(overseas, cn, "gallery-activity");
  for (const site of [cn, overseas]) {
    const old = await (await site.call(`/api/boards/${one.board.id}`)).json();
    expect(old.events).toEqual(one.events);
    const other = await (await site.call(`/api/boards/${two.board.id}`)).json();
    expect(other.board.title).toBe("Kept during seed");
    expect(other.events.at(-1)).toEqual(two.events[0]);
  }
});

it("refuses a stale Board batch without partially applying its earlier changes", async () => {
  const { cn, overseas, publish } = await pair();
  const entry = await publish();
  const created = await overseas.call(
    "/api/boards",
    "POST",
    { title: "Atomic board", entries: [entry] },
    "atomic-board",
    true,
  );
  const original = await created.json(),
    id = original.board.id;
  const failed = await cn.call(
    `/api/boards/${id}/changes`,
    "POST",
    {
      expectedRevision: 1,
      changes: [
        { kind: "rename", title: "Must roll back" },
        { kind: "remove", itemId: "missing-item" },
      ],
    },
    "bad-batch",
  );
  expect(failed.status).toBe(404);
  expect(
    (await (await overseas.call(`/api/boards/${id}`)).json()).board,
  ).toMatchObject({ title: "Atomic board", revision: 1 });
  const valid = await cn.call(
    `/api/boards/${id}/changes`,
    "POST",
    { expectedRevision: 1, changes: [{ kind: "slots", slots: 2 }] },
    "valid-batch",
  );
  expect(valid.status).toBe(200);
  const stale = await overseas.call(
    `/api/boards/${id}/changes`,
    "POST",
    {
      expectedRevision: 1,
      changes: [{ kind: "rename", title: "Stale title" }],
    },
    "stale-batch",
  );
  expect(stale.status).toBe(409);
});

it("converges concurrent bookmark removals and refuses replay over a newer save", async () => {
  const { cn, overseas, publish, transfer } = await pair();
  const id = await publish();
  const first = await (
    await cn.call(
      `/api/gallery/${id}/bookmark`,
      "POST",
      { saved: true, expectedVersion: null },
      "initial",
    )
  ).json();
  await transfer(cn, overseas, "gallery-activity");
  const body = { saved: false, expectedVersion: first.version };
  expect(
    (await cn.call(`/api/gallery/${id}/bookmark`, "POST", body, "cn-remove"))
      .status,
  ).toBe(200);
  expect(
    (
      await overseas.call(
        `/api/gallery/${id}/bookmark`,
        "POST",
        body,
        "overseas-remove",
      )
    ).status,
  ).toBe(200);
  await transfer(cn, overseas, "gallery-activity");
  await transfer(overseas, cn, "gallery-activity");
  const current = await (await cn.call("/api/gallery/bookmarks")).json();
  expect(current.ids).toEqual([]);
  expect(
    (
      await cn.call(
        `/api/gallery/${id}/bookmark`,
        "POST",
        { saved: true, expectedVersion: current.versions[id] },
        "new-save",
      )
    ).status,
  ).toBe(200);
  await transfer(cn, overseas, "gallery-activity");
  const replay = await overseas.call(
    `/api/gallery/${id}/bookmark`,
    "POST",
    body,
    "overseas-remove",
  );
  expect(replay.status).toBe(409);
  expect(
    (await (await overseas.call("/api/gallery/bookmarks")).json()).ids,
  ).toEqual([id]);
  const unauthorized = await routeResourceSync(
    new Request(ORIGIN + "/api/resource-sync/gallery-activity/changes"),
    cn.env,
  );
  expect(unauthorized?.status).toBe(401);
  const other = await cn.call(
    "/api/gallery/bookmarks",
    "GET",
    undefined,
    undefined,
    true,
  );
  expect((await other.json()).ids).toEqual([]);
});

it("reconciles Board creation after the response is lost and the entrance changes", async () => {
  const { cn, overseas } = await pair();
  const body = { title: "One creation" };
  const first = await overseas.call(
    "/api/boards",
    "POST",
    body,
    "lost-create",
    true,
  );
  expect(first.status).toBe(200);
  const original = await first.json();
  cn.restart();
  overseas.restart();
  const retried = await cn.call(
    "/api/boards",
    "POST",
    body,
    "lost-create",
    true,
  );
  expect(retried.status, await retried.clone().text()).toBe(200);
  const current = await retried.json();
  expect(current.board).toEqual(original.board);
  expect(current.events).toEqual(original.events);
});

it("does not restore a deleted account from delayed bookmarks or Board history", async () => {
  const { cn, overseas, publish, transfer } = await pair();
  const entry = await publish();
  const created = await overseas.call(
    "/api/boards",
    "POST",
    { title: "Retained selection" },
    "privacy-board",
    true,
  );
  expect(created.status).toBe(200);
  const board = (await created.json()).board;
  const changed = await overseas.call(
    `/api/boards/${board.id}/changes`,
    "POST",
    {
      expectedRevision: 1,
      changes: [{ kind: "rename", title: "Changed by former member" }],
    },
    "former-member",
  );
  expect(changed.status).toBe(200);
  expect(
    (
      await overseas.call(
        `/api/gallery/${entry}/bookmark`,
        "POST",
        { saved: true, expectedVersion: null },
        "private-save",
      )
    ).status,
  ).toBe(200);
  const deletion = await overseas.call("/api/auth/account/delete", "POST", {
    confirm: "delete-account",
    requestId: crypto.randomUUID(),
  });
  expect(deletion.status).toBe(202);
  await transfer(overseas, cn, "gallery-activity");
  cn.restart();
  const retained = await cn.call(
    `/api/boards/${board.id}`,
    "GET",
    undefined,
    undefined,
    true,
  );
  expect(retained.status).toBe(200);
  expect((await retained.json()).events[0].actor).toBe("(deleted account)");
  const rejected = await cn.call(
    `/api/gallery/${entry}/bookmark`,
    "POST",
    { saved: true, expectedVersion: null },
    "private-save",
  );
  expect(rejected.status).toBe(403);
  expect((await (await cn.call("/api/gallery/bookmarks")).json()).ids).toEqual(
    [],
  );
});

it("catches up a newly published circuit before adding it to a foreign Board", async () => {
  const { cn, overseas, transfer } = await pair(false);
  const created = await overseas.call(
    "/api/boards",
    "POST",
    { title: "Existing writer" },
    undefined,
    true,
  );
  const id = (await created.json()).board.id;
  cn.activate();
  overseas.activate();
  await transfer(overseas, cn, "gallery-activity");
  const published = await cn.call("/api/gallery/submissions", "POST", {
    name: "New in China",
    projectText: wiredProjectText(),
  });
  expect(published.status).toBe(201);
  const entry = (await published.json()).id;
  const added = await cn.call(
    `/api/boards/${id}/changes`,
    "POST",
    { expectedRevision: 1, changes: [{ kind: "add", entryId: entry }] },
    "add-new-publication",
  );
  expect(added.status, await added.clone().text()).toBe(200);
  expect((await added.json()).items[0].entryId).toBe(entry);
});

it("removes a legacy bookmark beyond the first seed batch without replacing the other saves", async () => {
  const { overseas } = await pair(false);
  const ids: string[] = [];
  for (let i = 0; i < 101; i++) {
    const created = await overseas.call(
      "/api/gallery/submissions",
      "POST",
      {
        name: `Legacy ${i}`,
        projectText: wiredProjectText(),
      },
      undefined,
      true,
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).id;
    ids.push(id);
    expect(
      (await overseas.call(`/api/gallery/${id}/bookmark`, "POST")).status,
    ).toBe(200);
  }
  const last = ids.sort().at(-1)!;
  overseas.activate();
  const removed = await overseas.call(
    `/api/gallery/${last}/bookmark`,
    "POST",
    { saved: false, expectedVersion: "1:overseas" },
    "legacy-remove",
  );
  expect(removed.status, await removed.clone().text()).toBe(200);
  const kept = await (await overseas.call("/api/gallery/bookmarks")).json();
  expect(kept.ids).toHaveLength(100);
  expect(kept.ids).not.toContain(last);
});

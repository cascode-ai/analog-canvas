import { afterEach, expect, it, vi } from "vitest";
import { accounts, transportOrigin } from "./regional-auth.test-support";
import {
  makerOf,
  signIn,
  adminOf,
  ownerAccountOf,
  ORIGIN,
  sqliteState,
  submissionRequest,
  wiredProjectText,
} from "./gallery.test-support";
import { GalleryDO, ComponentLibraryDO } from "./index";
import { routeComponentLibraryRequest } from "./component-library";
import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import { routeGalleryRequest } from "./gallery";
import { routeResourceSync } from "./resource-sync";
import { routeRegionalResourceActions } from "./regional-resource-actions";
import { digest } from "./regional-auth-contract";

afterEach(() => vi.unstubAllGlobals());

it("resolves a China-written Dataset review through the overseas entrance in its own stream", async () => {
  const { cn, overseas, auth } = await pair();
  const ownerCookie = await ownerAccountOf(auth.source);
  const cnOwner = await auth.connect(ownerCookie);
  const send = (
    site: typeof cn,
    cookie: string,
    path: string,
    method: string,
    body?: unknown,
  ) =>
    site.route(
      new Request(ORIGIN + path, {
        method,
        headers: { cookie, origin: ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const imported = await send(
    cn,
    cnOwner,
    "/api/gallery/sources/analoggenie/entries",
    "POST",
    {
      entries: [
        {
          id: "ag-308",
          name: "Synthetic Dataset",
          projectText: wiredProjectText(),
        },
      ],
    },
  );
  expect(imported.status, await imported.clone().text()).toBe(200);
  const transfer = async (stream: string) => {
    const source = cn.env.GALLERY.getByName("source:analoggenie");
    const target = overseas.env.GALLERY.getByName("source:analoggenie");
    const changes = await source.fetch("https://store/resource-sync/changes", {
      method: "POST",
      body: JSON.stringify({ stream, after: 0 }),
    });
    expect(
      (
        await target.fetch("https://store/resource-sync/receive", {
          method: "POST",
          body: JSON.stringify({ stream, envelope: await changes.json() }),
        })
      ).status,
    ).toBe(200);
  };
  await transfer("analoggenie");
  const revision = (await (await cn.call("/api/gallery/ag-308")).json()).entry
    .previewRevision;
  const created = await cn.call(
    "/api/gallery/ag-308/reviews",
    "POST",
    undefined,
    {
      revision,
      verdict: "issue",
      flags: ["wiring"],
      note: "Synthetic Dataset review",
      marks: [],
    },
  );
  expect(created.status, await created.clone().text()).toBe(200);
  const reviewId = (await created.json()).review.id;
  await transfer("analoggenie-interactions");
  const response = await send(
    overseas,
    ownerCookie,
    `/api/gallery/ag-308/reviews/${reviewId}`,
    "PATCH",
    { resolved: true },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const visible = await send(
    overseas,
    ownerCookie,
    "/api/gallery/ag-308/reviews",
    "GET",
  );
  expect((await visible.json()).history[0].resolved).toBe(true);
  // Reconciliation of a terminal resolution cannot be reused for another intent.
  expect(
    (
      await send(
        overseas,
        ownerCookie,
        `/api/gallery/ag-308/reviews/${reviewId}`,
        "PATCH",
        { resolved: false },
      )
    ).status,
  ).toBe(400);
});

it("resolves a foreign review once, preserving Owner-only authority across a lost reply", async () => {
  const { cn, overseas, publish, auth, loseNextReply } = await pair();
  const id = await publish(cn);
  const revision = (await (await overseas.call(`/api/gallery/${id}`)).json())
    .entry.previewRevision;
  const reviewer = await signIn(
    auth.source.authDurable,
    "regional-reviewer@example.com",
  );
  const created = await overseas.route(
    new Request(ORIGIN + `/api/gallery/${id}/reviews`, {
      method: "POST",
      headers: { cookie: reviewer, origin: ORIGIN },
      body: JSON.stringify({
        revision,
        verdict: "issue",
        flags: ["wiring"],
        note: "Synthetic review",
        marks: [],
      }),
    }),
  );
  expect(created.status, await created.clone().text()).toBe(200);
  const reviewId = (await created.json()).review.id;
  const changes = await overseas.store.fetch(
    new Request("https://store/resource-sync/changes", {
      method: "POST",
      body: JSON.stringify({ stream: "gallery-interactions", after: 0 }),
    }),
  );
  expect(
    (
      await cn.store.fetch(
        new Request("https://store/resource-sync/receive", {
          method: "POST",
          body: JSON.stringify({
            stream: "gallery-interactions",
            envelope: await changes.json(),
          }),
        }),
      )
    ).status,
  ).toBe(200);
  const resolve = (cookie: string) =>
    cn.route(
      new Request(ORIGIN + `/api/gallery/${id}/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { cookie, origin: ORIGIN },
        body: JSON.stringify({ resolved: true }),
      }),
    );
  expect((await resolve(await auth.connect(reviewer))).status).toBe(403);
  expect(
    (await resolve(await auth.connect(await adminOf(auth.source)))).status,
  ).toBe(403);
  const owner = await auth.connect(await ownerAccountOf(auth.source));
  loseNextReply();
  expect((await resolve(owner)).status).toBe(503);
  overseas.restart();
  const retry = await resolve(owner);
  expect(retry.status, await retry.clone().text()).toBe(200);
  expect(await retry.json()).toEqual({ ok: true });
  expect(
    (await (await cn.call(`/api/gallery/${id}/reviews`)).json()).history[0]
      .resolved,
  ).toBe(true);
  expect((await resolve(owner)).status).toBe(200);
});

it("keeps owner and moderator metadata permissions in the reverse direction", async () => {
  const { cn, overseas, publish, auth, cnCookie } = await pair();
  const id = await publish(cn);
  const stranger = await signIn(
    auth.source.authDurable,
    "metadata-reviewer@example.com",
  );
  const patch = (cookie: string, origin = ORIGIN) =>
    overseas.route(
      new Request(ORIGIN + `/api/gallery/${id}`, {
        method: "PATCH",
        headers: { cookie, origin, "idempotency-key": "review-metadata" },
        body: JSON.stringify({
          name: "Moderator name",
          description: "Moderated",
        }),
      }),
    );
  expect((await patch(stranger)).status).toBe(403);
  expect(
    (
      await auth.source.authDurable.fetch(
        new Request(ORIGIN + "/api/auth/users/role", {
          method: "POST",
          headers: { cookie: await adminOf(auth.source), origin: ORIGIN },
          body: JSON.stringify({
            email: "metadata-reviewer@example.com",
            role: "moderator",
          }),
        }),
      )
    ).status,
  ).toBe(200);
  expect((await patch(stranger, "https://unrelated.test")).status).toBe(403);
  expect((await patch(stranger)).status).toBe(200);
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).entry.name).toBe(
    "Moderator name",
  );
  expect(
    (
      await overseas.call(`/api/gallery/${id}`, "PATCH", "invalid-fields", {
        name: " ",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await cn.route(
        new Request(ORIGIN + `/api/gallery/${id}`, {
          method: "PATCH",
          headers: { cookie: cnCookie, origin: ORIGIN },
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
});

it("renames a foreign Gallery entry once across a lost reply and keeps later metadata on retry", async () => {
  const { cn, overseas, publish, loseNextReply } = await pair();
  const id = await publish(overseas);
  const input = { name: "Renamed in China", description: "A regional note" };
  loseNextReply();
  expect(
    (await cn.call(`/api/gallery/${id}`, "PATCH", "rename-once", input)).status,
  ).toBe(503);
  overseas.restart();
  const retry = await cn.call(
    `/api/gallery/${id}`,
    "PATCH",
    "rename-once",
    input,
  );
  expect(retry.status, await retry.clone().text()).toBe(200);
  expect(await retry.json()).toEqual({ id, ...input });
  expect(
    (await (await cn.call(`/api/gallery/${id}`)).json()).entry,
  ).toMatchObject(input);
  const history = await (
    await overseas.call(`/api/gallery/${id}/versions`)
  ).json();
  expect(history.versions).toHaveLength(1);
  expect(
    (
      await overseas.call(`/api/gallery/${id}`, "PATCH", "later-rename", {
        name: "Later name",
        description: "",
      })
    ).status,
  ).toBe(200);
  expect(
    (await cn.call(`/api/gallery/${id}`, "PATCH", "rename-once", input)).status,
  ).toBe(409);
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).entry.name).toBe(
    "Later name",
  );
});

async function pair() {
  const auth = accounts();
  const cookie = await makerOf(auth.source);
  const cnCookie = await auth.connect(cookie);
  const make = (region: "cn" | "overseas") => {
    const state = sqliteState();
    const env = {
      ...(region === "cn" ? auth.resources : auth.source),
      RESOURCE_REGION: region,
      RESOURCE_WRITES_ENABLED: "true",
      RESOURCE_ACTION_PEER:
        region === "cn" ? transportOrigin : "https://china.test",
      RESOURCE_SYNC_TOKEN: region === "cn" ? "cn-sync" : "source-sync",
      RESOURCE_SYNC_PEER_TOKEN: region === "cn" ? "source-sync" : "cn-sync",
      PROJECT_IDENTITY_URL: transportOrigin + "/api/auth/regional/identities",
      PROJECT_IDENTITY_TOKEN: "isolated-regional-account-service-secret",
    };
    let store = new GalleryDO(state, env);
    const datasets = new Map<
      string,
      {
        state: ReturnType<typeof sqliteState>;
        store: InstanceType<typeof GalleryDO>;
      }
    >();
    const componentState = sqliteState();
    let components = new ComponentLibraryDO(componentState, env);
    const componentBinding = {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          components.fetch(new Request(input, init)),
      }),
    };
    Object.assign(env, { COMPONENT_LIBRARY: componentBinding });
    env.GALLERY = {
      getByName: (name: string) => ({
        fetch: (input: string, init?: RequestInit) =>
          (() => {
            if (name === "gallery")
              return store.fetch(new Request(input, init));
            let dataset = datasets.get(name);
            if (!dataset) {
              const state = sqliteState();
              dataset = { state, store: new GalleryDO(state, env) };
              datasets.set(name, dataset);
            }
            return dataset.store.fetch(new Request(input, init));
          })(),
      }),
    };
    const route = async (request: Request): Promise<Response> =>
      (await routeRegionalResourceActions(request, env)) ??
      (await routeResourceSync(request, env)) ??
      (await routeGalleryRequest(request, env)) ??
      (await routeComponentLibraryRequest(request, {
        ...env,
        COMPONENT_LIBRARY: componentBinding,
      }))!;
    const call = (path: string, method = "GET", key?: string, body?: unknown) =>
      route(
        new Request(ORIGIN + path, {
          method,
          headers: {
            origin: ORIGIN,
            cookie: region === "cn" ? cnCookie : cookie,
            ...(key ? { "idempotency-key": key } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    return {
      env,
      get store() {
        return store;
      },
      get components() {
        return components;
      },
      legacyComponentDefinition: (id: string, definition: unknown) => {
        componentState.storage.sql.exec(
          "UPDATE components SET definition=? WHERE id=?",
          JSON.stringify(definition),
          id,
        );
      },
      route,
      call,
      restart: () => {
        store = new GalleryDO(state, env);
        for (const dataset of datasets.values())
          dataset.store = new GalleryDO(dataset.state, env);
        components = new ComponentLibraryDO(componentState, env);
      },
    };
  };
  const overseas = make("overseas"),
    cn = make("cn");
  let loseReply = false;
  let loseCatchup = false;
  let beforeCatchup: (() => Promise<void>) | undefined;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (url.pathname.startsWith("/api/auth/"))
        return auth.source.authDurable.fetch(request);
      if (loseCatchup && url.pathname.endsWith("/changes")) {
        loseCatchup = false;
        throw new TypeError("Catch-up connection lost");
      }
      if (beforeCatchup && url.pathname.endsWith("/changes")) {
        const run = beforeCatchup;
        beforeCatchup = undefined;
        await run();
      }
      const response = await (
        url.origin === transportOrigin ? overseas : cn
      ).route(request);
      if (
        loseReply &&
        url.pathname.startsWith("/api/resource-actions/") &&
        response.ok
      ) {
        loseReply = false;
        throw new TypeError("Connection lost after commit");
      }
      return response;
    },
  );
  const publish = async (site: typeof cn) => {
    const response = await site.route(
      submissionRequest(
        {
          name: "Regional lifecycle",
          projectText: wiredProjectText(),
          tags: [],
        },
        { cookie: site === cn ? cnCookie : cookie },
      ),
    );
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const peer = site === cn ? overseas : cn;
    const status = await peer.store.fetch(
      new Request("https://store/resource-sync/status", {
        method: "POST",
        body: JSON.stringify({ stream: "gallery" }),
      }),
    );
    const after = (await status.json()).received?.sequence ?? 0;
    const change = await site.store.fetch(
      new Request("https://store/resource-sync/changes", {
        method: "POST",
        body: JSON.stringify({ stream: "gallery", after }),
      }),
    );
    const imported = await peer.store.fetch(
      new Request("https://store/resource-sync/receive", {
        method: "POST",
        body: JSON.stringify({
          stream: "gallery",
          envelope: await change.json(),
        }),
      }),
    );
    expect(imported.status).toBe(200);
    return id as string;
  };
  return {
    cn,
    overseas,
    publish,
    auth,
    cookie,
    cnCookie,
    loseNextReply: () => {
      loseReply = true;
    },
    loseNextCatchup: () => {
      loseCatchup = true;
    },
    beforeNextCatchup: (run: () => Promise<void>) => {
      beforeCatchup = run;
    },
  };
}

it("updates a foreign User Component with the same revision checks and confirms local visibility", async () => {
  const { overseas, cn } = await pair();
  const definition = {
    symbol: {
      ...builtInSymbols.find((s) => s.id === "resistor")!,
      name: "Regional resistor",
    },
    electrical: deviceDescriptor("resistor"),
  };
  expect(
    (
      await overseas.call(
        "/api/components/regional-resistor",
        "PUT",
        undefined,
        { revision: 0, definition },
      )
    ).status,
  ).toBe(200);
  const changes = await overseas.components.fetch(
    new Request("https://store/resource-sync/changes", {
      method: "POST",
      body: JSON.stringify({ stream: "components", after: 0 }),
    }),
  );
  expect(
    (
      await cn.components.fetch(
        new Request("https://store/resource-sync/receive", {
          method: "POST",
          body: JSON.stringify({
            stream: "components",
            envelope: await changes.json(),
          }),
        }),
      )
    ).status,
  ).toBe(200);
  definition.symbol.name = "Updated from China";
  const updated = await cn.call(
    "/api/components/regional-resistor",
    "PUT",
    "foreign-update",
    { revision: 1, definition },
  );
  expect(updated.status, await updated.clone().text()).toBe(200);
  expect((await updated.json()).entry).toMatchObject({
    revision: 2,
    definition: { symbol: { name: "Updated from China" } },
  });
  expect(
    (await (await cn.call("/api/components/regional-resistor")).json()).entry
      .revision,
  ).toBe(2);
  expect(
    (
      await overseas.call(
        "/api/components/regional-resistor",
        "PUT",
        "stale-update",
        { revision: 1, definition },
      )
    ).status,
  ).toBe(409);
});

it("reconciles deletion of an oversized historical Component after restart without undoing a later restoration", async () => {
  const { cn, overseas, loseNextReply } = await pair();
  const path = "/api/components/domestic-resistor";
  expect(
    (
      await cn.call(path, "PUT", undefined, {
        revision: 0,
        definition: {
          symbol: {
            ...builtInSymbols.find((s) => s.id === "resistor")!,
            name: "Domestic resistor",
          },
          electrical: deviceDescriptor("resistor"),
        },
      })
    ).status,
  ).toBe(200);
  cn.legacyComponentDefinition("domestic-resistor", {
    legacy: "x".repeat(300_000),
  });
  const changes = await cn.components.fetch(
    new Request("https://store/resource-sync/changes", {
      method: "POST",
      body: JSON.stringify({ stream: "components", after: 0 }),
    }),
  );
  expect(
    (
      await overseas.components.fetch(
        new Request("https://store/resource-sync/receive", {
          method: "POST",
          body: JSON.stringify({
            stream: "components",
            envelope: await changes.json(),
          }),
        }),
      )
    ).status,
  ).toBe(200);
  const remove = () =>
    overseas.call(path, "PATCH", undefined, { revision: 1, action: "delete" });
  loseNextReply();
  expect((await remove()).status).toBe(503);
  cn.restart();
  const retry = await remove();
  expect(retry.status, await retry.clone().text()).toBe(200);
  expect((await retry.json()).entry).toMatchObject({
    revision: 2,
    status: "deleted",
  });
  expect((await (await overseas.call(path)).json()).entry).toMatchObject({
    revision: 2,
    status: "deleted",
  });
  const restored = await overseas.call(path, "PATCH", undefined, {
    revision: 2,
    action: "restore",
  });
  expect(restored.status, await restored.clone().text()).toBe(200);
  expect((await restored.json()).entry).toMatchObject({
    revision: 3,
    status: "shared",
  });
  expect((await remove()).status).toBe(409);
  expect((await (await cn.call(path)).json()).entry).toMatchObject({
    revision: 3,
    status: "shared",
  });
});

it("curates a foreign publication with revision checks and reconciles a lost reply exactly once", async () => {
  const { cn, overseas, publish, loseNextReply } = await pair();
  const id = await publish(overseas);
  const { entry } = await (await cn.call(`/api/gallery/${id}`)).json();
  const body = {
    tags: ["amplifier"],
    attention: {
      status: "needs-attention",
      issues: Array.from({ length: 12 }, () => ({
        kind: "suspected-disconnection",
        detail: "断".repeat(500),
      })),
    },
    expectedPreviewRevision: entry.previewRevision,
    expectedCurationRevision: entry.curationRevision,
  };
  const change = () =>
    cn.call(`/api/gallery/${id}/curation`, "PATCH", undefined, body);
  loseNextReply();
  expect((await change()).status).toBe(503);
  overseas.restart();
  const result = await change();
  expect(result.status, await result.clone().text()).toBe(200);
  expect((await result.json()).entry).toMatchObject({
    tags: ["amplifier"],
    curationRevision: 1,
  });
  expect(
    (await (await cn.call(`/api/gallery/${id}`)).json()).entry,
  ).toMatchObject({ tags: ["amplifier"], curationRevision: 1 });
  const stale = await overseas.call(
    `/api/gallery/${id}/curation`,
    "PATCH",
    undefined,
    { ...body, tags: ["buffer"] },
  );
  expect(stale.status).toBe(409);
});

it("keeps foreign component authority and the stricter component browser-origin check", async () => {
  const { cn, overseas, auth, cnCookie } = await pair();
  const path = "/api/components/guarded-resistor";
  const definition = {
    symbol: {
      ...builtInSymbols.find((s) => s.id === "resistor")!,
      name: "Guarded resistor",
    },
    electrical: deviceDescriptor("resistor"),
  };
  expect(
    (await overseas.call(path, "PUT", undefined, { revision: 0, definition }))
      .status,
  ).toBe(200);
  const changes = await overseas.components.fetch(
    new Request("https://store/resource-sync/changes", {
      method: "POST",
      body: JSON.stringify({ stream: "components", after: 0 }),
    }),
  );
  expect(
    (
      await cn.components.fetch(
        new Request("https://store/resource-sync/receive", {
          method: "POST",
          body: JSON.stringify({
            stream: "components",
            envelope: await changes.json(),
          }),
        }),
      )
    ).status,
  ).toBe(200);
  const stranger = await auth.connect(
    await signIn(auth.source.authDurable, "component-stranger@example.com"),
  );
  const remove = (
    cookie: string,
    site = "same-origin",
    revision = 1,
    action = "delete",
  ) =>
    cn.route(
      new Request(ORIGIN + path, {
        method: "PATCH",
        headers: { cookie, "sec-fetch-site": site },
        body: JSON.stringify({ revision, action }),
      }),
    );
  expect((await remove(stranger)).status).toBe(403);
  expect((await remove(cnCookie, "same-site")).status).toBe(403);
  const admin = await auth.connect(await adminOf(auth.source));
  expect((await remove(admin)).status).toBe(200);
  expect((await remove(cnCookie, "same-origin", 2, "restore")).status).toBe(
    403,
  );
  const forged = await overseas.route(
    new Request(ORIGIN + "/api/resource-actions/component", {
      method: "POST",
      headers: { authorization: "Bearer source-sync" },
      body: JSON.stringify({
        id: "guarded-resistor",
        operation: "status",
        commandId: "forged",
        target: "overseas",
        input: { revision: 2, action: "restore", admin: true },
      }),
    }),
  );
  expect(forged.status).toBe(401);
});

it("retains a duplicate Component publication outcome when the matching component is later withdrawn", async () => {
  const { overseas } = await pair();
  const definition = {
    symbol: {
      ...builtInSymbols.find((s) => s.id === "resistor")!,
      name: "Duplicate resistor",
    },
    electrical: deviceDescriptor("resistor"),
  };
  expect(
    (
      await overseas.call(
        "/api/components/first-resistor",
        "PUT",
        "first-create",
        { revision: 0, definition },
      )
    ).status,
  ).toBe(200);
  const duplicate = () =>
    overseas.call(
      "/api/components/second-resistor",
      "PUT",
      "duplicate-create",
      { revision: 0, definition },
    );
  const refused = await duplicate();
  expect(refused.status).toBe(409);
  const original = await refused.json();
  expect(original.code).toBe("COMPONENT_ALREADY_PUBLISHED");
  expect(
    (
      await overseas.call(
        "/api/components/first-resistor",
        "PATCH",
        undefined,
        { revision: 1, action: "delete" },
      )
    ).status,
  ).toBe(200);
  overseas.restart();
  const retried = await duplicate();
  expect(retried.status).toBe(409);
  expect(await retried.json()).toEqual(original);
});

it("deletes a foreign publication through either entrance and reconciles a lost reply after restart", async () => {
  const { cn, overseas, publish, loseNextReply } = await pair();
  const id = await publish(overseas);
  loseNextReply();
  expect(
    (await cn.call(`/api/gallery/${id}`, "DELETE", "delete-once")).status,
  ).toBe(503);
  overseas.restart();
  const reconciled = await cn.call(
    `/api/gallery/${id}`,
    "DELETE",
    "delete-once",
  );
  expect(reconciled.status, await reconciled.clone().text()).toBe(200);
  expect(await reconciled.json()).toEqual({ id, deleted: true });
  expect((await cn.call(`/api/gallery/${id}`)).status).toBe(404);
  expect((await overseas.call(`/api/gallery/${id}`)).status).toBe(404);

  const domesticId = await publish(cn);
  const deleted = await overseas.call(
    `/api/gallery/${domesticId}`,
    "DELETE",
    "reverse-delete",
  );
  expect(deleted.status, await deleted.clone().text()).toBe(200);
  expect((await overseas.call(`/api/gallery/${domesticId}`)).status).toBe(404);
  expect((await cn.call(`/api/gallery/${domesticId}`)).status).toBe(404);
});

it("withdraws and restores a foreign publication through either entrance, visible before success", async () => {
  const { cn, overseas, publish } = await pair();
  for (const [source, entrance] of [
    [overseas, cn],
    [cn, overseas],
  ]) {
    const id = await publish(source!);
    const response = await entrance!.call(
      `/api/gallery/${id}/recycle`,
      "POST",
      crypto.randomUUID(),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      (await (await entrance!.call(`/api/gallery/${id}`)).json()).status,
    ).toBe("recycled");
    const restored = await entrance!.call(
      `/api/gallery/${id}/restore`,
      "POST",
      crypto.randomUUID(),
    );
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect(
      (await (await entrance!.call(`/api/gallery/${id}`)).json()).status,
    ).toBe("public");
  }
});

it("keeps deletion ownership, curator bin requirements and command bindings across regions", async () => {
  const { cn, overseas, publish, auth } = await pair();
  const id = await publish(overseas);
  const stranger = await auth.connect(
    await signIn(auth.source.authDurable, "delete-stranger@example.com"),
  );
  const admin = await auth.connect(await adminOf(auth.source));
  const remove = (cookie: string) =>
    cn.route(
      new Request(ORIGIN + `/api/gallery/${id}`, {
        method: "DELETE",
        headers: {
          cookie,
          origin: ORIGIN,
          "idempotency-key": "guarded-delete",
        },
      }),
    );
  expect((await remove(stranger)).status).toBe(401);
  const publicDelete = await remove(admin);
  expect(publicDelete.status).toBe(409);
  expect(await publicDelete.json()).toMatchObject({ error: "not-recycled" });
  expect(
    (await cn.call(`/api/gallery/${id}/recycle`, "POST", "before-delete"))
      .status,
  ).toBe(200);
  expect((await remove(admin)).status).toBe(200);
  expect((await cn.call(`/api/gallery/${id}`)).status).toBe(404);
  // A receipt is per actor and bound to the original operation, even after deletion.
  expect((await remove(stranger)).status).toBe(404);
  const reused = await cn.route(
    new Request(ORIGIN + `/api/gallery/${id}/restore`, {
      method: "POST",
      headers: {
        cookie: admin,
        origin: ORIGIN,
        "idempotency-key": "guarded-delete",
      },
    }),
  );
  expect(reused.status).toBe(409);
  expect(await reused.json()).toMatchObject({ error: "command-reused" });
});

it("recovers a lost command reply after restart without a second mutation", async () => {
  const { cn, overseas, publish, loseNextReply } = await pair();
  const id = await publish(overseas),
    key = crypto.randomUUID();
  loseNextReply();
  expect(
    (await cn.call(`/api/gallery/${id}/recycle`, "POST", key)).status,
  ).toBe(503);
  const status = () =>
    overseas.route(
      new Request(ORIGIN + "/api/resource-sync/gallery/status", {
        headers: { authorization: "Bearer source-sync" },
      }),
    );
  const committed = await (await status()).json();
  overseas.restart();
  const recovered = await cn.call(`/api/gallery/${id}/recycle`, "POST", key);
  expect(recovered.status, await recovered.clone().text()).toBe(200);
  expect(await (await status()).json()).toMatchObject({
    sequence: committed.sequence,
  });
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).status).toBe(
    "recycled",
  );
  expect(
    (await cn.call(`/api/gallery/${id}/restore`, "POST", key)).status,
  ).toBe(409);
});

it("reconciles a superseded restore without claiming the curator's withdrawn entry is public", async () => {
  const { cn, overseas, publish, auth, loseNextReply } = await pair();
  const id = await publish(overseas);
  expect(
    (await cn.call(`/api/gallery/${id}/recycle`, "POST", crypto.randomUUID()))
      .status,
  ).toBe(200);
  const key = crypto.randomUUID();
  loseNextReply();
  expect(
    (await cn.call(`/api/gallery/${id}/restore`, "POST", key)).status,
  ).toBe(503);
  const admin = await adminOf(auth.source);
  expect(
    (
      await overseas.route(
        new Request(ORIGIN + `/api/gallery/${id}/recycle`, {
          method: "POST",
          headers: {
            cookie: admin,
            origin: ORIGIN,
            "idempotency-key": crypto.randomUUID(),
          },
        }),
      )
    ).status,
  ).toBe(200);
  const reconciled = await cn.call(`/api/gallery/${id}/restore`, "POST", key);
  expect(reconciled.status).toBe(409);
  expect(await reconciled.json()).toMatchObject({ error: "action-superseded" });
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).status).toBe(
    "recycled",
  );
});

it("does not announce a restore superseded during catch-up", async () => {
  const { cn, overseas, publish, auth, beforeNextCatchup } = await pair();
  const id = await publish(overseas);
  expect(
    (await cn.call(`/api/gallery/${id}/recycle`, "POST", crypto.randomUUID()))
      .status,
  ).toBe(200);
  const admin = await adminOf(auth.source);
  beforeNextCatchup(async () => {
    expect(
      (
        await overseas.route(
          new Request(ORIGIN + `/api/gallery/${id}/recycle`, {
            method: "POST",
            headers: {
              cookie: admin,
              origin: ORIGIN,
              "idempotency-key": crypto.randomUUID(),
            },
          }),
        )
      ).status,
    ).toBe(200);
  });
  const result = await cn.call(
    `/api/gallery/${id}/restore`,
    "POST",
    crypto.randomUUID(),
  );
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: "action-superseded" });
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).status).toBe(
    "recycled",
  );
});

it("preserves Dataset lifecycle refusal rather than using the Community store", async () => {
  const { cn } = await pair();
  const result = await cn.call(
    "/api/gallery/ag-123/recycle",
    "POST",
    crypto.randomUUID(),
  );
  expect(result.status).toBe(403);
  expect(await result.json()).toMatchObject({ error: "dataset-read-only" });
});

it("preserves the known commit when catch-up throws and reconciles the same operation", async () => {
  const { cn, overseas, publish, loseNextCatchup } = await pair();
  const id = await publish(overseas),
    key = crypto.randomUUID();
  loseNextCatchup();
  const pending = await cn.call(`/api/gallery/${id}/recycle`, "POST", key);
  expect(pending.status).toBe(503);
  expect(await pending.json()).toMatchObject({
    error: "action-propagation-pending",
  });
  expect(
    (await cn.call(`/api/gallery/${id}/recycle`, "POST", key)).status,
  ).toBe(200);
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).status).toBe(
    "recycled",
  );
});

it("keeps curator withdrawal authority and refuses unauthenticated peer commands", async () => {
  const { cn, overseas, publish, auth } = await pair();
  const id = await publish(overseas);
  const admin = await auth.connect(await adminOf(auth.source));
  const rejected = await cn.route(
    new Request(ORIGIN + `/api/gallery/${id}/recycle`, {
      method: "POST",
      headers: {
        cookie: admin,
        origin: ORIGIN,
        "idempotency-key": crypto.randomUUID(),
      },
    }),
  );
  expect(rejected.status, await rejected.clone().text()).toBe(200);
  expect(
    (await cn.call(`/api/gallery/${id}/restore`, "POST", crypto.randomUUID()))
      .status,
  ).toBe(409);
  const forged = await overseas.route(
    new Request(ORIGIN + "/api/resource-actions/lifecycle", {
      method: "POST",
      headers: { authorization: "Bearer source-sync" },
      body: JSON.stringify({
        id,
        action: "restore",
        target: "overseas",
        commandId: crypto.randomUUID(),
        user: { isAdmin: true },
      }),
    }),
  );
  expect(forged.status).toBe(401);
});

it("refuses a different signed-in account and a foreign browser origin", async () => {
  const { cn, overseas, publish, auth, cnCookie } = await pair();
  const id = await publish(overseas);
  const stranger = await auth.connect(
    await signIn(auth.source.authDurable, "stranger@example.com"),
  );
  const command = (cookie: string, origin: string) =>
    cn.route(
      new Request(ORIGIN + `/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: { cookie, origin, "idempotency-key": crypto.randomUUID() },
      }),
    );
  expect((await command(stranger, ORIGIN)).status).toBe(401);
  expect((await command(cnCookie, "https://foreign.test")).status).toBe(403);
  expect(
    (await (await overseas.call(`/api/gallery/${id}`)).json()).status,
  ).toBe("public");
});

it("binds delegation to the exact command and rejects it after the authority session ends", async () => {
  const { cn, overseas, publish, auth, cookie, cnCookie } = await pair();
  const id = await publish(overseas);
  const command = {
    id,
    action: "recycle",
    commandId: crypto.randomUUID(),
    target: "overseas",
  };
  const authorized = await cn.env
    .AUTH!.getByName("auth")
    .fetch("https://auth/internal/resource-action-authorize", {
      method: "POST",
      headers: { cookie: cnCookie },
      body: JSON.stringify({ binding: await digest(JSON.stringify(command)) }),
    });
  expect(authorized.status).toBe(200);
  const { token } = await authorized.json();
  const deliver = (body: unknown) =>
    overseas.route(
      new Request(ORIGIN + "/api/resource-actions/lifecycle", {
        method: "POST",
        headers: { authorization: "Bearer " + token },
        body: JSON.stringify(body),
      }),
    );
  expect((await deliver({ ...command, action: "restore" })).status).toBe(401);
  await auth.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/logout", {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
    }),
  );
  expect((await deliver(command)).status).toBe(401);
});

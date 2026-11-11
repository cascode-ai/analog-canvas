import { afterEach, expect, it, vi } from "vitest";
import { accounts, transportOrigin } from "./regional-auth.test-support";
import {
  makerOf,
  signIn,
  adminOf,
  ORIGIN,
  sqliteState,
  submissionRequest,
  wiredProjectText,
} from "./gallery.test-support";
import { GalleryDO } from "./index";
import { routeGalleryRequest } from "./gallery";
import { routeResourceSync } from "./resource-sync";
import { routeRegionalResourceActions } from "./regional-resource-actions";
import { digest } from "./regional-auth-contract";

afterEach(() => vi.unstubAllGlobals());

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
    env.GALLERY = {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          store.fetch(new Request(input, init)),
      }),
    };
    const route = async (request: Request): Promise<Response> =>
      (await routeRegionalResourceActions(request, env)) ??
      (await routeResourceSync(request, env)) ??
      (await routeGalleryRequest(request, env))!;
    const call = (path: string, method = "GET", key?: string) =>
      route(
        new Request(ORIGIN + path, {
          method,
          headers: {
            origin: ORIGIN,
            cookie: region === "cn" ? cnCookie : cookie,
            ...(key ? { "idempotency-key": key } : {}),
          },
        }),
      );
    return {
      env,
      get store() {
        return store;
      },
      route,
      call,
      restart: () => {
        store = new GalleryDO(state, env);
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
        url.pathname === "/api/resource-actions/lifecycle" &&
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

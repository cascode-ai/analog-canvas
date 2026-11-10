import { afterEach, expect, it, vi } from "vitest";
import { routeAuthRequest } from "./auth";
import {
  adminOf,
  environment,
  makerOf,
  ORIGIN,
  route,
  saveRequest,
  sqliteState,
} from "./gallery.test-support";
import { GalleryDO } from "./gallery-do";
import { RegionalProjectDO } from "./regional-projects";
import { accounts, config, secret } from "./regional-auth.test-support";
import { sha256Text } from "./agent-session-runtime";
import { RegionalSessionDO } from "./regional-session";

afterEach(() => vi.unstubAllGlobals());

it("revokes access at confirmation and resumes the same deletion after a lost response", async () => {
  const env = environment({
    AUTH_REGIONAL_AUTHORITY: JSON.stringify({
      ...JSON.parse(config),
      accountDeletion: true,
    }),
  });
  const cookie = await makerOf(env);
  const auth = (path: string, init: RequestInit) =>
    routeAuthRequest(new Request(ORIGIN + "/api/auth/" + path, init), {
      AUTH: env.AUTH!,
    });
  const me = async () =>
    (await (await auth("me", { headers: { cookie } }))!.json()).user;
  const original = await me();
  const requestId = crypto.randomUUID();
  const remove = async (session = "") =>
    (await auth("account/delete", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: session },
      body: JSON.stringify({ confirm: "delete-account", requestId }),
    }))!;

  expect((await remove(cookie)).status).toBe(202);
  expect(await me()).toBeNull();
  expect(await (await remove()).json()).toEqual({
    deletion: { requestId, overseas: "pending", cn: "pending" },
  });
  const identities = await auth("regional/identities", {
    method: "POST",
    headers: { authorization: "Bearer " + secret },
    body: JSON.stringify({ userIds: [original.id] }),
  });
  expect(await identities!.json()).toEqual({
    identities: [{ id: original.id, status: "deleted" }],
  });
  const replacementCookie = await makerOf(env);
  const replacement = await auth("me", {
    headers: { cookie: replacementCookie },
  });
  expect((await replacement!.json()).user.id).not.toBe(original.id);
});

it("continues the ordered Project stream across a retired owner's pending save", async () => {
  const authority = JSON.stringify({
    ...JSON.parse(config),
    accountDeletion: true,
  });
  const projectConfig = { PROJECT_REGION: "overseas" as const };
  let gallery: GalleryDO;
  const galleryBinding = {
    getByName: () => ({
      fetch: (url: string, init?: RequestInit) =>
        gallery.fetch(new Request(url, init)),
    }),
  };
  const source = environment({
    AUTH_REGIONAL_AUTHORITY: authority,
    GALLERY: galleryBinding,
  });
  gallery = new GalleryDO(
    source.galleryStoreStates.get("gallery")!,
    projectConfig,
  );
  const retained = await adminOf(source);
  const retiring = await makerOf(source);
  const sourceApi = {
    ...source,
    ...projectConfig,
    GALLERY: galleryBinding,
    PROJECT_SYNC_TOKEN: secret,
  };
  const destination = new RegionalProjectDO(sqliteState(), {
    PROJECT_REGION: "cn",
  });
  const target = {
    ...source,
    PROJECT_REGION: "cn" as const,
    PROJECT_IDENTITY_URL: ORIGIN + "/api/auth/regional/identities",
    PROJECT_IDENTITY_TOKEN: secret,
    PROJECT_SYNC_TOKEN: secret,
    PROJECTS: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          destination.fetch(new Request(url, init)),
      }),
    },
  };
  vi.stubGlobal("fetch", (input: URL | Request | string, init?: RequestInit) =>
    source.authDurable.fetch(new Request(input, init)),
  );
  expect(
    (await route(sourceApi, saveRequest(retiring, "Private to erase"))).status,
  ).toBe(201);
  expect(
    (await route(sourceApi, saveRequest(retained, "Keep this project"))).status,
  ).toBe(201);

  const path = ORIGIN + "/api/project-sync/events";
  const headers = { authorization: "Bearer " + secret };
  const getEvent = async (after: number) =>
    (
      await (
        await route(
          sourceApi,
          new Request(path + "?after=" + after, { headers }),
        )
      ).json()
    ).events[0];
  const pending = await getEvent(0);
  const journalBytes = async () =>
    (
      await (
        await route(
          sourceApi,
          new Request(ORIGIN + "/api/project-sync/status", { headers }),
        )
      ).json()
    ).journalBytes;
  const beforeDeletion = await journalBytes();
  const retiredProject = JSON.parse(pending.payload).id;
  const staleStore = new GalleryDO(sqliteState(), projectConfig);
  const liveStore = gallery;
  gallery = staleStore;
  const staleSave = saveRequest(retiring, "Private to erase");
  staleSave.headers.set("Idempotency-Key", retiredProject);
  expect((await route(sourceApi, staleSave)).status).toBe(201);
  gallery = liveStore;

  const removal = await source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/account/delete", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: retiring },
      body: JSON.stringify({
        confirm: "delete-account",
        requestId: crypto.randomUUID(),
      }),
    }),
  );
  expect(removal.status).toBe(202);
  expect(
    (
      await source.authDurable.fetch(
        new Request("https://auth/internal/account-deletion-tick", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(200);

  const reuse = saveRequest(retained, "Independent save under a retired ID");
  reuse.headers.set("Idempotency-Key", retiredProject);
  expect((await route(sourceApi, reuse)).status).toBe(404);
  const erased = await getEvent(0);
  expect(erased).toMatchObject({
    sequence: pending.sequence,
    eventId: pending.eventId,
    payloadHash: pending.payloadHash,
    payload: "",
  });
  expect(await journalBytes()).toBe(
    beforeDeletion - Buffer.byteLength(pending.payload),
  );
  const apply = (event: unknown) =>
    route(
      target,
      new Request(path, {
        method: "POST",
        headers,
        body: JSON.stringify({ event }),
      }),
    );
  // A delayed response that still contains the erased payload is consumed as a receipt.
  expect((await apply(pending)).status).toBe(200);
  expect((await apply(erased)).status).toBe(200);
  expect((await apply(await getEvent(1))).status).toBe(200);
  const projects = await route(
    target,
    new Request(ORIGIN + "/api/projects", {
      headers: { cookie: retained },
    }),
  );
  expect(await projects.json()).toMatchObject({
    projects: [{ name: "Keep this project" }],
  });

  // The stale store represents resource state restored before this completed job.
  gallery = staleStore;
  const recover = (after: number) =>
    route(
      {
        ...sourceApi,
        PROJECT_SYNC_ADMIN_TOKEN: "isolated-admin",
        PROJECT_IDENTITY_URL: ORIGIN + "/api/auth/regional/identities",
        PROJECT_IDENTITY_TOKEN: secret,
      },
      new Request(ORIGIN + "/api/project-sync/recover-account-deletions", {
        method: "POST",
        headers: { authorization: "Bearer isolated-admin" },
        body: JSON.stringify({ after }),
      }),
    );
  expect(await (await recover(0)).json()).toEqual({
    status: "sent",
    sequence: 1,
  });
  expect((await getEvent(0)).payload).toBe("");
  expect(await (await recover(1)).json()).toEqual({ status: "caught-up" });
});

it("accepts the original confirmation from an overseas account newly covered by copy mode", async () => {
  const source = environment({
    AUTH_REGIONAL_AUTHORITY: JSON.stringify({
      ...JSON.parse(config),
      accountDeletion: true,
    }),
    PROJECT_REGION_USERS: '["existing-trial-account"]',
    PROJECT_SYNC_EXPANSION: "copy",
  });
  const cookie = await makerOf(source);
  const response = await source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/account/delete", {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
      body: JSON.stringify({ confirm: "delete-account" }),
    }),
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    deletion: {
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      overseas: "pending",
      cn: "pending",
    },
  });
});

it("accepts deletion from China and recovers cleanup after Arena failure and a lost receipt", async () => {
  const enabled = JSON.stringify({
    ...JSON.parse(config),
    accountDeletion: true,
  });
  let arenaAvailable = false;
  let arenaCalls = 0;
  // Each region forgets the devices trusted at its own site's origin.
  const trusted = { overseas: new Set<string>(), cn: new Set<string>() };
  const devices = (seen: Set<string>) => ({
    getByName: (name: string) => ({
      fetch: async (input: string | Request, init?: RequestInit) => {
        seen.add(`${init?.method} ${name} ${String(input)}`);
        return Response.json({ devices: [] });
      },
    }),
  });
  const h = accounts(
    {
      AUTH_REGIONAL_AUTHORITY: enabled,
      AGENT_SESSION: devices(trusted.overseas),
      ARENA: {
        fetch: async () => {
          arenaCalls++;
          return new Response(null, { status: arenaAvailable ? 200 : 503 });
        },
      },
    },
    { AUTH_REGIONAL_CLIENT: enabled },
  );
  // The China site serves its own origin. Its deletion ticks run here; the
  // fixture's region, which shares the overseas origin, holds the sign-ins.
  const china = "https://cn.canvas.test";
  const region = new RegionalSessionDO(
    { storage: { ...sqliteState().storage, setAlarm: async () => {} } },
    {
      AUTH_REGIONAL_CLIENT: JSON.stringify({
        ...JSON.parse(enabled),
        clientOrigin: china,
      }),
      AGENT_SESSION: devices(trusted.cn),
    },
  );
  const forward = (async (input, init) =>
    h.source.authDurable.fetch(new Request(input, init))) as typeof fetch;
  region.fetchLike = forward;
  const overseas = await makerOf(h.source);
  const domestic = await h.connect(overseas);
  const other = await h.connect(overseas);
  const { user } = (await (await h.call("/api/auth/me", domestic)).json()) as {
    user: { id: string };
  };
  const requestId = crypto.randomUUID();
  const path = "/api/auth/account/delete";
  const accepted = await h.call(path, domestic, "POST", {
    requestId,
    confirm: "delete-account",
  });
  expect(accepted.status).toBe(202);
  expect(await (await h.call("/api/auth/me", other)).json()).toMatchObject({
    user: null,
  });

  const tick = new Request("https://auth/internal/account-deletion-tick", {
    method: "POST",
  });
  expect((await h.source.authDurable.fetch(tick.clone())).status).toBe(503);
  region.fetchLike = async (input, init) => {
    const response = await forward(input, init);
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith("/deletions") && body.acknowledge)
      throw new Error("response lost after durable acknowledgement");
    return response;
  };
  expect((await region.fetch(tick.clone())).status).toBe(503);
  region.fetchLike = forward;
  expect((await region.fetch(tick.clone())).status).toBe(200);
  arenaAvailable = true;
  expect((await h.source.authDurable.fetch(tick.clone())).status).toBe(200);
  expect(arenaCalls).toBe(2);
  const done = await h.call(path, "", "POST", { requestId, statusOnly: true });
  expect(done.status).toBe(200);
  expect(await done.json()).toEqual({
    deletion: { requestId, overseas: "complete", cn: "complete" },
  });
  const purge = async (site: string) =>
    `DELETE agent-device-trust-${await sha256Text(JSON.stringify([site, user.id]))} https://agent-session.internal/device-trust/all`;
  expect([...trusted.overseas]).toEqual([await purge(ORIGIN)]);
  expect([...trusted.cn]).toEqual([await purge(china)]);
});

it("keeps overseas local deletion available outside the trial cohort", async () => {
  const env = environment({
    AUTH_REGIONAL_AUTHORITY: JSON.stringify({
      ...JSON.parse(config),
      accountDeletion: true,
    }),
    PROJECT_REGION_USERS: '["another-account"]',
  });
  const cookie = await makerOf(env);
  const response = await env.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/account/delete", {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
      body: JSON.stringify({ confirm: "delete-account" }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    deleted: { circuits: 0, likes: 0, projects: 0, components: 0 },
  });
});

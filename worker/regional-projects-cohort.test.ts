import { afterEach, expect, it, vi } from "vitest";
import { GalleryDO } from "./gallery-do";
import { RegionalProjectDO } from "./regional-projects";
import { AI_SEATS } from "./auth";
import {
  adminOf,
  environment,
  makerOf,
  ORIGIN,
  projectText,
  route,
  saveRequest,
  seatOf,
  sqliteState,
  wiredProjectText,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

it("keeps an overseas account outside the trial on its existing save protocol", async () => {
  const source = environment();
  const member = await makerOf(source);
  const outside = await adminOf(source);
  const { user } = await (
    await source.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: member } }),
    )
  ).json();
  const trialProject = (
    await (await route(source, saveRequest(member, "Trial project"))).json()
  ).project;
  const otherProject = (
    await (await route(source, saveRequest(outside, "Outside project"))).json()
  ).project;
  const config = {
    PROJECT_REGION: "overseas" as const,
    PROJECT_REGION_USERS: JSON.stringify([user.id]),
  };
  const store = new GalleryDO(
    source.galleryStoreStates.get("gallery")!,
    config,
  );
  const binding = {
    getByName: () => ({
      fetch: (input: string, init?: RequestInit) =>
        store.fetch(new Request(input, init)),
    }),
  };
  const candidate = {
    ...source,
    ...config,
    GALLERY: binding,
    PROJECT_SYNC_TOKEN: "cohort-peer-secret",
  };
  const save = await route(
    candidate,
    new Request(`${ORIGIN}/api/projects/${otherProject.id}`, {
      method: "PUT",
      headers: { Cookie: outside, Origin: ORIGIN, "If-Match": "revision-1" },
      body: JSON.stringify({
        name: "Outside saved normally",
        projectText: projectText("Outside saved normally"),
      }),
    }),
  );
  expect(save.status).toBe(200);
  expect(await save.json()).toMatchObject({
    project: { id: otherProject.id, revision: 2 },
  });
  const opened = await route(
    candidate,
    new Request(`${ORIGIN}/api/projects/${trialProject.id}`, {
      headers: { Cookie: member },
    }),
  );
  expect(opened.status).toBe(200);
  expect((await opened.json()).project.saveToken).toMatch(/^head-/u);
  const exported = await route(
    candidate,
    new Request(`${ORIGIN}/api/project-sync/events?after=0`, {
      headers: { Authorization: "Bearer cohort-peer-secret" },
    }),
  );
  expect(exported.status).toBe(200);
  const events = (await exported.json()).events;
  expect(events).toHaveLength(1);
  expect(JSON.parse(events[0].payload)).toMatchObject({
    id: trialProject.id,
    ownerUserId: user.id,
  });
});

it.each([true, false])(
  "journals an admitted owner's cleared binding during an outside AI takeover (admitted: %s)",
  async (admitted) => {
    const source = environment();
    const original = await seatOf(source, 0),
      outside = await seatOf(source, 1);
    const saved = (
      await (
        await route(source, saveRequest(original, "Original AI draft"))
      ).json()
    ).project;
    const content = {
      name: "Published AI draft",
      description: "",
      tags: [],
      projectText: wiredProjectText("Publication"),
    };
    const published = await route(
      source,
      new Request(`${ORIGIN}/api/gallery/submissions`, {
        method: "POST",
        headers: { Cookie: original, Origin: ORIGIN },
        body: JSON.stringify({
          ...content,
          cloudProjectId: saved.id,
          expectedGalleryEntryId: null,
        }),
      }),
    );
    expect(published.status).toBe(201);
    const { id } = await published.json();
    const config = {
      PROJECT_REGION: "overseas" as const,
      PROJECT_REGION_USERS: JSON.stringify(
        admitted ? [AI_SEATS[0]!.userId] : [],
      ),
    };
    const store = new GalleryDO(
      source.galleryStoreStates.get("gallery")!,
      config,
    );
    const binding = {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          store.fetch(new Request(url, init)),
      }),
    };
    const target = {
      ...source,
      ...config,
      GALLERY: binding,
      PROJECTS: binding,
      PROJECTS_STORE_NAME: "gallery" as const,
      PROJECT_SYNC_TOKEN: "takeover-peer",
    };
    const open = async () =>
      (
        await (
          await route(
            target,
            new Request(`${ORIGIN}/api/projects/${saved.id}`, {
              headers: { Cookie: original },
            }),
          )
        ).json()
      ).project;
    const before = await open();
    const takeover = await route(
      target,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: { Cookie: outside, Origin: ORIGIN },
        body: JSON.stringify({ ...content, takeOver: true }),
      }),
    );
    expect(takeover.status, await takeover.clone().text()).toBe(200);
    const after = await open();
    expect(after.galleryEntryId).toBeNull();
    expect(after.projectText).toBe(before.projectText);
    if (admitted) {
      expect(after.saveToken).not.toBe(before.saveToken);
      const exported = await route(
        target,
        new Request(`${ORIGIN}/api/project-sync/events?after=1`, {
          headers: { Authorization: "Bearer takeover-peer" },
        }),
      );
      expect(exported.status).toBe(200);
      expect(
        JSON.parse((await exported.json()).events[0].payload),
      ).toMatchObject({
        id: saved.id,
        ownerUserId: AI_SEATS[0]!.userId,
        project: { gallery_entry_id: null },
      });
    }
  },
);

it("refuses domestic Project access outside admission instead of creating unsynchronized saves", async () => {
  const source = environment();
  const cookie = await makerOf(source);
  const config = { PROJECT_REGION: "cn" as const, PROJECT_REGION_USERS: "[]" };
  const store = new RegionalProjectDO(sqliteState(), config);
  const target = {
    ...source,
    ...config,
    PROJECTS: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          store.fetch(new Request(url, init)),
      }),
    },
  };
  for (const request of [
    new Request(`${ORIGIN}/api/projects`, { headers: { Cookie: cookie } }),
    saveRequest(cookie, "Not admitted"),
  ]) {
    const response = await route(target, request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "owner-not-admitted" });
  }
});

it("preserves publication and deletion for overseas accounts outside the cohort", async () => {
  let gallery: GalleryDO | undefined;
  const binding = {
    getByName: () => ({
      fetch: (url: string, init?: RequestInit) =>
        gallery!.fetch(new Request(url, init)),
    }),
  };
  const source = environment({ GALLERY: binding });
  const outside = await makerOf(source);
  const saved = (
    await (await route(source, saveRequest(outside, "Unrelated draft"))).json()
  ).project;
  const config = {
    PROJECT_REGION: "overseas" as const,
    PROJECT_REGION_USERS: JSON.stringify(["designated-other-user"]),
  };
  gallery = new GalleryDO(source.galleryStoreStates.get("gallery")!, config);
  const candidate = {
    ...source,
    ...config,
    GALLERY: binding,
    PROJECTS: binding,
    PROJECTS_STORE_NAME: "gallery" as const,
  };
  const published = await route(
    candidate,
    new Request(`${ORIGIN}/api/gallery/submissions`, {
      method: "POST",
      headers: { Cookie: outside, Origin: ORIGIN },
      body: JSON.stringify({
        name: "Unrelated publication",
        description: "",
        tags: [],
        projectText: wiredProjectText("Publication"),
        cloudProjectId: saved.id,
        expectedGalleryEntryId: null,
      }),
    }),
  );
  expect(published.status, await published.clone().text()).toBe(201);
  const { id } = await published.json();
  const opened = await route(
    candidate,
    new Request(`${ORIGIN}/api/projects/${saved.id}`, {
      headers: { Cookie: outside },
    }),
  );
  expect((await opened.json()).project.galleryEntryId).toBe(id);
  const deleted = await source.authDurable.fetch(
    new Request(`${ORIGIN}/api/auth/account/delete`, {
      method: "POST",
      headers: { Cookie: outside, Origin: ORIGIN },
      body: JSON.stringify({ confirm: "delete-account" }),
    }),
  );
  expect(deleted.status, await deleted.clone().text()).toBe(200);
  expect((await deleted.json()).deleted).toMatchObject({
    projects: 1,
    circuits: 1,
  });
});

it("refuses quota and replica imports for an owner outside the trial", async () => {
  const source = environment();
  const outside = await adminOf(source);
  const { user } = await (
    await source.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: outside } }),
    )
  ).json();
  const bind = (store: RegionalProjectDO) => ({
    getByName: () => ({
      fetch: (url: string, init?: RequestInit) =>
        store.fetch(new Request(url, init)),
    }),
  });
  const donor = {
    ...source,
    PROJECTS: bind(
      new RegionalProjectDO(sqliteState(), { PROJECT_REGION: "overseas" }),
    ),
    PROJECT_SYNC_TOKEN: "donor-secret",
  };
  expect(
    (await route(donor, saveRequest(outside, "Not admitted"))).status,
  ).toBe(201);
  const exported = await route(
    donor,
    new Request(`${ORIGIN}/api/project-sync/events?after=0`, {
      headers: { Authorization: "Bearer donor-secret" },
    }),
  );
  const event = (await exported.json()).events[0];
  vi.stubGlobal("fetch", async () =>
    Response.json({ identities: [{ id: user.id, status: "found", user }] }),
  );
  for (const [region, path, body] of [
    ["overseas", "quota", { id: crypto.randomUUID(), ownerUserId: user.id }],
    ["cn", "events", { event }],
  ] as const) {
    const config = {
      PROJECT_REGION: region,
      PROJECT_REGION_USERS: JSON.stringify(["designated-other-user"]),
    };
    const target = {
      ...source,
      ...config,
      PROJECTS: bind(new RegionalProjectDO(sqliteState(), config)),
      PROJECT_SYNC_TOKEN: "target-secret",
      PROJECT_IDENTITY_URL: `${ORIGIN}/api/auth/regional/identities`,
      PROJECT_IDENTITY_TOKEN: "identity-secret",
    };
    const response = await route(
      target,
      new Request(`${ORIGIN}/api/project-sync/${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer target-secret" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status, path).toBe(403);
    expect(await response.json()).toEqual({ error: "owner-not-admitted" });
  }
});

it("seeds only admitted owners while retaining other overseas Projects locally", async () => {
  const source = environment();
  const member = await makerOf(source);
  const outside = await adminOf(source);
  const { user } = await (
    await source.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: member } }),
    )
  ).json();
  const included = (
    await (await route(source, saveRequest(member, "Admitted"))).json()
  ).project;
  const excluded = (
    await (await route(source, saveRequest(outside, "Unrelated"))).json()
  ).project;
  const config = {
    PROJECT_REGION: "overseas" as const,
    PROJECT_REGION_USERS: JSON.stringify([user.id]),
  };
  const store = new GalleryDO(
    source.galleryStoreStates.get("gallery")!,
    config,
  );
  const binding = {
    getByName: () => ({
      fetch: (url: string, init?: RequestInit) =>
        store.fetch(new Request(url, init)),
    }),
  };
  const candidate = {
    ...source,
    ...config,
    GALLERY: binding,
    PROJECTS: binding,
    PROJECTS_STORE_NAME: "gallery" as const,
    PROJECT_SYNC_TOKEN: "cohort-peer-secret",
    PROJECT_SYNC_ADMIN_TOKEN: "cohort-admin-secret",
  };
  const seed = () =>
    route(
      candidate,
      new Request(`${ORIGIN}/api/project-sync/seed`, {
        method: "POST",
        headers: { Authorization: "Bearer cohort-admin-secret" },
      }),
    );
  expect(await (await seed()).json()).toEqual({ seeded: 1, remaining: 0 });
  expect(await (await seed()).json()).toEqual({ seeded: 0, remaining: 0 });
  const exported = await route(
    candidate,
    new Request(`${ORIGIN}/api/project-sync/events?after=0`, {
      headers: { Authorization: "Bearer cohort-peer-secret" },
    }),
  );
  expect(JSON.parse((await exported.json()).events[0].payload)).toMatchObject({
    id: included.id,
    ownerUserId: user.id,
  });
  const tail = await route(
    candidate,
    new Request(`${ORIGIN}/api/project-sync/events?after=1`, {
      headers: { Authorization: "Bearer cohort-peer-secret" },
    }),
  );
  expect((await tail.json()).events).toEqual([]);
  const legacy = await route(
    candidate,
    new Request(`${ORIGIN}/api/projects/${excluded.id}`, {
      headers: { Cookie: outside },
    }),
  );
  expect((await legacy.json()).project).toMatchObject({
    id: excluded.id,
    revision: 1,
  });
});

it("copies the all-account baseline and legacy edits without broadening trial access", async () => {
  const source = environment();
  const outside = await makerOf(source);
  const { user } = await (
    await source.authDurable.fetch(
      new Request(ORIGIN + "/api/auth/me", {
        headers: { cookie: outside },
      }),
    )
  ).json();
  const saved = await route(
    source,
    saveRequest(outside, "Historical baseline"),
  );
  const original = (await saved.json()).project;
  const config = {
    PROJECT_REGION: "overseas" as const,
    PROJECT_REGION_USERS: '["trial-account"]',
    PROJECT_SYNC_EXPANSION: "copy",
    PROJECT_SYNC_TOKEN: "isolated-peer",
    PROJECT_SYNC_ADMIN_TOKEN: "isolated-admin",
  };
  const gallery = new GalleryDO(
    source.galleryStoreStates.get("gallery")!,
    config,
  );
  const bind = (store: { fetch(request: Request): Promise<Response> }) => ({
    getByName: () => ({
      fetch: (url: string, init?: RequestInit) =>
        store.fetch(new Request(url, init)),
    }),
  });
  const capture = { ...source, ...config, GALLERY: bind(gallery) };
  const cnConfig = { ...config, PROJECT_REGION: "cn" as const };
  const domesticGallery = bind(new GalleryDO(sqliteState(), cnConfig));
  const cn = {
    ...source,
    ...cnConfig,
    GALLERY: domesticGallery,
    PROJECTS: domesticGallery,
    PROJECTS_STORE_NAME: "gallery" as const,
    PROJECT_IDENTITY_URL: ORIGIN + "/isolated/identities",
    PROJECT_IDENTITY_TOKEN: "isolated-identity",
  };
  vi.stubGlobal("fetch", async () =>
    Response.json({
      identities: [{ id: user.id, status: "found", user }],
    }),
  );
  const seed = () =>
    route(
      capture,
      new Request(ORIGIN + "/api/project-sync/seed", {
        method: "POST",
        headers: { authorization: "Bearer isolated-admin" },
      }),
    );
  expect(await (await seed()).json()).toEqual({ seeded: 1, remaining: 0 });
  const exportEvent = async (after: number) =>
    (
      await (
        await route(
          capture,
          new Request(ORIGIN + "/api/project-sync/events?after=" + after, {
            headers: { authorization: "Bearer isolated-peer" },
          }),
        )
      ).json()
    ).events[0];
  const receive = (event: unknown) =>
    route(
      cn,
      new Request(ORIGIN + "/api/project-sync/events", {
        method: "POST",
        headers: { authorization: "Bearer isolated-peer" },
        body: JSON.stringify({ event }),
      }),
    );
  const first = await exportEvent(0);
  expect(JSON.parse(first.payload)).toMatchObject({
    id: original.id,
    ownerUserId: user.id,
    project: { name: "Historical baseline", revision: 1 },
  });
  expect((await receive(first)).status).toBe(200);
  const open = (env: Parameters<typeof route>[0]) =>
    route(
      env,
      new Request(ORIGIN + "/api/projects/" + original.id, {
        headers: { cookie: outside },
      }),
    );
  expect((await open(cn)).status).toBe(403);
  const publication = await route(
    cn,
    new Request(ORIGIN + "/api/gallery/submissions", {
      method: "POST",
      headers: { cookie: outside, origin: ORIGIN },
      body: JSON.stringify({
        name: "Copied Project",
        description: "",
        tags: [],
        projectText: wiredProjectText("Publication"),
        cloudProjectId: original.id,
        expectedGalleryEntryId: null,
      }),
    }),
  );
  expect(publication.status).toBe(403);
  expect((await publication.json()).error).toBe("owner-not-admitted");

  const updated = await route(
    capture,
    new Request(ORIGIN + "/api/projects/" + original.id, {
      method: "PUT",
      headers: { cookie: outside, origin: ORIGIN, "if-match": "revision-1" },
      body: JSON.stringify({
        name: "Edit during capture",
        projectText: projectText("Edit during capture"),
      }),
    }),
  );
  expect(updated.status).toBe(200);
  expect((await updated.json()).project).not.toHaveProperty("saveToken");
  expect(await (await seed()).json()).toEqual({ seeded: 1, remaining: 0 });
  const second = await exportEvent(1);
  expect(JSON.parse(second.payload)).toMatchObject({
    id: original.id,
    parents: [first.eventId],
    project: { name: "Edit during capture", revision: 2 },
    versions: [{ revision: 1 }],
  });
  expect((await receive(second)).status).toBe(200);
  expect(await (await seed()).json()).toEqual({ seeded: 0, remaining: 0 });
  const removed = await route(
    capture,
    new Request(ORIGIN + "/api/projects/" + original.id, {
      method: "DELETE",
      headers: { cookie: outside, origin: ORIGIN },
    }),
  );
  expect(removed.status).toBe(200);
  expect(await (await seed()).json()).toEqual({ seeded: 1, remaining: 0 });
  const third = await exportEvent(2);
  expect(JSON.parse(third.payload)).toMatchObject({
    id: original.id,
    project: null,
    parents: [second.eventId],
  });
  expect((await receive(third)).status).toBe(200);
});

it("drains a persisted edit on promotion and accepts an old overseas tab until a remote edit", async () => {
  const source = environment();
  const cookie = await makerOf(source);
  const { user } = await (
    await source.authDurable.fetch(
      new Request(ORIGIN + "/api/auth/me", {
        headers: { cookie },
      }),
    )
  ).json();
  const original = (
    await (await route(source, saveRequest(cookie, "Open tab"))).json()
  ).project;
  const config = {
    PROJECT_REGION: "overseas" as const,
    PROJECT_REGION_USERS: '["trial-account"]',
    PROJECT_SYNC_EXPANSION: "copy",
    PROJECT_SYNC_ADMIN_TOKEN: "isolated-admin",
    PROJECT_SYNC_TOKEN: "isolated-peer",
    PROJECT_IDENTITY_URL: ORIGIN + "/isolated/identities",
    PROJECT_IDENTITY_TOKEN: "isolated-identity",
  };
  const sourceState = source.galleryStoreStates.get("gallery")!;
  const domesticState = sqliteState();
  const bind = (target: { fetch(request: Request): Promise<Response> }) => ({
    getByName: () => ({
      fetch: (url: string, init?: RequestInit) =>
        target.fetch(new Request(url, init)),
    }),
  });
  const overseas = {
    ...source,
    ...config,
    GALLERY: bind(new GalleryDO(sourceState, config)),
  };
  const domesticConfig = { ...config, PROJECT_REGION: "cn" as const };
  const domestic = {
    ...source,
    ...domesticConfig,
    PROJECTS: bind(new RegionalProjectDO(domesticState, domesticConfig)),
  };
  vi.stubGlobal("fetch", async () =>
    Response.json({
      identities: [{ id: user.id, status: "found", user }],
    }),
  );
  const save = (
    env: Parameters<typeof route>[0],
    match: string,
    name: string,
  ) =>
    route(
      env,
      new Request(ORIGIN + "/api/projects/" + original.id, {
        method: "PUT",
        headers: { cookie, origin: ORIGIN, "if-match": match },
        body: JSON.stringify({ name, projectText: projectText(name) }),
      }),
    );
  const readEvent = async (env: Parameters<typeof route>[0], after: number) =>
    (
      await (
        await route(
          env,
          new Request(ORIGIN + "/api/project-sync/events?after=" + after, {
            headers: { authorization: "Bearer isolated-peer" },
          }),
        )
      ).json()
    ).events[0];
  const receive = (env: Parameters<typeof route>[0], event: unknown) =>
    route(
      env,
      new Request(ORIGIN + "/api/project-sync/events", {
        method: "POST",
        headers: { authorization: "Bearer isolated-peer" },
        body: JSON.stringify({ event }),
      }),
    );

  const seed = await route(
    overseas,
    new Request(ORIGIN + "/api/project-sync/seed", {
      method: "POST",
      headers: { authorization: "Bearer isolated-admin" },
    }),
  );
  expect(await seed.json()).toEqual({ seeded: 1, remaining: 0 });
  const first = await readEvent(overseas, 0);
  expect((await receive(domestic, first)).status).toBe(200);
  expect(
    (await save(overseas, "revision-1", "Edit after last seed")).status,
  ).toBe(200);

  const fullSource = { ...config, PROJECT_SYNC_EXPANSION: "all" };
  const fullDomestic = { ...domesticConfig, PROJECT_SYNC_EXPANSION: "all" };
  Object.assign(overseas, fullSource, {
    GALLERY: bind(new GalleryDO(sourceState, fullSource)),
  });
  Object.assign(domestic, fullDomestic, {
    PROJECTS: bind(new RegionalProjectDO(domesticState, fullDomestic)),
  });
  const status = async (env: Parameters<typeof route>[0]) =>
    (
      await route(
        env,
        new Request(ORIGIN + "/api/project-sync/status", {
          headers: { authorization: "Bearer isolated-peer" },
        }),
      )
    ).json();
  const reconcile = async (
    here: Parameters<typeof route>[0],
    peer: Parameters<typeof route>[0],
  ) =>
    route(
      here,
      new Request(ORIGIN + "/api/project-sync/pull", {
        method: "POST",
        headers: { authorization: "Bearer isolated-peer" },
        body: JSON.stringify({ status: await status(peer) }),
      }),
    );
  expect((await reconcile(overseas, domestic)).status).toBe(200);
  expect((await reconcile(domestic, overseas)).status).toBe(200);
  expect(await status(overseas)).toMatchObject({
    epoch: first.epoch,
    sequence: 1,
    acknowledged: 1,
    journalBytes: Buffer.byteLength(first.payload),
  });
  expect((await receive(overseas, first)).status).toBe(409);
  const outsider = await adminOf(source);
  const url = ORIGIN + "/api/projects/" + original.id;
  expect(
    (await route(overseas, new Request(url, { headers: { cookie: outsider } })))
      .status,
  ).toBe(404);
  expect((await status(overseas)).sequence).toBe(1);
  const history = await route(
    overseas,
    new Request(url + "/versions", { headers: { cookie } }),
  );
  const { versions } = await history.json();
  expect(versions).toMatchObject([{ versionNo: 1 }]);
  const restored = await route(
    overseas,
    new Request(
      url +
        "/versions/" +
        encodeURIComponent(versions[0].versionId) +
        "/restore",
      {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "if-match": "revision-2" },
      },
    ),
  );
  expect(restored.status).toBe(200);
  const { project } = await restored.json();
  expect(project).toMatchObject({
    name: "Open tab",
    revision: 3,
    saveToken: expect.stringMatching(/^head-/u),
  });
  expect((await receive(domestic, await readEvent(overseas, 1))).status).toBe(
    200,
  );
  expect((await receive(domestic, await readEvent(overseas, 2))).status).toBe(
    200,
  );
  expect(
    (await save(domestic, project.saveToken, "Domestic edit")).status,
  ).toBe(200);
  expect((await receive(overseas, await readEvent(domestic, 0))).status).toBe(
    200,
  );
  expect(
    (await save(overseas, "revision-4", "Stale overseas tab")).status,
  ).toBe(409);
});

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
    PROJECTS: binding,
    PROJECTS_STORE_NAME: "gallery" as const,
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
  "protects a publication's affected Project owner during an outside AI takeover (admitted: %s)",
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
    expect(takeover.status, await takeover.clone().text()).toBe(
      admitted ? 409 : 200,
    );
    if (admitted) expect(await open()).toEqual(before);
    else expect((await open()).galleryEntryId).toBeNull();
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

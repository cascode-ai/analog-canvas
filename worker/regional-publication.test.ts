import { afterEach, expect, it, vi } from "vitest";
import { GalleryDO } from "./gallery-do";
import {
  environment,
  makerOf,
  ORIGIN,
  route,
  saveRequest,
  sqliteState,
  wiredProjectText,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

async function publicationTrial(maxBytes?: number) {
  const secret = "publication-test-identity-secret";
  const auth = environment({
    AUTH_REGIONAL_AUTHORITY: JSON.stringify({
      origin: ORIGIN,
      clientOrigin: "https://cn.test",
      secret,
    }),
  });
  const cookie = await makerOf(auth);
  const { user } = await (
    await auth.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } }),
    )
  ).json();
  const make = (region: "overseas" | "cn") => {
    const config = {
      PROJECT_REGION: region,
      PROJECT_REGION_USERS: JSON.stringify([user.id]),
      ...(maxBytes === undefined ? {} : { PROJECT_SYNC_MAX_BYTES: maxBytes }),
    };
    const store = new GalleryDO(sqliteState(), config);
    const binding = {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          store.fetch(new Request(url, init)),
      }),
    };
    return {
      ...auth,
      ...config,
      GALLERY: binding,
      PROJECTS: binding,
      PROJECTS_STORE_NAME: "gallery" as const,
      PROJECT_SYNC_TOKEN: "publication-peer",
      PROJECT_SYNC_PEER_URL: ORIGIN,
      PROJECT_SYNC_PEER_TOKEN: "publication-peer",
      PROJECT_IDENTITY_URL: `${ORIGIN}/api/auth/regional/identities`,
      PROJECT_IDENTITY_TOKEN: secret,
    };
  };
  const source = make("overseas"),
    domestic = make("cn");
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).pathname.startsWith("/api/auth/")
      ? auth.authDurable.fetch(request)
      : route(source, request);
  });
  const request = (path: string, method = "GET", body?: unknown) =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const open = async (env: typeof source, id: string) => {
    const response = await route(env, request(`/api/projects/${id}`));
    expect(response.status).toBe(200);
    return (await response.json()).project;
  };
  const events = async (env = source, after = 0) => {
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/project-sync/events?after=${after}`, {
        headers: { Authorization: "Bearer publication-peer" },
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()).events as unknown[];
  };
  const copy = async (from = source, to = domestic) => {
    for (let after = 0; after < 30; after += 1) {
      const batch = await events(from, after);
      if (!batch.length) return;
      const event = batch[0];
      const response = await route(
        to,
        new Request(`${ORIGIN}/api/project-sync/events`, {
          method: "POST",
          headers: { Authorization: "Bearer publication-peer" },
          body: JSON.stringify({ event }),
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
    }
    throw new Error("Unexpected unbounded test journal");
  };
  const create = async (name: string) => {
    const response = await route(source, saveRequest(cookie, name));
    expect(response.status).toBe(201);
    return (await response.json()).project;
  };
  const content = {
    name: "Published regional draft",
    description: "",
    tags: [],
    projectText: wiredProjectText("Publication"),
  };
  return { source, domestic, request, open, events, copy, create, content };
}

it("publishes a regional draft and replicates its binding without changing the saved drawing", async () => {
  const trial = await publicationTrial();
  const saved = await trial.create("Private original");
  const before = await trial.open(trial.source, saved.id);
  const published = await route(
    trial.source,
    trial.request("/api/gallery/submissions", "POST", {
      ...trial.content,
      cloudProjectId: saved.id,
      expectedGalleryEntryId: null,
    }),
  );
  expect(published.status, await published.clone().text()).toBe(201);
  const { id } = await published.json();
  await trial.copy();
  for (const env of [trial.source, trial.domestic]) {
    const current = await trial.open(env, saved.id);
    expect(current).toMatchObject({
      galleryEntryId: id,
      projectText: before.projectText,
      revision: before.revision,
    });
    expect(current.saveToken).not.toBe(before.saveToken);
  }
});

it("saves an owned Gallery entry as a regional Cloud Project with its binding", async () => {
  const trial = await publicationTrial();
  const published = await route(
    trial.source,
    trial.request("/api/gallery/submissions", "POST", trial.content),
  );
  expect(published.status).toBe(201);
  const { id } = await published.json();
  const saved = await route(
    trial.source,
    trial.request("/api/projects", "POST", {
      name: "Draft from publication",
      projectText: trial.content.projectText,
      galleryEntryId: id,
    }),
  );
  expect(saved.status, await saved.clone().text()).toBe(201);
  const { project } = await saved.json();
  await trial.copy();
  expect(await trial.open(trial.domestic, project.id)).toMatchObject({
    galleryEntryId: id,
    name: "Draft from publication",
  });
});

it("replicates both sides of a publication source change and refuses a stale retry", async () => {
  const trial = await publicationTrial();
  const first = await trial.create("First private draft");
  const second = await trial.create("Second private draft");
  const published = await route(
    trial.source,
    trial.request("/api/gallery/submissions", "POST", {
      ...trial.content,
      cloudProjectId: first.id,
      expectedGalleryEntryId: null,
    }),
  );
  expect(published.status).toBe(201);
  const { id } = await published.json();
  const update = () =>
    route(
      trial.source,
      trial.request(`/api/gallery/${id}`, "PUT", {
        ...trial.content,
        cloudProjectId: second.id,
        expectedGalleryEntryId: null,
      }),
    );
  expect((await update()).status).toBe(200);
  await trial.copy();
  await trial.copy(); // Replaying acknowledged events cannot restore the old binding.
  for (const env of [trial.source, trial.domestic]) {
    expect((await trial.open(env, first.id)).galleryEntryId).toBeNull();
    expect((await trial.open(env, second.id)).galleryEntryId).toBe(id);
  }
  expect((await update()).status).toBe(409);
});

it("rolls back the publication and binding when its synchronization journal is full", async () => {
  const trial = await publicationTrial(4000);
  const saved = await trial.create("Original");
  const before = await trial.open(trial.source, saved.id);
  const eventsBefore = await trial.events();
  const published = await route(
    trial.source,
    trial.request("/api/gallery/submissions", "POST", {
      ...trial.content,
      cloudProjectId: saved.id,
      expectedGalleryEntryId: null,
    }),
  );
  expect(published.status, await published.clone().text()).toBe(507);
  expect(await trial.open(trial.source, saved.id)).toEqual(before);
  expect(await trial.events()).toEqual(eventsBefore);
  const listing = await route(trial.source, trial.request("/api/gallery"));
  expect(listing.status).toBe(200);
  expect((await listing.json()).entries).toEqual([]);
});

it("refuses publication through unresolved concurrent Project heads", async () => {
  const trial = await publicationTrial();
  const saved = await trial.create("Shared base");
  await trial.copy();
  for (const [env, name] of [
    [trial.source, "Overseas edit"],
    [trial.domestic, "Domestic edit"],
  ] as const) {
    const current = await trial.open(env, saved.id);
    const request = trial.request(`/api/projects/${saved.id}`, "PUT", {
      name,
      projectText: trial.content.projectText,
    });
    request.headers.set("If-Match", current.saveToken);
    expect((await route(env, request)).status).toBe(200);
  }
  await trial.copy(trial.domestic, trial.source);
  const conflicts = () =>
    route(trial.source, trial.request(`/api/projects/${saved.id}`));
  const before = await (await conflicts()).json();
  expect(before.conflicts).toHaveLength(2);
  const published = await route(
    trial.source,
    trial.request("/api/gallery/submissions", "POST", {
      ...trial.content,
      cloudProjectId: saved.id,
      expectedGalleryEntryId: null,
    }),
  );
  expect(published.status).toBe(409);
  expect(await (await conflicts()).json()).toEqual(before);
});

it("does not spend the owner's quota on definitely refused Gallery links", async () => {
  const trial = await publicationTrial();
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const request = trial.request("/api/projects", "POST", {
      name: "Rejected link",
      projectText: trial.content.projectText,
      galleryEntryId: "missing-entry",
    });
    request.headers.set("Idempotency-Key", `refused-${attempt}`);
    expect((await route(trial.source, request)).status).toBe(403);
  }
  expect((await trial.create("Still has capacity")).name).toBe(
    "Still has capacity",
  );
});

it.each([false, true])(
  "requires the original Gallery creation intent on retries in either region (already bound: %s)",
  async (bound) => {
    const trial = await publicationTrial();
    const draft = bound ? await trial.create("Existing source") : null;
    const published = await route(
      trial.source,
      trial.request("/api/gallery/submissions", "POST", {
        ...trial.content,
        ...(draft
          ? { cloudProjectId: draft.id, expectedGalleryEntryId: null }
          : {}),
      }),
    );
    expect(published.status).toBe(201);
    const { id } = await published.json();
    const save = (env: typeof trial.source, galleryEntryId: string) => {
      const request = trial.request("/api/projects", "POST", {
        name: "Idempotent draft",
        projectText: trial.content.projectText,
        galleryEntryId,
      });
      request.headers.set("Idempotency-Key", "publication-create-intent");
      return route(env, request);
    };
    expect((await save(trial.source, id)).status).toBe(201);
    const changed = await save(trial.source, "different-entry");
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: "create-key-reused" });
    expect((await save(trial.source, id)).status).toBe(200);
    await trial.copy();
    expect((await save(trial.domestic, "different-entry")).status).toBe(409);
    expect((await save(trial.domestic, id)).status).toBe(200);
  },
);

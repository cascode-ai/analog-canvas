import { afterEach, expect, it, vi } from "vitest";
import { GalleryDO } from "./gallery-do";
import {
  environment,
  adminOf,
  makerOf,
  ORIGIN,
  projectText,
  route,
  saveRequest,
  sqliteState,
  wiredProjectText,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

async function trial(protectDomestic = true, protection?: string) {
  const secret = "isolated-protected-project-identity-secret";
  const auth = environment({
    AUTH_REGIONAL_AUTHORITY: JSON.stringify({
      origin: ORIGIN,
      clientOrigin: "https://cn.test",
      secret,
    }),
  });
  const cookie = await makerOf(auth);
  const original = (
    await (await route(auth, saveRequest(cookie, "Historical original"))).json()
  ).project;
  const protectedIds = protection ?? JSON.stringify([original.id]);
  const sourceStore = new GalleryDO(auth.galleryStoreStates.get("gallery")!, {
    PROJECT_REGION: "overseas",
    PROJECT_PROTECTED_IDS: protectedIds,
  });
  const domesticStore = new GalleryDO(sqliteState(), {
    PROJECT_REGION: "cn",
    ...(protectDomestic ? { PROJECT_PROTECTED_IDS: protectedIds } : {}),
  });
  const bind = (store: GalleryDO) => ({
    getByName: () => ({
      fetch: (url: string, init?: RequestInit) =>
        store.fetch(new Request(url, init)),
    }),
  });
  const common = {
    ...auth,
    PROJECT_SYNC_TOKEN: "test-peer",
    PROJECT_IDENTITY_URL: `${ORIGIN}/api/auth/regional/identities`,
    PROJECT_IDENTITY_TOKEN: secret,
  };
  const source = {
    ...common,
    PROJECT_REGION: "overseas" as const,
    GALLERY: bind(sourceStore),
  };
  const domestic = {
    ...common,
    PROJECTS: bind(domesticStore),
    GALLERY: bind(domesticStore),
  };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    auth.authDurable.fetch(new Request(input, init)),
  );
  const open = async (env: typeof common, id = original.id) =>
    (
      await (
        await route(
          env,
          new Request(`${ORIGIN}/api/projects/${id}`, {
            headers: { Cookie: cookie },
          }),
        )
      ).json()
    ).project;
  const events = async (env: typeof common, after = 0) =>
    (
      await (
        await route(
          env,
          new Request(`${ORIGIN}/api/project-sync/events?after=${after}`, {
            headers: { Authorization: "Bearer test-peer" },
          }),
        )
      ).json()
    ).events;
  const deliver = (env: typeof common, event: unknown) =>
    route(
      env,
      new Request(`${ORIGIN}/api/project-sync/events`, {
        method: "POST",
        headers: { Authorization: "Bearer test-peer" },
        body: JSON.stringify({ event }),
      }),
    );
  const update = (env: typeof common, id: string, token: string) =>
    route(
      env,
      new Request(`${ORIGIN}/api/projects/${id}`, {
        method: "PUT",
        headers: { Cookie: cookie, Origin: ORIGIN, "If-Match": token },
        body: JSON.stringify({
          name: "Changed",
          projectText: projectText("Changed"),
        }),
      }),
    );
  return {
    cookie,
    source,
    domestic,
    original,
    open,
    events,
    deliver,
    update,
    auth,
  };
}

it("copies an existing Project read-only into China while its overseas owner can still save", async () => {
  const t = await trial();
  const before = await t.open(t.source);
  expect(
    (await t.deliver(t.domestic, (await t.events(t.source))[0])).status,
  ).toBe(200);
  const copy = await t.open(t.domestic);
  expect(copy.projectText).toBe(before.projectText);
  expect((await t.update(t.domestic, copy.id, copy.saveToken)).status).toBe(
    403,
  );
  expect(
    (
      await route(
        t.domestic,
        new Request(`${ORIGIN}/api/projects/${copy.id}`, {
          method: "DELETE",
          headers: { Cookie: t.cookie, Origin: ORIGIN },
        }),
      )
    ).status,
  ).toBe(403);
  expect((await t.open(t.source)).projectText).toBe(before.projectText);
  expect((await t.update(t.source, before.id, before.saveToken)).status).toBe(
    200,
  );
});

it("keeps a protected Project hidden from another account", async () => {
  const t = await trial();
  await t.open(t.source);
  expect(
    (await t.deliver(t.domestic, (await t.events(t.source))[0])).status,
  ).toBe(200);
  const other = await adminOf(t.auth);
  const response = await route(
    t.domestic,
    new Request(`${ORIGIN}/api/projects/${t.original.id}`, {
      method: "DELETE",
      headers: { Cookie: other, Origin: ORIGIN },
    }),
  );
  expect(response.status).toBe(404);
});

it.each([
  "invalid-json",
  "{}",
  '["bad id"]',
  JSON.stringify(Array(1001).fill("project")),
])(
  "refuses invalid protection configuration instead of accepting unsafe writes (%#)",
  async (protection) => {
    const t = await trial(true, protection);
    const result = await route(
      t.domestic,
      new Request(`${ORIGIN}/api/projects`, { headers: { Cookie: t.cookie } }),
    );
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: "region-not-configured",
    });
  },
);

it("refuses publication that would change a protected domestic Project's binding", async () => {
  const t = await trial();
  await t.open(t.source);
  expect(
    (await t.deliver(t.domestic, (await t.events(t.source))[0])).status,
  ).toBe(200);
  const response = await route(
    t.domestic,
    new Request(`${ORIGIN}/api/gallery/submissions`, {
      method: "POST",
      headers: { Cookie: t.cookie, Origin: ORIGIN },
      body: JSON.stringify({
        name: "Protected publication",
        description: "",
        tags: [],
        projectText: wiredProjectText("Protected publication"),
        cloudProjectId: t.original.id,
        expectedGalleryEntryId: null,
      }),
    }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "protected-project" });
  expect((await t.open(t.domestic)).galleryEntryId).toBeNull();
});

it.each(["update", "delete"])(
  "refuses an old domestic client's %s event for an overseas original",
  async (operation) => {
    const t = await trial(false);
    const before = await t.open(t.source);
    expect(
      (await t.deliver(t.domestic, (await t.events(t.source))[0])).status,
    ).toBe(200);
    const copy = await t.open(t.domestic);
    const mutated =
      operation === "update"
        ? await t.update(t.domestic, copy.id, copy.saveToken)
        : await route(
            t.domestic,
            new Request(`${ORIGIN}/api/projects/${copy.id}`, {
              method: "DELETE",
              headers: { Cookie: t.cookie, Origin: ORIGIN },
            }),
          );
    expect(mutated.ok).toBe(true);
    const result = await t.deliver(t.source, (await t.events(t.domestic))[0]);
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ error: "protected-project" });
    expect((await t.open(t.source)).projectText).toBe(before.projectText);
  },
);

it("allows a separate new Project to sync saves and deletion without changing the historical original", async () => {
  const t = await trial();
  const original = await t.open(t.source);
  expect(
    (await t.deliver(t.domestic, (await t.events(t.source))[0])).status,
  ).toBe(200);
  const created = await route(
    t.source,
    saveRequest(t.cookie, "Acceptance-only new Project"),
  );
  expect(created.status).toBe(201);
  const id = (await created.json()).project.id;
  expect(
    (await t.deliver(t.domestic, (await t.events(t.source, 1))[0])).status,
  ).toBe(200);
  const copy = await t.open(t.domestic, id);
  expect((await t.update(t.domestic, id, copy.saveToken)).status).toBe(200);
  expect(
    (await t.deliver(t.source, (await t.events(t.domestic))[0])).status,
  ).toBe(200);
  expect((await t.open(t.source, id)).name).toBe("Changed");
  expect(
    (
      await route(
        t.domestic,
        new Request(`${ORIGIN}/api/projects/${id}`, {
          method: "DELETE",
          headers: { Cookie: t.cookie, Origin: ORIGIN },
        }),
      )
    ).ok,
  ).toBe(true);
  expect(
    (await t.deliver(t.source, (await t.events(t.domestic, 1))[0])).status,
  ).toBe(200);
  expect(
    (
      await route(
        t.source,
        new Request(`${ORIGIN}/api/projects/${id}`, {
          headers: { Cookie: t.cookie },
        }),
      )
    ).status,
  ).toBe(404);
  expect((await t.open(t.source)).projectText).toBe(original.projectText);
});

it("keeps historical favorites and restored versions read-only in China", async () => {
  const t = await trial();
  const original = await t.open(t.source);
  await t.update(t.source, original.id, original.saveToken);
  for (const after of [0, 1])
    expect(
      (await t.deliver(t.domestic, (await t.events(t.source, after))[0]))
        .status,
    ).toBe(200);
  const headers = { Cookie: t.cookie, Origin: ORIGIN };
  const versions = await route(
    t.domestic,
    new Request(`${ORIGIN}/api/projects/${original.id}/versions`, { headers }),
  );
  expect(versions.status).toBe(200);
  const history = await versions.json();
  expect(history.versions).toHaveLength(1);
  expect(
    (
      await route(
        t.domestic,
        new Request(`${ORIGIN}/api/projects/${original.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ favorite: true }),
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await route(
        t.domestic,
        new Request(
          `${ORIGIN}/api/projects/${original.id}/versions/${history.versions[0].versionId}/restore`,
          {
            method: "POST",
            headers: { ...headers, "If-Match": history.saveToken },
          },
        ),
      )
    ).status,
  ).toBe(403);
  expect((await t.open(t.domestic)).name).toBe("Changed");
});

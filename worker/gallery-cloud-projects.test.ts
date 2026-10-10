import * as galleryRequests from "./gallery-requests";
// Private Cloud Projects and the Shelf drafts a publication comes from.

import { clearFormulaArtifactCacheForTests } from "../packages/math-typesetting/src/cache";
import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { describe, expect, it, vi } from "vitest";
import { CLOUD_PROJECT_LIMIT as EDITOR_CLOUD_PROJECT_LIMIT } from "../apps/editor/src/features/editor-shell/cloud-projects";
import { CLOUD_PROJECT_LIMIT } from "./gallery-store-cloud-projects";
import { GalleryDO } from "./gallery";
import { GALLERY_MAX_PROJECT_BYTES } from "./gallery-store";
import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  formulaProjectText,
  makerOf,
  pagedStoreBackup,
  projectText,
  route,
  saveRequest,
  sqliteState,
  submitOne,
  wiredProjectText,
} from "./gallery.test-support";

describe("private Cloud Projects", () => {
  it("limits distinct Projects without evicting an existing Project", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    for (let index = 0; index < CLOUD_PROJECT_LIMIT; index += 1) {
      const saved = await route(env, saveRequest(cookie, `Shelf ${index}`));
      expect(saved.status).toBe(201);
    }
    const refused = await route(env, saveRequest(cookie, "One too many"));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("project-limit");
    const listed = await route(
      env,
      new Request(`${ORIGIN}/api/projects`, {
        headers: cookieHeaders(cookie),
      }),
    );
    const { projects } = (await listed.json()) as {
      projects: { name: string; id: string }[];
    };
    expect(projects).toHaveLength(CLOUD_PROJECT_LIMIT);
    expect(projects.map((project) => project.name)).not.toContain(
      "One too many",
    );

    const removed = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${projects[0]!.id}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN, Cookie: cookie },
      }),
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).projects).toHaveLength(
      CLOUD_PROJECT_LIMIT - 1,
    );
    expect((await route(env, saveRequest(cookie, "Room again"))).status).toBe(
      201,
    );
  });

  it("enforces the same limit the editor displays", () => {
    // No Cloud Project response carries the limit, so the editor keeps its own
    // copy for the File menu, the My shelf counter, and the limit-reached
    // status. Changing one without the other shows members the wrong number.
    expect(EDITOR_CLOUD_PROJECT_LIMIT, "the editor's copy of the limit").toBe(
      CLOUD_PROJECT_LIMIT,
    );
  });

  it("serves a shelf thumbnail only to the account that owns it", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const created = await route(env, saveRequest(cookie, "Bias branch"));
    const { project } = (await created.json()) as {
      project: { id: string; revision: number };
    };

    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${project.id}/preview.svg`, {
        headers: cookieHeaders(cookie),
      }),
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("image/svg+xml");
    // Private caching only: a shared cache must never hold one member's shelf.
    expect(preview.headers.get("cache-control")).toContain("private");
    expect(await preview.text()).toContain("<svg");

    // A Project id is not a capability, and being signed in is not enough.
    const stranger = await adminOf(env);
    const denied = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${project.id}/preview.svg`, {
        headers: cookieHeaders(stranger),
      }),
    );
    expect(denied.status).toBe(404);

    const anonymous = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${project.id}/preview.svg`),
    );
    expect(anonymous.status).toBe(401);
  });

  it("renders saved and legacy Shelf formulas without exposing private projects", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    clearFormulaArtifactCacheForTests();
    const created = await route(
      env,
      new Request(`${ORIGIN}/api/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({
          name: "Formula circuit",
          projectText: formulaProjectText(),
        }),
      }),
    );
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as {
      project: { id: string; revision: number };
    };
    const original = env.gallerySql
      .exec<{ preview_svg: string }>(
        "SELECT preview_svg FROM cloud_projects WHERE id=?",
        project.id,
      )
      .one().preview_svg;
    // A common formula is set in label type, which needs no preparation.
    expect(original).toContain(
      'data-role="formula" data-formula-typography="label-v5"',
    );
    const legacy = '<svg><text data-role="formula-pending">latex</text></svg>';
    env.gallerySql.exec(
      "UPDATE cloud_projects SET preview_svg=? WHERE id=?",
      legacy,
      project.id,
    );
    clearFormulaArtifactCacheForTests();
    const url = `${ORIGIN}/api/projects/${project.id}/preview.svg?v=${project.revision}&render=formula-label-v5`;
    const repaired = await route(
      env,
      new Request(url, { headers: cookieHeaders(cookie) }),
    );
    expect(await repaired.text()).toBe(original);
    expect(repaired.headers.get("cache-control")).toContain("private");
    expect((await route(env, new Request(url))).status).toBe(401);
  });

  it("backfills a thumbnail for a shelf saved before previews existed", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const created = await route(env, saveRequest(cookie, "Legacy"));
    const { project } = (await created.json()) as {
      project: { id: string; revision: number };
    };
    // Simulate a row from before stored previews.
    env.gallerySql.exec(
      "UPDATE cloud_projects SET preview_svg = '' WHERE id = ?",
      project.id,
    );

    const preview = await route(
      env,
      new Request(
        `${ORIGIN}/api/projects/${project.id}/preview.svg?v=${project.revision}`,
        { headers: cookieHeaders(cookie) },
      ),
    );
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain("<svg");
    // And it sticks: the row now carries the rendered bytes.
    const row = env.gallerySql
      .exec<{ preview_svg: string }>(
        "SELECT preview_svg FROM cloud_projects WHERE id = ?",
        project.id,
      )
      .toArray()[0]!;
    expect(row.preview_svg).toContain("<svg");
  });

  it("updates one stable Project with optimistic revision checking", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const created = await route(env, saveRequest(cookie, "First"));
    const createdProject = (await created.json()).project as {
      id: string;
      revision: number;
    };
    const update = (revision: number, name: string) =>
      route(
        env,
        new Request(`${ORIGIN}/api/projects/${createdProject.id}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            Origin: ORIGIN,
            Cookie: cookie,
            "If-Match": `revision-${revision}`,
          },
          body: JSON.stringify({ name, projectText: projectText(name) }),
        }),
      );
    const updated = await update(1, "Second");
    expect(updated.status).toBe(200);
    expect((await updated.json()).project).toMatchObject({
      id: createdProject.id,
      name: "Second",
      revision: 2,
    });
    const retried = await update(1, "Second");
    expect(retried.status).toBe(200);
    expect((await retried.json()).project).toMatchObject({ revision: 2 });
    const conflict = await update(1, "Stale");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "revision-conflict",
      project: { id: createdProject.id, revision: 2 },
    });
  });

  it("retains three private saves, restores reversibly with revision checks, and backs up history", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const stranger = await adminOf(env);
    const { project } = await (
      await route(env, saveRequest(cookie, "Draft 1"))
    ).json();
    const base = `${ORIGIN}/api/projects/${project.id}`;
    const call = (
      path = "",
      method = "GET",
      revision?: number,
      name?: string,
      identity = cookie,
    ) =>
      route(
        env,
        new Request(base + path, {
          method,
          headers: {
            Cookie: identity,
            Origin: ORIGIN,
            ...(revision ? { "If-Match": `revision-${revision}` } : {}),
          },
          ...(name
            ? { body: JSON.stringify({ name, projectText: projectText(name) }) }
            : {}),
        }),
      );
    for (let revision = 1; revision < 5; revision++)
      expect(
        (await call("", "PUT", revision, `Draft ${revision + 1}`)).status,
      ).toBe(200);
    // Retried Save must not grow history or displace a useful revision.
    expect((await call("", "PUT", 4, "Draft 5")).status).toBe(200);
    const history = await (await call("/versions")).json();
    expect(history.revision).toBe(5);
    expect(
      history.versions.map((v: { versionNo: number }) => v.versionNo),
    ).toEqual([4, 3, 2]);
    const path = `/versions/${encodeURIComponent(history.versions[1].versionId)}`;
    expect(
      (await call("/versions", "GET", undefined, undefined, stranger)).status,
    ).toBe(404);
    expect(
      (await call(path + "/project", "GET", undefined, undefined, stranger))
        .status,
    ).toBe(404);
    expect(
      (await call(path + "/restore", "POST", 5, undefined, stranger)).status,
    ).toBe(404);
    expect(
      (await call(path + "/preview.svg")).headers.get("cache-control"),
    ).toContain("private");
    expect(await (await call(path + "/preview.svg")).text()).toContain("<svg");
    expect((await call(path + "/restore", "POST")).status).toBe(428);
    expect((await call(path + "/restore", "POST", 4)).status).toBe(409);
    env.gallerySql.exec(
      "UPDATE cloud_projects SET favorite = 1, gallery_entry_id = 'publication' WHERE id = ?",
      project.id,
    );
    expect((await call(path + "/restore", "POST", 5)).status).toBe(200);
    expect((await (await call()).json()).project).toMatchObject({
      name: "Draft 3",
      revision: 6,
      favorite: true,
      galleryEntryId: "publication",
    });
    expect(
      (await (await call("/versions")).json()).versions.map(
        (v: { versionNo: number }) => v.versionNo,
      ),
    ).toEqual([5, 4, 3]);
    const maintenance = async (action: string, body: unknown) => {
      const response = await env.GALLERY.getByName("gallery").fetch(
        `https://gallery/${action}`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      return response.json();
    };
    const backup = await pagedStoreBackup((query) =>
      maintenance("schema-backup", query),
    );
    expect(backup.tables.cloudProjectVersions).toHaveLength(3);
    const publicOnly = await maintenance("schema-backup", {
      table: "inventory",
      scope: "gallery",
    });
    expect(publicOnly.tables).not.toHaveProperty("cloudProjectVersions");
    expect(
      await maintenance("schema-backup", {
        table: "cloudProjectVersions",
        scope: "gallery",
      }),
    ).toMatchObject({ error: "invalid-table" });
    await call("", "DELETE");
    expect(
      env.gallerySql.exec("SELECT * FROM cloud_project_versions").toArray(),
    ).toHaveLength(0);
    await maintenance("schema-restore", { backup });
    expect((await (await call("/versions")).json()).versions).toHaveLength(3);
    expect((await call(path + "/project")).status).toBe(200);
    expect(await (await call(path + "/preview.svg")).text()).toContain("<svg");
  });

  it("is private to the account that saved it", async () => {
    const env = environment();
    const mine = await makerOf(env);
    const saved = await route(env, saveRequest(mine, "Private"));
    const { project } = (await saved.json()) as { project: { id: string } };
    const projectId = project.id;

    const stranger = await adminOf(env);
    const strangerRead = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${projectId}`, {
        headers: cookieHeaders(stranger),
      }),
    );
    // An id is not a capability: even an admin reads only their own shelf.
    expect(strangerRead.status).toBe(404);
    const strangerList = await route(
      env,
      new Request(`${ORIGIN}/api/projects`, {
        headers: cookieHeaders(stranger),
      }),
    );
    expect((await strangerList.json()).projects).toEqual([]);

    const own = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${projectId}`, {
        headers: cookieHeaders(mine),
      }),
    );
    expect(own.status).toBe(200);
    expect((await own.json()).project.projectText).toContain("Private");
  });

  it("refuses a signed-out visitor and an oversized or unparseable project", async () => {
    const env = environment();
    const anonymous = await route(env, new Request(`${ORIGIN}/api/projects`));
    expect(anonymous.status).toBe(401);

    const cookie = await makerOf(env);
    const oversized = await route(
      env,
      new Request(`${ORIGIN}/api/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({
          name: "Huge",
          projectText: "x".repeat(GALLERY_MAX_PROJECT_BYTES + 1),
        }),
      }),
    );
    expect(oversized.status).toBe(413);

    const unparseable = await route(
      env,
      new Request(`${ORIGIN}/api/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({ name: "Broken", projectText: "{" }),
      }),
    );
    expect(unparseable.status).toBe(400);
  });
});

describe("durable Shelf publication sources", () => {
  async function request(
    env: Harness,
    cookie: string,
    path: string,
    method = "GET",
    body?: unknown,
    revision = 1,
  ) {
    return route(
      env,
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          Origin: ORIGIN,
          Cookie: cookie,
          "content-type": "application/json",
          "if-match": `revision-${revision}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  const content = (name: string) => ({
    name,
    description: "",
    tags: [],
    projectText: wiredProjectText(name),
  });
  async function draft(
    env: Harness,
    cookie: string,
    name: string,
    galleryEntryId?: string,
  ) {
    const response = await request(env, cookie, "/api/projects", "POST", {
      ...content(name),
      ...(galleryEntryId ? { galleryEntryId } : {}),
    });
    expect(response.status).toBe(201);
    return (await response.json()).project;
  }
  async function open(env: Harness, cookie: string, id: string) {
    return (await (await request(env, cookie, `/api/projects/${id}`)).json())
      .project;
  }

  it("persists the link for both save/publish orders without changing private content", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const saved = await draft(env, cookie, "Private draft");
    const before = await open(env, cookie, saved.id);
    const published = await request(
      env,
      cookie,
      "/api/gallery/submissions",
      "POST",
      {
        ...content("Public title"),
        cloudProjectId: saved.id,
        expectedGalleryEntryId: null,
      },
    );
    expect(published.status).toBe(201);
    const { id } = await published.json();
    expect(await open(env, cookie, saved.id)).toEqual({
      ...before,
      galleryEntryId: id,
    });
    expect(
      (await (await request(env, cookie, "/api/projects")).json()).projects[0]
        .galleryEntryId,
    ).toBe(id);
    const update = await request(env, cookie, `/api/gallery/${id}`, "PUT", {
      ...content("Public v2"),
      cloudProjectId: saved.id,
      expectedGalleryEntryId: id,
    });
    expect(update.status).toBe(200);
    const stored = await request(
      env,
      cookie,
      `/api/projects/${saved.id}`,
      "PUT",
      content("Private v2"),
    );
    expect(stored.status).toBe(200);
    expect((await stored.json()).project.galleryEntryId).toBe(id);
    const separate = await submitOne(env, "Publish first", { cookie });
    expect(
      (await draft(env, cookie, "Saved afterwards", separate)).galleryEntryId,
    ).toBe(separate);
    // Saving another private copy never silently takes over the public source.
    expect(
      (await draft(env, cookie, "Additional copy", separate)).galleryEntryId,
    ).toBeNull();
  });

  it("changes source atomically while retaining both drafts, author, likes and history", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const id = await submitOne(env, "Public", { cookie });
    const first = await draft(env, cookie, "Original source", id);
    const second = await draft(env, cookie, "Replacement source");
    const firstBefore = await open(env, cookie, first.id);
    const secondBefore = await open(env, cookie, second.id);
    await request(env, cookie, `/api/gallery/${id}/like`, "POST");
    const rowBefore = env.gallerySql
      .exec<any>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .one();
    const switched = await request(env, cookie, `/api/gallery/${id}`, "PUT", {
      ...content("Updated public"),
      cloudProjectId: second.id,
      expectedGalleryEntryId: null,
    });
    expect(switched.status).toBe(200);
    expect(await open(env, cookie, first.id)).toEqual({
      ...firstBefore,
      galleryEntryId: null,
    });
    expect(await open(env, cookie, second.id)).toEqual({
      ...secondBefore,
      galleryEntryId: id,
    });
    const rowAfter = env.gallerySql
      .exec<any>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .one();
    expect(rowAfter.owner_user_id).toBe(rowBefore.owner_user_id);
    expect(rowAfter.author).toBe(rowBefore.author);
    expect(
      env.gallerySql
        .exec<any>("SELECT * FROM gallery_likes WHERE entry_id = ?", id)
        .toArray(),
    ).toHaveLength(1);
    expect(
      env.gallerySql
        .exec<any>(
          "SELECT * FROM gallery_entry_versions WHERE entry_id = ?",
          id,
        )
        .one().project_text,
    ).toBe(rowBefore.project_text);
    // A stale old-source tab cannot overwrite the new public revision or create a duplicate.
    for (const [path, method] of [
      [`/api/gallery/${id}`, "PUT"],
      ["/api/gallery/submissions", "POST"],
    ]) {
      const stale = await request(env, cookie, path!, method!, {
        ...content("Stale overwrite"),
        cloudProjectId: first.id,
        expectedGalleryEntryId: id,
      });
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toBe("publication-link-conflict");
    }
    expect(
      env.gallerySql.exec<any>("SELECT * FROM gallery_entries").toArray(),
    ).toEqual([rowAfter]);
    // Saving the old private draft is still allowed and does not reclaim publication.
    const oldSave = await request(
      env,
      cookie,
      `/api/projects/${first.id}`,
      "PUT",
      { ...content("Old draft edited"), galleryEntryId: id },
    );
    expect(oldSave.status).toBe(200);
    expect((await oldSave.json()).project.galleryEntryId).toBeNull();
    // Explicitly publishing as new moves only the current draft's link.
    const fresh = await request(
      env,
      cookie,
      "/api/gallery/submissions",
      "POST",
      {
        ...content("New publication"),
        cloudProjectId: second.id,
        expectedGalleryEntryId: id,
      },
    );
    expect(fresh.status).toBe(201);
    const newId = (await fresh.json()).id;
    expect(newId).not.toBe(id);
    expect((await open(env, cookie, second.id)).galleryEntryId).toBe(newId);
    expect(
      env.gallerySql
        .exec<any>("SELECT * FROM gallery_entries WHERE id = ?", id)
        .one(),
    ).toEqual(rowAfter);
  });

  it("cannot bind another account's draft or publication, even as administrator", async () => {
    const env = environment();
    const owner = await makerOf(env);
    const stranger = await adminOf(env);
    const saved = await draft(env, owner, "Private");
    const before = await open(env, owner, saved.id);
    const refused = await request(
      env,
      stranger,
      "/api/gallery/submissions",
      "POST",
      {
        ...content("Bad"),
        cloudProjectId: saved.id,
        expectedGalleryEntryId: null,
      },
    );
    expect(refused.status).toBe(404);
    expect(await open(env, owner, saved.id)).toEqual(before);
    expect(
      env.gallerySql.exec<any>("SELECT * FROM gallery_entries").toArray(),
    ).toHaveLength(0);
    const publicId = await submitOne(env, "Other author's work", {
      cookie: stranger,
    });
    const badSave = await request(env, owner, "/api/projects", "POST", {
      ...content("Private"),
      galleryEntryId: publicId,
    });
    expect(badSave.status).toBe(403);
    expect(
      env.gallerySql.exec<any>("SELECT * FROM cloud_projects").toArray(),
    ).toHaveLength(1);
  });

  it("rolls back publication and source changes together if storage fails", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const id = await submitOne(env, "Stable public", { cookie });
    const first = await draft(env, cookie, "Old source", id);
    const second = await draft(env, cookie, "New source");
    const originals = env.gallerySql
      .exec<any>("SELECT * FROM cloud_projects ORDER BY id")
      .toArray();
    const publication = env.gallerySql
      .exec<any>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .one();
    // Fail after retiring the old source but before installing the new link.
    const exec = env.gallerySql.exec.bind(env.gallerySql);
    env.gallerySql.exec = ((query: string, ...bindings: unknown[]) => {
      if (query.includes("UPDATE cloud_projects SET gallery_entry_id = ?"))
        throw new Error("injected storage failure");
      return exec(query, ...bindings);
    }) as typeof env.gallerySql.exec;
    await expect(
      request(env, cookie, `/api/gallery/${id}`, "PUT", {
        ...content("Must roll back"),
        cloudProjectId: second.id,
        expectedGalleryEntryId: null,
      }),
    ).rejects.toThrow("injected storage failure");
    await expect(
      request(env, cookie, "/api/gallery/submissions", "POST", {
        ...content("Must not appear"),
        cloudProjectId: first.id,
        expectedGalleryEntryId: id,
      }),
    ).rejects.toThrow("injected storage failure");
    expect(
      exec<any>("SELECT * FROM cloud_projects ORDER BY id").toArray(),
    ).toEqual(originals);
    expect(exec<any>("SELECT * FROM gallery_entries").toArray()).toEqual([
      publication,
    ]);
    expect(
      exec<any>("SELECT * FROM gallery_entry_versions").toArray(),
    ).toHaveLength(0);
  });

  it("favorites are account-scoped metadata, preserving drawing, publication, revisions and backup", async () => {
    const env = environment();
    const owner = await makerOf(env);
    const stranger = await adminOf(env);
    const publicId = await submitOne(env, "Public", { cookie: owner });
    const saved = await draft(env, owner, "Private", publicId);
    const before = await open(env, owner, saved.id);
    expect(
      (
        await request(env, stranger, `/api/projects/${saved.id}`, "PATCH", {
          favorite: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(env, owner, `/api/projects/${saved.id}`, "PATCH", {
          favorite: "true",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(env, owner, `/api/projects/${saved.id}`, "PATCH", {
          favorite: true,
        })
      ).status,
    ).toBe(200);
    expect(await open(env, owner, saved.id)).toEqual({
      ...before,
      favorite: true,
    });
    const backup = (await pagedStoreBackup(async (query) =>
      (
        await env.GALLERY.getByName("gallery").fetch(
          "https://gallery/schema-backup",
          { method: "POST", body: JSON.stringify(query) },
        )
      ).json(),
    )) as any;
    expect(backup.tables.cloudProjects[0].favorite).toBe(1);
    await request(env, owner, `/api/projects/${saved.id}`, "PATCH", {
      favorite: false,
    });
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/schema-restore",
      { method: "POST", body: JSON.stringify({ backup }) },
    );
    expect(await open(env, owner, saved.id)).toEqual({
      ...before,
      favorite: true,
    });
    const renamed = await request(
      env,
      owner,
      `/api/projects/${saved.id}`,
      "PUT",
      content("Renamed"),
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).project).toMatchObject({
      favorite: true,
      galleryEntryId: publicId,
    });
  });

  it("preserves old rows in the additive migration and includes links in full backups", async () => {
    const state = sqliteState();
    const original = wiredProjectText("Legacy private");
    state.storage.sql.exec(
      "CREATE TABLE cloud_projects (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, revision INTEGER, schema_version INTEGER, project_text TEXT, preview_svg TEXT DEFAULT '')",
    );
    state.storage.sql.exec(
      "INSERT INTO cloud_projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "old",
      "owner",
      "Legacy private",
      "before",
      "before",
      7,
      CURRENT_PROJECT_FILE_VERSION,
      original,
      "<svg/>",
    );
    const durable = new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<any>("SELECT * FROM cloud_projects WHERE id = 'old'")
        .one(),
    ).toMatchObject({
      project_text: original,
      revision: 7,
      gallery_entry_id: null,
      favorite: 0,
      preview_svg: "<svg/>",
    });
    state.storage.sql.exec(
      "UPDATE cloud_projects SET gallery_entry_id = 'old-public' WHERE id = 'old'",
    );
    const call = async (action: string, body: unknown) => {
      const response = await durable.fetch(
        new Request(`https://gallery.internal/${action}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    const backup = (await pagedStoreBackup((query) =>
      call("schema-backup", query),
    )) as any;
    expect(backup.tables.cloudProjects[0].gallery_entry_id).toBe("old-public");
    await call("schema-restore", { backup });
    expect(
      state.storage.sql
        .exec<any>("SELECT * FROM cloud_projects WHERE id = 'old'")
        .one(),
    ).toMatchObject({
      project_text: original,
      revision: 7,
      gallery_entry_id: "old-public",
    });
  });
});

it("acknowledges unchanged saves without rendering another thumbnail or returning the drawing", async () => {
  const env = environment();
  const cookie = await makerOf(env);
  const preview = vi.spyOn(galleryRequests, "renderPreview");
  try {
    const created = await route(
      env,
      saveRequest(cookie, "Fast acknowledgement"),
    );
    const { project } = await created.json();
    expect(preview).toHaveBeenCalledTimes(1);
    const saved = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: cookie,
          "If-Match": "revision-1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Fast acknowledgement",
          projectText: projectText("Fast acknowledgement"),
        }),
      }),
    );
    expect(saved.status).toBe(200);
    expect(preview).toHaveBeenCalledTimes(1);
    const acknowledgement = (await saved.json()).project;
    expect(acknowledgement).toMatchObject({
      id: project.id,
      revision: 1,
      name: "Fast acknowledgement",
    });
    expect(acknowledgement).not.toHaveProperty("projectText");
    expect(project).not.toHaveProperty("projectText");
    const opened = await route(
      env,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        headers: cookieHeaders(cookie),
      }),
    );
    expect((await opened.json()).project.projectText).toContain(
      "Fast acknowledgement",
    );
  } finally {
    preview.mockRestore();
  }
});

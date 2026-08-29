import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { hierarchicalSymbolId } from "@icm/symbols";

import { CLOUD_PROJECT_LIMIT } from "./gallery-do";
import {
  GALLERY_DAILY_SUBMISSION_LIMIT,
  GALLERY_MAX_PROJECT_BYTES,
  GalleryDO,
  routeGalleryRequest,
  SHORT_ID_LENGTH,
  shortId,
  type GalleryEnv,
} from "./gallery";
import { AuthDO, type AuthEnv } from "./auth";

function sqliteState() {
  const db = new DatabaseSync(":memory:");
  return {
    storage: {
      sql: {
        exec<T>(query: string, ...bindings: unknown[]) {
          const statement = db.prepare(query);
          if (/^\s*(select|with|pragma)/iu.test(query)) {
            const rows = statement.all(
              ...(bindings as (string | number | null)[]),
            ) as T[];
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("expected one row");
                return rows[0]!;
              },
            };
          }
          statement.run(...(bindings as (string | number | null)[]));
          return {
            toArray: () => [] as T[],
            one: () => {
              throw new Error("no rows");
            },
          };
        },
      },
      transactionSync<T>(callback: () => T): T {
        return callback();
      },
    },
  };
}

type Harness = GalleryEnv & {
  authDurable: AuthDO;
  /** The gallery's own storage, for seeding rows a route cannot create. */
  gallerySql: ReturnType<typeof sqliteState>["storage"]["sql"];
};

/**
 * One harness for every test: a gallery DO plus the auth DO that is now the
 * only way to publish anything.
 */
function environment(): Harness {
  const galleryState = sqliteState();
  const durable = new GalleryDO(galleryState);
  const authDurable = new AuthDO(sqliteState(), {
    RESEND_API_KEY: "rk",
    ADMIN_EMAILS: "owner@example.com",
  } as AuthEnv);
  return {
    GALLERY: {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          durable.fetch(new Request(input, init)),
      }),
    },
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          authDurable.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
    authDurable,
    gallerySql: galleryState.storage.sql,
  };
}

const ORIGIN = "https://gallery.test";

function submissionRequest(
  body: unknown,
  overrides: {
    ip?: string;
    origin?: string | null;
    cookie?: string;
  } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (overrides.origin !== null) {
    headers.set("Origin", overrides.origin ?? ORIGIN);
  }
  if (overrides.cookie) headers.set("Cookie", overrides.cookie);
  headers.set("CF-Connecting-IP", overrides.ip ?? "203.0.113.7");
  return new Request(`${ORIGIN}/api/gallery/submissions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function projectText(name = "Fixture"): string {
  return serializeProject(createEmptyProject("gallery-fixture", name));
}

function previousVersionText(): string {
  const raw = JSON.parse(projectText()) as { schemaVersion: number };
  raw.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION - 1;
  return JSON.stringify(raw);
}

function previousRouteVersionText(): string {
  // A structurally valid previous-window document. Route legs already use
  // the current shape, so the bounded upgrade is a version stamp — the
  // assertions protect the leg and anchor round-trip.
  const project = createEmptyProject("gallery-fixture", "Legacy Route");
  const document = project.documents[0]! as any;
  document.nets.push({ id: "net-route", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-route", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net-route", position: { x: 100, y: 100 } },
  );
  const legacy = createRoutePath({
    id: "route-legacy",
    netId: "net-route",
    start: { kind: "junction", junctionId: "J1" },
    end: { kind: "junction", junctionId: "J2" },
    bends: [{ x: 100, y: 0 }],
    modes: ["manual", "trunk"],
  });
  document.routes.push(legacy);
  document.annotations.push({
    id: "label-route",
    kind: "net-label",
    netId: "net-route",
    binding: { kind: "net-name", netId: "net-route" },
    anchor: {
      kind: "route",
      routeId: "route-legacy",
      legId: legacy.legs[1]!.id,
      t: 0.5,
      normalOffset: -10,
      direction: "forward",
      orientation: "follow",
      fallbackPosition: { x: 100, y: 50 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  const raw = JSON.parse(serializeProject(project)) as any;
  raw.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION - 1;
  return JSON.stringify(raw);
}

async function route(env: GalleryEnv, request: Request) {
  const response = await routeGalleryRequest(request, env);
  if (!response) throw new Error("gallery route did not match");
  return response;
}

function cookieHeaders(cookie: string): HeadersInit {
  return { Cookie: cookie };
}

/** A curator session: exempt from the gates and the daily quota. */
function adminOf(env: Harness): Promise<string> {
  return signIn(env.authDurable, "owner@example.com");
}

/** An ordinary member: gated and quota-limited, but publishes directly. */
function makerOf(env: Harness): Promise<string> {
  return signIn(env.authDurable, "maker@example.com");
}

async function submitOne(
  env: Harness,
  name: string,
  overrides: { ip?: string; text?: string; cookie?: string } = {},
): Promise<string> {
  const response = await route(
    env,
    submissionRequest(
      {
        name,
        description: "d",
        projectText: overrides.text ?? projectText(name),
      },
      {
        ip: overrides.ip ?? "203.0.113.7",
        cookie: overrides.cookie ?? (await adminOf(env)),
      },
    ),
  );
  expect(response.status).toBe(201);
  const payload = (await response.json()) as {
    id: string;
    previewRevision: string;
  };
  expect(payload.previewRevision).toMatch(/^[a-f0-9]{64}$/u);
  return payload.id;
}

describe("gallery data migrations", () => {
  it("renames tokenzhang across entries and restorable versions once", () => {
    const state = sqliteState();
    new GalleryDO(state);
    state.storage.sql.exec(
      `INSERT INTO gallery_entries
       (id, name, author, description, created_at, schema_version, status,
        project_text, svg_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "legacy-entry",
      "Legacy",
      "tokenzhang",
      "",
      "2026-08-01T00:00:00.000Z",
      CURRENT_PROJECT_SCHEMA_VERSION,
      "public",
      projectText("Legacy"),
      "<svg/>",
      "other-entry",
      "Other",
      "Other Author",
      "",
      "2026-08-01T00:00:00.000Z",
      CURRENT_PROJECT_SCHEMA_VERSION,
      "recycled",
      projectText("Other"),
      "<svg/>",
    );
    state.storage.sql.exec(
      `INSERT INTO gallery_entry_versions
       (id, entry_id, version_no, name, author, description, schema_version,
        project_text, svg_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "legacy-version",
      "legacy-entry",
      1,
      "Legacy",
      "Token Zhang",
      "",
      CURRENT_PROJECT_SCHEMA_VERSION,
      projectText("Legacy"),
      "<svg/>",
      "2026-08-01T00:00:00.000Z",
    );
    state.storage.sql.exec("DELETE FROM data_migrations");

    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ id: string; author: string }>(
          "SELECT id, author FROM gallery_entries ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { id: "legacy-entry", author: "Zhishuai Zhang" },
      { id: "other-entry", author: "Other Author" },
    ]);
    expect(
      state.storage.sql
        .exec<{ author: string }>(
          "SELECT author FROM gallery_entry_versions WHERE id = 'legacy-version'",
        )
        .one().author,
    ).toBe("Zhishuai Zhang");

    state.storage.sql.exec(
      "UPDATE gallery_entries SET author = 'Token Zhang' WHERE id = 'legacy-entry'",
    );
    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ author: string }>(
          "SELECT author FROM gallery_entries WHERE id = 'legacy-entry'",
        )
        .one().author,
    ).toBe("Token Zhang");
  });

  it("migrates histories to two versions and removes orphaned data", () => {
    const state = sqliteState();
    new GalleryDO(state);
    for (const entryId of ["entry-a", "entry-b"]) {
      state.storage.sql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          project_text, svg_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entryId,
        entryId,
        "Author",
        "",
        "2026-08-01T00:00:00.000Z",
        CURRENT_PROJECT_SCHEMA_VERSION,
        "public",
        projectText(entryId),
        "<svg/>",
      );
    }
    for (const [entryId, versionNo] of [
      ["entry-a", 1],
      ["entry-a", 2],
      ["entry-a", 3],
      ["entry-a", 4],
      ["entry-b", 1],
      ["entry-b", 2],
      ["entry-b", 3],
      ["missing-entry", 1],
    ] as const) {
      state.storage.sql.exec(
        `INSERT INTO gallery_entry_versions
         (id, entry_id, version_no, name, author, description,
          schema_version, project_text, svg_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `${entryId}-${versionNo}`,
        entryId,
        versionNo,
        `${entryId} v${versionNo}`,
        "Author",
        "",
        CURRENT_PROJECT_SCHEMA_VERSION,
        projectText(`${entryId} v${versionNo}`),
        "<svg/>",
        `2026-08-${String(versionNo).padStart(2, "0")}T00:00:00.000Z`,
      );
    }
    state.storage.sql.exec(
      `INSERT INTO gallery_likes(entry_id, user_id, liked_at)
       VALUES ('missing-entry', 'legacy-user', '2026-08-01T00:00:00.000Z')`,
    );
    state.storage.sql.exec("DELETE FROM data_migrations");

    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ entry_id: string; version_no: number }>(
          `SELECT entry_id, version_no FROM gallery_entry_versions
           ORDER BY entry_id, version_no DESC`,
        )
        .toArray(),
    ).toEqual([
      { entry_id: "entry-a", version_no: 4 },
      { entry_id: "entry-a", version_no: 3 },
      { entry_id: "entry-b", version_no: 3 },
      { entry_id: "entry-b", version_no: 2 },
    ]);
    expect(
      state.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM gallery_likes")
        .one().count,
    ).toBe(0);
  });
});

describe("newest-first gallery feed", () => {
  async function galleryPage(
    env: Harness,
    cursor?: string,
  ): Promise<{
    entries: { id: string; createdAt: string }[];
    nextCursor: string | null;
  }> {
    const params = new URLSearchParams({ limit: "3" });
    if (cursor) params.set("cursor", cursor);
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?${params.toString()}`),
    );
    const payload = (await response.json()) as {
      entries: { id: string; createdAt: string }[];
      nextCursor: string | null;
    };
    return payload;
  }

  async function wallOf(env: Harness, count: number): Promise<string[]> {
    const cookie = await adminOf(env);
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(await submitOne(env, `Circuit ${index}`, { cookie }));
    }
    return ids;
  }

  it("pages newest-first without repeating or skipping a circuit", async () => {
    const env = environment();
    const wall = await wallOf(env, 7);

    const first = await galleryPage(env);
    const second = await galleryPage(env, first.nextCursor!);
    const third = await galleryPage(env, second.nextCursor!);
    expect(third.nextCursor).toBeNull();

    const entries = [...first.entries, ...second.entries, ...third.entries];
    const seen = entries.map((entry) => entry.id);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...wall].sort());
    const order = entries.map((entry) => `${entry.createdAt}|${entry.id}`);
    expect(order).toEqual([...order].sort().reverse());
  });

  it("stops when the newest-first cursor chain is exhausted", async () => {
    const env = environment();
    const empty = await galleryPage(env);
    expect(empty).toEqual({ entries: [], nextCursor: null });

    await wallOf(env, 2);
    const full = await galleryPage(env);
    expect(full.entries).toHaveLength(2);
    expect(full.nextCursor).toBeNull();
  });

  it("returns the same newest-first order on every read", async () => {
    const env = environment();
    await wallOf(env, 3);
    const read = async () => {
      const plain = await route(env, new Request(`${ORIGIN}/api/gallery`));
      return (await plain.json()) as {
        entries: { id: string; createdAt: string }[];
      };
    };
    const payload = await read();
    expect(payload.entries).toHaveLength(3);
    // Newest-first, and the same every time. Entries submitted inside one
    // millisecond share a timestamp and fall back to comparing ids, so the
    // contract is the ordering and its stability, not a fixed sequence.
    const stamps = payload.entries.map((entry) => entry.createdAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
    expect((await read()).entries.map((entry) => entry.id)).toEqual(
      payload.entries.map((entry) => entry.id),
    );
  });
});

describe("stars and thumbs", () => {
  function likeRequest(id: string, cookie?: string): Request {
    const headers = new Headers({ Origin: ORIGIN });
    if (cookie) headers.set("Cookie", cookie);
    return new Request(`${ORIGIN}/api/gallery/${id}/like`, {
      method: "POST",
      headers,
    });
  }

  async function feed(env: Harness, cookie?: string) {
    const response = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery`,
        cookie ? { headers: cookieHeaders(cookie) } : undefined,
      ),
    );
    return (await response.json()) as {
      entries: {
        id: string;
        netlistable: boolean;
        likes: number;
        likedByViewer: boolean;
      }[];
    };
  }

  it("records whether a circuit extracts, and publishes both alike", async () => {
    const env = environment();
    const cookie = await adminOf(env);

    // An ideal switch has no reviewed netlist definition, so this circuit
    // does not extract. That is a legitimate schematic, not a mistake: it is
    // published exactly like any other and simply wears no star.
    const sketch = createEmptyProject("sketch", "Sketch");
    sketch.documents[0]!.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      schematicReference: "S1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const sketchId = await submitOne(env, "Sketch", {
      cookie,
      text: serializeProject(sketch),
    });
    const extractableId = await submitOne(env, "Extractable", { cookie });

    const listed = await feed(env);
    const byId = new Map(listed.entries.map((entry) => [entry.id, entry]));
    expect(byId.get(sketchId)!.netlistable).toBe(false);
    expect(byId.get(extractableId)!.netlistable).toBe(true);
    // Both are on the wall; the star separates them, nothing else does.
    expect(listed.entries).toHaveLength(2);
  });

  it("counts one thumb per account and takes it back on a second press", async () => {
    const env = environment();
    const owner = await adminOf(env);
    const id = await submitOne(env, "Liked", { cookie: owner });
    const other = await makerOf(env);

    const first = await route(env, likeRequest(id, other));
    expect(await first.json()).toEqual({ likes: 1, likedByViewer: true });
    // Pressing again is not a second thumb; it is taking the thumb back.
    const second = await route(env, likeRequest(id, other));
    expect(await second.json()).toEqual({ likes: 0, likedByViewer: false });

    await route(env, likeRequest(id, other));
    await route(env, likeRequest(id, owner));
    const listed = await feed(env, other);
    expect(listed.entries[0]!.likes).toBe(2);
    expect(listed.entries[0]!.likedByViewer).toBe(true);
  });

  it("shows counts to a signed-out visitor without claiming they liked it", async () => {
    const env = environment();
    const owner = await adminOf(env);
    const id = await submitOne(env, "Public", { cookie: owner });
    await route(env, likeRequest(id, owner));

    const anonymous = await feed(env);
    expect(anonymous.entries[0]!.likes).toBe(1);
    expect(anonymous.entries[0]!.likedByViewer).toBe(false);
    // And a thumb needs an account.
    expect((await route(env, likeRequest(id))).status).toBe(401);
  });

  it("refuses a thumb for a circuit that is not on the wall", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    expect((await route(env, likeRequest("nosuchid", cookie))).status).toBe(
      404,
    );
  });
});

describe("circuit addresses", () => {
  it("gives a new circuit a short, readable id", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Short", { cookie });
    expect(id).toHaveLength(SHORT_ID_LENGTH);
    // No characters that get misread off a screen: 0/o, 1/l/i, u.
    expect(id).toMatch(/^[23456789abcdefghjkmnpqrstvwxyz]+$/u);

    // And it is the address: the entry is readable at exactly that id.
    const entry = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    expect(entry.status).toBe(200);
  });

  it("keeps drawing distinct ids", () => {
    const drawn = new Set(Array.from({ length: 500 }, () => shortId()));
    expect(drawn.size).toBe(500);
  });

  it("still serves an entry that was given a long id", async () => {
    // Shortening changes what new links look like; it must never strand an
    // address someone already shared.
    const env = environment();
    const legacy = "0f9d2c4e-1a3b-4c5d-8e7f-102030405060";
    env.gallerySql.exec(
      `INSERT INTO gallery_entries(
         id, name, author, description, created_at, schema_version,
         status, recycled_at, owner_user_id, submitter_email,
         submitter_provider, tags, project_text, svg_text
       ) VALUES (?, ?, ?, ?, ?, ?, 'public', NULL, NULL, NULL, NULL, '', ?, '')`,
      legacy,
      "Old Link",
      "Someone",
      "",
      new Date().toISOString(),
      CURRENT_PROJECT_SCHEMA_VERSION,
      projectText("Old Link"),
    );
    const served = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${legacy}`),
    );
    expect(served.status).toBe(200);
    expect((await served.json()).entry.name).toBe("Old Link");
  });
});

describe("private Cloud Projects", () => {
  function saveRequest(cookie: string, name: string): Request {
    return new Request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: ORIGIN,
        Cookie: cookie,
      },
      body: JSON.stringify({ name, projectText: projectText(name) }),
    });
  }

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

  it("saves private unfinished work without Gallery quality gates", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const empty = serializeProject(createEmptyProject("blank", "Blank"));
    const saved = await route(
      env,
      new Request(`${ORIGIN}/api/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: JSON.stringify({ name: "Blank", projectText: empty }),
      }),
    );
    expect(saved.status).toBe(201);
  });
});

describe("gallery submissions", () => {
  it("publishes immediately with canonical text and a server preview", async () => {
    const env = environment();
    const id = await submitOne(env, "Ring Oscillator");

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const listed = (await list.json()) as {
      entries: {
        id: string;
        name: string;
        previewRevision: string;
        schemaVersion: number;
      }[];
    };
    expect(listed.entries.map((entry) => entry.id)).toEqual([id]);
    expect(listed.entries[0]).toMatchObject({
      name: "Ring Oscillator",
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
    expect(listed.entries[0]!.previewRevision).toMatch(/^[a-f0-9]{64}$/u);

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    expect(JSON.parse(payload.projectText)).toMatchObject({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      name: "Ring Oscillator",
    });

    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(preview.headers.get("content-type")).toBe("image/svg+xml");
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(await preview.text()).toContain("<svg");

    const immutablePreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/preview.svg?v=${listed.entries[0]!.previewRevision}`,
      ),
    );
    expect(immutablePreview.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("publishes and updates a hierarchical Project with its top-level Cell preview", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const publish = await route(
      env,
      submissionRequest(
        {
          name: "Hierarchical DAC",
          projectText: hierarchicalProjectText("Hierarchical DAC"),
        },
        { cookie },
      ),
    );
    expect(publish.status).toBe(201);
    const { id } = (await publish.json()) as { id: string };

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const stored = (await detail.json()) as { projectText: string };
    expect(parseProject(stored.projectText).documents).toHaveLength(2);

    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    const svg = await preview.text();
    expect(svg).toContain('data-object-id="XU0"');
    expect(svg).toContain(
      `data-symbol-id="${hierarchicalSymbolId("scdac_unit")}"`,
    );

    const update = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Hierarchical DAC v2",
          projectText: hierarchicalProjectText("Hierarchical DAC v2"),
        }),
      }),
    );
    expect(update.status).toBe(200);
  });

  it("upgrades a previous-schema submission through the protocol", async () => {
    const env = environment();
    const id = await submitOne(env, "Old Schema", {
      text: previousVersionText(),
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    expect(JSON.parse(payload.projectText).schemaVersion).toBe(
      CURRENT_PROJECT_SCHEMA_VERSION,
    );
  });

  it("migrates previous-schema Route legs and anchors in stored text", async () => {
    const env = environment();
    const id = await submitOne(env, "Legacy Route", {
      text: previousRouteVersionText(),
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = JSON.parse(payload.projectText) as any;
    const storedRoute = stored.documents[0].routes[0];
    expect(storedRoute.start).toEqual({
      kind: "junction",
      junctionId: "J1",
    });
    expect(storedRoute.legs).toHaveLength(2);
    expect(stored.documents[0].annotations[0].anchor).toMatchObject({
      routeId: storedRoute.id,
      legId: storedRoute.legs[1].id,
    });
  });

  it("refuses an anonymous submission: a session is the whole gate", async () => {
    const env = environment();
    const anonymous = await route(
      env,
      submissionRequest({ name: "X", projectText: projectText() }),
    );
    expect(anonymous.status).toBe(401);

    // There is no passphrase to fall back on: a bearer header buys nothing.
    const withBearer = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/submissions`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "content-type": "application/json",
          Authorization: "Bearer secret-token",
        },
        body: JSON.stringify({ name: "X", projectText: projectText() }),
      }),
    );
    expect(withBearer.status).toBe(401);
  });

  it("publishes an ordinary member's circuit straight to the wall", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const response = await route(
      env,
      submissionRequest(
        { name: "Direct", projectText: wiredProjectText("Direct") },
        { cookie },
      ),
    );
    expect(response.status).toBe(201);
    const { id, status } = (await response.json()) as {
      id: string;
      status: string;
    };
    expect(status).toBe("public");

    // Visible to everyone immediately: no queue, no approval step.
    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await list.json()) as { entries: { id: string }[] }).entries.map(
        (entry) => entry.id,
      ),
    ).toEqual([id]);
    expect(
      (await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))).status,
    ).toBe(200);
  });

  it("takes the byline from the account, not from the request", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const response = await route(
      env,
      submissionRequest(
        {
          name: "Claimed",
          author: "someone-else",
          projectText: wiredProjectText("Claimed"),
        },
        { cookie },
      ),
    );
    const { id } = (await response.json()) as { id: string };
    const detail = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { author: string } };
    expect(detail.entry.author).toBe("maker");
  });

  it("records the submitting identity and shows it only to a curator", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const adminCookie = await adminOf(env);
    const response = await route(
      env,
      submissionRequest(
        { name: "Traced", projectText: wiredProjectText("Traced") },
        { cookie },
      ),
    );
    const { id } = (await response.json()) as { id: string };

    const asCurator = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          headers: cookieHeaders(adminCookie),
        }),
      )
    ).json()) as { submitterEmail?: string; submitterProvider?: string };
    expect(asCurator).toMatchObject({
      submitterEmail: "maker@example.com",
      submitterProvider: "email",
    });

    // The wall shows a byline; it does not show anybody's email address.
    const asVisitor = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as Record<string, unknown>;
    expect(asVisitor).not.toHaveProperty("submitterEmail");
    expect(asVisitor).not.toHaveProperty("submitterProvider");
  });

  it("rejects invalid fields, foreign origins, oversized and invalid projects", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const noName = await route(
      env,
      submissionRequest({ name: "  ", projectText: projectText() }, { cookie }),
    );
    expect(noName.status).toBe(400);

    const foreign = await route(
      env,
      submissionRequest(
        { name: "X", projectText: projectText() },
        { origin: "https://evil.example", cookie },
      ),
    );
    expect(foreign.status).toBe(403);

    const oversized = await route(
      env,
      submissionRequest(
        {
          name: "X",
          projectText: "x".repeat(GALLERY_MAX_PROJECT_BYTES + 1),
        },
        { cookie },
      ),
    );
    expect(oversized.status).toBe(413);

    const invalid = await route(
      env,
      submissionRequest(
        { name: "X", projectText: '{"schemaVersion":99}' },
        { cookie },
      ),
    );
    expect(invalid.status).toBe(400);
  });

  it("rate-limits ordinary submitters per day; curators are exempt", async () => {
    const env = environment();

    // Ordinary submissions (limit enforced) exhaust the day, without
    // touching a different submitter.
    async function submitDirect(hash: string): Promise<number> {
      const response = await env.GALLERY.getByName("gallery").fetch(
        "https://gallery/submit",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            day: "2026-08-22",
            submitterHash: hash,
            enforceLimit: true,
            entry: {
              id: crypto.randomUUID(),
              name: "Quota",
              author: "",
              description: "",
              created_at: "2026-08-22T00:00:00.000Z",
              schema_version: 21,
              project_text: projectText(),
              svg_text: "<svg/>",
            },
          }),
        },
      );
      return response.status;
    }
    for (let index = 0; index < GALLERY_DAILY_SUBMISSION_LIMIT; index += 1) {
      expect(await submitDirect("hash-a")).toBe(200);
    }
    expect(await submitDirect("hash-a")).toBe(429);
    expect(await submitDirect("hash-b")).toBe(200);

    // A curator is exempt: more than the limit, all accepted.
    const adminCookie = await adminOf(env);
    for (
      let index = 0;
      index < GALLERY_DAILY_SUBMISSION_LIMIT + 2;
      index += 1
    ) {
      await submitOne(env, `Curated ${index}`, { cookie: adminCookie });
    }
  });
});

describe("the daily publish quota", () => {
  const countsByHash = (env: Harness): Map<string, number> =>
    new Map(
      env.gallerySql
        .exec<{
          submitter_hash: string;
          count: number;
        }>("SELECT submitter_hash, count FROM gallery_submissions")
        .toArray()
        .map((row) => [row.submitter_hash, row.count]),
    );

  it("counts per account, so one address does not spend everyone's allowance", async () => {
    const env = environment();
    const first = await signIn(env.authDurable, "first@example.com");
    const second = await signIn(env.authDurable, "second@example.com");

    // Two members behind one shared exit — a campus or an office.
    await submitOne(env, "From first", { cookie: first, ip: "203.0.113.7" });
    await submitOne(env, "From second", { cookie: second, ip: "203.0.113.7" });

    const shared = countsByHash(env);
    expect(shared.size).toBe(2);
    expect([...shared.values()]).toEqual([1, 1]);

    // One member from two addresses — switching networks is not a fresh
    // allowance, which is what keying on the address used to permit.
    await submitOne(env, "Roaming", { cookie: first, ip: "198.51.100.2" });
    const roamed = countsByHash(env);
    expect(roamed.size).toBe(2);
    expect([...roamed.values()].sort()).toEqual([1, 2]);
  });

  it("refuses the submission past the limit and leaves the count where it was", async () => {
    const env = environment();
    const cookie = await makerOf(env);

    await submitOne(env, "First", { cookie });
    const hash = [...countsByHash(env).keys()][0]!;
    env.gallerySql.exec(
      "UPDATE gallery_submissions SET count = ? WHERE submitter_hash = ?",
      GALLERY_DAILY_SUBMISSION_LIMIT,
      hash,
    );

    const refused = await route(
      env,
      submissionRequest(
        {
          name: "One too many",
          description: "d",
          projectText: projectText("One too many"),
        },
        { cookie },
      ),
    );
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toBe("rate-limited");
    // A refused publish must not spend a slot of its own.
    expect(countsByHash(env).get(hash)).toBe(GALLERY_DAILY_SUBMISSION_LIMIT);
  });
});

describe("direct publishing (the review queue is retired)", () => {
  it("publishes for every role: quality checks are advisory, never a gate", async () => {
    const env = environment();
    const cookie = await makerOf(env);

    // An ordinary member publishes even when the quality checks would flag
    // the project; the checker has false positives and sharing is the point.
    const member = await route(
      env,
      submissionRequest(
        { name: "Empty", projectText: projectText("Empty") },
        { cookie },
      ),
    );
    expect(member.status).toBe(201);

    // A curator curates: the same empty project goes straight up.
    const adminCookie = await adminOf(env);
    const viaAdmin = await route(
      env,
      submissionRequest(
        { name: "Admin Empty", projectText: projectText("Admin Empty") },
        { cookie: adminCookie },
      ),
    );
    expect(viaAdmin.status).toBe(201);
    expect(((await viaAdmin.json()) as { status: string }).status).toBe(
      "public",
    );
  });

  it("has no queue to read and no approval step", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Live", { cookie: adminCookie });

    for (const [path, method] of [
      [`${ORIGIN}/api/gallery/review`, "GET"],
      [`${ORIGIN}/api/gallery/${id}/approve`, "POST"],
    ] as const) {
      const response = await route(
        env,
        new Request(path, {
          method,
          headers: { Origin: ORIGIN, Cookie: adminCookie },
        }),
      );
      expect(response.status).toBe(404);
    }
  });

  it("publishes an entry stranded in the queue, keeping real rejections", () => {
    const state = sqliteState();
    // A database written before direct publishing: no submitter columns,
    // one entry still waiting for a reviewer, one already turned down.
    state.storage.sql.exec(`
      CREATE TABLE gallery_entries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        recycled_at TEXT,
        owner_user_id TEXT,
        project_text TEXT NOT NULL,
        svg_text TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    for (const [id, status] of [
      ["waiting", "pending"],
      ["refused", "rejected"],
    ]) {
      state.storage.sql.exec(
        `INSERT INTO gallery_entries(
           id, name, author, description, created_at, schema_version,
           status, recycled_at, owner_user_id, project_text, svg_text
         ) VALUES (?, ?, '', '', '2026-01-01T00:00:00.000Z', 21, ?, NULL, NULL, ?, '<svg/>')`,
        id,
        id,
        status,
        projectText(),
      );
    }

    new GalleryDO(state);

    const rows = state.storage.sql
      .exec<{ id: string; status: string }>(
        "SELECT id, status FROM gallery_entries ORDER BY id",
      )
      .toArray();
    expect(rows).toEqual([
      { id: "refused", status: "rejected" },
      { id: "waiting", status: "public" },
    ]);
  });
});

function reviewHarness(): { authDurable: AuthDO; env: Harness } {
  const env = environment();
  return { authDurable: env.authDurable, env };
}

async function signIn(authDurable: AuthDO, email: string): Promise<string> {
  const sent: string[] = [];
  authDurable.fetchLike = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    void input;
    sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return Response.json({ id: "email-1" });
  }) as typeof fetch;
  await authDurable.fetch(
    new Request(`${ORIGIN}/api/auth/email/start`, {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  const link = sent[0]!.match(/https?:\/\/\S+/u)![0];
  const callback = await authDurable.fetch(new Request(link));
  return callback.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("icm_session="))!
    .split(";")[0]!;
}

function wiredProjectText(name = "Wired", secondResistorX = 200): string {
  const project = createEmptyProject("g3", name);
  const document = project.documents[0]!;
  document.instances = [
    {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R1", parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: {
        position: { x: secondResistorX, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R2", parameters: {} },
    },
  ];
  document.nets = [
    {
      id: "n1",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
    {
      id: "n2",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "2" },
      ],
    },
  ];
  return serializeProject(project);
}

function hierarchicalProjectText(name = "Hierarchical"): string {
  const project = parseProject(wiredProjectText(name));
  const top = project.documents[0]!;
  const child = createEmptyDocument("document-child", "scdac_unit");
  top.instances.push({
    id: "XU0",
    symbolId: hierarchicalSymbolId(child.netlist!.name),
    placement: {
      position: { x: 100, y: 120 },
      rotation: 0,
      mirror: "none",
    },
    netlist: {
      reference: "XU0",
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: child.id },
    },
  });
  project.documents.push(child);
  return serializeProject(project);
}

describe("gallery version history", () => {
  it("snapshots on every update, lists, restores (reversibly), and guards", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Versioned v1", { cookie: adminCookie });

    function updateRequest(name: string, secondResistorX: number): Request {
      return new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          author: "tz",
          projectText: wiredProjectText(name, secondResistorX),
        }),
      });
    }
    const initialDetail = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { previewRevision: string } };
    const updateV2 = (await (
      await route(env, updateRequest("Versioned v2", 240))
    ).json()) as { previewRevision: string };
    const updateV3 = (await (
      await route(env, updateRequest("Versioned v3", 280))
    ).json()) as { previewRevision: string };
    expect(
      new Set([
        initialDetail.entry.previewRevision,
        updateV2.previewRevision,
        updateV3.previewRevision,
      ]).size,
    ).toBe(3);

    // Anonymous callers see nothing.
    const denied = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/versions`),
    );
    expect(denied.status).toBe(401);

    const listed = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/versions`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    const { versions } = (await listed.json()) as {
      versions: { versionId: string; versionNo: number; name: string }[];
    };
    expect(versions.map((version) => version.name)).toEqual([
      "Versioned v2",
      "Versioned v1",
    ]);

    const versionPreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${versions[1]!.versionId}/preview.svg`,
        { headers: cookieHeaders(adminCookie) },
      ),
    );
    expect(versionPreview.headers.get("content-type")).toBe("image/svg+xml");

    // Restore v1: current v3 is snapshotted first, entry becomes v1.
    const restored = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${versions[1]!.versionId}/restore`,
        {
          method: "POST",
          headers: { Origin: ORIGIN, ...cookieHeaders(adminCookie) },
        },
      ),
    );
    expect(restored.status).toBe(200);
    expect(
      ((await restored.json()) as { previewRevision: string }).previewRevision,
    ).toBe(initialDetail.entry.previewRevision);
    const detail = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { name: string; previewRevision: string } };
    expect(detail.entry.name).toBe("Versioned v1");
    expect(detail.entry.previewRevision).toBe(
      initialDetail.entry.previewRevision,
    );

    const afterRestore = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}/versions`, {
          headers: cookieHeaders(adminCookie),
        }),
      )
    ).json()) as { versions: { name: string }[] };
    expect(afterRestore.versions.map((version) => version.name)).toEqual([
      "Versioned v3",
      "Versioned v2",
    ]);
  });

  it("prunes history beyond the per-entry cap", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Cap 0", { cookie: adminCookie });
    let oldestVersionId = "";
    for (let index = 1; index <= 4; index += 1) {
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          method: "PUT",
          headers: {
            Origin: ORIGIN,
            Cookie: adminCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: `Cap ${index}`,
            projectText: projectText(`Cap ${index}`),
          }),
        }),
      );
      if (index === 1) {
        oldestVersionId = env.gallerySql
          .exec<{ id: string }>(
            "SELECT id FROM gallery_entry_versions WHERE entry_id = ?",
            id,
          )
          .one().id;
      }
    }
    const listed = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}/versions`, {
          headers: cookieHeaders(adminCookie),
        }),
      )
    ).json()) as { versions: { versionNo: number }[] };
    expect(listed.versions).toHaveLength(2);
    expect(listed.versions[0]!.versionNo).toBe(4);
    expect(listed.versions.at(-1)!.versionNo).toBe(3);

    const prunedPreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${oldestVersionId}/preview.svg`,
        { headers: cookieHeaders(adminCookie) },
      ),
    );
    expect(prunedPreview.status).toBe(404);
    const prunedRestore = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${oldestVersionId}/restore`,
        {
          method: "POST",
          headers: { Origin: ORIGIN, ...cookieHeaders(adminCookie) },
        },
      ),
    );
    expect(prunedRestore.status).toBe(404);
  });
});

describe("gallery circuit tags", () => {
  it("normalizes tags on write, filters as an OR-union, and aggregates", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const submitTagged = (name: string, tags: unknown) =>
      route(
        env,
        submissionRequest(
          { name, tags, projectText: projectText(name) },
          { cookie: adminCookie },
        ),
      );
    await submitTagged("Amp A", ["  Amplifier ", "OTA", "amplifier"]);
    await submitTagged("Comp B", ["comparator"]);
    await submitTagged("Mixed C", ["ADC", "amplifier "]);
    await submitTagged("Plain D", "not-an-array");

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const all = (await list.json()) as {
      entries: { name: string; tags: string[] }[];
    };
    expect(all.entries.find((entry) => entry.name === "Amp A")?.tags).toEqual([
      "amplifier",
      "ota",
    ]);
    expect(all.entries.find((entry) => entry.name === "Plain D")?.tags).toEqual(
      [],
    );

    const union = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?tags=comparator,adc`),
    );
    const filtered = (await union.json()) as { entries: { name: string }[] };
    expect(filtered.entries.map((entry) => entry.name).sort()).toEqual([
      "Comp B",
      "Mixed C",
    ]);

    const aggregate = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/tags`),
    );
    const counts = (await aggregate.json()) as {
      tags: { tag: string; count: number }[];
    };
    expect(counts.tags[0]).toEqual({ tag: "amplifier", count: 2 });

    // The bearer update path rewrites tags ("editable any time").
    const target = all.entries.find((entry) => entry.name === "Comp B")!;
    const detail = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?limit=60`),
    );
    void detail;
    const id = (
      (await (
        await route(env, new Request(`${ORIGIN}/api/gallery`))
      ).json()) as {
        entries: { id: string; name: string }[];
      }
    ).entries.find((entry) => entry.name === "Comp B")!.id;
    const updated = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: target.name,
          tags: ["latch", "comparator"],
          projectText: projectText(target.name),
        }),
      }),
    );
    expect(updated.status).toBe(200);
    const after = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { tags: string[] } };
    expect(after.entry.tags).toEqual(["latch", "comparator"]);
  });
});

describe("gallery list author filter and paging (phase G4)", () => {
  it("filters by exact byline and pages the filtered set", async () => {
    const env = environment();
    // The byline follows the account, so the fixture needs two of them. Both
    // are admins here only to skip the gates the empty fixture would fail.
    const alice = await signIn(env.authDurable, "alice@example.com");
    const bob = await signIn(env.authDurable, "bob@example.com");
    await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/users/role`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: await adminOf(env),
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "alice@example.com", role: "moderator" }),
      }),
    );
    await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/users/role`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: await adminOf(env),
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "bob@example.com", role: "moderator" }),
      }),
    );
    for (const [name, cookie] of [
      ["A1", alice],
      ["B1", bob],
      ["A2", alice],
      ["A3", alice],
    ] as const) {
      const response = await route(
        env,
        submissionRequest({ name, projectText: projectText(name) }, { cookie }),
      );
      expect(response.status).toBe(201);
    }

    const filtered = await route(
      env,
      new Request(`${ORIGIN}/api/gallery?author=alice&limit=2`),
    );
    const first = (await filtered.json()) as {
      entries: { name: string; author: string }[];
      nextCursor: string | null;
    };
    expect(first.entries.every((entry) => entry.author === "alice")).toBe(true);
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery?author=alice&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      ),
    );
    const rest = (await second.json()) as {
      entries: { name: string }[];
      nextCursor: string | null;
    };
    expect(rest.entries).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();

    const unfiltered = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await unfiltered.json()) as { entries: unknown[] }).entries,
    ).toHaveLength(4);
  });
});

describe("gallery owner editing", () => {
  it("keeps an owner's update on the wall and under its own byline", async () => {
    const env = environment();
    const ownerCookie = await makerOf(env);
    const adminCookie = await adminOf(env);
    const strangerCookie = await signIn(env.authDurable, "other@example.com");

    const submitted = await route(
      env,
      submissionRequest(
        { name: "Edit Me", projectText: wiredProjectText("Edit Me") },
        { cookie: ownerCookie },
      ),
    );
    const { id, previewRevision: initialRevision } =
      (await submitted.json()) as {
        id: string;
        previewRevision: string;
      };

    function updateRequest(
      cookie: string | null,
      secondResistorX = 240,
    ): Request {
      const headers = new Headers({
        "content-type": "application/json",
        Origin: ORIGIN,
      });
      if (cookie) headers.set("Cookie", cookie);
      return new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: "Edit Me v2",
          projectText: wiredProjectText("Edit Me v2", secondResistorX),
        }),
      });
    }

    const stranger = await route(env, updateRequest(strangerCookie));
    expect(stranger.status).toBe(403);
    const anonymous = await route(env, updateRequest(null));
    expect(anonymous.status).toBe(401);

    // The owner's own edit stays live rather than dropping out of the feed.
    const updated = await route(env, updateRequest(ownerCookie));
    expect(updated.status).toBe(200);
    const updatedPayload = (await updated.json()) as {
      status: string;
      previewRevision: string;
    };
    expect(updatedPayload.status).toBe("public");
    expect(updatedPayload.previewRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(updatedPayload.previewRevision).not.toBe(initialRevision);

    const stalePreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/preview.svg?v=${initialRevision}`,
      ),
    );
    expect(stalePreview.headers.get("cache-control")).toBe("no-store");
    const freshPreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/preview.svg?v=${updatedPayload.previewRevision}`,
      ),
    );
    expect(freshPreview.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );

    const mine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: cookieHeaders(ownerCookie),
      }),
    );
    const entries = (await mine.json()) as {
      entries: { name: string; status: string; previewRevision: string }[];
    };
    expect(entries.entries).toMatchObject([
      {
        name: "Edit Me v2",
        status: "public",
        previewRevision: updatedPayload.previewRevision,
      },
    ]);

    // A curator's edit does not re-attribute the entry to the curator.
    const adminEdit = await route(env, updateRequest(adminCookie, 280));
    expect(adminEdit.status).toBe(200);
    const adminRevision = (
      (await adminEdit.json()) as { previewRevision: string }
    ).previewRevision;
    expect(adminRevision).not.toBe(updatedPayload.previewRevision);
    const detail = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { author: string }; ownerUserId: string | null };
    expect(detail.entry.author).toBe("maker");
    // The detail response names the owner so the editor can offer updates.
    expect(typeof detail.ownerUserId).toBe("string");

    // Quality checks are advisory on updates too: an ordinary owner may
    // replace the entry with a sparse sketch.
    const sparse = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Empty", projectText: projectText() }),
      }),
    );
    expect(sparse.status).toBe(200);
  });
});

describe("gallery admin sessions", () => {
  it("lets a curator session reach the curator-only surfaces", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const memberCookie = await makerOf(env);

    const asCurator = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(asCurator.status).toBe(200);

    const asMember = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: cookieHeaders(memberCookie),
      }),
    );
    expect(asMember.status).toBe(401);
  });
});

describe("gallery administration", () => {
  it("requires an admin session for every admin operation", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Guarded", { cookie: adminCookie });

    const anonymous = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: { Origin: ORIGIN },
      }),
    );
    expect(anonymous.status).toBe(401);

    // A bearer header is not a credential any more: the caller reads as an
    // ordinary visitor, and the ownership check turns an unknown entry into
    // a not-found rather than an unauthorized.
    const impossible = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/some-id/recycle`, {
        method: "POST",
        headers: { Origin: ORIGIN, Authorization: "Bearer anything" },
      }),
    );
    expect(impossible.status).toBe(404);

    const asMember = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: cookieHeaders(await makerOf(env)),
      }),
    );
    expect(asMember.status).toBe(401);
  });

  it("recycles, hides, restores, and only hard-deletes from the bin", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Lifecycle", { cookie: adminCookie });
    const initial = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))
    ).json()) as { entry: { previewRevision: string } };
    const previewUrl = `${ORIGIN}/api/gallery/${id}/preview.svg?v=${initial.entry.previewRevision}`;

    const earlyDelete = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(earlyDelete.status).toBe(409);

    const recycle = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(recycle.status).toBe(200);

    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(((await list.json()) as { entries: unknown[] }).entries).toEqual([]);
    const hidden = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    expect(hidden.status).toBe(404);
    const hiddenPreview = await route(env, new Request(previewUrl));
    expect(hiddenPreview.status).toBe(404);
    expect(hiddenPreview.headers.get("cache-control")).toBe("no-store");

    const bin = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    const binned = (await bin.json()) as { entries: { id: string }[] };
    expect(binned.entries.map((entry) => entry.id)).toEqual([id]);

    const restore = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/restore`, {
        method: "POST",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(restore.status).toBe(200);
    const restoredPreview = await route(env, new Request(previewUrl));
    expect(restoredPreview.status).toBe(200);
    expect(restoredPreview.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const back = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await back.json()) as { entries: { id: string }[] }).entries,
    ).toHaveLength(1);

    const updated = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Lifecycle v2",
          projectText: projectText("Lifecycle v2"),
        }),
      }),
    );
    expect(updated.status).toBe(200);
    const likerCookie = await makerOf(env);
    const liked = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/like`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: likerCookie },
      }),
    );
    expect(liked.status).toBe(200);
    expect(
      env.gallerySql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM gallery_entry_versions WHERE entry_id = ?",
          id,
        )
        .one().count,
    ).toBe(1);
    expect(
      env.gallerySql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM gallery_likes WHERE entry_id = ?",
          id,
        )
        .one().count,
    ).toBe(1);

    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
        method: "POST",
        headers: cookieHeaders(adminCookie),
      }),
    );
    const remove = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(remove.status).toBe(200);
    const gone = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/recycled`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(((await gone.json()) as { entries: unknown[] }).entries).toEqual([]);
    expect(
      env.gallerySql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM gallery_entry_versions WHERE entry_id = ?",
          id,
        )
        .one().count,
    ).toBe(0);
    expect(
      env.gallerySql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM gallery_likes WHERE entry_id = ?",
          id,
        )
        .one().count,
    ).toBe(0);
  });

  it("rejects with an owner-visible reason and prevents owner self-restore", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const ownerCookie = await makerOf(env);
    const id = await submitOne(env, "Needs cleanup", {
      cookie: ownerCookie,
      text: wiredProjectText("Needs cleanup"),
    });

    function rejectRequest(cookie: string, reason: unknown, origin = ORIGIN) {
      return new Request(`${ORIGIN}/api/gallery/${id}/reject`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason }),
      });
    }

    expect((await route(env, rejectRequest(ownerCookie, "No"))).status).toBe(
      401,
    );
    expect(
      (await route(env, rejectRequest(adminCookie, "No", "https://evil.test")))
        .status,
    ).toBe(403);
    expect((await route(env, rejectRequest(adminCookie, "   "))).status).toBe(
      400,
    );

    const rejected = await route(
      env,
      rejectRequest(adminCookie, "Label the ports and remove loose wires."),
    );
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ id, status: "rejected" });

    const publicList = await route(env, new Request(`${ORIGIN}/api/gallery`));
    expect(
      ((await publicList.json()) as { entries: unknown[] }).entries,
    ).toEqual([]);
    const mine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: cookieHeaders(ownerCookie),
      }),
    );
    expect(await mine.json()).toMatchObject({
      entries: [
        {
          id,
          status: "rejected",
          rejectReason: "Label the ports and remove loose wires.",
        },
      ],
    });

    const adminRejected = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/rejected`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(adminRejected.status).toBe(200);
    expect(await adminRejected.json()).toMatchObject({
      entries: [
        {
          id,
          rejectReason: "Label the ports and remove loose wires.",
        },
      ],
    });
    const memberRejected = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/rejected`, {
        headers: cookieHeaders(ownerCookie),
      }),
    );
    expect(memberRejected.status).toBe(401);

    const ownerRestore = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/restore`, {
        method: "POST",
        headers: { Cookie: ownerCookie, Origin: ORIGIN },
      }),
    );
    expect(ownerRestore.status).toBe(409);
    const earlyDelete = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(earlyDelete.status).toBe(409);

    expect(
      (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
            method: "POST",
            headers: { Cookie: adminCookie, Origin: ORIGIN },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/${id}/restore`, {
            method: "POST",
            headers: { Cookie: ownerCookie, Origin: ORIGIN },
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/${id}/restore`, {
            method: "POST",
            headers: { Cookie: adminCookie, Origin: ORIGIN },
          }),
        )
      ).status,
    ).toBe(200);

    const restoredMine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: cookieHeaders(ownerCookie),
      }),
    );
    expect(await restoredMine.json()).toMatchObject({
      entries: [{ id, status: "public", rejectReason: null }],
    });
  });

  it("converges stored entries back into the rolling window", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Aging Entry", { cookie: adminCookie });

    // Age the stored record to the previous schema version through the
    // internal update operation, simulating a record left behind by time.
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/update-entry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          projectText: previousVersionText(),
          schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION - 1,
          svgText: "<svg/>",
        }),
      },
    );

    const maintenance = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-current`, {
        method: "POST",
        headers: {
          ...cookieHeaders(adminCookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ apply: true }),
      }),
    );
    expect(await maintenance.json()).toMatchObject({
      applied: true,
      ready: 1,
      failures: [],
      targetSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as {
      entry: { schemaVersion: number };
      projectText: string;
    };
    expect(payload.entry.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(payload.projectText).schemaVersion).toBe(
      CURRENT_PROJECT_SCHEMA_VERSION,
    );
    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(await preview.text()).toContain("<svg");
  });

  function legacy25RouteText(): string {
    const raw = JSON.parse(projectText("Legacy 25")) as any;
    raw.schemaVersion = 25;
    const document = raw.documents[0];
    document.nets.push({ id: "net-route", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net-route", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net-route", position: { x: 100, y: 100 } },
    );
    document.routes.push({
      id: "route-legacy",
      netId: "net-route",
      from: { kind: "junction", junctionId: "J1" },
      to: { kind: "junction", junctionId: "J2" },
      waypoints: [{ x: 100, y: 0 }],
      segmentModes: ["manual", "trunk"],
    });
    return JSON.stringify(raw);
  }

  it("chains schema-24 stock through converge in one run", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Ancient", { cookie: adminCookie });
    const raw = JSON.parse(legacy25RouteText()) as any;
    raw.schemaVersion = 24;
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/update-entry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          projectText: JSON.stringify(raw),
          schemaVersion: 24,
          svgText: "<svg/>",
        }),
      },
    );

    const maintenance = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-current`, {
        method: "POST",
        headers: {
          ...cookieHeaders(adminCookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ apply: true }),
      }),
    );
    expect(await maintenance.json()).toMatchObject({
      applied: true,
      ready: 1,
      failures: [],
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = JSON.parse(payload.projectText) as any;
    expect(stored.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(stored.documents[0].routes[0].legs).toHaveLength(2);
  });

  it("chains schema-25 stock through converge in one run", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Deep Legacy", { cookie: adminCookie });
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/update-entry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          projectText: legacy25RouteText(),
          schemaVersion: 25,
          svgText: "<svg/>",
        }),
      },
    );

    const maintenance = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-current`, {
        method: "POST",
        headers: {
          ...cookieHeaders(adminCookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ apply: true }),
      }),
    );
    expect(await maintenance.json()).toMatchObject({
      applied: true,
      ready: 1,
      failures: [],
    });
    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = JSON.parse(payload.projectText) as any;
    expect(stored.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(stored.documents[0].routes[0].legs).toHaveLength(2);
  });

  it("upgrades already-stored schema-25 Routes during maintenance", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Broken VDD", { cookie: adminCookie });
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/update-entry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          projectText: previousRouteVersionText(),
          schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION - 1,
          svgText: "<svg/>",
        }),
      },
    );

    const maintenance = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-current`, {
        method: "POST",
        headers: {
          ...cookieHeaders(adminCookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ apply: true }),
      }),
    );
    expect(await maintenance.json()).toMatchObject({
      applied: true,
      ready: 1,
      failures: [],
      targetSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = JSON.parse(payload.projectText) as any;
    expect(stored.documents[0].routes[0]).toMatchObject({
      start: { kind: "junction", junctionId: "J1" },
      legs: expect.any(Array),
    });
    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(await preview.text()).toBe("<svg/>");
  });

  it("backs up, dry-runs, and atomically converges every Project table", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Schema convergence", {
      cookie: adminCookie,
    });
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Schema convergence v2",
          projectText: projectText("Schema convergence v2"),
        }),
      }),
    );
    const versionId = env.gallerySql
      .exec<{ id: string }>(
        "SELECT id FROM gallery_entry_versions WHERE entry_id = ?",
        id,
      )
      .one().id;
    env.gallerySql.exec(
      "UPDATE gallery_entries SET schema_version = ?, project_text = ? WHERE id = ?",
      CURRENT_PROJECT_SCHEMA_VERSION - 1,
      previousVersionText(),
      id,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entry_versions SET schema_version = ?, project_text = ? WHERE id = ?",
      CURRENT_PROJECT_SCHEMA_VERSION - 1,
      previousRouteVersionText(),
      versionId,
    );
    env.gallerySql.exec(
      `INSERT INTO cloud_projects
       (id, user_id, name, created_at, updated_at, revision,
        schema_version, project_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      "cloud-legacy",
      "user-legacy",
      "Legacy Cloud Project",
      "2026-08-24T00:00:00.000Z",
      "2026-08-24T00:00:00.000Z",
      1,
      CURRENT_PROJECT_SCHEMA_VERSION - 1,
      previousRouteVersionText(),
    );

    const backup = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-backup`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(backup.status).toBe(200);
    expect(backup.headers.get("content-disposition")).toContain("attachment");
    const backupPayload = (await backup.json()) as any;
    expect(backupPayload.tables.galleryEntries).toHaveLength(1);
    expect(backupPayload.tables.galleryEntryVersions).toHaveLength(1);
    expect(backupPayload.tables.cloudProjects).toHaveLength(1);

    const dryRun = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-current`, {
        method: "POST",
        headers: {
          ...cookieHeaders(adminCookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ apply: false }),
      }),
    );
    expect(await dryRun.json()).toMatchObject({
      applied: false,
      ready: 3,
      failures: [],
      inventory: {
        gallery_entries: {
          [String(CURRENT_PROJECT_SCHEMA_VERSION - 1)]: 1,
        },
        gallery_entry_versions: {
          [String(CURRENT_PROJECT_SCHEMA_VERSION - 1)]: 1,
        },
        cloud_projects: {
          [String(CURRENT_PROJECT_SCHEMA_VERSION - 1)]: 1,
        },
      },
      migrationReports: expect.arrayContaining([
        expect.objectContaining({
          table: "gallery_entries",
          id,
          report: expect.objectContaining({
            changed: false,
          }),
        }),
        expect.objectContaining({
          table: "gallery_entry_versions",
          id: expect.any(String),
          report: expect.objectContaining({
            changed: false,
          }),
        }),
        expect.objectContaining({
          table: "cloud_projects",
          id: expect.any(String),
          report: expect.objectContaining({
            changed: false,
          }),
        }),
      ]),
    });
    expect(
      env.gallerySql
        .exec<{ schema_version: number }>(
          "SELECT schema_version FROM gallery_entries WHERE id = ?",
          id,
        )
        .one().schema_version,
    ).toBe(CURRENT_PROJECT_SCHEMA_VERSION - 1);

    const applied = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-current`, {
        method: "POST",
        headers: {
          ...cookieHeaders(adminCookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ apply: true }),
      }),
    );
    expect(await applied.json()).toMatchObject({
      applied: true,
      ready: 3,
      failures: [],
    });
    for (const table of [
      "gallery_entries",
      "gallery_entry_versions",
      "cloud_projects",
    ]) {
      const row = env.gallerySql
        .exec<{
          id: string;
          schema_version: number;
          project_text: string;
        }>(`SELECT id, schema_version, project_text FROM ${table}`)
        .one();
      expect(row.schema_version).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
      expect(parseProject(row.project_text).schemaVersion).toBe(
        CURRENT_PROJECT_SCHEMA_VERSION,
      );
      const stored = JSON.parse(row.project_text) as any;
      for (const document of stored.documents) {
        for (const net of document.nets) {
          expect(Object.keys(net).sort()).toEqual(["id", "terminals"]);
        }
      }
    }

    const restored = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-restore`, {
        method: "POST",
        headers: {
          ...cookieHeaders(adminCookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ backup: backupPayload }),
      }),
    );
    expect(await restored.json()).toMatchObject({
      restored: true,
      records: 3,
      tables: {
        galleryEntries: 1,
        galleryEntryVersions: 1,
        cloudProjects: 1,
      },
    });
    for (const table of [
      "gallery_entries",
      "gallery_entry_versions",
      "cloud_projects",
    ]) {
      expect(
        env.gallerySql
          .exec<{ schema_version: number }>(
            `SELECT schema_version FROM ${table}`,
          )
          .one().schema_version,
      ).toBe(CURRENT_PROJECT_SCHEMA_VERSION - 1);
    }
  });

  it("reapplies two-version retention when restoring a legacy backup", async () => {
    const env = environment();
    const adminCookie = await adminOf(env);
    const id = await submitOne(env, "Legacy backup v1", {
      cookie: adminCookie,
    });
    for (const versionNo of [2, 3]) {
      const updated = await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          method: "PUT",
          headers: {
            Origin: ORIGIN,
            Cookie: adminCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: `Legacy backup v${versionNo}`,
            projectText: projectText(`Legacy backup v${versionNo}`),
          }),
        }),
      );
      expect(updated.status).toBe(200);
    }

    const backupResponse = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-backup`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    const backup = (await backupResponse.json()) as any;
    const versions = backup.tables.galleryEntryVersions as Record<
      string,
      unknown
    >[];
    expect(
      versions
        .map((version) => Number(version.version_no))
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
    versions.push({
      ...versions[0],
      id: "legacy-version-zero",
      version_no: 0,
    });

    const restored = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-restore`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: adminCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ backup }),
      }),
    );
    expect(await restored.json()).toMatchObject({
      restored: true,
      records: 3,
      tables: {
        galleryEntries: 1,
        galleryEntryVersions: 2,
        cloudProjects: 0,
      },
    });
    expect(
      env.gallerySql
        .exec<{ version_no: number }>(
          `SELECT version_no FROM gallery_entry_versions
           WHERE entry_id = ? ORDER BY version_no DESC`,
          id,
        )
        .toArray()
        .map((version) => version.version_no),
    ).toEqual([2, 1]);
  });
});

describe("gallery owner lifecycle (withdrawal and history)", () => {
  async function submitPublished(
    env: GalleryEnv,
    ownerCookie: string,
    name: string,
  ): Promise<string> {
    const submitted = await route(
      env,
      submissionRequest(
        { name, projectText: wiredProjectText(name) },
        { cookie: ownerCookie },
      ),
    );
    expect(submitted.status).toBe(201);
    const { id, status } = (await submitted.json()) as {
      id: string;
      status: string;
    };
    expect(status).toBe("public");
    return id;
  }

  function lifecycle(
    id: string,
    action: "recycle" | "restore",
    cookie: string | null,
  ): Request {
    const headers = new Headers({ Origin: ORIGIN });
    if (cookie) headers.set("Cookie", cookie);
    return new Request(`${ORIGIN}/api/gallery/${id}/${action}`, {
      method: "POST",
      headers,
    });
  }

  async function mineStatus(
    env: GalleryEnv,
    cookie: string,
    id: string,
  ): Promise<string | undefined> {
    const mine = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/mine`, {
        headers: { Cookie: cookie },
      }),
    );
    const payload = (await mine.json()) as {
      entries: { id: string; status: string }[];
    };
    return payload.entries.find((entry) => entry.id === id)?.status;
  }

  it("owners withdraw and restore their own entries; strangers cannot", async () => {
    const { authDurable, env } = reviewHarness();
    const ownerCookie = await signIn(authDurable, "maker@example.com");
    const adminCookie = await signIn(authDurable, "owner@example.com");
    const strangerCookie = await signIn(authDurable, "other@example.com");
    const id = await submitPublished(env, ownerCookie, "Mine");

    expect(
      (await route(env, lifecycle(id, "recycle", strangerCookie))).status,
    ).toBe(401);
    expect((await route(env, lifecycle(id, "recycle", null))).status).toBe(401);

    // Owner withdraws: gone from the public wall, "recycled" in /mine.
    expect(
      (await route(env, lifecycle(id, "recycle", ownerCookie))).status,
    ).toBe(200);
    const list = await route(env, new Request(`${ORIGIN}/api/gallery`));
    const wall = (await list.json()) as { entries: { id: string }[] };
    expect(wall.entries.some((entry) => entry.id === id)).toBe(false);
    expect(await mineStatus(env, ownerCookie, id)).toBe("recycled");

    // Bringing it back republishes it, for the owner as much as the admin.
    expect(
      (await route(env, lifecycle(id, "restore", ownerCookie))).status,
    ).toBe(200);
    expect(await mineStatus(env, ownerCookie, id)).toBe("public");
    expect(
      (await route(env, lifecycle(id, "recycle", adminCookie))).status,
    ).toBe(200);
    expect(
      (await route(env, lifecycle(id, "restore", adminCookie))).status,
    ).toBe(200);
    expect(await mineStatus(env, ownerCookie, id)).toBe("public");

    const missing = await route(
      env,
      lifecycle("does-not-exist", "recycle", ownerCookie),
    );
    expect(missing.status).toBe(404);
  });

  it("owners browse their version history; a restore stays published", async () => {
    const { authDurable, env } = reviewHarness();
    const ownerCookie = await signIn(authDurable, "maker@example.com");
    const adminCookie = await signIn(authDurable, "owner@example.com");
    const strangerCookie = await signIn(authDurable, "other@example.com");
    const id = await submitPublished(env, ownerCookie, "Hist v1");

    // The owner's update snapshots v1 and stays on the wall.
    const updated = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Hist v2",
          author: "maker",
          projectText: wiredProjectText("Hist v2"),
        }),
      }),
    );
    expect(updated.status).toBe(200);

    function versionsRequest(cookie: string | null): Request {
      const headers = new Headers();
      if (cookie) headers.set("Cookie", cookie);
      return new Request(`${ORIGIN}/api/gallery/${id}/versions`, { headers });
    }
    expect((await route(env, versionsRequest(strangerCookie))).status).toBe(
      401,
    );
    expect((await route(env, versionsRequest(null))).status).toBe(401);
    const listed = await route(env, versionsRequest(ownerCookie));
    expect(listed.status).toBe(200);
    const { versions } = (await listed.json()) as {
      versions: { versionId: string; name: string }[];
    };
    expect(versions).toHaveLength(1);
    expect(versions[0]!.name).toBe("Hist v1");

    const previewPath = `${ORIGIN}/api/gallery/${id}/versions/${versions[0]!.versionId}/preview.svg`;
    const strangerPreview = await route(
      env,
      new Request(previewPath, { headers: { Cookie: strangerCookie } }),
    );
    expect(strangerPreview.status).toBe(404);
    const ownerPreview = await route(
      env,
      new Request(previewPath, { headers: { Cookie: ownerCookie } }),
    );
    expect(await ownerPreview.text()).toContain("<svg");

    // Restoring v1 puts the old content back without taking the entry down.
    const restore = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${versions[0]!.versionId}/restore`,
        { method: "POST", headers: { Origin: ORIGIN, Cookie: ownerCookie } },
      ),
    );
    expect(restore.status).toBe(200);
    expect(await mineStatus(env, ownerCookie, id)).toBe("public");
    const detail = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        headers: { Cookie: ownerCookie },
      }),
    );
    const payload = (await detail.json()) as { entry: { name: string } };
    expect(payload.entry.name).toBe("Hist v1");
  });
});

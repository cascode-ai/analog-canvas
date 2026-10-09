// Maintenance: the backup credential and pages, the netlist read, schema
// convergence, Project format, and restore.

import { CURRENT_MODEL_SCHEMA_VERSION, createEmptyProject } from "@icm/model";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDesignNetlistExport } from "@icm/netlist";
import { GALLERY_NETLIST_PAGE_CHARACTERS } from "./gallery-store-maintenance";
import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  pagedStoreBackup,
  previousRouteVersionText,
  previousVersionText,
  projectText,
  route,
  saveRequest,
  submitOne,
} from "./gallery.test-support";

/** One admin backup page through the route, as a browser session reads it. */
function adminBackupPage(env: Harness, cookie: string) {
  return async (query: Record<string, string>) =>
    (
      await route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/maintenance/schema-backup?${new URLSearchParams(query)}`,
          { headers: cookieHeaders(cookie) },
        ),
      )
    ).json();
}

describe("off-site Gallery backup credential", () => {
  const endpoint = `${ORIGIN}/api/gallery/maintenance/automated-backup`;
  it("reads only bounded Gallery pages and records a stable restore schema", async () => {
    const env = environment();
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Backup target", { cookie });
    const get = (table: string) =>
      route(
        env,
        new Request(`${endpoint}?table=${table}`, {
          headers: { Authorization: "Bearer backup-only-secret" },
        }),
      );
    const first = (await (await get("inventory")).json()) as any;
    expect(first.tables).toEqual({
      galleryEntries: 1,
      galleryEntryVersions: 0,
      galleryLikes: 0,
    });
    expect(
      first.schema
        .filter((s: any) => s.type === "table")
        .map((s: any) => s.name)
        .sort(),
    ).toEqual(["gallery_entries", "gallery_entry_versions", "gallery_likes"]);
    expect(JSON.stringify(first)).not.toContain("cloud_projects");
    expect(
      ((await (await get("inventory")).json()) as any).snapshotRevision,
    ).toBe(first.snapshotRevision);
    const page = (await (await get("galleryEntries")).json()) as any;
    expect(page.rows).toEqual(
      env.gallerySql
        .exec("SELECT * FROM gallery_entries WHERE id = ?", id)
        .toArray(),
    );
    expect(page.rows).toHaveLength(1);
    // A same-count update must invalidate the capture, including a raw SQL maintenance edit.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET description = ? WHERE id = ?",
      "Changed",
      id,
    );
    const after = (await (await get("inventory")).json()) as any;
    expect(after.tables).toEqual(first.tables);
    expect(after.snapshotRevision).not.toBe(first.snapshotRevision);
    expect((await get("cloudProjects")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    const replay = new DatabaseSync(":memory:");
    for (const item of first.schema) replay.exec(item.sql);
    const columns = Object.keys(page.rows[0]);
    replay
      .prepare(
        `INSERT INTO gallery_entries (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      )
      .run(...(Object.values(page.rows[0]) as any[]));
    expect(replay.prepare("SELECT * FROM gallery_entries").all()).toEqual(
      page.rows,
    );
    replay.close();
  });

  it("keeps a Gallery capture's revision through private Project saves", async () => {
    const env = environment();
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    env.STORE_BACKUP_TOKEN = "store-only-secret";
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Backup target", { cookie });
    const inventory = async (scope: "gallery" | "store") =>
      (await (
        await route(
          env,
          new Request(`${endpoint}?scope=${scope}&table=inventory`, {
            headers: {
              Authorization: `Bearer ${scope === "store" ? "store" : "backup"}-only-secret`,
            },
          }),
        )
      ).json()) as { snapshotRevision: string };
    const gallery = await inventory("gallery");
    const store = await inventory("store");
    const saved = await route(env, saveRequest(await makerOf(env), "Private"));
    expect(saved.status).toBe(201);
    expect((await inventory("gallery")).snapshotRevision).toBe(
      gallery.snapshotRevision,
    );
    const afterSave = await inventory("store");
    expect(afterSave.snapshotRevision).not.toBe(store.snapshotRevision);
    // A like is Gallery data, so it restarts both.
    env.gallerySql.exec(
      "INSERT INTO gallery_likes VALUES (?, ?, ?)",
      id,
      "u1",
      "2026-10-07",
    );
    expect((await inventory("gallery")).snapshotRevision).not.toBe(
      gallery.snapshotRevision,
    );
    expect((await inventory("store")).snapshotRevision).not.toBe(
      afterSave.snapshotRevision,
    );
  });

  it("lets the store credential read every backup table and nothing else", async () => {
    const env = environment();
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    env.STORE_BACKUP_TOKEN = "store-only-secret";
    const saved = await route(env, saveRequest(await makerOf(env), "Private"));
    const { project } = (await saved.json()) as { project: { id: string } };
    const store = { Authorization: "Bearer store-only-secret" };
    const gallery = { Authorization: "Bearer backup-only-secret" };
    const get = (path: string, headers: Record<string, string>) =>
      route(env, new Request(`${ORIGIN}${path}`, { headers }));
    const inventory = (await (
      await get(
        "/api/gallery/maintenance/automated-backup?scope=store&table=inventory",
        store,
      )
    ).json()) as any;
    expect(inventory.scope).toBe("store");
    expect(Object.keys(inventory.tables).sort()).toEqual([
      "cloudProjectVersions",
      "cloudProjects",
      "galleryEntries",
      "galleryEntryVersions",
      "galleryLikes",
    ]);
    const page = (await (
      await get(
        "/api/gallery/maintenance/automated-backup?scope=store&table=cloudProjects",
        store,
      )
    ).json()) as any;
    expect(page.rows.map((row: { id: string }) => row.id)).toEqual([
      project.id,
    ]);
    // Each credential reads only its own scope.
    for (const [path, headers] of [
      ["/api/gallery/maintenance/automated-backup?table=inventory", store],
      [
        "/api/gallery/maintenance/automated-backup?scope=store&table=inventory",
        gallery,
      ],
    ] as const)
      expect((await get(path, headers)).status, path).toBe(401);
    // A call that names no scope reads the narrower one.
    const unscoped = await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/schema-backup",
      { method: "POST", body: JSON.stringify({ table: "cloudProjects" }) },
    );
    expect(await unscoped.json()).toEqual({ error: "invalid-table" });
    // The store credential opens no other read.
    for (const path of [
      "/api/gallery",
      "/api/gallery/maintenance/netlists",
      "/api/gallery/maintenance/schema-backup?table=cloudProjects",
      "/api/projects",
    ])
      expect((await get(path, store)).status, path).toBe(401);
  });

  it("fails closed without the secret and cannot authorize writes or private exports", async () => {
    const env = environment();
    const headers = {
      Authorization: "Bearer backup-only-secret",
      "content-type": "application/json",
    };
    expect(
      (
        await route(
          env,
          new Request(`${endpoint}?table=inventory`, { headers }),
        )
      ).status,
    ).toBe(401);
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    expect(
      (await route(env, new Request(`${endpoint}?table=inventory`))).status,
    ).toBe(401);
    expect(
      (
        await route(
          env,
          new Request(`${endpoint}?table=inventory`, {
            headers: { Authorization: "Bearer wrong" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await route(
          env,
          new Request(endpoint, { method: "POST", headers, body: "{}" }),
        )
      ).status,
    ).toBe(405);
    for (const action of [
      "schema-restore",
      "project-format",
      "schema-current",
      "label-looks",
    ])
      expect(
        (
          await route(
            env,
            new Request(`${ORIGIN}/api/gallery/maintenance/${action}`, {
              method: "POST",
              headers,
              body: "{}",
            }),
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await route(
          env,
          new Request(
            `${ORIGIN}/api/gallery/maintenance/schema-backup?table=cloudProjects`,
            { headers },
          ),
        )
      ).status,
    ).toBe(401);
  });
});

describe("Gallery netlist read", () => {
  const endpoint = `${ORIGIN}/api/gallery/maintenance/netlists`;
  const bearer = { Authorization: "Bearer backup-only-secret" };
  type NetlistPage = {
    format: string;
    netlistFormat: string;
    entries: {
      id: string;
      name: string;
      netlistable: boolean;
      netlist: string | null;
      diagnostics: { severity: string; code: string; message: string }[];
    }[];
    nextCursor: string | null;
  };
  async function read(
    env: Harness,
    query = "",
    headers: Record<string, string> = bearer,
  ): Promise<{ status: number; page: NetlistPage }> {
    const response = await route(
      env,
      new Request(`${endpoint}${query}`, { headers }),
    );
    return {
      status: response.status,
      page: (await response.json()) as NetlistPage,
    };
  }
  function exported(env: Harness, id: string, format: "spice" | "spectre") {
    const result = createDesignNetlistExport(
      parseProject(
        env.gallerySql
          .exec<{ project_text: string }>(
            "SELECT project_text FROM gallery_entries WHERE id = ?",
            id,
          )
          .one().project_text,
      ),
      { format },
    );
    return result.status === "ready" ? result.file.text : null;
  }

  it("pages the public Gallery's netlists for the read-only credential or an admin", async () => {
    const env = environment();
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    const cookie = await adminOf(env);
    // An ideal switch has no reviewed netlist definition, so this one blocks.
    const sketch = createEmptyProject("sketch", "Sketch");
    sketch.documents[0]!.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      reference: "S1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const blocked = await submitOne(env, "Sketch", {
      cookie,
      text: serializeProject(sketch),
    });
    const ready = await submitOne(env, "Extractable", { cookie });
    const withdrawn = await submitOne(env, "Withdrawn", { cookie });
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'recycled' WHERE id = ?",
      withdrawn,
    );
    const publicIds = [blocked, ready].sort();

    const { status, page } = await read(env);
    expect(status).toBe(200);
    expect(page.format).toBe("analog-canvas-gallery-netlists-v1");
    expect(page.netlistFormat).toBe("spice");
    expect(page.entries.map((entry) => entry.id)).toEqual(publicIds);
    expect(page.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain("projectText");
    const byId = new Map(page.entries.map((entry) => [entry.id, entry]));
    expect(exported(env, ready, "spice")).toEqual(expect.any(String));
    expect(byId.get(ready)).toMatchObject({
      name: "Extractable",
      netlistable: true,
      netlist: exported(env, ready, "spice"),
    });
    expect(byId.get(blocked)).toMatchObject({
      netlistable: false,
      netlist: null,
    });
    expect(
      byId.get(blocked)!.diagnostics.some((item) => item.severity === "error"),
    ).toBe(true);

    const spectre = await read(env, `?format=spectre&id=${ready}`);
    expect(spectre.page.entries.map((entry) => entry.netlist)).toEqual([
      exported(env, ready, "spectre"),
    ]);
    const first = await read(env, "?limit=1");
    expect(first.page.entries).toHaveLength(1);
    expect(first.page.nextCursor).toBe(first.page.entries[0]!.id);
    const second = await read(env, `?limit=1&after=${first.page.nextCursor}`);
    expect(
      [...first.page.entries, ...second.page.entries].map((entry) => entry.id),
    ).toEqual(publicIds);
    expect(second.page.nextCursor).toBeNull();

    // An admin's browser session reads the same pages without the token.
    expect(await read(env, "", { Cookie: cookie })).toEqual({ status, page });
  });

  it("ends a page before its Project Code outgrows one response", async () => {
    const env = environment();
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    for (const id of ["~large-1", "~large-2"])
      env.gallerySql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          project_text, svg_text)
         VALUES (?, ?, 'Author', '', '2026-09-24T00:00:00.000Z', 1, 'public', ?, '')`,
        id,
        id,
        "x".repeat(GALLERY_NETLIST_PAGE_CHARACTERS / 2 + 1),
      );
    const first = await read(env);
    expect(first.page.entries.map((entry) => entry.id)).toEqual(["~large-1"]);
    expect(first.page.entries[0]!.diagnostics[0]!.code).toBe(
      "PROJECT_UNREADABLE",
    );
    expect(first.page.nextCursor).toBe("~large-1");
    const second = await read(env, "?after=~large-1");
    expect(second.page.entries.map((entry) => entry.id)).toEqual(["~large-2"]);
    expect(second.page.nextCursor).toBeNull();
  });

  it("refuses other readers, writes, unknown formats and entries off the wall", async () => {
    const env = environment();
    expect((await read(env)).status).toBe(401);
    env.GALLERY_BACKUP_TOKEN = "backup-only-secret";
    expect((await read(env, "", {})).status).toBe(401);
    expect(
      (await read(env, "", { Authorization: "Bearer wrong" })).status,
    ).toBe(401);
    expect((await read(env, "", { Cookie: await makerOf(env) })).status).toBe(
      401,
    );
    expect(
      (
        await route(
          env,
          new Request(endpoint, {
            method: "POST",
            headers: bearer,
            body: "{}",
          }),
        )
      ).status,
    ).toBe(405);
    expect((await read(env, "?format=verilog")).status).toBe(400);
    const withdrawn = await submitOne(env, "Withdrawn");
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'rejected' WHERE id = ?",
      withdrawn,
    );
    expect((await read(env, `?id=${withdrawn}`)).status).toBe(404);
  });
});

describe("gallery administration", () => {
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
          schemaVersion: CURRENT_MODEL_SCHEMA_VERSION,
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
      targetSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
    });

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as {
      entry: { schemaVersion: number };
      projectText: string;
    };
    expect(payload.entry.schemaVersion).toBe(CURRENT_PROJECT_FILE_VERSION);
    expect(JSON.parse(payload.projectText).schemaVersion).toBe(
      CURRENT_PROJECT_FILE_VERSION,
    );
    const preview = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/preview.svg`),
    );
    expect(await preview.text()).toContain("<svg");
  });

  function legacy25RouteText(): string {
    const raw = JSON.parse(
      JSON.stringify(parseProject(projectText("Legacy 25"))),
    ) as any;
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
    const stored = parseProject(payload.projectText) as any;
    expect(stored.schemaVersion).toBe(CURRENT_MODEL_SCHEMA_VERSION);
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
          schemaVersion: CURRENT_MODEL_SCHEMA_VERSION,
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
      targetSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
    });

    const detail = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    const payload = (await detail.json()) as { projectText: string };
    const stored = parseProject(payload.projectText) as any;
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
      CURRENT_MODEL_SCHEMA_VERSION,
      previousVersionText(),
      id,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entry_versions SET schema_version = ?, project_text = ? WHERE id = ?",
      CURRENT_MODEL_SCHEMA_VERSION,
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
      CURRENT_MODEL_SCHEMA_VERSION,
      previousRouteVersionText(),
    );
    // The publisher's AI mark cannot be worked out again from the drawing.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET ai_generated = 1 WHERE id = ?",
      id,
    );

    // The whole store no longer fits one response; it is read page by page.
    const whole = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/maintenance/schema-backup`, {
        headers: cookieHeaders(adminCookie),
      }),
    );
    expect(whole.status).toBe(400);
    expect(await whole.json()).toEqual({ error: "table-required" });
    const backupPayload = (await pagedStoreBackup(
      adminBackupPage(env, adminCookie),
    )) as any;
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
          [String(CURRENT_MODEL_SCHEMA_VERSION)]: 1,
        },
        gallery_entry_versions: {
          [String(CURRENT_MODEL_SCHEMA_VERSION)]: 1,
        },
        cloud_projects: {
          [String(CURRENT_MODEL_SCHEMA_VERSION)]: 1,
        },
      },
      migrationReports: [],
    });
    expect(
      env.gallerySql
        .exec<{ schema_version: number }>(
          "SELECT schema_version FROM gallery_entries WHERE id = ?",
          id,
        )
        .one().schema_version,
    ).toBe(CURRENT_MODEL_SCHEMA_VERSION);

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
      expect(row.schema_version).toBe(CURRENT_PROJECT_FILE_VERSION);
      expect(parseProject(row.project_text).schemaVersion).toBe(
        CURRENT_MODEL_SCHEMA_VERSION,
      );
      const stored = JSON.parse(row.project_text) as any;
      for (const document of stored.documents) {
        for (const net of document.nets) {
          expect(Object.keys(net).sort()).toEqual(["at", "id"]);
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
      ).toBe(CURRENT_MODEL_SCHEMA_VERSION);
    }
    expect(
      env.gallerySql
        .exec<{ ai_generated: number }>(
          "SELECT ai_generated FROM gallery_entries",
        )
        .one().ai_generated,
    ).toBe(1);
  });

  it("migrates one Gallery row with optimistic comparison while preserving all metadata and versions", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Portable migration", { cookie });
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          ...cookieHeaders(cookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Second",
          projectText: projectText("Second"),
        }),
      }),
    );
    env.gallerySql.exec(
      "INSERT INTO gallery_likes VALUES (?, ?, ?)",
      id,
      "visitor",
      "2026-09-20",
    );
    const endpoint = `${ORIGIN}/api/gallery/maintenance/project-format`;
    const send = (body: unknown, headers = cookieHeaders(cookie)) =>
      route(
        env,
        new Request(endpoint, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    for (const [table, sqlTable] of [
      ["galleryEntries", "gallery_entries"],
      ["galleryEntryVersions", "gallery_entry_versions"],
    ]) {
      const row = env.gallerySql
        .exec<Record<string, any>>(`SELECT * FROM ${sqlTable}`)
        .one();
      const originalProjectText = JSON.stringify(
        parseProject(row.project_text),
      );
      env.gallerySql.exec(
        `UPDATE ${sqlTable} SET project_text = ?, schema_version = ? WHERE id = ?`,
        originalProjectText,
        CURRENT_MODEL_SCHEMA_VERSION,
        row.id,
      );
      const before = env.gallerySql
        .exec<Record<string, any>>(`SELECT * FROM ${sqlTable}`)
        .one();
      const projectText = serializeProject(parseProject(originalProjectText));
      const body = { table, id: row.id, originalProjectText, projectText };
      expect((await send(body, { Origin: ORIGIN })).status).toBe(401);
      expect(
        (
          await send(body, {
            ...cookieHeaders(cookie),
            Origin: "https://untrusted.example",
          })
        ).status,
      ).toBe(403);
      expect(
        (await send({ ...body, originalProjectText: "outdated" })).status,
      ).toBe(409);
      expect(
        (
          await send({
            ...body,
            projectText: serializeProject(
              createEmptyProject("different", "Altered"),
            ),
          })
        ).status,
      ).toBe(422);
      expect(env.gallerySql.exec(`SELECT * FROM ${sqlTable}`).one()).toEqual(
        before,
      );
      const migrated = await send(body);
      expect(migrated.status).toBe(200);
      expect(await migrated.json()).toMatchObject({
        changed: true,
        schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      });
      expect(env.gallerySql.exec(`SELECT * FROM ${sqlTable}`).one()).toEqual({
        ...before,
        project_text: projectText,
        schema_version: CURRENT_PROJECT_FILE_VERSION,
      });
      expect(await (await send(body)).json()).toMatchObject({ changed: false });
    }
    expect(
      (
        await send({
          table: "cloudProjects",
          id,
          originalProjectText: "",
          projectText: "",
        })
      ).status,
    ).toBe(400);
    expect(
      env.gallerySql.exec("SELECT * FROM gallery_likes").toArray(),
    ).toEqual([{ entry_id: id, user_id: "visitor", liked_at: "2026-09-20" }]);
    expect(
      env.gallerySql.exec("SELECT id FROM gallery_entries").toArray(),
    ).toHaveLength(1);
    expect(
      env.gallerySql.exec("SELECT id FROM gallery_entry_versions").toArray(),
    ).toHaveLength(1);
  });

  it("backs up every raw row through bounded admin-only pages, including likes", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Paged backup", { cookie });
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          ...cookieHeaders(cookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Updated",
          projectText: projectText("Updated"),
        }),
      }),
    );
    env.gallerySql.exec(
      "INSERT INTO gallery_likes VALUES (?, ?, ?)",
      id,
      "u1",
      "2026-09-20",
    );
    env.gallerySql.exec(
      "INSERT INTO gallery_likes VALUES (?, ?, ?)",
      id,
      "u2",
      "2026-09-20",
    );
    const endpoint = `${ORIGIN}/api/gallery/maintenance/schema-backup`;
    const denied = await route(env, new Request(`${endpoint}?table=inventory`));
    expect(denied.status).toBe(401);
    const get = (query: string) =>
      route(
        env,
        new Request(`${endpoint}?${query}`, { headers: cookieHeaders(cookie) }),
      );
    const inventory = (await (await get("table=inventory")).json()) as any;
    expect(inventory.tables).toEqual({
      galleryEntries: 1,
      galleryEntryVersions: 1,
      cloudProjects: 0,
      galleryLikes: 2,
      cloudProjectVersions: 0,
    });
    for (const [key, name] of Object.entries({
      galleryEntries: "gallery_entries",
      galleryEntryVersions: "gallery_entry_versions",
      cloudProjects: "cloud_projects",
      galleryLikes: "gallery_likes",
    })) {
      const expected = env.gallerySql
        .exec(
          `SELECT * FROM ${name} ORDER BY ${key === "galleryLikes" ? "entry_id, user_id" : "id"}`,
        )
        .toArray();
      const rows = [];
      let cursor = null;
      env.galleryQueries.length = 0;
      do {
        const response = await get(
          `table=${key}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
        );
        expect(response.status).toBe(200);
        const page = (await response.json()) as any;
        expect(page.rows.length).toBeLessThanOrEqual(1);
        rows.push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor);
      expect(rows).toEqual(expected);
      expect(
        env.galleryQueries.filter((q) => q.startsWith("SELECT * FROM")),
      ).toSatisfy((queries: string[]) =>
        queries.every((q) => q.endsWith("LIMIT 1")),
      );
    }
    expect((await get("table=not-a-table")).status).toBe(400);
    expect((await get("table=galleryEntries&after=bad-json")).status).toBe(400);
    expect(
      (await get(`table=galleryLikes&after=${encodeURIComponent('["one"]')}`))
        .status,
    ).toBe(400);
  });

  it("reapplies three-version retention when restoring a legacy backup", async () => {
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

    const backup = (await pagedStoreBackup(
      adminBackupPage(env, adminCookie),
    )) as any;
    const versions = backup.tables.galleryEntryVersions as Record<
      string,
      unknown
    >[];
    expect(
      versions
        .map((version) => Number(version.version_no))
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
    versions.push(
      {
        ...versions[0],
        id: "legacy-version-zero",
        version_no: 0,
      },
      { ...versions[0], id: "legacy-version-four", version_no: 4 },
    );

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
      records: 4,
      tables: {
        galleryEntries: 1,
        galleryEntryVersions: 3,
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
    ).toEqual([4, 2, 1]);
  });
});

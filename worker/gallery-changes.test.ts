// The change feed a copy of the Gallery reads instead of every Project.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { installEntryChanges } from "./gallery-store-changes";
import {
  ORIGIN,
  adminOf,
  environment,
  makerOf,
  route,
  submitOne,
} from "./gallery.test-support";

type Change = {
  id: string;
  seq: number;
  removed?: true;
  entry?: { name: string; hasReference?: true; referenceRevision?: string };
};
type Page = {
  format: string;
  changes: Change[];
  latest: number;
  nextCursor: string | null;
};

describe("Gallery change feed", () => {
  it("lists each entry's latest change after a reader's last one", async () => {
    const env = environment();
    const admin = await adminOf(env);
    const maker = await makerOf(env);
    const read = async (query = "") =>
      (await (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/maintenance/changes${query}`),
        )
      ).json()) as Page;

    const first = await submitOne(env, "First", { cookie: admin });
    const second = await submitOne(env, "Second", { cookie: maker });
    const start = await read();
    expect(start.format).toBe("analog-canvas-gallery-changes-v1");
    expect(start.changes.map((change) => change.id)).toEqual([first, second]);
    expect(start.changes[0]!.entry).toMatchObject({ name: "First" });
    expect(start.nextCursor).toBeNull();
    const seen = start.latest;

    // Nothing changed: nothing listed.
    expect((await read(`?after=${seen}`)).changes).toEqual([]);

    // An edit, a reference image and a withdrawal each list their entry
    // once, with its latest state.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET name = 'First, renamed' WHERE id = ?",
      first,
    );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 2]);
    const saved = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${second}/reference`, {
        method: "PUT",
        headers: { Origin: ORIGIN, Cookie: maker },
        body: JSON.stringify({
          image: { type: "image/png", data: png.toString("base64") },
          rights: true,
        }),
      }),
    );
    expect(saved.status).toBe(200);
    const { revision } = (await saved.json()) as { revision: string };
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'recycled' WHERE id = ?",
      first,
    );
    const later = await read(`?after=${seen}`);
    expect(later.changes.map((change) => change.id)).toEqual([second, first]);
    expect(later.changes[0]!.entry).toMatchObject({
      name: "Second",
      hasReference: true,
      referenceRevision: revision,
    });
    expect(later.changes[1]).toMatchObject({ id: first, removed: true });
    expect(later.changes[1]).not.toHaveProperty("entry");

    // A page resumes by its cursor.
    const one = await read(`?after=${seen}&limit=1`);
    expect(one.changes.map((change) => change.id)).toEqual([second]);
    expect(
      (await read(`?after=${one.nextCursor}`)).changes.map((c) => c.id),
    ).toEqual([first]);

    expect(
      (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/maintenance/changes?source=nope`),
        )
      ).status,
    ).toBe(400);
  });

  it("records every entry of a store from before the feed once, in id order", () => {
    const db = new DatabaseSync(":memory:");
    const sql = {
      exec: (query: string, ...bindings: unknown[]) => {
        const statement = db.prepare(query);
        const rows = /^\s*(SELECT|WITH)/iu.test(query)
          ? (statement.all(...(bindings as never[])) as Record<
              string,
              unknown
            >[])
          : (statement.run(...(bindings as never[])), []);
        return { toArray: () => rows, one: () => rows[0]! };
      },
    } as never;
    db.exec(
      "CREATE TABLE gallery_entries (id TEXT PRIMARY KEY, name TEXT, author TEXT, description TEXT, created_at TEXT, owner_user_id TEXT, schema_version INTEGER, tags TEXT, curation_json TEXT, netlistable INTEGER, preview_revision TEXT, preview_width REAL, preview_height REAL, component_count INTEGER, ai_generated INTEGER, status TEXT, project_text TEXT, svg_text TEXT)",
    );
    db.exec(
      "CREATE TABLE entry_references (entry_id TEXT PRIMARY KEY, revision TEXT)",
    );
    db.exec("INSERT INTO gallery_entries (id) VALUES ('b'), ('a')");
    installEntryChanges(sql);
    installEntryChanges(sql); // installing again records nothing new
    expect(
      db
        .prepare("SELECT entry_id, seq FROM gallery_entry_changes ORDER BY seq")
        .all(),
    ).toEqual([
      { entry_id: "a", seq: 1 },
      { entry_id: "b", seq: 2 },
    ]);
    db.exec("UPDATE gallery_entries SET name = 'x' WHERE id = 'a'");
    expect(
      db
        .prepare("SELECT seq FROM gallery_entry_changes WHERE entry_id = 'a'")
        .get(),
    ).toEqual({ seq: 3 });
  });
});

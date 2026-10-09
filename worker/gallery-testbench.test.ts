// A circuit's testbench is its author's (#1545): stored apart from the
// Project Code, read back by its author, the Owner's own accounts and, among
// AI accounts, each other; everyone else gets the drawing without it.

import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { moveTestbenches } from "./gallery-maintenance";
import {
  splitTestbench,
  withTestbench,
  withoutTestbench,
} from "./gallery-testbench";
import {
  type Harness,
  ORIGIN,
  adminOf,
  environment,
  makerOf,
  ownerAccountOf,
  pagedStoreBackup,
  projectText,
  route,
  seatOf,
  signIn,
  submitOne,
  testbenchProjectText,
} from "./gallery.test-support";

/** The Project Code `cookie`'s session reads, or the read credential's. */
async function readProject(
  env: Harness,
  id: string,
  cookie?: string,
): Promise<string> {
  const response = await route(
    env,
    new Request(
      `${ORIGIN}/api/gallery/${id}`,
      cookie ? { headers: { Cookie: cookie } } : {},
    ),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { projectText: string }).projectText;
}

const folders = (text: string) => parseProject(text).simulationFolders;

function storedRow(env: Harness, id: string, table = "gallery_entries") {
  return env.gallerySql
    .exec<{ project_text: string; testbench_text: string | null }>(
      `SELECT project_text, testbench_text FROM ${table} WHERE id = ?`,
      id,
    )
    .one();
}

/** The stored text a fresh publish of the same Project, emptied, writes. */
function withoutFolders(text: string): string {
  return serializeProject({ ...parseProject(text), simulationFolders: [] });
}

function update(
  env: Harness,
  id: string,
  cookie: string,
  fields: Record<string, unknown>,
) {
  return route(
    env,
    new Request(`${ORIGIN}/api/gallery/${id}`, {
      method: "PUT",
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ description: "d", ...fields }),
    }),
  );
}

function maintain(env: Harness, cookie: string, body: unknown) {
  return route(
    env,
    new Request(`${ORIGIN}/api/gallery/maintenance/testbench-privacy`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

/** A backup Release as the snapshot helper downloads it, taken an hour ago. */
function recentRelease(): string {
  const at = new Date(Date.now() - 3_600_000)
    .toISOString()
    .slice(0, 19)
    .replace(/:/gu, "-");
  return `store-${at}Z-18329-1`;
}

describe("a circuit's testbench", () => {
  it("is stored apart from the Project Code and read back by its author, byte for byte", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const text = testbenchProjectText("Amplifier");
    const id = await submitOne(env, "Amplifier", { cookie: maker, text });

    const row = storedRow(env, id);
    expect(row.project_text).toBe(withoutFolders(text));
    expect(row.project_text).not.toContain("gain_db");
    expect(row.testbench_text).toContain("gain_db > 40");

    expect(await readProject(env, id, maker)).toBe(text);
    // One of the Owner's own accounts reads everyone's.
    expect(
      folders(await readProject(env, id, await ownerAccountOf(env))),
    ).toEqual(folders(text));
    // Anyone else, a curator and the read credential included, gets the
    // drawing without it.
    for (const reader of [
      await signIn(env.authDurable, "someone@example.com"),
      await adminOf(env),
      undefined,
    ])
      expect(await readProject(env, id, reader)).toBe(row.project_text);
  });

  it("is shared among AI accounts, never with a person, and never theirs with one", async () => {
    const env = environment();
    const claude = await seatOf(env, 0);
    const sol = await seatOf(env, 2);
    const maker = await makerOf(env);
    const ai = await submitOne(env, "AI amplifier", {
      cookie: claude,
      text: testbenchProjectText("AI amplifier"),
    });
    const person = await submitOne(env, "Person's amplifier", {
      cookie: maker,
      text: testbenchProjectText("Person's amplifier"),
    });

    expect(folders(await readProject(env, ai, sol))).toHaveLength(1);
    expect(folders(await readProject(env, ai, maker))).toEqual([]);
    expect(folders(await readProject(env, person, sol))).toEqual([]);
    expect(
      folders(await readProject(env, ai, await ownerAccountOf(env))),
    ).toHaveLength(1);
  });

  it("follows the same rule in version history, and a restore brings it back", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const first = testbenchProjectText("Amplifier");
    const id = await submitOne(env, "Amplifier", {
      cookie: maker,
      text: first,
    });
    const second = testbenchProjectText("Amplifier", "gain_db > 60");
    expect(
      (await update(env, id, maker, { name: "Amplifier", projectText: second }))
        .status,
    ).toBe(200);
    expect(await readProject(env, id, maker)).toBe(second);

    const listed = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/versions`, {
        headers: { Cookie: maker },
      }),
    );
    const [version] = (
      (await listed.json()) as {
        versions: { versionId: string }[];
      }
    ).versions;
    const versionRow = storedRow(
      env,
      version!.versionId,
      "gallery_entry_versions",
    );
    expect(versionRow.project_text).toBe(withoutFolders(first));
    expect(versionRow.testbench_text).toContain("gain_db > 40");
    const versionProject = async (cookie: string) =>
      (
        (await (
          await route(
            env,
            new Request(
              `${ORIGIN}/api/gallery/${id}/versions/${version!.versionId}/project`,
              { headers: { Cookie: cookie } },
            ),
          )
        ).json()) as { projectText: string }
      ).projectText;
    expect(await versionProject(maker)).toBe(first);
    // A curator reads the history, not the testbench in it.
    expect(await versionProject(await adminOf(env))).toBe(
      withoutFolders(first),
    );

    const restored = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${version!.versionId}/restore`,
        { method: "POST", headers: { Origin: ORIGIN, Cookie: maker } },
      ),
    );
    expect(restored.status).toBe(200);
    expect(await readProject(env, id, maker)).toBe(first);
    expect(storedRow(env, id)).toEqual({
      project_text: withoutFolders(first),
      testbench_text: expect.stringContaining("gain_db > 40"),
    });
  });

  it("stays when someone who never received it updates the entry, and its author replaces it", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const text = testbenchProjectText("Amplifier");
    const id = await submitOne(env, "Amplifier", { cookie: maker, text });
    const curator = await adminOf(env);

    // A curator's Edit and replace starts from the drawing without it, and
    // a testbench of the curator's own does not replace it either.
    expect(
      (
        await update(env, id, curator, {
          name: "Amplifier",
          projectText: await readProject(env, id, curator),
        })
      ).status,
    ).toBe(200);
    expect(await readProject(env, id, maker)).toBe(text);
    expect(
      (
        await update(env, id, curator, {
          name: "Amplifier",
          projectText: testbenchProjectText("Amplifier", "gain_db > 99"),
        })
      ).status,
    ).toBe(200);
    expect(await readProject(env, id, maker)).toBe(text);

    // Its author's update replaces the content, testbench included.
    expect(
      (
        await update(env, id, maker, {
          name: "Amplifier",
          projectText: projectText("Amplifier"),
        })
      ).status,
    ).toBe(200);
    expect(folders(await readProject(env, id, maker))).toEqual([]);
    expect(storedRow(env, id).testbench_text).toBeNull();
  });

  it("moves with an AI account's entry another takes over", async () => {
    const env = environment();
    const claude = await seatOf(env, 0);
    const sol = await seatOf(env, 2);
    const id = await submitOne(env, "AI amplifier", {
      cookie: claude,
      text: testbenchProjectText("AI amplifier"),
    });

    const redraw = await readProject(env, id, sol);
    expect(folders(redraw)).toHaveLength(1);
    const taken = await update(env, id, sol, {
      name: "AI amplifier",
      projectText: redraw,
      takeOver: true,
    });
    expect(taken.status).toBe(200);
    expect(await taken.json()).toMatchObject({ author: "GPT-6.1 Sol" });

    expect(await readProject(env, id, sol)).toBe(redraw);
    expect(await readProject(env, id, claude)).toBe(redraw);
    expect(folders(await readProject(env, id, await makerOf(env)))).toEqual([]);
    expect(storedRow(env, id).testbench_text).toContain("gain_db > 40");
  });
});

describe("moving existing testbenches out of the Project Code", () => {
  it("waits for a recorded backup, then moves them byte for byte, and a second run changes nothing", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const admin = await adminOf(env);
    const someone = await signIn(env.authDurable, "someone@example.com");
    // Rows as they were stored before the move: the testbench inside the
    // Project Code, in an entry and in a saved version.
    const full = testbenchProjectText("Amplifier");
    const entry = await submitOne(env, "Amplifier", {
      cookie: maker,
      text: full,
    });
    expect(
      (
        await update(env, entry, maker, {
          name: "Amplifier",
          projectText: testbenchProjectText("Amplifier", "gain_db > 60"),
        })
      ).status,
    ).toBe(200);
    const [{ id: version }] = env.gallerySql
      .exec<{ id: string }>(
        "SELECT id FROM gallery_entry_versions WHERE entry_id = ?",
        entry,
      )
      .toArray() as [{ id: string }];
    const current = testbenchProjectText("Amplifier", "gain_db > 60");
    env.gallerySql.exec(
      "UPDATE gallery_entries SET project_text = ?, testbench_text = NULL WHERE id = ?",
      current,
      entry,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entry_versions SET project_text = ?, testbench_text = NULL WHERE id = ?",
      full,
      version,
    );
    const plain = await submitOne(env, "Plain", { cookie: maker });
    const plainText = storedRow(env, plain).project_text;
    // From before schema 42: counted, left for the schema pass.
    const legacy = await submitOne(env, "Legacy", { cookie: maker });
    const legacyText = `${JSON.stringify(
      { schemaVersion: 41, simulation: { analyses: [{ kind: "op" }] } },
      null,
      2,
    )}\n`;
    env.gallerySql.exec(
      "UPDATE gallery_entries SET project_text = ? WHERE id = ?",
      legacyText,
      legacy,
    );

    // Already private while they wait.
    expect(await readProject(env, entry, maker)).toBe(current);
    expect(await readProject(env, entry, someone)).toBe(
      withoutFolders(current),
    );
    expect(
      JSON.parse(await readProject(env, legacy, someone)),
    ).not.toHaveProperty("simulation");

    // Nothing moves before a backup is recorded, by hand or on the schedule.
    expect((await maintain(env, admin, { apply: true })).status).toBe(409);
    expect(
      (await moveTestbenches(env, { apply: true, scheduled: true })).payload,
    ).toEqual({ skipped: "backup-required" });
    expect(
      (
        await maintain(env, admin, {
          backup: "store-2026-01-01T00-00-00Z-1-1",
        })
      ).status,
    ).toBe(400);
    expect((await maintain(env, maker, {})).status).toBe(401);
    const release = recentRelease();
    const report = await maintain(env, admin, { backup: release });
    expect(report.status).toBe(200);
    expect(await report.json()).toEqual({
      backup: release,
      applied: false,
      moved: { galleryEntries: 0, galleryEntryVersions: 0 },
      remaining: { galleryEntries: 1, galleryEntryVersions: 1 },
      legacy: { galleryEntries: 1, galleryEntryVersions: 0 },
      failures: [],
    });
    expect(storedRow(env, entry).project_text).toBe(current);

    // The schedule then moves a batch a tick.
    expect(
      (await moveTestbenches(env, { apply: true, scheduled: true, limit: 1 }))
        .payload,
    ).toMatchObject({
      moved: { galleryEntries: 1, galleryEntryVersions: 0 },
      remaining: { galleryEntries: 0, galleryEntryVersions: 1 },
    });
    expect(
      (await moveTestbenches(env, { apply: true, scheduled: true })).payload,
    ).toMatchObject({
      moved: { galleryEntries: 0, galleryEntryVersions: 1 },
      remaining: { galleryEntries: 0, galleryEntryVersions: 0 },
    });
    expect(
      (await moveTestbenches(env, { apply: true, scheduled: true })).payload,
    ).toEqual({ skipped: "moved" });

    // Only the testbench's value changed; it now stands in its own column.
    for (const [id, table, text] of [
      [entry, "gallery_entries", current],
      [version, "gallery_entry_versions", full],
    ] as const) {
      const row = storedRow(env, id, table);
      expect(row.project_text).toBe(withoutFolders(text));
      expect(JSON.parse(row.testbench_text!)).toEqual(
        JSON.parse(text).simulationFolders,
      );
    }
    expect(storedRow(env, plain)).toEqual({
      project_text: plainText,
      testbench_text: null,
    });
    expect(storedRow(env, legacy).project_text).toBe(legacyText);
    expect(await readProject(env, entry, maker)).toBe(current);
    expect(await readProject(env, entry, someone)).toBe(
      withoutFolders(current),
    );

    // Running it again changes nothing.
    const snapshot = () =>
      ["gallery_entries", "gallery_entry_versions"].map((table) =>
        env.gallerySql.exec(`SELECT * FROM ${table} ORDER BY id`).toArray(),
      );
    const before = snapshot();
    const again = await maintain(env, admin, { apply: true });
    expect(await again.json()).toMatchObject({
      moved: { galleryEntries: 0, galleryEntryVersions: 0 },
      remaining: { galleryEntries: 0, galleryEntryVersions: 0 },
    });
    expect(snapshot()).toEqual(before);
  });

  it("keeps each testbench in the backup pages and a restore from them", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const text = testbenchProjectText("Amplifier");
    const id = await submitOne(env, "Amplifier", { cookie: maker, text });
    const page = async (query: Record<string, unknown>) =>
      (
        await env.GALLERY.getByName("gallery").fetch(
          "https://gallery/schema-backup",
          { method: "POST", body: JSON.stringify(query) },
        )
      ).json();
    // The off-site collector checks the scope's tables: still the same three,
    // the testbench riding in each row.
    const inventory = await page({ table: "inventory", scope: "gallery" });
    expect(Object.keys(inventory.tables)).toEqual([
      "galleryEntries",
      "galleryEntryVersions",
      "galleryLikes",
    ]);
    const backup = await pagedStoreBackup(page);
    expect(backup.tables.galleryEntries).toEqual([
      expect.objectContaining({ id, testbench_text: expect.any(String) }),
    ]);
    env.gallerySql.exec("DELETE FROM gallery_entries");
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/schema-restore",
      { method: "POST", body: JSON.stringify({ backup }) },
    );
    expect(await readProject(env, id, maker)).toBe(text);
  });
});

describe("splitting stored Project Code", () => {
  it("splits the schema 42-49 key byte for byte and drops the pre-42 one for other readers", () => {
    // A bracket and a quote inside a string do not end the value.
    const setups = `{\n  "schemaVersion": 49,\n  "simulationSetups": [\n    { "id": "s1", "text": "a \\"]\\" }" }\n  ],\n  "name": "x"\n}\n`;
    const split = splitTestbench(setups)!;
    expect(split.projectText).toBe(
      `{\n  "schemaVersion": 49,\n  "simulationSetups": [],\n  "name": "x"\n}\n`,
    );
    expect(withTestbench(split.projectText, split.testbench)).toBe(setups);
    expect(withoutTestbench(setups)).toBe(split.projectText);
    expect(
      JSON.parse(
        withoutTestbench('{"schemaVersion":41,"simulation":{"analyses":[]}}'),
      ),
    ).toEqual({ schemaVersion: 41 });
  });
});

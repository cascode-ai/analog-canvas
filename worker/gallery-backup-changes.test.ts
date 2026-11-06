import { describe, expect, it } from "vitest";
import {
  ORIGIN,
  environment,
  makerOf,
  route,
  saveRequest,
} from "./gallery.test-support";

describe("whole-store backup reconciliation over HTTP", () => {
  it("keeps private keys out of Gallery scope and rejects stale or malformed cursors", async () => {
    const env = environment();
    env.STORE_BACKUP_TOKEN = "store-only";
    env.GALLERY_BACKUP_TOKEN = "gallery-only";
    const request = (
      scope: string,
      table: string,
      after?: unknown,
      key?: unknown,
    ) =>
      route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/maintenance/automated-backup?${new URLSearchParams({ scope, table, ...(after === undefined ? {} : { after: JSON.stringify(after) }), ...(key === undefined ? {} : { key: JSON.stringify(key) }) })}`,
          { headers: { Authorization: `Bearer ${scope}-only` } },
        ),
      );
    const start = await (await request("gallery", "inventory")).json();
    await route(env, saveRequest(await makerOf(env), "Private fixture"));
    const end = await (await request("gallery", "inventory")).json();
    expect(end.changeCursor).toEqual(start.changeCursor);
    const query = { epoch: start.changeCursor.epoch, since: 0, until: 0 };
    expect(
      (await (await request("gallery", "changes", query)).json()).changes,
    ).toEqual([]);
    expect(
      (await request("gallery", "cloudProjects", undefined, ["private"]))
        .status,
    ).toBe(400);
    expect(
      (await request("store", "changes", { ...query, epoch: "old-process" }))
        .status,
    ).toBe(409);
    for (const invalid of [
      { ...query, since: -1 },
      { ...query, until: 1.5 },
      { ...query, position: [0, "t"] },
    ])
      expect((await request("store", "changes", invalid)).status).toBe(400);
    expect(
      (await request("store", "cloudProjects", undefined, null)).status,
    ).toBe(400);
  });

  it("pages both keys of key-changing maintenance updates without gaps", async () => {
    const env = environment();
    env.STORE_BACKUP_TOKEN = "store-only";
    const project = (
      await (
        await route(env, saveRequest(await makerOf(env), "Fixture"))
      ).json()
    ).project;
    const get = async (table: string, after?: string) => {
      const result = await route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/maintenance/automated-backup?${new URLSearchParams({ scope: "store", table, ...(after ? { after } : {}) })}`,
          { headers: { Authorization: "Bearer store-only" } },
        ),
      );
      expect(result.status).toBe(200);
      return result.json();
    };
    const before = await get("inventory");
    let id = project.id;
    // Synthetic maintenance fixture: these writes intentionally bypass the HTTP save path.
    for (let n = 0; n < 270; n++) {
      const next = `maintenance-${n.toString().padStart(3, "0")}`;
      env.gallerySql.exec(
        "UPDATE cloud_projects SET id = ? WHERE id = ?",
        next,
        id,
      );
      id = next;
    }
    const after = await get("inventory");
    const first = await get(
      "changes",
      JSON.stringify({
        epoch: before.changeCursor.epoch,
        since: before.changeCursor.revision,
        until: after.changeCursor.revision,
      }),
    );
    expect(first.changes).toHaveLength(256);
    expect(typeof first.nextCursor).toBe("string");
    const second = await get("changes", first.nextCursor);
    expect(second.nextCursor).toBeNull();
    const keys = [...first.changes, ...second.changes].map(
      (x: any) => x.key[0],
    );
    expect(new Set(keys).size).toBe(271);
    expect(keys).toContain(project.id);
    expect(keys).toContain(id);
  });

  it("finds changed and deleted keys without restarting the full capture", async () => {
    const env = environment();
    env.STORE_BACKUP_TOKEN = "isolated-backup";
    const cookie = await makerOf(env);
    const created = await route(env, saveRequest(cookie, "Before capture"));
    const { project } = await created.json();
    const get = async (query: Record<string, string>) => {
      const response = await route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/maintenance/automated-backup?${new URLSearchParams({ scope: "store", ...query })}`,
          { headers: { Authorization: "Bearer isolated-backup" } },
        ),
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    const before = await get({ table: "inventory" });
    expect(before.changeCursor).toMatchObject({
      epoch: expect.any(String),
      revision: expect.any(Number),
    });
    const second = await route(env, saveRequest(cookie, "During capture"));
    const secondId = (await second.json()).project.id;
    expect(
      (
        await route(
          env,
          new Request(`${ORIGIN}/api/projects/${project.id}`, {
            method: "DELETE",
            headers: { Origin: ORIGIN, Cookie: cookie },
          }),
        )
      ).status,
    ).toBe(200);
    const after = await get({ table: "inventory" });
    const changes = await get({
      table: "changes",
      after: JSON.stringify({
        epoch: before.changeCursor.epoch,
        since: before.changeCursor.revision,
        until: after.changeCursor.revision,
      }),
    });
    expect(changes.changes).toEqual(
      expect.arrayContaining([
        { table: "cloudProjects", key: [project.id] },
        { table: "cloudProjects", key: [secondId] },
      ]),
    );
    expect(changes.nextCursor).toBeNull();
    expect(
      (await get({ table: "cloudProjects", key: JSON.stringify([project.id]) }))
        .rows,
    ).toEqual([]);
    expect(
      (await get({ table: "cloudProjects", key: JSON.stringify([secondId]) }))
        .rows[0].id,
    ).toBe(secondId);
    expect((await get({ table: "inventory" })).changeCursor).toEqual(
      after.changeCursor,
    );
  });
});

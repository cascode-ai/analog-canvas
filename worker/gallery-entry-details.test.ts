// An entry's name and description saved alone, as the editor's reference
// window saves them: who may update the entry may, and the drawing stays.

import { describe, expect, it } from "vitest";
import {
  ORIGIN,
  adminOf,
  environment,
  type Harness,
  makerOf,
  route,
  signIn,
  submitOne,
} from "./gallery.test-support";

function patchAs(env: Harness, id: string, cookie: string, body: unknown) {
  return route(
    env,
    new Request(`${ORIGIN}/api/gallery/${id}`, {
      method: "PATCH",
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

function stored(env: Harness, id: string) {
  return env.galleryStoreStates
    .get("gallery")!
    .storage.sql.exec<{
      name: string;
      description: string;
      preview_revision: string;
      versions: number;
    }>(
      `SELECT name, description, preview_revision,
         (SELECT COUNT(*) FROM gallery_entry_versions WHERE entry_id = gallery_entries.id)
           AS versions
       FROM gallery_entries WHERE id = ?`,
      id,
    )
    .one();
}

describe("PATCH /api/gallery/<id>", () => {
  it("renames and redescribes an entry for its owner and the Owner, keeping the drawing", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const id = await submitOne(env, "Ring", { cookie: maker });
    const before = stored(env, id);

    const response = await patchAs(env, id, maker, {
      name: " Ring oscillator ",
      description: "Three inverters in a loop",
    });
    expect(response.status).toBe(200);
    expect(stored(env, id)).toEqual({
      name: "Ring oscillator",
      description: "Three inverters in a loop",
      preview_revision: before.preview_revision,
      // The version before is kept.
      versions: before.versions + 1,
    });

    expect(
      (await patchAs(env, id, await adminOf(env), { name: "Ring" })).status,
    ).toBe(200);
    expect(stored(env, id).name).toBe("Ring");
  });

  it("refuses anyone else, a blank name and a dataset's entry", async () => {
    const env = environment();
    const id = await submitOne(env, "Ring", { cookie: await makerOf(env) });
    const other = await signIn(env.authDurable, "other@example.com");
    expect(
      (await patchAs(env, id, other, { name: "Mine", description: "" })).status,
    ).toBe(403);
    expect(
      (await patchAs(env, id, await adminOf(env), { name: "  " })).status,
    ).toBe(400);
    expect(
      (await patchAs(env, "ag-1030", await adminOf(env), { name: "Renamed" }))
        .status,
    ).toBe(403);
    expect(stored(env, id).name).toBe("Ring");
  });
});

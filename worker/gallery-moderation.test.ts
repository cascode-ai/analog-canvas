// Moderation: curator sessions, duplicate cleanup, recycling and rejection,
// the recycle bin's retention, and account deletion.

import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { GalleryDO } from "./gallery";
import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  projectText,
  route,
  sqliteState,
  submitOne,
  wiredProjectText,
} from "./gallery.test-support";

describe("account deletion", () => {
  it("removes the account's circuits, likes and Cloud Projects, and nobody else's", async () => {
    const state = sqliteState();
    const durable = new GalleryDO(state);
    const sql = state.storage.sql;
    const at = "2026-10-01T00:00:00.000Z";
    for (const [id, owner, status] of [
      ["alice-public", "alice", "public"],
      ["alice-recycled", "alice", "recycled"],
      ["bob-public", "bob", "public"],
    ])
      sql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          owner_user_id, submitter_email, project_text, svg_text)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, '<svg/>')`,
        id,
        id,
        owner,
        at,
        CURRENT_PROJECT_FILE_VERSION,
        status,
        owner,
        `${owner}@example.com`,
        projectText(id),
      );
    for (const [id, entry] of [
      ["alice-v1", "alice-public"],
      ["bob-v1", "bob-public"],
    ])
      sql.exec(
        `INSERT INTO gallery_entry_versions
         (id, entry_id, version_no, name, author, description,
          schema_version, project_text, svg_text, created_at)
         VALUES (?, ?, 1, ?, 'x', '', ?, ?, '<svg/>', ?)`,
        id,
        entry,
        id,
        CURRENT_PROJECT_FILE_VERSION,
        projectText(id),
        at,
      );
    for (const [entry, user] of [
      ["bob-public", "alice"],
      ["alice-public", "bob"],
      ["bob-public", "carol"],
    ])
      sql.exec(
        "INSERT INTO gallery_likes(entry_id, user_id, liked_at) VALUES (?, ?, ?)",
        entry,
        user,
        at,
      );
    for (const [id, user] of [
      ["alice-project", "alice"],
      ["bob-project", "bob"],
    ]) {
      sql.exec(
        `INSERT INTO cloud_projects
         (id, user_id, name, created_at, updated_at, revision,
          schema_version, project_text)
         VALUES (?, ?, ?, ?, ?, 2, ?, ?)`,
        id,
        user,
        id,
        at,
        at,
        CURRENT_PROJECT_FILE_VERSION,
        projectText(id),
      );
      sql.exec(
        `INSERT INTO cloud_project_versions
         (id, project_id, revision, name, saved_at, schema_version, project_text)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
        `${id}-r1`,
        id,
        id,
        at,
        CURRENT_PROJECT_FILE_VERSION,
        projectText(id),
      );
    }
    const call = (body: unknown) =>
      durable.fetch(
        new Request("https://gallery/delete-account", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );

    expect((await call({})).status).toBe(400);
    const deleted = await call({ userId: "alice" });
    expect(await deleted.json()).toEqual({
      entries: 2,
      likes: 1,
      projects: 1,
    });
    const ids = (query: string) =>
      sql
        .exec<{ id: string }>(query)
        .toArray()
        .map((row) => row.id);
    expect(ids("SELECT id FROM gallery_entries")).toEqual(["bob-public"]);
    expect(ids("SELECT id FROM gallery_entry_versions")).toEqual(["bob-v1"]);
    expect(
      ids(
        "SELECT entry_id || ':' || user_id AS id FROM gallery_likes ORDER BY id",
      ),
    ).toEqual(["bob-public:carol"]);
    expect(ids("SELECT id FROM cloud_projects")).toEqual(["bob-project"]);
    expect(ids("SELECT id FROM cloud_project_versions")).toEqual([
      "bob-project-r1",
    ]);
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

describe("administrator duplicate cleanup", () => {
  function ref(env: Harness, id: string) {
    return {
      id,
      previewRevision:
        env.gallerySql
          .exec<{ preview_revision: string }>(
            "SELECT preview_revision FROM gallery_entries WHERE id = ?",
            id,
          )
          .one().preview_revision || "legacy",
    };
  }
  function cleanup(body: unknown, cookie = "", origin = ORIGIN) {
    return new Request(`${ORIGIN}/api/gallery/duplicates/recycle`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
  function states(env: Harness) {
    return env.gallerySql
      .exec<{ id: string; status: string }>(
        "SELECT id, status FROM gallery_entries ORDER BY id",
      )
      .toArray();
  }
  async function fixture() {
    const env = environment();
    const cookie = await adminOf(env);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(
        await submitOne(env, `Copy ${index}`, {
          cookie,
          text: wiredProjectText(`Copy ${index}`, 200 + index * 10),
        }),
      );
    }
    return {
      env,
      cookie,
      ids,
      body: {
        keep: ref(env, ids[0]!),
        remove: ids.slice(1).map((id) => ref(env, id)),
      },
    };
  }

  it("requires an admin and same-origin request, even when a member owns the group", async () => {
    const { env, cookie, ids, body } = await fixture();
    const member = await makerOf(env);
    const memberProfile = await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: member } }),
    );
    const memberId = (await memberProfile.json()).user.id;
    env.gallerySql.exec(
      "UPDATE gallery_entries SET owner_user_id = ?",
      memberId,
    );
    const before = states(env);
    expect((await route(env, cleanup(body))).status).toBe(401);
    expect((await route(env, cleanup(body, member))).status).toBe(401);
    await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/users/role`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "maker@example.com", role: "moderator" }),
      }),
    );
    expect((await route(env, cleanup(body, member))).status).toBe(401);
    expect(
      (await route(env, cleanup(body, cookie, "https://stranger.test"))).status,
    ).toBe(403);
    for (const malformed of [
      null,
      {},
      { keep: body.keep, remove: [] },
      { keep: body.keep, remove: [body.keep] },
      { keep: body.keep, remove: Array(50).fill(ref(env, ids[1]!)) },
    ]) {
      expect((await route(env, cleanup(malformed, cookie))).status).toBe(400);
    }
    expect(states(env)).toEqual(before);
  });

  it.each(["preview", "hidden parameter", "missing survivor", "uncheckable"])(
    "leaves the whole group unchanged when %s changed since the scan",
    async (change) => {
      const { env, cookie, ids, body } = await fixture();
      if (change === "preview")
        env.gallerySql.exec(
          "UPDATE gallery_entries SET preview_revision = 'changed' WHERE id = ?",
          ids[2]!,
        );
      if (change === "missing survivor")
        env.gallerySql.exec(
          "UPDATE gallery_entries SET status = 'recycled' WHERE id = ?",
          ids[0]!,
        );
      if (change === "hidden parameter") {
        const project = parseProject(wiredProjectText());
        project.documents[0]!.instances[0]!.netlist!.parameters.value = "2k";
        // Deliberately leave preview_revision identical: it isn't an electrical revision.
        env.gallerySql.exec(
          "UPDATE gallery_entries SET project_text = ? WHERE id = ?",
          serializeProject(project),
          ids[2]!,
        );
      }
      if (change === "uncheckable")
        env.gallerySql.exec(
          "UPDATE gallery_entries SET project_text = ? WHERE id = ?",
          projectText(),
          ids[2]!,
        );
      const before = states(env);
      expect((await route(env, cleanup(body, cookie))).status).toBe(409);
      expect(states(env)).toEqual(before);
    },
  );

  it("keeps the chosen survivor, preserves history/likes, survives later retention sweeps and restores", async () => {
    const { env, cookie, ids } = await fixture();
    const extra = ids[0]!;
    const keep = ids[1]!;
    const updated = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${extra}`, {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Extra v2",
          projectText: wiredProjectText("Extra v2", 400),
        }),
      }),
    );
    expect(updated.status).toBe(200);
    const liked = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${extra}/like`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGIN },
      }),
    );
    expect(liked.status).toBe(200);
    const history = () =>
      env.gallerySql
        .exec("SELECT * FROM gallery_entry_versions WHERE entry_id = ?", extra)
        .toArray();
    const likes = () =>
      env.gallerySql
        .exec("SELECT * FROM gallery_likes WHERE entry_id = ?", extra)
        .toArray();
    const beforeHistory = history();
    const beforeLikes = likes();
    expect(beforeHistory.length).toBeGreaterThan(0);
    const response = await route(
      env,
      cleanup(
        { keep: ref(env, keep), remove: [ref(env, extra), ref(env, ids[2]!)] },
        cookie,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kept: keep,
      recycled: [extra, ids[2]],
    });
    expect(states(env).find((row) => row.id === keep)?.status).toBe("public");
    // A second admin choosing the opposite survivor cannot remove the last copy.
    expect(
      (
        await route(
          env,
          cleanup({ keep: ref(env, extra), remove: [ref(env, keep)] }, cookie),
        )
      ).status,
    ).toBe(409);
    for (let index = 0; index < 27; index += 1) {
      env.gallerySql.exec(
        `INSERT INTO gallery_entries
        (id, name, author, description, created_at, schema_version, status, recycled_at, owner_user_id, project_text, svg_text)
        SELECT ?, name, author, description, created_at, schema_version, 'recycled', '2099-01-01', owner_user_id, project_text, svg_text
        FROM gallery_entries WHERE id = ?`,
        `overflow-${index}`,
        keep,
      );
    }
    await submitOne(env, "Trigger author retention", { cookie });
    expect(states(env).filter((row) => row.status === "recycled")).toHaveLength(
      27,
    ); // 25 author rows plus two curated copies.
    expect(history()).toEqual(beforeHistory);
    expect(likes()).toEqual(beforeLikes);
    const restored = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${extra}/restore`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGIN },
      }),
    );
    expect(restored.status).toBe(200);
    const detail = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${extra}`),
    );
    expect((await detail.json()).projectText).toContain("Extra v2");
    expect(history()).toEqual(beforeHistory);
    expect(likes()).toEqual(beforeLikes);
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
      "private, max-age=31536000, immutable",
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
});

describe("recycle bin retention", () => {
  function seedRecycled(
    env: Harness,
    id: string,
    ownerUserId: string,
    recycledAt: string,
  ): void {
    env.gallerySql.exec(
      `INSERT INTO gallery_entries(
        id, name, author, description, created_at, schema_version,
        status, recycled_at, owner_user_id, submitter_email,
        submitter_provider, tags, project_text, svg_text, netlistable,
        preview_revision
      ) VALUES (?, ?, '', '', ?, ?, 'recycled', ?, ?, '', '', '[]', ?, '<svg/>', 0, 'r')`,
      id,
      `Binned ${id}`,
      recycledAt,
      CURRENT_PROJECT_FILE_VERSION,
      recycledAt,
      ownerUserId,
      projectText(),
    );
  }

  function recycledIds(env: Harness, ownerUserId: string): string[] {
    return env.gallerySql
      .exec<{ id: string }>(
        `SELECT id FROM gallery_entries
         WHERE status = 'recycled' AND owner_user_id = ?
         ORDER BY recycled_at`,
        ownerUserId,
      )
      .toArray()
      .map((row) => row.id);
  }

  async function submitFor(
    env: Harness,
    ownerUserId: string,
    day: string,
  ): Promise<number> {
    const response = await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/submit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          day,
          enforceLimit: true,
          entry: {
            id: "",
            name: "Retention probe",
            author: "",
            description: "",
            created_at: `${day}T00:00:00.000Z`,
            schema_version: CURRENT_PROJECT_FILE_VERSION,
            owner_user_id: ownerUserId,
            project_text: projectText(),
            svg_text: "<svg/>",
          },
        }),
      },
    );
    return response.status;
  }

  it("caps an account's recycled rows at the newest K on the next write", async () => {
    const env = environment();
    for (let index = 0; index < 27; index += 1) {
      seedRecycled(
        env,
        `bin-${String(index).padStart(2, "0")}`,
        "hoarder",
        `2026-08-30T10:${String(index).padStart(2, "0")}:00.000Z`,
      );
    }
    expect(await submitFor(env, "hoarder", "2026-08-31")).toBe(200);
    const remaining = recycledIds(env, "hoarder");
    expect(remaining).toHaveLength(25);
    // The oldest rows fell off; the newest stayed.
    expect(remaining[0]).toBe("bin-02");
    expect(remaining.at(-1)).toBe("bin-26");
  });

  it("leaves an anonymous-owner backlog alone, the cap being per account", async () => {
    const env = environment();
    for (let index = 0; index < 30; index += 1) {
      seedRecycled(
        env,
        `legacy-${String(index).padStart(2, "0")}`,
        "",
        `2026-08-2${index % 10}T00:00:00.000Z`,
      );
    }
    expect(await submitFor(env, "author", "2026-08-31")).toBe(200);
    const legacy = env.gallerySql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM gallery_entries
         WHERE status = 'recycled' AND owner_user_id = ''`,
      )
      .one().count;
    // The anonymous bucket is cap-exempt: these rows have no account whose
    // newest 25 could be identified, so nothing evicts them.
    expect(legacy).toBe(30);
  });

  it("tells the author when an entry was withdrawn, not when it dies", async () => {
    const env = environment();
    seedRecycled(env, "bin-mine", "author", "2026-08-30T12:00:00.000Z");
    const response = await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/mine",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerUserId: "author" }),
      },
    );
    const payload = (await response.json()) as {
      entries: { id: string; recycledAt?: string | null }[];
    };
    expect(payload.entries[0]).toMatchObject({
      id: "bin-mine",
      recycledAt: "2026-08-30T12:00:00.000Z",
    });
  });
});

// An entry in its owner's hands: version history, editing, withdrawal and
// removal.

import { describe, expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import { type GalleryEnv } from "./gallery-store";
import { AuthDO } from "./auth";
import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  projectText,
  route,
  signIn,
  submissionRequest,
  submitOne,
  wiredProjectText,
} from "./gallery.test-support";

describe("an author removes their own entry", () => {
  it("deletes it outright, without withdrawing it first", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const id = await submitOne(env, "Mine to remove", { cookie });

    const removed = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN, Cookie: cookie },
      }),
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).deleted).toBe(true);

    const gone = await route(env, new Request(`${ORIGIN}/api/gallery/${id}`));
    expect(gone.status).toBe(404);
  });

  it("refuses a stranger and an anonymous visitor", async () => {
    const env = environment();
    const owner = await makerOf(env);
    const id = await submitOne(env, "Not yours", { cookie: owner });
    const stranger = await signIn(env.authDurable, "stranger@example.com");

    const byStranger = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN, Cookie: stranger },
      }),
    );
    expect(byStranger.status).toBe(401);

    const anonymous = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN },
      }),
    );
    expect(anonymous.status).toBe(401);

    // Still standing after both refusals.
    expect(
      (await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))).status,
    ).toBe(200);
  });
});

function reviewHarness(): { authDurable: AuthDO; env: Harness } {
  const env = environment();
  return { authDurable: env.authDurable, env };
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
      "Versioned v1",
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
    expect(listed.versions).toHaveLength(3);
    expect(listed.versions[0]!.versionNo).toBe(4);
    expect(listed.versions.at(-1)!.versionNo).toBe(2);

    const prunedPreview = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${oldestVersionId}/preview.svg`,
        { headers: cookieHeaders(adminCookie) },
      ),
    );
    expect(prunedPreview.status).toBe(404);
    const prunedProject = await route(
      env,
      new Request(
        `${ORIGIN}/api/gallery/${id}/versions/${oldestVersionId}/project`,
        { headers: cookieHeaders(adminCookie) },
      ),
    );
    expect(prunedProject.status).toBe(404);

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
      "private, max-age=31536000, immutable",
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
    await signIn(authDurable, "owner@example.com");
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
    const projectPath = previewPath.replace("preview.svg", "project");
    for (const cookie of [null, strangerCookie]) {
      const denied = await route(
        env,
        new Request(projectPath, { headers: cookie ? { Cookie: cookie } : {} }),
      );
      expect(denied.status).toBe(404);
      expect(denied.headers.get("cache-control")).toBe("no-store");
    }
    const historical = await route(
      env,
      new Request(projectPath, { headers: { Cookie: ownerCookie } }),
    );
    expect(historical.status).toBe(200);
    expect(historical.headers.get("cache-control")).toBe("no-store");
    const snapshot = (await historical.json()) as { projectText: string };
    expect(Object.keys(snapshot)).toEqual(["projectText"]);
    expect(parseProject(snapshot.projectText).name).toBe("Hist v1");
    const otherId = await submitPublished(env, ownerCookie, "Other entry");
    const wrongEntry = await route(
      env,
      new Request(
        projectPath.replace(`/gallery/${id}/`, `/gallery/${otherId}/`),
        { headers: { Cookie: ownerCookie } },
      ),
    );
    expect(wrongEntry.status).toBe(404);

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

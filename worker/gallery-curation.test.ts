// Visual curation: tags and Needs attention, reviewed against the drawing.

import { describe, expect, it } from "vitest";
import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  pagedStoreBackup,
  route,
  signIn,
  submitOne,
} from "./gallery.test-support";

describe("Gallery visual curation", () => {
  async function update(
    env: Harness,
    id: string,
    cookie: string,
    overrides: Record<string, unknown> = {},
  ) {
    const current = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          headers: cookieHeaders(cookie),
        }),
      )
    ).json()) as {
      entry: { previewRevision: string; curationRevision: number };
    };
    return route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/curation`, {
        method: "PATCH",
        headers: {
          ...cookieHeaders(cookie),
          "content-type": "application/json",
          Origin: ORIGIN,
        },
        body: JSON.stringify({
          tags: [
            "amplifier",
            "differential pair",
            "cmos",
            "cascode",
            "feedback",
            "ota",
          ],
          attention: {
            status: "needs-attention",
            issues: [
              {
                kind: "suspected-disconnection",
                detail: "右侧输出导线与输出端口之间有可见间隙。",
              },
            ],
          },
          expectedPreviewRevision: current.entry.previewRevision,
          expectedCurationRevision: current.entry.curationRevision,
          ...overrides,
        }),
      }),
    );
  }
  it("preserves drawings while tagging, scopes attention to the author/admin, and permits resolution", async () => {
    const env = environment();
    const admin = await adminOf(env);
    const maker = await makerOf(env);
    const other = await signIn(env.authDurable, "other@example.com");
    const mine = await submitOne(env, "My amplifier", { cookie: maker });
    const theirs = await submitOne(env, "Other amplifier", { cookie: other });
    const before = env.gallerySql
      .exec<{ project_text: string; svg_text: string }>(
        "SELECT project_text, svg_text FROM gallery_entries WHERE id = ?",
        mine,
      )
      .one();
    expect((await update(env, mine, admin)).status).toBe(200);
    expect((await update(env, theirs, admin)).status).toBe(200);
    const after = env.gallerySql
      .exec<{ project_text: string; svg_text: string }>(
        "SELECT project_text, svg_text FROM gallery_entries WHERE id = ?",
        mine,
      )
      .one();
    expect(after).toEqual(before);
    const feed = async (cookie: string, query = "") =>
      (await (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery${query}`, {
            headers: cookieHeaders(cookie),
          }),
        )
      ).json()) as Promise<{
        entries: Array<{
          id: string;
          attention?: unknown;
          tags: string[];
        }>;
        total: number;
        filterCounts: { attention: number; netlistable: number; liked: number };
        authors: { author: string; ownerUserId: string; count: number }[];
      }>;
    const manyTags = Array.from({ length: 20 }, (_, i) => `absent${i}`);
    manyTags.push("ota");
    expect((await feed("", `?tags=${manyTags.join(",")}`)).total).toBe(2);
    const publicFeed = await feed("");
    expect(publicFeed.total).toBe(2);
    expect(publicFeed.filterCounts.attention).toBe(0);
    expect((await feed(admin, "?limit=1")).filterCounts.attention).toBe(2);
    expect((await feed(maker)).filterCounts.attention).toBe(1);
    expect((await feed(other)).filterCounts.attention).toBe(1);
    expect((await feed(maker, "?tags=absent")).filterCounts.attention).toBe(0);
    expect((await feed("", "?category=amplifiers")).total).toBe(2);
    expect(publicFeed.entries.every((e) => e.attention === undefined)).toBe(
      true,
    );
    expect(publicFeed.entries[0]!.tags).toHaveLength(6);
    expect(
      (await feed(maker, "?attention=1")).entries.map((e) => e.id),
    ).toEqual([mine]);
    expect((await feed(admin, "?attention=1")).total).toBe(2);
    const mineAuthors = (await feed(maker, "?attention=1")).authors;
    const otherAuthors = (await feed(other, "?attention=1")).authors;
    expect(mineAuthors).toHaveLength(1);
    expect(otherAuthors).toHaveLength(1);
    expect(mineAuthors[0]!.count).toBe(1);
    expect(mineAuthors[0]!.ownerUserId).not.toBe(otherAuthors[0]!.ownerUserId);
    expect((await feed(admin, "?attention=1&limit=1")).authors).toEqual(
      expect.arrayContaining([...mineAuthors, ...otherAuthors]),
    );
    expect((await feed(maker, "?attention=1&tags=absent")).authors).toEqual([]);
    // The tag counts beside the wall narrow with it: Needs attention counts
    // only what this viewer may see needing attention, Liked only their likes.
    const otaCount = async (cookie: string, query = "") => {
      const response = await route(
        env,
        new Request(`${ORIGIN}/api/gallery/tags${query}`, {
          headers: cookieHeaders(cookie),
        }),
      );
      if (response.status !== 200) return response.status;
      const { tags } = (await response.json()) as {
        tags: { tag: string; count: number }[];
      };
      return tags.find((item) => item.tag === "ota")?.count ?? 0;
    };
    expect(await otaCount("")).toBe(2);
    expect(await otaCount(admin, "?attention=1")).toBe(2);
    expect(await otaCount(maker, "?attention=1")).toBe(1);
    expect(await otaCount(maker, "?liked=1")).toBe(0);
    expect(await otaCount("", "?attention=1")).toBe(401);
    const like = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${mine}/like`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: other },
      }),
    );
    expect(like.status).toBe(200);
    expect(await otaCount(other, "?liked=1")).toBe(1);
    expect(await otaCount("", "?liked=1")).toBe(0);
    expect(
      (await feed(other)).entries.find((e) => e.id === mine)?.attention,
    ).toBeUndefined();
    const publicEntry = (await (
      await route(env, new Request(`${ORIGIN}/api/gallery/${mine}`))
    ).json()) as { entry: { attention?: unknown } };
    expect(publicEntry.entry.attention).toBeUndefined();
    expect((await update(env, mine, other)).status).toBe(403);
    expect(
      (await route(env, new Request(`${ORIGIN}/api/gallery?attention=1`)))
        .status,
    ).toBe(401);
    expect(
      (
        await update(env, mine, maker, {
          attention: { status: "resolved", issues: [] },
        })
      ).status,
    ).toBe(200);
    expect((await feed(maker, "?attention=1")).total).toBe(0);
    expect((await feed(maker, "?attention=1")).authors).toEqual([]);
    expect((await feed(maker)).filterCounts.attention).toBe(0);
    expect((await feed(admin)).filterCounts.attention).toBe(1);
    expect(await otaCount(maker, "?attention=1")).toBe(0);
    expect(await otaCount(admin, "?attention=1")).toBe(1);
    expect((await update(env, mine, maker)).status).toBe(200);
    expect((await feed(maker, "?attention=1")).total).toBe(1);
  });
  it("narrows Needs attention by reason and counts each reason", async () => {
    const env = environment();
    const admin = await adminOf(env);
    const maker = await makerOf(env);
    const other = await signIn(env.authDurable, "other@example.com");
    const supply = await submitOne(env, "Global supply", { cookie: maker });
    const broken = await submitOne(env, "Broken wire", { cookie: other });
    const fixed = await submitOne(env, "Fixed overlap", { cookie: other });
    const pending = (issues: { kind: string; detail: string }[]) => ({
      attention: { status: "needs-attention", issues },
    });
    expect(
      (
        await update(
          env,
          supply,
          admin,
          pending([{ kind: "global-vdd", detail: ".global VDD" }]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await update(
          env,
          broken,
          admin,
          pending([
            { kind: "suspected-disconnection", detail: "Gap at the output." },
            { kind: "global-vdd", detail: ".global VDD" },
          ]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await update(env, fixed, admin, {
          attention: {
            status: "resolved",
            issues: [{ kind: "overlap", detail: "Labels overlapped." }],
          },
        })
      ).status,
    ).toBe(200);
    const feed = async (cookie: string, query: string) =>
      (await (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery${query}`, {
            headers: cookieHeaders(cookie),
          }),
        )
      ).json()) as {
        entries: { id: string }[];
        total: number;
        filterCounts: {
          attention: number;
          attentionKinds?: Record<string, number>;
        };
      };
    // Each reason counts the entries still needing attention for it; a
    // resolved finding counts for nothing.
    const all = await feed(admin, "?attention=1");
    expect(all.total).toBe(2);
    expect(all.filterCounts.attentionKinds).toEqual({
      "global-vdd": 2,
      "suspected-disconnection": 1,
    });
    // Choosing a reason narrows the wall, not the reason counts beside it.
    const wiring = await feed(
      admin,
      "?attention=1&reason=suspected-disconnection",
    );
    expect(wiring.entries.map((entry) => entry.id)).toEqual([broken]);
    expect(wiring.filterCounts.attentionKinds).toEqual(
      all.filterCounts.attentionKinds,
    );
    // An author counts only their own; an unknown reason narrows nothing.
    expect(
      (await feed(maker, "?attention=1")).filterCounts.attentionKinds,
    ).toEqual({ "global-vdd": 1 });
    expect((await feed(admin, "?attention=1&reason=nonsense")).total).toBe(2);
    expect((await feed(admin, "")).filterCounts.attentionKinds).toBeUndefined();
    // The tag counts beside the wall follow the reason too.
    const tagCount = async (query: string) => {
      const { tags } = (await (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/tags${query}`, {
            headers: cookieHeaders(admin),
          }),
        )
      ).json()) as { tags: { tag: string; count: number }[] };
      return tags.find((item) => item.tag === "ota")?.count ?? 0;
    };
    expect(await tagCount("?attention=1")).toBe(2);
    expect(await tagCount("?attention=1&reason=suspected-disconnection")).toBe(
      1,
    );
  });

  it("rejects outdated reviews and invalid attention without changing metadata", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Review target", { cookie });
    expect(
      (
        await update(env, id, cookie, {
          attention: { status: "needs-attention", issues: [] },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await update(env, id, cookie, {
          expectedPreviewRevision: "old-revision",
        })
      ).status,
    ).toBe(409);
    expect((await update(env, id, cookie)).status).toBe(200);
    expect(
      (await update(env, id, cookie, { expectedCurationRevision: 0 })).status,
    ).toBe(409);
    expect(
      env.gallerySql
        .exec<{ curation_json: string }>(
          "SELECT curation_json FROM gallery_entries WHERE id = ?",
          id,
        )
        .one().curation_json,
    ).toContain('"revision":1');
  });
  it("rejects a review started before tags were republished with an identical drawing", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Metadata race", { cookie });
    await update(env, id, cookie);
    const original = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          headers: cookieHeaders(cookie),
        }),
      )
    ).json()) as { projectText: string; entry: { previewRevision: string } };
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          ...cookieHeaders(cookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Metadata race",
          description: "d",
          tags: ["new tag"],
          projectText: original.projectText,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { previewRevision: string }).previewRevision,
    ).toBe(original.entry.previewRevision);
    expect(
      (await update(env, id, cookie, { expectedCurationRevision: 1 })).status,
    ).toBe(409);
    expect(
      env.gallerySql
        .exec<{ tags: string }>(
          "SELECT tags FROM gallery_entries WHERE id = ?",
          id,
        )
        .one().tags,
    ).toBe(",new tag,");
  });

  it("includes curation in backups, version snapshots and restores", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Backed up review", { cookie });
    await update(env, id, cookie);
    await update(env, id, cookie, {
      attention: { status: "resolved", issues: [] },
    });
    const call = async (operation: string, body: unknown) =>
      (
        await env.GALLERY.getByName("gallery").fetch(
          `https://gallery/${operation}`,
          {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          },
        )
      ).json() as Promise<any>;
    const backup = await pagedStoreBackup((query) =>
      call("schema-backup", query),
    );
    const current = (backup.tables.galleryEntries as any[]).find(
      (e: any) => e.id === id,
    ).curation_json;
    expect(JSON.parse(current).attention.status).toBe("resolved");
    expect(
      (backup.tables.galleryEntryVersions as any[]).some((e: any) =>
        e.curation_json.includes("needs-attention"),
      ),
    ).toBe(true);
    await update(env, id, cookie);
    await call("schema-restore", { backup });
    expect(
      env.gallerySql
        .exec<{ curation_json: string }>(
          "SELECT curation_json FROM gallery_entries WHERE id = ?",
          id,
        )
        .one().curation_json,
    ).toBe(current);
  });
});

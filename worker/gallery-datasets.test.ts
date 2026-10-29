// Reference datasets in stores of their own (#1510).

import { describe, expect, it } from "vitest";
import { OWNER_ACCOUNT_IDS } from "./auth";
import {
  ORIGIN,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  route,
  submitOne,
} from "./gallery.test-support";

describe("reference datasets in stores of their own (#1510)", () => {
  it("lets the Owner import a dataset's circuits, which open only under their source and stay read-only", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    await submitOne(env, "Community circuit", { cookie: maker });
    const call = (path: string, init: RequestInit = {}, cookie = owner) =>
      route(
        env,
        new Request(`${ORIGIN}${path}`, {
          ...init,
          headers: {
            Origin: ORIGIN,
            Cookie: cookie,
            "content-type": "application/json",
          },
        }),
      );
    const importing = (cookie: string, entries: unknown[]) =>
      call(
        "/api/gallery/sources/analoggenie/entries",
        { method: "POST", body: JSON.stringify({ entries }) },
        cookie,
      );
    const circuit = (id: string) => ({
      id,
      name: `AnalogGenie ${id}`,
      description: "Redrawn from the dataset's figure.",
      tags: ["amplifier"],
      projectText: projectText(id),
    });

    // Only the Owner imports.
    expect((await importing(maker, [circuit("ag-308")])).status).toBe(403);
    const imported = await importing(owner, [
      circuit("ag-308"),
      // An id another dataset, or the community, would own is refused.
      circuit("ct-1"),
    ]);
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({
      source: "analoggenie",
      results: [
        { id: "ag-308", ok: true, created: true },
        { id: "ct-1", ok: false, error: "invalid-id" },
      ],
    });

    // The dataset's wall holds it under the dataset's name; the community
    // wall holds it too (#1697), the community's own store does not.
    const wall = async (query: string) =>
      (
        (await (await call(`/api/gallery${query}`)).json()) as {
          entries: { id: string; author: string }[];
        }
      ).entries;
    expect(await wall("?source=analoggenie")).toEqual([
      expect.objectContaining({
        id: "ag-308",
        author: "AnalogGenie (redrawn)",
      }),
    ]);
    expect((await wall("")).map((entry) => entry.id)).toContain("ag-308");
    expect(
      (await wall("?source=community")).map((entry) => entry.id),
    ).not.toContain("ag-308");
    expect((await call("/api/gallery/ag-308")).status).toBe(200);
    expect(
      (await (await call("/api/gallery/sources")).json()) as {
        sources: { key: string; count: number }[];
      },
    ).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ key: "analoggenie", count: 1 }),
        expect.objectContaining({ key: "circuitthink", count: 0 }),
      ]),
    });

    // Read-only: no like, update or withdraw reaches it.
    for (const [path, method] of [
      ["/api/gallery/ag-308/like", "POST"],
      ["/api/gallery/ag-308", "PUT"],
      ["/api/gallery/ag-308/recycle", "POST"],
    ] as const)
      expect(await (await call(path, { method, body: "{}" })).json()).toEqual({
        error: "dataset-read-only",
      });

    // Importing it again replaces it in place.
    expect(
      await (
        await importing(owner, [{ ...circuit("ag-308"), name: "Renamed" }])
      ).json(),
    ).toMatchObject({ results: [{ id: "ag-308", ok: true, created: false }] });
    expect(await wall("?source=analoggenie")).toEqual([
      expect.objectContaining({ id: "ag-308" }),
    ]);
  });

  it("takes an Owner token from a non-browser client, on the import alone (#1769)", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const auth = (path: string, init: RequestInit = {}) =>
      env.authDurable.fetch(
        new Request(`${ORIGIN}/api/auth/owner-tokens${path}`, {
          ...init,
          headers: { Origin: ORIGIN, Cookie: owner },
        }),
      );
    const mint = async () =>
      (await (
        await auth("", {
          method: "POST",
          body: JSON.stringify({ label: "redraw machine" }),
        })
      ).json()) as { id: string; token: string };
    const { id, token } = await mint();
    // A command-line client: no Origin, no cookie, only the bearer.
    const bearerCall = (
      path: string,
      bearer: string | null,
      init: RequestInit = {},
    ) =>
      route(
        env,
        new Request(`${ORIGIN}${path}`, {
          ...init,
          headers: {
            "content-type": "application/json",
            ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
          },
        }),
      );
    const importing = (bearer: string | null) =>
      bearerCall("/api/gallery/sources/analoggenie/entries", bearer, {
        method: "POST",
        body: JSON.stringify({
          entries: [
            { id: "ag-7", name: "AnalogGenie 7", projectText: projectText() },
          ],
        }),
      });

    const imported = await importing(token);
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({
      source: "analoggenie",
      results: [expect.objectContaining({ id: "ag-7", ok: true })],
    });

    expect((await importing(null)).status).toBe(401);
    expect((await importing("acot_wrong")).status).toBe(401);
    expect((await importing(`${token}x`)).status).toBe(401);
    // A bad bearer is refused even beside the Owner's own session.
    const withCookie = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/sources/analoggenie/entries`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: owner,
          Authorization: "Bearer acot_wrong",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entries: [
            { id: "ag-8", name: "AnalogGenie 8", projectText: projectText() },
          ],
        }),
      }),
    );
    expect(withCookie.status).toBe(401);

    // No other route takes it: not a read, not a submission.
    expect((await bearerCall("/api/gallery/ag-7", token)).status).toBe(401);
    expect(
      (
        await bearerCall("/api/gallery/submissions", token, {
          method: "POST",
          body: JSON.stringify({
            name: "Through a token",
            description: "d",
            projectText: projectText("Through a token"),
          }),
        })
      ).status,
    ).toBe(401);

    // A revoked token is refused.
    expect((await auth(`/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await importing(token)).status).toBe(401);

    // So is one whose account is no longer the Owner.
    const second = await mint();
    expect((await importing(second.token)).status).toBe(200);
    env.authSql.exec(
      "UPDATE users SET id = 'former-owner' WHERE id = ?",
      OWNER_ACCOUNT_IDS[1],
    );
    env.authSql.exec(
      "UPDATE owner_tokens SET user_id = 'former-owner' WHERE user_id = ?",
      OWNER_ACCOUNT_IDS[1],
    );
    const refused = await importing(second.token);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "owner-only" });
  });

  it("merges every dataset into the community wall: one order, counts that add up (#1697)", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    const community: string[] = [];
    for (let index = 0; index < 4; index += 1)
      community.push(
        await submitOne(env, `Community ${index}`, { cookie: maker }),
      );
    const call = (path: string, init: RequestInit = {}) =>
      route(
        env,
        new Request(`${ORIGIN}${path}`, {
          ...init,
          headers: {
            Origin: ORIGIN,
            Cookie: owner,
            "content-type": "application/json",
          },
        }),
      );
    const imported = async (key: string, ids: string[]) =>
      expect(
        (
          await call(`/api/gallery/sources/${key}/entries`, {
            method: "POST",
            body: JSON.stringify({
              entries: ids.map((id, index) => ({
                id,
                name: `Dataset ${id}`,
                tags: ["amplifier"],
                projectText: projectText(id),
                createdAt: `2026-0${index + 1}-01T00:00:00.000Z`,
              })),
            }),
          })
        ).status,
      ).toBe(200);
    await imported("analoggenie", ["ag-1", "ag-2", "ag-3"]);
    await imported("circuitthink", ["ct-1", "ct-2"]);
    const everyId = [...community, "ag-1", "ag-2", "ag-3", "ct-1", "ct-2"];

    type Page = {
      entries: { id: string; createdAt: string }[];
      nextCursor: string | null;
      total: number;
      sources: Record<string, number>;
      filterCounts: Record<string, unknown>;
    };
    const page = async (query: string) =>
      (await (await call(`/api/gallery?${query}`)).json()) as Page;
    async function walk(order: string, seed = "") {
      const seen: string[] = [];
      let cursor = "";
      for (let pages = 0; pages < 10; pages += 1) {
        const params = new URLSearchParams({ limit: "3", order, seed });
        if (cursor) params.set("cursor", cursor);
        for (const queries of env.galleryStoreQueries.values())
          queries.length = 0;
        const answer = await page(params.toString());
        if (!cursor) expect(answer.total).toBe(everyId.length);
        else {
          for (const field of ["total", "filterCounts", "authors", "sources"])
            expect(answer).not.toHaveProperty(field);
          for (const queries of env.galleryStoreQueries.values())
            expect(
              queries.filter((query) =>
                /^\s*SELECT (?:COUNT|MAX|json_extract)/iu.test(query),
              ),
            ).toEqual([]);
        }
        seen.push(...answer.entries.map((entry) => entry.id));
        if (!answer.nextCursor) break;
        cursor = answer.nextCursor;
      }
      return seen;
    }
    // Every order pages through every store's circuits once.
    for (const [order, seed] of [
      ["newest", ""],
      ["oldest", ""],
      ["random", "abc123"],
      ["parts", ""],
      ["name", ""],
      ["name-desc", ""],
    ] as const) {
      const seen = await walk(order, seed);
      expect([...seen].sort()).toEqual([...everyId].sort());
    }
    const newest = await walk("newest");
    // Ties in time fall back to the id, across stores as within one.
    expect(newest.slice(-5)).toEqual(["ag-3", "ct-2", "ag-2", "ct-1", "ag-1"]);
    expect(await walk("random", "abc123")).toEqual(
      await walk("random", "abc123"),
    );

    // Totals and filter counts add up across the stores, with each
    // dataset's share beside them; the tags too.
    const first = await page("");
    expect(first.total).toBe(9);
    expect(first.sources).toMatchObject({ analoggenie: 3, circuitthink: 2 });
    const counts = first.filterCounts as Record<string, number>;
    expect(counts.netlistable! + counts.withoutNetlist!).toBe(9);
    // Made by: AI, by hand (the community's) or from a dataset, three
    // sides that exclude each other.
    expect(counts).toMatchObject({ ai: 0, human: 4, datasets: 5 });
    const madeBy = async (ai: string) => {
      const answer = await page(`ai=${ai}`);
      return {
        total: answer.total,
        ids: answer.entries.map((entry) => entry.id).sort(),
        counts: answer.filterCounts,
      };
    };
    const datasets = await madeBy("dataset");
    expect(datasets.total).toBe(5);
    expect(datasets.ids).toEqual(["ag-1", "ag-2", "ag-3", "ct-1", "ct-2"]);
    // The side's own counts leave the choice out, so each still says what
    // choosing it would show.
    expect(datasets.counts).toMatchObject({ human: 4, datasets: 5 });
    expect((await madeBy("0")).ids).toEqual([...community].sort());
    expect((await madeBy("1")).total).toBe(0);
    const datasetTags = (await (
      await call("/api/gallery/tags?ai=dataset")
    ).json()) as { tags: { tag: string; count: number }[] };
    expect(datasetTags.tags).toContainEqual({ tag: "amplifier", count: 5 });
    const tags = (await (await call("/api/gallery/tags")).json()) as {
      tags: { tag: string; count: number }[];
    };
    expect(tags.tags).toContainEqual({ tag: "amplifier", count: 5 });
    expect((await page("source=community")).total).toBe(4);
  });
});

// Reference datasets in stores of their own (#1510).

import { describe, expect, it } from "vitest";
import { OWNER_ACCOUNT_IDS } from "./auth";
import { routeGalleryRequest } from "./gallery";
import {
  ORIGIN,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  route,
  submitOne,
  wiredProjectText,
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

    // No withdraw reaches it (a fix of its drawing does; see below); a like does, being a
    // reader's mark rather than a change of the circuit.
    expect(
      await (
        await call("/api/gallery/ag-308/like", { method: "POST", body: "{}" })
      ).json(),
    ).toMatchObject({ likedByViewer: true, likes: 1 });
    expect(
      await (
        await call("/api/gallery/ag-308/recycle", {
          method: "POST",
          body: "{}",
        })
      ).json(),
    ).toEqual({ error: "dataset-read-only" });

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

  it("lets an account with ten public circuits fix a dataset's drawing, named beside its byline", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    const call = (path: string, cookie: string, init: RequestInit = {}) =>
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
    const importing = (text: string) =>
      call("/api/gallery/sources/analoggenie/entries", owner, {
        method: "POST",
        body: JSON.stringify({
          entries: [
            {
              id: "ag-308",
              name: "AnalogGenie #308",
              description: "Redrawn from the dataset's figure.",
              tags: ["amplifier"],
              projectText: text,
            },
          ],
        }),
      });
    await importing(projectText("ag-308"));
    const fix = (cookie: string, text: string) =>
      call("/api/gallery/ag-308", cookie, {
        method: "PUT",
        body: JSON.stringify({
          name: "Ignored",
          description: "Ignored",
          projectText: text,
        }),
      });
    const entry = async () =>
      (
        (await (await call("/api/gallery/ag-308?summary=1", maker)).json()) as {
          entry: {
            name: string;
            author: string;
            description: string;
            fixedBy?: string[];
          };
        }
      ).entry;

    // Nine circuits of one's own are not yet enough.
    for (let index = 0; index < 9; index += 1)
      await submitOne(env, `Maker circuit ${index}`, { cookie: maker });
    const locked = await fix(maker, wiredProjectText("Fixed"));
    expect(locked.status).toBe(403);
    expect(await locked.json()).toEqual({
      error: "dataset-edit-locked",
      contributions: 9,
      needed: 10,
    });

    // The tenth opens it: the drawing changes, the dataset's name,
    // description and byline stay, and the fixer is named beside them.
    await submitOne(env, "Maker circuit 9", { cookie: maker });
    expect(
      await (await call("/api/gallery/quota", maker)).json(),
    ).toMatchObject({
      datasetEdits: { allowed: true, contributions: 10, needed: 10 },
    });
    expect((await fix(maker, wiredProjectText("Fixed"))).status).toBe(200);
    const fixed = await entry();
    expect(fixed).toMatchObject({
      name: "AnalogGenie #308",
      author: "AnalogGenie (redrawn)",
      description: "Redrawn from the dataset's figure.",
      fixedBy: [expect.any(String)],
    });
    expect(
      (
        (await (
          await call("/api/gallery?source=analoggenie", maker)
        ).json()) as { entries: { id: string; fixedBy?: string[] }[] }
      ).entries,
    ).toEqual([
      expect.objectContaining({ id: "ag-308", fixedBy: fixed.fixedBy }),
    ]);

    // The Owner's re-import is the dataset's own, not a fix to credit.
    await importing(wiredProjectText("Re-imported", 260));
    expect((await entry()).fixedBy).toEqual(fixed.fixedBy);
  });

  it("keeps each reader's own bookmarks of a dataset's circuits", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    const call = (path: string, cookie: string, method = "GET") =>
      route(
        env,
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: { Origin: ORIGIN, Cookie: cookie },
          ...(method === "POST"
            ? { body: JSON.stringify({ entries: [] }) }
            : {}),
        }),
      );
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/sources/analoggenie/entries`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: owner },
        body: JSON.stringify({
          entries: ["ag-1", "ag-2"].map((id) => ({
            id,
            name: id,
            projectText: projectText(id),
          })),
        }),
      }),
    );
    const kept = async (cookie: string) =>
      (await (
        await call("/api/gallery/sources/analoggenie/bookmarks", cookie)
      ).json()) as { ids: string[] };
    expect(
      await (await call("/api/gallery/ag-2/bookmark", maker, "POST")).json(),
    ).toEqual({ saved: true });
    expect(await kept(maker)).toEqual({ ids: ["ag-2"] });
    // Another reader keeps none of them; a second click lets it go.
    expect(await kept(owner)).toEqual({ ids: [] });
    expect(
      await (await call("/api/gallery/ag-2/bookmark", maker, "POST")).json(),
    ).toEqual({ saved: false });
    expect(await kept(maker)).toEqual({ ids: [] });
    expect(
      (await call("/api/gallery/ag-9/bookmark", maker, "POST")).status,
    ).toBe(404);
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
      ["likes", ""],
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

  it("sets a dataset circuit's original figure and verdict beside its entry, for licensed datasets only", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
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
    const post = (path: string, body: unknown, cookie = owner) =>
      call(path, { method: "POST", body: JSON.stringify(body) }, cookie);
    await post("/api/gallery/sources/analoggenie/entries", {
      entries: ["ag-308", "ag-309"].map((id) => ({
        id,
        name: `AnalogGenie ${id}`,
        projectText: projectText(id),
      })),
    });
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    const figure = { type: "image/png", data: png.toString("base64") };
    const comparison = {
      id: "ag-308",
      verdict: "error",
      category: "Split node",
      detail: "Node split",
      reason: "The dataset splits the M4 drain from its gate.",
      families: ["MOS"],
      sourceNetlist: "M1 (a b c d) nmos4",
      figure,
    };
    const comparisons = "/api/gallery/sources/analoggenie/comparisons";

    expect(
      (await post(comparisons, { comparisons: [comparison] }, maker)).status,
    ).toBe(403);
    // A dataset whose figures we may not show takes none.
    expect(
      (
        await post("/api/gallery/sources/analogretriever/comparisons", {
          comparisons: [{ ...comparison, id: "ar-1" }],
        })
      ).status,
    ).toBe(404);
    expect(
      await (
        await post(comparisons, {
          comparisons: [
            comparison,
            { id: "ag-309", verdict: "match" },
            { ...comparison, id: "ag-310", verdict: "wrong" },
            { ...comparison, id: "ag-311", category: "" },
            {
              ...comparison,
              id: "ag-312",
              figure: { type: "image/jpeg", data: figure.data },
            },
            { ...comparison, id: "ct-1" },
          ],
        })
      ).json(),
    ).toMatchObject({
      results: [
        { id: "ag-308", ok: true, created: true },
        { id: "ag-309", ok: false, error: "figure-required" },
        { id: "ag-310", ok: false, error: "invalid-fields" },
        { id: "ag-311", ok: false, error: "invalid-fields" },
        { id: "ag-312", ok: false, error: "invalid-figure" },
        { id: "ct-1", ok: false, error: "invalid-id" },
      ],
    });

    // Any signed-in reader lists it with its entry's name and preview.
    const listed = (await (await call(comparisons, {}, maker)).json()) as {
      comparisons: { id: string; figureRevision: string }[];
    };
    expect(listed.comparisons).toEqual([
      expect.objectContaining({
        id: "ag-308",
        name: "AnalogGenie ag-308",
        verdict: "error",
        category: "Split node",
        families: ["MOS"],
      }),
    ]);
    const revision = listed.comparisons[0]!.figureRevision;
    expect(
      (await (await call("/api/gallery/sources", {}, maker)).json()) as {
        sources: { key: string }[];
      },
    ).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({ key: "analoggenie", comparisons: 1 }),
      ]),
    });
    const image = await call(
      `${comparisons}/ag-308/figure?v=${revision}`,
      {},
      maker,
    );
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    expect(
      await (await call(`${comparisons}/ag-308`, {}, maker)).json(),
    ).toEqual({ id: "ag-308", sourceNetlist: "M1 (a b c d) nmos4" });
    // Signed out, it asks to sign in as every Gallery read does.
    expect(
      (await routeGalleryRequest(new Request(`${ORIGIN}${comparisons}`), env))
        ?.status,
    ).toBe(401);

    // Imported again without a figure, it keeps the stored one.
    const { figure: _kept, ...withoutFigure } = comparison;
    await post(comparisons, {
      comparisons: [{ ...withoutFigure, verdict: "notation" }],
    });
    expect(
      ((await (await call(comparisons)).json()) as typeof listed).comparisons,
    ).toEqual([
      expect.objectContaining({
        verdict: "notation",
        figureRevision: revision,
      }),
    ]);
  });
});

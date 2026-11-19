import { describe, expect, it } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import { componentLibraryHarness as harness } from "./component-library.test-support";
import { routeComponentLibraryRequest } from "./component-library";

function definition(name = "Custom resistor", width = 0) {
  const symbol = structuredClone(
    builtInSymbols.find((item) => item.id === "resistor")!,
  );
  symbol.viewBox.width += width;
  return {
    symbol: { ...symbol, name },
    electrical: deviceDescriptor("resistor"),
  };
}
const catalog = (extra = "") =>
  `?view=summary&catalog=1&type=all&order=newest${extra}`;
const ids = async (response: Response) =>
  ((await response.json()).entries as { id: string }[]).map(
    (entry) => entry.id,
  );

describe("private component library", () => {
  it("keeps a private record to its author while old writes stay public", async () => {
    const route = harness();
    const saved = await route(
      "PUT",
      "/private-first",
      { definition: definition(), revision: 0, visibility: "private" },
      "alice",
    );
    expect((await saved.json()).entry).toMatchObject({
      status: "private",
      revision: 1,
    });
    await route(
      "PUT",
      "/legacy-public",
      { definition: definition("Legacy"), revision: 0 },
      "alice",
    );
    expect((await route("GET", "/private-first")).status).toBe(404);
    expect(
      (await route("GET", "/private-first", undefined, "bob")).status,
    ).toBe(404);
    expect(
      (await route("GET", "/private-first", undefined, "admin")).status,
    ).toBe(200);
    expect(
      (await route("GET", "/private-first", undefined, "alice")).status,
    ).toBe(200);
    expect(
      await ids(await route("GET", catalog(), undefined, "alice")),
    ).toEqual(["legacy-public"]);
    expect(await ids(await route("GET", "", undefined, "alice"))).toEqual([
      "legacy-public",
    ]);
    expect(
      (
        await ids(
          await route(
            "GET",
            catalog("&author=alice&private=1"),
            undefined,
            "alice",
          ),
        )
      ).sort(),
    ).toEqual(["legacy-public", "private-first"]);
    expect(
      await ids(await route("GET", catalog("&private=1"), undefined, "bob")),
    ).toEqual(["legacy-public"]);
    // Exact content stays refused, whatever the visibility.
    const duplicate = await route(
      "PUT",
      "/private-copy",
      { definition: definition(), revision: 0, visibility: "public" },
      "alice",
    );
    expect(await duplicate.json()).toMatchObject({
      code: "COMPONENT_ALREADY_PUBLISHED",
      existing: { id: "private-first" },
    });
  });

  it("finds the author's own records of one name, trimmed and in any case", async () => {
    const route = harness();
    await route(
      "PUT",
      "/name-private",
      {
        definition: definition("ADC core"),
        revision: 0,
        visibility: "private",
      },
      "alice",
    );
    await route(
      "PUT",
      "/name-public",
      { definition: definition("adc CORE", 1), revision: 0 },
      "alice",
    );
    await route(
      "PUT",
      "/name-bob",
      { definition: definition("ADC core"), revision: 0 },
      "bob",
    );
    expect((await route("GET", "?view=same-name&name=ADC")).status).toBe(401);
    const found = await (
      await route(
        "GET",
        "?view=same-name&name=%20Adc%20Core%20",
        undefined,
        "alice",
      )
    ).json();
    expect(
      found.entries.map((entry: { id: string; status: string }) => [
        entry.id,
        entry.status,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["name-private", "private"],
        ["name-public", "shared"],
      ]),
    );
    expect(found.entries).toHaveLength(2);
  });

  it("keeps each replaced definition as a version and changes visibility explicitly", async () => {
    const route = harness();
    await route(
      "PUT",
      "/versioned-one",
      { definition: definition("Amp"), revision: 0, visibility: "private" },
      "alice",
    );
    const second = await (
      await route(
        "PUT",
        "/versioned-one",
        { definition: definition("Amp", 2), revision: 1 },
        "alice",
      )
    ).json();
    expect(second).toMatchObject({
      outcome: "updated",
      entry: { revision: 2, status: "private" },
    });
    const versions = await (
      await route("GET", "/versioned-one?view=versions", undefined, "alice")
    ).json();
    expect(versions).toMatchObject({
      id: "versioned-one",
      revision: 2,
      versions: [{ revision: 1, sourceId: "versioned-one", name: "Amp" }],
    });
    expect(
      (await route("GET", "/versioned-one?view=versions", undefined, "bob"))
        .status,
    ).toBe(404);
    // Same content, new visibility: a revision, no new version.
    const published = await (
      await route(
        "PUT",
        "/versioned-one",
        { definition: definition("Amp", 2), revision: 2, visibility: "public" },
        "alice",
      )
    ).json();
    expect(published.entry).toMatchObject({ revision: 3, status: "shared" });
    expect(
      (
        await (
          await route("GET", "/versioned-one?view=versions", undefined, "alice")
        ).json()
      ).versions,
    ).toHaveLength(1);
    expect(
      (
        await route(
          "PATCH",
          "/versioned-one",
          { revision: 3, action: "make-private" },
          "bob",
        )
      ).status,
    ).toBe(403);
    const hidden = await (
      await route(
        "PATCH",
        "/versioned-one",
        { revision: 3, action: "make-private" },
        "alice",
      )
    ).json();
    expect(hidden.entry).toMatchObject({ revision: 4, status: "private" });
    expect(
      (
        await (
          await route(
            "PATCH",
            "/versioned-one",
            { revision: 3, action: "make-private" },
            "alice",
          )
        ).json()
      ).outcome,
    ).toBe("unchanged");
    expect(await ids(await route("GET", catalog()))).toEqual([]);
    const shown = await (
      await route(
        "PATCH",
        "/versioned-one",
        { revision: 4, action: "make-public" },
        "alice",
      )
    ).json();
    expect(shown.entry).toMatchObject({ revision: 5, status: "shared" });
    // Deleting a private record restores it to private.
    await route(
      "PATCH",
      "/versioned-one",
      { revision: 5, action: "make-private" },
      "alice",
    );
    await route(
      "PATCH",
      "/versioned-one",
      { revision: 6, action: "delete" },
      "alice",
    );
    const restored = await (
      await route(
        "PATCH",
        "/versioned-one",
        { revision: 7, action: "restore" },
        "alice",
      )
    ).json();
    expect(restored.entry).toMatchObject({ status: "private" });
  });
});

describe("component consolidation", () => {
  function admin(
    route: ReturnType<typeof harness>,
    body: unknown,
    user = "admin",
  ) {
    return routeComponentLibraryRequest(
      new Request("https://components.test/api/admin/components/consolidate", {
        method: "POST",
        headers: {
          origin: "https://components.test",
          cookie: `icm_session=${user}`,
        },
        body: JSON.stringify(body),
      }),
      route.env,
    ) as Promise<Response>;
  }
  function seedDuplicates(route: ReturnType<typeof harness>) {
    for (const [id, at, width] of [
      ["adc-oldest", "2026-01-01T00:00:00Z", 0],
      ["adc-middle", "2026-02-01T00:00:00Z", 1],
      ["adc-newest", "2026-03-01T00:00:00Z", 2],
    ] as const)
      route.seed({
        id,
        authorId: "alice",
        definition: definition("Historical", width),
        createdAt: at,
      });
    route.seed({
      id: "adc-bob-only",
      authorId: "bob",
      definition: definition("Historical"),
    });
    route.seed({
      id: "alice-other",
      authorId: "alice",
      definition: definition("Historical"),
      status: "official",
    });
  }

  it("is administrator-only and reports a dry run without changing anything", async () => {
    const route = harness();
    seedDuplicates(route);
    expect((await admin(route, {}, "alice")).status).toBe(403);
    expect((await admin(route, { makePrivate: ["no"] })).status).toBe(400);
    const plan = await (
      await admin(route, { makePrivate: ["adc-bob-only", "missing-record"] })
    ).json();
    expect(plan).toMatchObject({
      dryRun: true,
      planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      groups: [
        {
          authorId: "alice",
          name: "historical",
          keep: { id: "adc-newest", revision: 1 },
          fold: [
            { id: "adc-middle", revision: 1 },
            { id: "adc-oldest", revision: 1 },
          ],
          outcome: "would-fold",
        },
      ],
      private: [
        { id: "adc-bob-only", outcome: "would-make-private", revision: 1 },
        { id: "missing-record", outcome: "skipped", reason: "not-found" },
      ],
      totals: { groups: 1, records: 2, private: 1, skipped: 1, failed: 0 },
    });
    expect((await ids(await route("GET", catalog()))).sort()).toEqual([
      "adc-bob-only",
      "adc-middle",
      "adc-newest",
      "adc-oldest",
      "alice-other",
    ]);
  });

  it("applies exactly the reviewed plan, atomically per group and idempotently", async () => {
    const route = harness();
    seedDuplicates(route);
    const plan = await (
      await admin(route, { makePrivate: ["adc-bob-only"] })
    ).json();
    expect(
      (
        await admin(route, {
          dryRun: false,
          makePrivate: ["adc-bob-only"],
          planDigest: "0".repeat(64),
        })
      ).status,
    ).toBe(409);
    const applied = await (
      await admin(route, {
        dryRun: false,
        makePrivate: ["adc-bob-only"],
        planDigest: plan.planDigest,
      })
    ).json();
    expect(applied).toMatchObject({
      dryRun: false,
      groups: [{ outcome: "folded", keep: { id: "adc-newest" } }],
      private: [{ id: "adc-bob-only", outcome: "made-private", revision: 2 }],
    });
    expect(await ids(await route("GET", catalog()))).toEqual([
      "adc-newest",
      "alice-other",
    ]);
    const folded = await (
      await route("GET", "/adc-oldest", undefined, "alice")
    ).json();
    expect(folded.entry).toMatchObject({
      status: "superseded",
      supersededBy: "adc-newest",
      revision: 2,
    });
    expect((await route("GET", "/adc-oldest", undefined, "bob")).status).toBe(
      404,
    );
    const versions = await (
      await route("GET", "/adc-newest?view=versions", undefined, "alice")
    ).json();
    expect(
      versions.versions.map(
        (version: { sourceId: string }) => version.sourceId,
      ),
    ).toEqual(["adc-middle", "adc-oldest"]);
    const refused = await route(
      "PUT",
      "/adc-oldest",
      { definition: definition("Historical", 9), revision: 2 },
      "alice",
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "COMPONENT_SUPERSEDED",
      supersededBy: "adc-newest",
    });
    const again = await (
      await admin(route, { dryRun: false, makePrivate: ["adc-bob-only"] })
    ).json();
    expect(again).toMatchObject({
      groups: [],
      private: [{ id: "adc-bob-only", outcome: "unchanged" }],
      totals: { groups: 0, records: 0, private: 0 },
    });
  });
});

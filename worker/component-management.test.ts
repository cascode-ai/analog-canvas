import { expect, it } from "vitest";
import { componentLibraryHarness } from "./component-library.test-support";

it("authors remove and restore their own records while moderator removals stay protected", async () => {
  const route = componentLibraryHarness();
  route.seed({
    id: "broken-own",
    authorId: "alice",
    definition: { broken: true },
    status: "official",
  });
  expect(
    (
      await route(
        "PATCH",
        "/broken-own",
        { revision: 1, action: "delete" },
        "bob",
      )
    ).status,
  ).toBe(403);
  const removed = await route(
    "PATCH",
    "/broken-own",
    { revision: 1, action: "delete" },
    "alice",
  );
  expect(removed.status).toBe(200);
  expect((await removed.json()).entry).toMatchObject({
    revision: 2,
    status: "deleted",
    deletion: { by: "author", previousStatus: "official" },
  });
  expect((await route("GET", "/broken-own")).status).toBe(404);
  expect((await route("GET", "/broken-own", undefined, "bob")).status).toBe(
    404,
  );
  expect((await route("GET", "/broken-own", undefined, "alice")).status).toBe(
    200,
  );
  expect(
    (
      await route(
        "PATCH",
        "/broken-own",
        { revision: 1, action: "delete" },
        "alice",
      )
    ).status,
  ).toBe(200);
  const restored = await route(
    "PATCH",
    "/broken-own",
    { revision: 2, action: "restore" },
    "alice",
  );
  expect((await restored.json()).entry).toMatchObject({
    revision: 3,
    status: "official",
  });
  expect(
    (
      await route(
        "PATCH",
        "/broken-own",
        { revision: 3, action: "delete" },
        "admin",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await route(
        "PATCH",
        "/broken-own",
        { revision: 4, action: "restore" },
        "alice",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await route(
        "PATCH",
        "/broken-own",
        { revision: 3, action: "restore" },
        "admin",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await route(
        "PATCH",
        "/broken-own",
        { revision: 4, action: "restore" },
        "admin",
      )
    ).status,
  ).toBe(200);
});

it("isolates deleted discovery, legacy tombstones and metadata-only management", async () => {
  const route = componentLibraryHarness();
  for (const authorId of ["alice", "bob"])
    route.seed({
      id: `${authorId}-legacy`,
      authorId,
      definition: {},
      status: "deleted",
    });
  expect((await route("GET", "?status=deleted")).status).toBe(403);
  for (const suffix of [
    "?status=deleted",
    "?status=deleted&view=summary&catalog=1",
  ]) {
    const page = await (await route("GET", suffix, undefined, "alice")).json();
    expect(page.entries.map((e: { id: string }) => e.id)).toEqual([
      "alice-legacy",
    ]);
    if (page.authors)
      expect(page.authors.map((a: { authorId: string }) => a.authorId)).toEqual(
        ["alice"],
      );
    const admin = await (await route("GET", suffix, undefined, "admin")).json();
    expect(admin.entries).toHaveLength(2);
  }
  expect(
    (
      await route(
        "PATCH",
        "/alice-legacy",
        { revision: 1, action: "restore" },
        "alice",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await route(
        "PATCH",
        "/alice-legacy",
        { revision: 1, status: "official" },
        "alice",
      )
    ).status,
  ).toBe(403);
  expect(
    (await route("GET", "/bob-legacy?view=preview", undefined, "alice")).status,
  ).toBe(404);
});

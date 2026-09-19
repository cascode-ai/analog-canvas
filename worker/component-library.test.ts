import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import {
  ComponentLibraryDO,
  routeComponentLibraryRequest,
  type ComponentLibraryEnv,
} from "./component-library";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function harness() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const durable = new ComponentLibraryDO({
    storage: {
      sql: {
        exec<T>(sql: string, ...bindings: (string | number | null)[]) {
          const statement = db.prepare(sql);
          if (sql.trim().startsWith("SELECT"))
            return { toArray: () => statement.all(...bindings) as T[] };
          statement.run(...bindings);
          return { toArray: () => [] as T[] };
        },
      },
      transactionSync<T>(fn: () => T): T {
        db.exec("BEGIN");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  });
  const env: ComponentLibraryEnv = {
    COMPONENT_LIBRARY: {
      getByName: () => ({
        fetch: (input, init) => durable.fetch(new Request(input, init)),
      }),
    },
    AUTH: {
      getByName: () => ({
        fetch: async (input, init) => {
          const request =
            typeof input === "string" ? new Request(input, init) : input;
          const id = request.headers.get("cookie")?.split("=")[1];
          return Response.json({
            user: id
              ? {
                  id,
                  displayName: id,
                  isAdmin: id === "admin",
                  role: id === "moderator" ? "moderator" : "user",
                }
              : null,
          });
        },
      }),
    },
  };
  return (
    method = "GET",
    suffix = "",
    body?: unknown,
    user?: string,
    origin = "https://components.test",
  ) =>
    routeComponentLibraryRequest(
      new Request(`https://components.test/api/components${suffix}`, {
        method,
        headers: { origin, ...(user ? { cookie: `icm_session=${user}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    ) as Promise<Response>;
}
function definition(name = "Custom resistor") {
  return {
    symbol: { ...builtInSymbols.find((item) => item.id === "resistor")!, name },
    electrical: deviceDescriptor("resistor"),
  };
}

describe("public component library", () => {
  it("requires sign-in and same-origin saves; every saved component is public", async () => {
    const route = harness();
    const body = { definition: definition(), revision: 0 };
    expect((await route("PUT", "/component-1", body)).status).toBe(401);
    expect(
      (
        await route(
          "PUT",
          "/component-1",
          body,
          "alice",
          "https://elsewhere.test",
        )
      ).status,
    ).toBe(403);
    const saved = await (
      await route("PUT", "/component-1", body, "alice")
    ).json();
    expect(saved.entry).toMatchObject({
      authorId: "alice",
      status: "shared",
      revision: 1,
      definition: {
        symbol: { id: "user-component-1-r1" },
        electrical: { symbolId: "user-component-1-r1" },
      },
    });
    expect((await (await route()).json()).entries).toEqual([saved.entry]);
    expect((await (await route("GET", "/component-1")).json()).entry).toEqual(
      saved.entry,
    );
  });
  it("protects author ownership and detects stale concurrent edits", async () => {
    const route = harness();
    await route(
      "PUT",
      "/component-1",
      { definition: definition(), revision: 0 },
      "alice",
    );
    const update = { definition: definition("Revised"), revision: 1 };
    expect((await route("PUT", "/component-1", update, "bob")).status).toBe(
      403,
    );
    expect(
      (await route("PUT", "/component-1", update, "moderator")).status,
    ).toBe(403);
    expect((await route("PUT", "/component-1", update, "alice")).status).toBe(
      200,
    );
    expect((await route("PUT", "/component-1", update, "alice")).status).toBe(
      409,
    );
    const latest = (await (await route("GET", "/component-1")).json()).entry;
    expect(latest.definition.symbol.id).toBe("user-component-1-r2");
    expect(latest.authorId).toBe("alice");
  });
  it("reserves promotion and deletion for admins and preserves the stored definition", async () => {
    const route = harness();
    const saved = (
      await (
        await route(
          "PUT",
          "/component-1",
          { definition: definition(), revision: 0 },
          "alice",
        )
      ).json()
    ).entry;
    const promote = { status: "official", revision: 1 };
    expect(
      (await route("PATCH", "/component-1", promote, "alice")).status,
    ).toBe(403);
    expect(
      (await route("PATCH", "/component-1", promote, "moderator")).status,
    ).toBe(403);
    expect(
      (await route("PATCH", "/component-1", promote, "admin")).status,
    ).toBe(200);
    expect(
      (
        await route(
          "PUT",
          "/component-1",
          { definition: definition(), revision: 2 },
          "alice",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await route(
          "PATCH",
          "/component-1",
          { status: "deleted", revision: 2 },
          "admin",
        )
      ).status,
    ).toBe(200);
    expect((await route("GET", "/component-1")).status).toBe(404);
    expect((await (await route()).json()).entries).toEqual([]);
    expect((await route("GET", "?status=deleted")).status).toBe(403);
    const deleted = (
      await (await route("GET", "?status=deleted", undefined, "admin")).json()
    ).entries[0];
    expect(deleted.definition).toEqual(saved.definition);
    await route(
      "PATCH",
      "/component-1",
      { status: "shared", revision: 3 },
      "admin",
    );
    expect((await (await route()).json()).entries[0].authorId).toBe("alice");
  });
  it("paginates and searches the growing library without omitting matches", async () => {
    const route = harness();
    for (const [id, name] of [
      ["component-1", "Alpha"],
      ["component-2", "Beta"],
      ["component-3", "Alpha Two"],
    ])
      await route(
        "PUT",
        `/${id}`,
        { definition: definition(name), revision: 0 },
        "alice",
      );
    const first = await (await route("GET", "?limit=1.5&q=alpha")).json();
    const next = await (
      await route("GET", `?limit=1&q=alpha&cursor=${first.nextCursor}`)
    ).json();
    expect(first.entries.map((item: { id: string }) => item.id)).toEqual([
      "component-1",
    ]);
    expect(next.entries.map((item: { id: string }) => item.id)).toEqual([
      "component-3",
    ]);
    expect(next.nextCursor).toBeNull();
  });
  it("rejects inconsistent pins, project-dependent definitions and oversized input", async () => {
    const route = harness();
    const broken = definition();
    broken.electrical = { ...broken.electrical!, pinOrder: ["missing"] };
    expect(
      (
        await route(
          "PUT",
          "/component-1",
          { definition: broken, revision: 0 },
          "alice",
        )
      ).status,
    ).toBe(400);
    const dependent = {
      ...definition(),
      generatedFrom: { name: "Cell", terminals: [] },
    };
    expect(
      (
        await route(
          "PUT",
          "/component-1",
          { definition: dependent, revision: 0 },
          "alice",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await route(
          "PUT",
          "/component-1",
          { definition: "x".repeat(140_000), revision: 0 },
          "alice",
        )
      ).status,
    ).toBe(413);
    expect((await (await route()).json()).entries).toEqual([]);
  });
});

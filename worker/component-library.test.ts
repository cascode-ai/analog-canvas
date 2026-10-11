import {
  componentLibraryHarness as harness,
  nativePackage,
} from "./component-library.test-support";
import { describe, expect, it, vi } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import { ComponentDefinitionSchema } from "@icm/model";
import type { CircuitComponentPackage } from "@icm/edit-engine";

function definition(name = "Custom resistor") {
  return {
    symbol: { ...builtInSymbols.find((item) => item.id === "resistor")!, name },
    electrical: deviceDescriptor("resistor"),
  };
}

describe("public component library", () => {
  it("browses lightweight capabilities without source and reads a revision-bound preview", async () => {
    const route = harness();
    const native = nativePackage();
    await route("PUT", "/native-summary", { ...native, revision: 0 }, "alice");
    await route(
      "PUT",
      "/symbol-summary",
      { definition: { symbol: definition().symbol }, revision: 0 },
      "alice",
    );
    const page = await (await route("GET", "?view=summary")).json();
    expect(page.entries).toEqual([
      expect.objectContaining({
        id: "native-summary",
        name: "Packaged resistor",
        capability: "circuit",
        pinCount: 2,
      }),
      expect.objectContaining({
        id: "symbol-summary",
        capability: "symbol-only",
      }),
    ]);
    expect(page.entries[0]).not.toHaveProperty("definition");
    expect(page.entries[0]).not.toHaveProperty("circuit");
    expect(JSON.stringify(page).length).toBeLessThan(2000);
    const preview = await route(
      "GET",
      "/native-summary?view=preview&revision=1",
    );
    expect(preview.status).toBe(200);
    expect((await preview.json()).symbol.name).toBe("Packaged resistor");
    const identity = await route(
      "GET",
      "/native-summary?view=identity&revision=1",
    );
    expect(identity.status).toBe(200);
    expect(await identity.json()).toEqual({
      id: "native-summary",
      revision: 1,
      status: "shared",
    });
    expect(
      (await route("GET", "/native-summary?view=identity&revision=2")).status,
    ).toBe(409);
    expect(
      (await route("GET", "/native-summary?view=preview&revision=2")).status,
    ).toBe(409);
    expect(
      (await (await route("GET", "/native-summary")).json()).entry.circuit
        .source,
    ).toBeDefined();
  });
  it("expires publication recovery after seven days without replaying a stale receipt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
      const route = harness();
      const body = {
        ...nativePackage(),
        revision: 0,
        idempotencyKey: "publication-expiry",
      };
      expect((await route("PUT", "/native-expiry", body, "alice")).status).toBe(
        200,
      );
      vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
      expect((await route("PUT", "/native-expiry", body, "alice")).status).toBe(
        200,
      );
      vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
      expect((await route("PUT", "/native-expiry", body, "alice")).status).toBe(
        409,
      );
      expect(
        (await (await route("GET", "/native-expiry")).json()).entry.revision,
      ).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("recovers the exact public snapshot after a lost publish reply and refuses key reuse for different writes", async () => {
    const route = harness();
    const body = {
      ...nativePackage(),
      revision: 0,
      idempotencyKey: "publish-request-one",
    };
    const first = await route("PUT", "/native-recover", body, "alice");
    expect(first.status).toBe(200);
    const receipt = await first.json();
    const retry = await route("PUT", "/native-recover", body, "alice");
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(receipt);
    const changed = structuredClone(body);
    changed.definition.symbol.name = "Different request";
    expect(
      (await route("PUT", "/native-recover", changed, "alice")).status,
    ).toBe(409);
    expect((await route("PUT", "/native-recover", body, "bob")).status).toBe(
      403,
    );
    const next = {
      ...body,
      revision: 1,
      idempotencyKey: "publish-request-two",
    };
    expect((await route("PUT", "/native-recover", next, "alice")).status).toBe(
      200,
    );
    const recovered = await route("PUT", "/native-recover", body, "alice");
    expect((await recovered.json()).entry.revision).toBe(1);
    expect(
      (await (await route("GET", "/native-recover")).json()).entry.revision,
    ).toBe(2);
  });
  it("stores a complete native snapshot with explicit dependencies and refuses inconsistent updates atomically", async () => {
    const route = harness();
    const packaged = nativePackage();
    const body = { ...packaged, revision: 0 };
    expect((await route("PUT", "/native-package", body)).status).toBe(401);
    expect(
      (
        await route(
          "PUT",
          "/native-package",
          body,
          "alice",
          "https://elsewhere.test",
        )
      ).status,
    ).toBe(403);
    const response = await route("PUT", "/native-package", body, "alice");
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = (await response.json()).entry;
    expect(saved.circuit.source).toEqual(packaged.circuit.source);
    expect(saved.circuit.externalDefinition.symbolId).toBe(
      "user-native-package-r1",
    );
    expect(saved.definition.circuitBinding).toEqual(
      packaged.definition.circuitBinding,
    );
    expect((await (await route()).json()).entries).toEqual([saved]);
    expect(
      (await (await route("GET", "/native-package")).json()).entry,
    ).toEqual(saved);
    const invalid: [string, (value: CircuitComponentPackage) => void][] = [
      [
        "wrong format version",
        (value) => {
          (value.circuit as { version: number }).version = 2;
        },
      ],
      [
        "wrong source owner",
        (value) => {
          value.circuit.source.id = "unrelated";
        },
      ],
      [
        "missing entry",
        (value) => {
          value.circuit.externalDefinition.implementation = {
            kind: "source",
            sourceId: "source-resistor",
            entry: "missing",
          };
        },
      ],
      [
        "unsafe path",
        (value) => {
          value.circuit.source.files[0]!.path = "../escape.spice";
        },
      ],
      [
        "duplicate path",
        (value) => {
          value.circuit.source.files.push(value.circuit.source.files[0]!);
        },
      ],
      [
        "unrelated owned file",
        (value) => {
          value.circuit.source.files.push({
            path: "private.spice",
            text: "* Unrelated Project file\n",
          });
        },
      ],
      [
        "draft bytes",
        (value) => {
          value.circuit.source.draft = {
            baseRevision: 1,
            entry: "model.spice",
            files: value.circuit.source.files,
          };
        },
      ],
      [
        "unapplied source",
        (value) => {
          value.circuit.source.revision = 0;
        },
      ],
      [
        "unknown terminal",
        (value) => {
          value.definition.circuitBinding!.terminals[0]!.terminalId = "missing";
        },
      ],
      [
        "unknown graphical pin",
        (value) => {
          value.definition.circuitBinding!.terminals[0] = {
            terminalId: "p",
            pinName: "missing",
          };
        },
      ],
      [
        "competing primitive",
        (value) => {
          value.definition.electrical =
            ComponentDefinitionSchema.parse(definition()).electrical!;
        },
      ],
      [
        "stale formal order",
        (value) => {
          value.circuit.externalDefinition.terminals.reverse();
        },
      ],
      [
        "stale default",
        (value) => {
          value.circuit.externalDefinition.formalParameters[0]!.defaultValue =
            "2k";
        },
      ],
      [
        "invalid digest",
        (value) => {
          value.circuit.source.dependencies[0]!.sha256 = "bad";
        },
      ],
      [
        "duplicate dependency identity",
        (value) => {
          value.circuit.source.dependencies.push({
            ...value.circuit.source.dependencies[0]!,
            mountPath: "vendor/another.spice",
          });
        },
      ],
      [
        "two file owners",
        (value) => {
          value.circuit.source.files.push({
            path: "vendor/models.spice",
            text: "* Third-party bytes must not replace a dependency\n",
          });
        },
      ],
    ];
    for (const [reason, change] of invalid) {
      const value = structuredClone(packaged);
      change(value);
      expect(
        (
          await route(
            "PUT",
            "/native-package",
            { ...value, revision: 1 },
            "alice",
          )
        ).status,
        reason,
      ).toBe(400);
      expect(
        (await (await route("GET", "/native-package")).json()).entry,
        reason,
      ).toEqual(saved);
    }
    await expect(
      route.durable.fetch(
        new Request("https://components/save", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            revision: 1,
            id: "native-package",
            userId: "alice",
            definition: {
              ...packaged.definition,
              circuitBinding: { definitionId: "missing", terminals: [] },
            },
          }),
        }),
      ),
    ).rejects.toThrow();
    expect(
      (await (await route("GET", "/native-package")).json()).entry,
    ).toEqual(saved);
    expect(
      (
        await route(
          "PUT",
          "/native-package",
          { ...packaged, revision: 1 },
          "bob",
        )
      ).status,
    ).toBe(403);
    expect((await route("PUT", "/native-package", body, "alice")).status).toBe(
      409,
    );
    const oversized = structuredClone(packaged);
    oversized.circuit.source.files[0]!.text += "* " + "界".repeat(50_000);
    expect(
      (
        await route(
          "PUT",
          "/native-package",
          { ...oversized, revision: 1 },
          "alice",
        )
      ).status,
    ).toBe(413);
    expect(
      (await (await route("GET", "/native-package")).json()).entry,
    ).toEqual(saved);
    expect(
      (
        await route(
          "PATCH",
          "/native-package",
          { status: "official", revision: 1 },
          "admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await route(
          "PUT",
          "/native-package",
          { ...packaged, revision: 2 },
          "alice",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await route(
          "PUT",
          "/native-package",
          { ...packaged, revision: 2 },
          "admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await route(
          "PATCH",
          "/native-package",
          { status: "deleted", revision: 3 },
          "admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await route(
          "PUT",
          "/native-package",
          { ...packaged, revision: 4 },
          "admin",
        )
      ).status,
    ).toBe(409);
    expect((await route("GET", "/native-package")).status).toBe(404);
    const deleted = (
      await (await route("GET", "?status=deleted", undefined, "admin")).json()
    ).entries[0];
    expect(deleted.circuit.source).toEqual(packaged.circuit.source);
    expect(deleted.authorId).toBe("alice");
  });
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
  it("removes every component an account shared when the account is deleted", async () => {
    const route = harness();
    for (const [id, user] of [
      ["component-1", "alice"],
      ["component-2", "alice"],
      ["component-3", "bob"],
    ] as const)
      await route(
        "PUT",
        `/${id}`,
        { definition: definition(), revision: 0 },
        user,
      );
    const removed = await route.durable.fetch(
      new Request("https://components/delete-author", {
        method: "POST",
        body: JSON.stringify({ userId: "alice" }),
      }),
    );
    expect(await removed.json()).toEqual({ deleted: 2 });
    const left = (await (await route()).json()).entries as {
      authorId: string;
    }[];
    expect(left.map((entry) => entry.authorId)).toEqual(["bob"]);
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
    expect(
      (await route("GET", "/component-1?view=identity&revision=3")).status,
    ).toBe(404);
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

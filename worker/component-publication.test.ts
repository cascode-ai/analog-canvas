import { describe, expect, it } from "vitest";
import {
  componentLibraryHarness,
  nativePackage,
} from "./component-library.test-support";
import { componentPublicationContent } from "../apps/editor/src/features/user-components/component-publication-content";
import { publishedComponentPayload } from "../apps/editor/src/features/user-components/component-library-contract";

describe("publication identity across repackaging and recovery", () => {
  it("keeps zero-pin native packages, syntax and symbol-only definitions distinct", () => {
    const native = nativePackage();
    native.definition.symbol.pins = [];
    native.definition.symbol.hierarchicalBlock = true;
    native.definition.circuitBinding!.terminals = [];
    native.circuit.externalDefinition.terminals = [];
    native.circuit.source.files = [
      {
        path: "model.spice",
        text: ".subckt pkg_resistor params: value=1k\nR1 0 0 {value}\n.ends pkg_resistor\n",
      },
    ];
    native.circuit.source.dependencies = [];
    const spectre = structuredClone(native);
    spectre.circuit.source.language = "spectre";
    spectre.circuit.source.files[0]!.text =
      "subckt pkg_resistor\nparameters value=1k\nR1 (0 0) resistor r=value\nends pkg_resistor\n";
    const symbol = structuredClone(native.definition.symbol);
    delete symbol.hierarchicalBlock;
    symbol.decorative = true;
    const artwork = { definition: { symbol } };
    expect(componentPublicationContent(native)).not.toBe(
      componentPublicationContent(spectre),
    );
    expect(componentPublicationContent(artwork)).not.toBe(
      componentPublicationContent(native),
    );
    const variant = structuredClone(artwork);
    variant.definition.symbol.name += " variant";
    expect(componentPublicationContent(variant)).not.toBe(
      componentPublicationContent(artwork),
    );
  });
  it("ignores owned IDs and local source counters, preserves authored bytes and dependency identity", () => {
    const original = nativePackage();
    const copy = publishedComponentPayload(original, "different-id", 4);
    copy.circuit!.source.id = "copied-source";
    copy.circuit!.source.revision = 23;
    copy.circuit!.externalDefinition.id = "copied-owner";
    copy.circuit!.externalDefinition.implementation!.sourceId = "copied-source";
    copy.definition.circuitBinding!.definitionId = "copied-owner";
    copy.circuit!.externalDefinition.terminals.forEach((terminal, index) => {
      terminal.id = `copied-${index}`;
      copy.definition.circuitBinding!.terminals[index]!.terminalId =
        terminal.id;
    });
    expect(componentPublicationContent(copy)).toBe(
      componentPublicationContent(original),
    );
    for (const mutate of [
      (item: typeof copy) => {
        item.definition.symbol.name += " variant";
      },
      (item: typeof copy) => {
        item.definition.symbol.viewBox.width += 2;
      },
      (item: typeof copy) => {
        item.circuit!.source.files[0]!.text += "* Comment\n";
      },
      (item: typeof copy) => {
        item.circuit!.source.dependencies[0]!.id = "different-vendor";
      },
      (item: typeof copy) => {
        item.circuit!.source.dependencies[0]!.sha256 = "b".repeat(64);
      },
      (item: typeof copy) => {
        item.circuit!.externalDefinition.terminals.reverse();
        item.circuit!.source.files[0]!.text =
          item.circuit!.source.files[0]!.text.replace(
            "pkg_resistor P N",
            "pkg_resistor N P",
          );
      },
      (item: typeof copy) => {
        item.definition.circuitBinding!.terminals.reverse();
      },
    ]) {
      const variant = structuredClone(copy);
      mutate(variant);
      expect(componentPublicationContent(variant)).not.toBe(
        componentPublicationContent(original),
      );
    }
  });
  it("returns unchanged without moving version or time, after permission and revision checks", async () => {
    const route = componentLibraryHarness();
    const original = nativePackage();
    const first = await (
      await route(
        "PUT",
        "/unchanged-native",
        { ...original, revision: 0 },
        "alice",
      )
    ).json();
    const update = {
      ...original,
      revision: 1,
      idempotencyKey: "unchanged-request",
    };
    const result = await (
      await route("PUT", "/unchanged-native", update, "alice")
    ).json();
    expect(result).toEqual({ entry: first.entry, outcome: "unchanged" });
    expect(
      await (await route("PUT", "/unchanged-native", update, "alice")).json(),
    ).toEqual(result);
    expect(
      (
        await route(
          "PUT",
          "/unchanged-native",
          { ...update, revision: 0 },
          "alice",
        )
      ).status,
    ).toBe(409);
    expect(
      (await route("PUT", "/unchanged-native", update, "bob")).status,
    ).toBe(403);
  });
  it("backfills exact historical duplicates without changing their records, isolates invalid history, and serializes concurrent creates", async () => {
    const route = componentLibraryHarness();
    const payload = nativePackage();
    route.seed({
      id: "history-first",
      authorId: "alice",
      definition: publishedComponentPayload(payload, "history-first", 1),
    });
    route.seed({
      id: "history-second",
      authorId: "alice",
      definition: publishedComponentPayload(payload, "history-second", 1),
    });
    route.seed({
      id: "history-invalid",
      authorId: "alice",
      definition: { broken: true },
    });
    const before = await (await route()).json();
    const body = {
      ...payload,
      revision: 0,
      idempotencyKey: "duplicate-stable-result",
    };
    const duplicate = await route("PUT", "/history-candidate", body, "alice");
    expect(await duplicate.json()).toMatchObject({
      existing: { id: "history-first", revision: 1 },
    });
    expect(await (await route()).json()).toEqual(before);
    await route(
      "PATCH",
      "/history-first",
      { revision: 1, status: "deleted" },
      "admin",
    );
    expect(
      await (await route("PUT", "/history-candidate", body, "alice")).json(),
    ).toMatchObject({ existing: { id: "history-first" } });
    const variant = structuredClone(payload);
    variant.definition.symbol.name = "Concurrent variant";
    const results = await Promise.all(
      ["concurrent-one", "concurrent-two"].map((id) =>
        route(
          "PUT",
          `/${id}`,
          { ...variant, revision: 0, idempotencyKey: id },
          "alice",
        ),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
  });
});

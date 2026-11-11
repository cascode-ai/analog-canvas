import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";

import { builtInSymbols } from "./builtins.js";
import { externalSubcircuitSymbolId } from "./hierarchical-block.js";
import {
  createProjectSymbolResolver,
  drawnPinNames,
  findUnsupportedProjectSymbolIds,
  InMemorySymbolResolver,
  relocatedPin,
  variantHiddenPinNames,
  variantHidesPin,
  variantPinAt,
} from "./resolver.js";
import { SymbolDefinitionSchema } from "./schema.js";

const resistor = {
  schemaVersion: 1 as const,
  id: "resistor",
  name: "Resistor",
  viewBox: { x: -20, y: -10, width: 40, height: 20 },
  pins: [
    {
      name: "1",
      role: "passive",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "2",
      role: "passive",
      at: { x: 20, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  primitives: [
    { kind: "line" as const, from: { x: -10, y: 0 }, to: { x: 10, y: 0 } },
  ],
  variants: [{ id: "compact", hiddenPinNames: [] }],
  defaultVariantId: "compact",
};

describe("Symbol Resolver boundary", () => {
  it("retains the last definition and its variants in merged caller-owned lists", () => {
    const project = createEmptyProject("merged", "Merged");
    const definitions = [
      resistor,
      {
        ...resistor,
        name: "Available capture",
        variants: [{ id: "captured", hiddenPinNames: [] }],
        defaultVariantId: "captured",
      },
    ];
    const resolver = createProjectSymbolResolver(project, definitions);
    expect(resolver.resolve("resistor")?.definition.name).toBe(
      "Available capture",
    );
    expect(resolver.resolve("resistor")?.variant?.id).toBe("captured");
    expect(resolver.resolve("resistor", "compact")).toBeUndefined();
    definitions[1]!.name = "Updated capture";
    expect(
      createProjectSymbolResolver(project, definitions).resolve("resistor")
        ?.definition.name,
    ).toBe("Updated capture");
    expect(resolver.resolve("resistor")?.definition.name).toBe(
      "Available capture",
    );
  });

  it("layers captured Project definitions over an owned catalog snapshot", () => {
    const input = structuredClone(resistor);
    const catalog = new InMemorySymbolResolver([input]);
    input.name = "Edited after catalog loading";
    const project = createEmptyProject("overlay", "Overlay");
    const resolver = createProjectSymbolResolver(project, catalog);
    expect(resolver.resolve("resistor")?.definition.name).toBe("Resistor");
    project.componentDefinitions = [
      {
        symbol: SymbolDefinitionSchema.parse({ ...resistor, name: "Captured" }),
      },
    ];
    const captured = createProjectSymbolResolver(project, catalog);
    expect(captured.resolve("resistor")?.definition.name).toBe("Captured");
    expect(catalog.resolve("resistor")?.definition.name).toBe("Resistor");
  });

  it("resolves only canonical IDs and applies the canonical default variant", () => {
    const resolver = new InMemorySymbolResolver([resistor]);
    expect(resolver.resolve("res")).toBeUndefined();
    expect(resolver.resolve("resistor")?.variant?.id).toBe("compact");
    expect(resolver.resolve("resistor", "compact")?.variant?.id).toBe(
      "compact",
    );
    expect(resolver.resolve("missing")).toBeUndefined();
  });

  it("rejects duplicate electrical pin names", () => {
    expect(
      SymbolDefinitionSchema.safeParse({
        ...resistor,
        pins: [resistor.pins[0], resistor.pins[0]],
      }).success,
    ).toBe(false);
  });

  it("does not remove an electrical pin when a variant hides it", () => {
    const hidden = SymbolDefinitionSchema.parse({
      ...resistor,
      defaultVariantId: "implicit-terminal",
      variants: [{ id: "implicit-terminal", hiddenPinNames: ["2"] }],
    });
    expect(hidden.pins.map((pin) => pin.name)).toEqual(["1", "2"]);
  });

  it("rejects a preferred landing outside the pin's outward axis", () => {
    const result = SymbolDefinitionSchema.safeParse({
      ...resistor,
      pins: [
        {
          ...resistor.pins[0],
          routing: {
            escape: "outward",
            preferredLanding: { x: 0, y: 10 },
          },
        },
        resistor.pins[1],
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              "Preferred routing landing must lie on the pin's outward axis",
          }),
        ]),
      );
    }
  });

  it("reports unsupported Project device symbols without rejecting hierarchy", () => {
    const project = createEmptyProject("coverage", "Coverage");
    project.documents[0]!.instances.push({
      id: "D1",
      symbolId: "diode",
      placement: null,
    });
    expect(findUnsupportedProjectSymbolIds(project, [resistor])).toEqual([
      "diode",
    ]);
  });

  it("does not derive an unreferenced manual top Cell over a catalog symbol", () => {
    const project = createEmptyProject("coverage", "Coverage");
    project.documents[0]!.netlist = {
      name: "resistor",
      terminals: [],
      formalParameters: [],
    };

    const resolver = createProjectSymbolResolver(project, [resistor]);

    expect(resolver.resolve("resistor")?.definition.name).toBe("Resistor");
  });

  it("derives a passive black-box symbol from a shared external interface", () => {
    const project = createEmptyProject("coverage", "Coverage");
    project.externalSubcircuitDefinitions.push({
      id: "external-ota",
      name: "OTA",
      terminals: [
        { id: "external-ota-inp", name: "INP", direction: "passive" },
        { id: "external-ota-out", name: "OUT", direction: "passive" },
      ],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    project.documents[0]!.instances.push({
      id: "X1",
      symbolId: externalSubcircuitSymbolId("external-ota"),
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-ota" },
        parameters: {},
      },
    });

    const resolver = createProjectSymbolResolver(project, [resistor]);

    expect(
      resolver
        .resolve(externalSubcircuitSymbolId("external-ota"))
        ?.definition.pins.map((pin) => pin.name),
    ).toEqual(["INP", "OUT"]);
  });
});

describe("a variant that moves its pins (#2170)", () => {
  const catalog = new InMemorySymbolResolver(builtInSymbols);

  it("draws the wide chopper's pins at its box's corners, on the grid", () => {
    const narrow = catalog.resolve("chopper")!;
    const wide = catalog.resolve("chopper", "wide")!;
    expect(wide.definition).toBe(narrow.definition);
    expect(drawnPinNames(wide)).toEqual(drawnPinNames(narrow));
    expect(drawnPinNames(wide)).toEqual(["INP", "INN", "OUTP", "OUTN"]);
    expect(
      wide.definition.pins.map((pin) => [
        pin.name,
        variantPinAt(wide.variant, pin),
        relocatedPin(wide.variant, pin.name)?.direction ?? pin.direction,
      ]),
    ).toEqual([
      ["INP", { x: -20, y: -40 }, "west"],
      ["INN", { x: -20, y: 40 }, "west"],
      ["OUTP", { x: 20, y: -40 }, "east"],
      ["OUTN", { x: 20, y: 40 }, "east"],
    ]);
    for (const pin of wide.definition.pins) {
      expect(variantHidesPin(wide.variant, pin.name)).toBe(false);
      const at = variantPinAt(wide.variant, pin);
      expect(Number.isInteger(at.x / 10) && Number.isInteger(at.y / 10)).toBe(
        true,
      );
    }
    expect(variantHiddenPinNames(wide.variant)).toEqual(new Set());
  });

  it("keeps a 3-terminal MOS body hidden, offered back only by its bulk rule", () => {
    const mos = catalog.resolve("nmos")!;
    expect(mos.variant?.auxiliaryPins?.map((pin) => pin.name)).toEqual(["B"]);
    expect(relocatedPin(mos.variant, "B")).toBeUndefined();
    expect(variantHidesPin(mos.variant, "B")).toBe(true);
    expect(variantHiddenPinNames(mos.variant)).toEqual(new Set(["B"]));
    // An op-amp's hidden supplies are hidden, not moved.
    const opamp = catalog.resolve("opamp")!;
    expect(variantHidesPin(opamp.variant, "VDD")).toBe(true);
  });
});

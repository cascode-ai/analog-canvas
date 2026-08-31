import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";

import {
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
} from "./hierarchical-block.js";
import {
  createProjectSymbolResolver,
  findUnsupportedProjectSymbolIds,
  InMemorySymbolResolver,
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

  it("does not generate a compatibility block for an unknown symbol", () => {
    const resolver = new InMemorySymbolResolver([resistor]);
    expect(resolver.resolve("generic-block-5")).toBeUndefined();
    expect(resolver.resolve("generic-block-0")).toBeUndefined();
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

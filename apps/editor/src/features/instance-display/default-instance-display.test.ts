import { resolveSchematicStyleProfile } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  defaultInstanceDisplayAnnotations,
  missingDefaultInstanceDisplayAnnotations,
} from "./default-instance-display";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("default instance display annotations", () => {
  it("creates a RichText schematic label and master label for an external call", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "opaque-import-id",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: {
        reference: "X1",
        binding: {
          kind: "external-subcircuit" as const,
          definitionId: "master-opamp",
        },
        parameters: {},
      },
    };
    const annotations = defaultInstanceDisplayAnnotations(
      document,
      instance,
      resolver,
      resolveSchematicStyleProfile(document.presentation.styleProfileId),
      { masterName: "sky130_fd_pr__nfet_01v8" },
    );

    expect(annotations).toMatchObject([
      {
        kind: "instance-label",
        binding: {
          kind: "instance-schematic-name",
          instanceId: "opaque-import-id",
        },
      },
      {
        id: "instance-master-opaque-import-id",
        kind: "instance-value",
      },
    ]);
  });

  it("shows a formal Port terminal name as its only visible identity", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "derived-internal-port-id",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const annotations = defaultInstanceDisplayAnnotations(
      document,
      instance,
      resolver,
      resolveSchematicStyleProfile(document.presentation.styleProfileId),
      { formalTerminalId: "terminal-input" },
    );

    expect(annotations).toEqual([
      expect.objectContaining({
        binding: { kind: "cell-terminal-name", terminalId: "terminal-input" },
      }),
    ]);
  });

  it("materializes an imported reference once when a retained Instance is placed", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "imported-resistor-opaque-id",
      symbolId: "resistor",
      schematicReference: "R7",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: { reference: "R7", parameters: { value: "10k" } },
    };

    const missing = missingDefaultInstanceDisplayAnnotations(
      document,
      instance,
      resolver,
      resolveSchematicStyleProfile(document.presentation.styleProfileId),
    );
    expect(missing).toEqual([
      expect.objectContaining({
        binding: {
          kind: "instance-schematic-name",
          instanceId: "imported-resistor-opaque-id",
        },
      }),
    ]);

    document.annotations.push(...missing);
    expect(
      missingDefaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        resolveSchematicStyleProfile(document.presentation.styleProfileId),
      ),
    ).toEqual([]);
  });
});

describe("blocks that carry no designator", () => {
  const styleProfile = (document: ReturnType<typeof createEmptyDocument>) =>
    resolveSchematicStyleProfile(document.presentation.styleProfileId);

  it("places a signal-flow block with no designator label", () => {
    // A summing junction or a 1/s block is read by its shape, and a diagram
    // full of X1, X2, X3 says nothing a reader needs.
    for (const symbolId of [
      "adder",
      "multiplier",
      "transconductance",
      "integrator",
      "unit-delay",
      "quantizer",
    ]) {
      const document = createEmptyDocument("main", "Main");
      const instance = {
        id: `${symbolId}-1`,
        symbolId,
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      };
      expect(
        defaultInstanceDisplayAnnotations(
          document,
          instance,
          resolver,
          styleProfile(document),
          {},
        ),
        symbolId,
      ).toEqual([]);
    }
  });

  it("still labels an ordinary device", () => {
    const document = createEmptyDocument("main", "Main");
    const annotations = defaultInstanceDisplayAnnotations(
      document,
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      },
      resolver,
      styleProfile(document),
      {},
    );
    expect(annotations.length).toBeGreaterThan(0);
  });
});

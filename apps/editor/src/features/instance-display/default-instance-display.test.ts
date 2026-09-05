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
  it("creates a live Reference label and literal master label for an external call", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "opaque-import-id",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      reference: "X1",
      netlist: {
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
          kind: "instance-reference",
          instanceId: "opaque-import-id",
        },
      },
      {
        id: "instance-master-opaque-import-id",
        kind: "instance-value",
      },
    ]);
  });

  /**
   * A Cell name is a name, not a device designator. `M1` is an identifier
   * whose leading symbol carries a subscripted index, and typesetting it that
   * way is house style; `sky130_fd_pr__nfet_01v8` is a word, and the same
   * rule turns it into "s" with everything else shrunk beneath it.
   */
  it("sets a master Cell name upright, with no subscript", () => {
    const document = createEmptyDocument("main", "Main");
    const annotations = defaultInstanceDisplayAnnotations(
      document,
      {
        id: "call-1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
        reference: "X1",
        netlist: {
          binding: {
            kind: "external-subcircuit" as const,
            definitionId: "master-opamp",
          },
          parameters: {},
        },
      },
      resolver,
      resolveSchematicStyleProfile(document.presentation.styleProfileId),
      { masterName: "CELLNAME" },
    );

    const master = annotations.find((annotation) =>
      annotation.id.startsWith("instance-master-"),
    );
    expect(master?.content).toEqual({
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "CELLNAME" }],
        },
      ],
    });
  });

  it("still subscripts an instance designator, which is an identifier", () => {
    // The brake. Fixing Cell names must not flatten `M1` into upright text:
    // there the leading symbol and its index are exactly what the reader
    // expects to see set apart.
    const document = createEmptyDocument("main", "Main");
    const annotations = defaultInstanceDisplayAnnotations(
      document,
      {
        id: "m1",
        symbolId: "nmos",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
        reference: "M1",
      },
      resolver,
      resolveSchematicStyleProfile(document.presentation.styleProfileId),
      {},
    );

    const label = annotations.find(
      (annotation) => annotation.binding?.kind === "instance-reference",
    );
    expect(label?.binding).toEqual({
      kind: "instance-reference",
      instanceId: "m1",
    });
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
      reference: "R7",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: { parameters: { value: "10k" } },
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
          kind: "instance-reference",
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

  it("labels each compound magnetic device with its allocated X reference", () => {
    for (const [symbolId, reference] of [
      ["tcoil", "X1"],
      ["xfmr", "X2"],
    ] as const) {
      const document = createEmptyDocument("main", "Main");
      const annotations = defaultInstanceDisplayAnnotations(
        document,
        {
          id: `${symbolId}-1`,
          symbolId,
          reference,
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

      expect(annotations).toEqual([
        expect.objectContaining({
          kind: "instance-label",
          binding: {
            kind: "instance-reference",
            instanceId: `${symbolId}-1`,
          },
        }),
      ]);
    }
  });
});

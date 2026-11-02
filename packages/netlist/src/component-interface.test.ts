import { describe, expect, it } from "vitest";
import {
  componentInterfaceIssues,
  createEmptyProject,
  ComponentDefinitionSchema,
  type SymbolDefinition,
} from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import {
  parseProject,
  serializeProject,
  tryParseProjectWithMetadata,
} from "@icm/project-protocol";
import { createDesignNetlistExport } from "./export.js";

function amplifierProject(symbolId = "opamp") {
  const project = createEmptyProject(
    "interface-contract",
    "Interface contract",
    "dut",
  );
  const document = project.documents[0]!;
  document.instances.push({
    id: "tested",
    reference: "X1",
    symbolId,
    placement: null,
  });
  // Each pin the part draws as placed; an op-amp's supplies stay hidden.
  const symbol = builtInSymbols.find((item) => item.id === symbolId)!;
  const hidden = new Set(
    symbol.variants.find((variant) => variant.id === symbol.defaultVariantId)
      ?.hiddenPinNames,
  );
  for (const [index, pin] of symbol.pins.entries()) {
    if (hidden.has(pin.name)) continue;
    const pinName = pin.name,
      name = `N${index}`;
    document.nets.push({
      id: name,
      terminals: [{ instanceId: "tested", pinName }],
    });
    document.connectivityEvidence.push({
      id: `hint-${name}`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  for (const name of ["VDD", "VSS"]) {
    document.instances.push({
      id: `marker-${name}`,
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: name,
      terminals: [{ instanceId: `marker-${name}`, pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: `port-${name}`,
      name,
      netId: name,
      direction: "inout",
      interfaceInstanceIds: [`marker-${name}`],
    });
  }
  return withProjectComponentDefinitions(project);
}

describe("portable component interfaces meet real netlist export", () => {
  it.each([
    ["comparator", {}, "icm_ideal_comparator_vdd"],
    ["comparator", { vhigh: "1.8" }, "icm_ideal_comparator"],
    ["adder", { signA: "-" }, "adder_minus_a"],
    ["adder", { signB: "-" }, "adder_minus_b"],
    ["adder", { signA: "-", signB: "-" }, "adder_minus_ab"],
  ] as const)(
    "checks the actual generated %s body %s %s",
    (symbolId, parameters, target) => {
      for (const fault of ["order", "mapping"] as const) {
        const project = amplifierProject(symbolId);
        project.documents[0]!.instances[0]!.netlist = {
          parameters,
          ...(symbolId === "comparator"
            ? {
                binding: {
                  kind: "unresolved-subcircuit" as const,
                  name: "icm_ideal_comparator",
                },
              }
            : {}),
        };
        const valid = createDesignNetlistExport(
          parseProject(serializeProject(project)),
        );
        expect(valid.status, JSON.stringify(valid.diagnostics)).toBe("ready");
        if (valid.status === "ready") expect(valid.file.text).toContain(target);
        const ports = project.componentDefinitions!.find(
          (definition) => definition.symbol.id === symbolId,
        )!.subcircuit!.ports;
        if (fault === "order") [ports[2], ports[3]] = [ports[3]!, ports[2]!];
        else {
          const first = ports[2]!,
            second = ports[3]!;
          if ("pinName" in first && "pinName" in second)
            [first.pinName, second.pinName] = [second.pinName, first.pinName];
        }
        const invalid = createDesignNetlistExport(
          parseProject(serializeProject(project)),
        );
        expect(invalid.status, `${target} ${fault}`).toBe("blocked");
        expect(invalid.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "COMPONENT_MODEL_INTERFACE_MISMATCH",
          }),
        );
      }
    },
  );
  it.each(["missing", "unknown", "duplicate-name", "both-contracts"] as const)(
    "rejects %s while leaving the input recoverable",
    (fault) => {
      const project = amplifierProject();
      const definition = project.componentDefinitions!.find(
        (item) => item.symbol.id === "opamp",
      )!;
      if (fault === "missing")
        definition.subcircuit!.ports = definition.subcircuit!.ports.filter(
          (port) => !("pinName" in port) || port.pinName !== "IN-",
        );
      if (fault === "unknown") {
        const port = definition.subcircuit!.ports.find(
          (port) => "pinName" in port,
        )!;
        if ("pinName" in port) port.pinName = "NOT_A_PIN";
      }
      if (fault === "duplicate-name")
        definition.subcircuit!.ports[3]!.name =
          definition.subcircuit!.ports[2]!.name.toLowerCase();
      if (fault === "both-contracts") {
        const resistor = amplifierProject();
        resistor.documents[0]!.instances[0]!.symbolId = "resistor";
        resistor.componentDefinitions = [];
        const captured = withProjectComponentDefinitions(resistor);
        const primitive = captured.componentDefinitions!.find(
          (item) => item.symbol.id === "resistor",
        )!.electrical!;
        definition.electrical = {
          ...primitive,
          symbolId: "opamp",
          pinOrder: ["IN+", "IN-", "OUT"],
        };
      }
      const raw = JSON.stringify(project);
      const parsed = tryParseProjectWithMetadata(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok)
        expect(parsed.diagnostics).toContainEqual(
          expect.objectContaining({
            path: expect.arrayContaining(["componentDefinitions"]),
            code: "INVALID_PROJECT",
          }),
        );
      expect(createDesignNetlistExport(project).status).toBe("blocked");
      expect(JSON.stringify(project)).toBe(raw);
    },
  );

  it("preserves an explicitly ordered custom interface and custom supply names", () => {
    const project = amplifierProject();
    const definition = project.componentDefinitions!.find(
      (item) => item.symbol.id === "opamp",
    )!;
    const [vdd, vss, plus, minus, out] = definition.subcircuit!.ports;
    vdd!.name = "VPWR";
    vss!.name = "VGND";
    definition.subcircuit!.ports = [out!, vdd!, minus!, vss!, plus!];
    definition.subcircuit!.target = "custom_amp";
    project.externalSubcircuitDefinitions.push({
      id: "custom-master",
      name: "custom_amp",
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: definition.subcircuit!.ports.map((port, index) => ({
        id: `custom-port-${index}`,
        name: port.name,
        direction: port.direction,
      })),
    });
    expect(ComponentDefinitionSchema.safeParse(definition).success).toBe(true);
    const reopened = parseProject(serializeProject(project));
    const exported = createDesignNetlistExport(reopened);
    expect(exported.status).toBe("ready");
    if (exported.status === "ready")
      expect(exported.file.text).toContain("X1 N2 VDD N1 VSS N0 custom_amp");
  });

  it.each([
    "identity",
    "missing-supply",
    "duplicate-supply",
    "direction",
  ] as const)(
    "requires explicit repair of a registry-ID shadow with changed %s",
    (change) => {
      const project = amplifierProject();
      const component = project.componentDefinitions!.find(
        (item) => item.symbol.id === "opamp",
      )!;
      const descriptor = component.subcircuit!;
      descriptor.target = "authored_gain";
      // An interface without a VDD supply has no VDD pin to draw (#1833).
      const dropVddPin = () => {
        const symbol = component.symbol;
        symbol.pins = symbol.pins.filter((pin) => pin.name !== "VDD");
        for (const variant of symbol.variants)
          variant.hiddenPinNames = variant.hiddenPinNames.filter(
            (name) => name !== "VDD",
          );
      };
      if (change === "identity") descriptor.id = "authored-interface";
      else if (change === "missing-supply") {
        descriptor.ports.shift();
        dropVddPin();
      } else if (change === "duplicate-supply") {
        const vdd = descriptor.ports[0]!;
        if (!("supply" in vdd)) throw Error("Missing supply in fixture");
        vdd.supply = "VSS";
        dropVddPin();
      } else descriptor.ports[2]!.direction = "output";
      project.externalSubcircuitDefinitions.push({
        id: "unrelated-master",
        name: "authored_gain",
        interfaceStatus: "declared",
        formalParameters: [],
        terminals: descriptor.ports.map((port, index) => ({
          id: `custom-port-${index}`,
          name: port.name,
          direction: port.direction,
        })),
      });
      const reopened = parseProject(serializeProject(project));
      const exported = createDesignNetlistExport(reopened);
      expect(exported.status).toBe("blocked");
      expect(exported.diagnostics).toContainEqual(
        expect.objectContaining({ code: "MODEL_IMPLEMENTATION_MISSING" }),
      );
    },
  );

  it.each(["order", "mapping"] as const)(
    "does not accept changed %s for an unchanged built-in model",
    (change) => {
      const project = amplifierProject();
      const definition = project.componentDefinitions!.find(
        (item) => item.symbol.id === "opamp",
      )!;
      const ports = definition.subcircuit!.ports;
      if (change === "order") [ports[2], ports[3]] = [ports[3]!, ports[2]!];
      else {
        const positive = ports[2]!,
          negative = ports[3]!;
        if (!("pinName" in positive) || !("pinName" in negative))
          throw new Error("Missing input mapping");
        [positive.pinName, negative.pinName] = [
          negative.pinName,
          positive.pinName,
        ];
      }
      expect(ComponentDefinitionSchema.safeParse(definition).success).toBe(
        true,
      );
      const exported = createDesignNetlistExport(project);
      expect(exported.status).toBe("blocked");
      expect(exported.diagnostics).toContainEqual(
        expect.objectContaining({ code: "COMPONENT_MODEL_INTERFACE_MISMATCH" }),
      );
    },
  );

  it("refuses two formal inputs mapped to the same canvas pin", () => {
    const project = amplifierProject();
    const valid = createDesignNetlistExport(
      parseProject(serializeProject(project)),
    );
    expect(valid.status).toBe("ready");
    // VDD is drawn, so the op-amp's limits read its supplies (#1463).
    if (valid.status === "ready")
      expect(valid.file.text).toContain(
        "X1 VDD VSS N0 N1 N2 icm_opamp_vdd_vss",
      );
    const definition = project.componentDefinitions!.find(
      (item) => item.symbol.id === "opamp",
    )!;
    const negative = definition.subcircuit!.ports.find(
      (port) => "pinName" in port && port.pinName === "IN-",
    )!;
    if (!("pinName" in negative)) throw new Error("Missing negative pin");
    negative.pinName = "IN+";
    expect(ComponentDefinitionSchema.safeParse(definition).success).toBe(false);
    expect(tryParseProjectWithMetadata(JSON.stringify(project)).ok).toBe(false);
    expect(() => serializeProject(project)).toThrow(/pin/);
    const rejected = createDesignNetlistExport(project);
    expect(rejected.status).toBe("blocked");
    expect(rejected.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_COMPONENT_INTERFACE",
        severity: "error",
      }),
    );
  });
});

/**
 * `symbol` drawing VDD above and VSS below as supply pins its default
 * variant hides and a supply-pins variant draws, as an op-amp will (#1833).
 */
function withSupplyPins(symbol: SymbolDefinition): SymbolDefinition {
  const supply = (name: "VDD" | "VSS", side: -1 | 1) => ({
    name,
    role: side < 0 ? "positive-supply" : "negative-supply",
    at: { x: 0, y: 30 * side },
    direction: side < 0 ? ("north" as const) : ("south" as const),
    presentation: { visibility: "visible" as const, leadLength: 10 },
  });
  return {
    ...structuredClone(symbol),
    pins: [
      ...symbol.pins.filter((pin) => !["VDD", "VSS"].includes(pin.name)),
      supply("VDD", -1),
      supply("VSS", 1),
    ],
    defaultVariantId: "signal-pins",
    variants: [
      { id: "signal-pins", hiddenPinNames: ["VDD", "VSS"] },
      { id: "supply-pins", hiddenPinNames: [] },
    ],
  };
}

describe("a Project whose symbols draw supplies as pins on request opens (#1833)", () => {
  it("opens an op-amp interface whose VDD and VSS pins draw its supply ports, and netlists it as before", () => {
    const plain = amplifierProject();
    // X1's VDD on the VDD rail: by Properties here, by a wire once drawn.
    plain.documents[0]!.nets.find((net) => net.id === "VDD")!.terminals.push({
      instanceId: "tested",
      pinName: "VDD",
    });
    const drawn = structuredClone(plain);
    const captured = drawn.componentDefinitions!.find(
      (definition) => definition.symbol.id === "opamp",
    )!;
    captured.symbol = withSupplyPins(captured.symbol);
    drawn.documents[0]!.instances[0]!.symbolVariantId = "supply-pins";
    const loaded = parseProject(serializeProject(drawn));
    const before = createDesignNetlistExport(plain, { format: "spice" });
    const after = createDesignNetlistExport(loaded, { format: "spice" });
    expect(before.status).toBe("ready");
    expect(after).toEqual(before);
  });

  it("keeps a port that maps a pin named after a supply, beside that supply's port", () => {
    expect(
      componentInterfaceIssues({
        symbol: { id: "io-cell", pins: [{ name: "VDD" }, { name: "OUT" }] },
        subcircuit: {
          symbolId: "io-cell",
          ports: [
            { name: "vdd_core", supply: "VDD" },
            { name: "vdd_io", pinName: "VDD" },
            { name: "out", pinName: "OUT" },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("opens a Circuit Component on that artwork, its supply pins unmapped, mapped to supplies or mapped to pins", () => {
    const artwork = withSupplyPins(
      builtInSymbols.find((symbol) => symbol.id === "opamp")!,
    );
    const signals = [
      { terminalId: "ea-VIP", pinName: "IN+" },
      { terminalId: "ea-VIN", pinName: "IN-" },
      { terminalId: "ea-VOUT", pinName: "OUT" },
    ];
    const open = (
      ports: string[],
      supplies: ({ terminalId: string } & (
        { pinName: string } | { supply: "VDD" | "VSS" }
      ))[],
    ) => {
      const project = createEmptyProject("ea", "Error amplifier");
      project.externalSubcircuitDefinitions.push({
        id: "ea",
        name: "EA",
        interfaceStatus: "declared",
        formalParameters: [],
        terminals: ports.map((name) => ({
          id: `ea-${name}`,
          name,
          direction: "passive" as const,
        })),
      });
      project.componentDefinitions = [
        {
          symbol: { ...artwork, id: "ea-artwork" },
          circuitBinding: {
            definitionId: "ea",
            terminals: [...signals, ...supplies],
          },
        },
      ];
      project.documents[0]!.instances.push({
        id: "X1",
        reference: "X1",
        symbolId: "ea-artwork",
        placement: null,
        netlist: {
          binding: { kind: "external-subcircuit", definitionId: "ea" },
          parameters: {},
        },
      });
      const loaded = parseProject(serializeProject(project));
      const resolver = createProjectSymbolResolver(loaded, builtInSymbols);
      return (variant?: string) => {
        const resolved = resolver.resolve("ea-artwork", variant)!;
        return resolved.definition.pins.map((pin) => [
          pin.name,
          pin.role,
          pin.presentation.visibility === "implicit" ||
          resolved.variant?.hiddenPinNames.includes(pin.name)
            ? "hidden"
            : "drawn",
        ]);
      };
    };
    // Unmapped, they draw nothing, shown or not.
    const signalOnly = open(["VIP", "VIN", "VOUT"], []);
    expect(signalOnly("supply-pins").map(([name]) => name)).toEqual([
      "VIP",
      "VIN",
      "VOUT",
    ]);
    // A supply mapping stays a property terminal.
    expect(
      open(
        ["VIP", "VIN", "VOUT", "VDD", "VSS"],
        [
          { terminalId: "ea-VDD", supply: "VDD" },
          { terminalId: "ea-VSS", supply: "VSS" },
        ],
      )("supply-pins").slice(3),
    ).toEqual([
      ["VDD", "inout", "hidden"],
      ["VSS", "inout", "hidden"],
    ]);
    // Mapped to pins, they are their terminals' plain pins, drawn on request.
    const pinned = open(
      ["VIP", "VIN", "VOUT", "VDD", "VSS"],
      [
        { terminalId: "ea-VDD", pinName: "VDD" },
        { terminalId: "ea-VSS", pinName: "VSS" },
      ],
    );
    expect(pinned().slice(3)).toEqual([
      ["VDD", "inout", "hidden"],
      ["VSS", "inout", "hidden"],
    ]);
    expect(pinned("supply-pins").slice(3)).toEqual([
      ["VDD", "inout", "drawn"],
      ["VSS", "inout", "drawn"],
    ]);
  });
});

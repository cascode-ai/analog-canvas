import { describe, expect, it } from "vitest";
import { createEmptyProject, type SymbolDefinition } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import { createDesignNetlistExport } from "@icm/netlist";
import { renderDocumentSvg } from "@icm/render-svg";
import { parseProject, serializeProject } from "./index.js";

const FORMS = [
  "opamp",
  "opamp-lettered",
  "opamp-wide",
  "opamp-wide-lettered",
  "opamp-inputs-swapped",
  "opamp-lettered-inputs-swapped",
  "opamp-wide-inputs-swapped",
  "opamp-wide-lettered-inputs-swapped",
];

/** A form as converter v6 drew it: no supply pins, leads or variants. */
function beforeSupplyPins(symbol: SymbolDefinition): SymbolDefinition {
  const { defaultVariantId: _default, ...rest } = structuredClone(symbol);
  return {
    ...rest,
    pins: rest.pins.filter((pin) => !["VDD", "VSS"].includes(pin.name)),
    primitives: rest.primitives.filter(
      (primitive) => !["vdd-lead", "vss-lead"].includes(primitive.part ?? ""),
    ),
    variants: [],
  };
}

/** A drawing saved with a v6 op-amp: its signal pins wired, its class captured. */
function savedProject(symbol: SymbolDefinition) {
  const project = createEmptyProject("supply-repair", "Supply repair", "dut");
  const document = project.documents[0]!;
  document.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: symbol.id,
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  for (const [index, pin] of symbol.pins.entries()) {
    const name = `N${index}`;
    document.nets.push({
      id: name,
      terminals: [{ instanceId: "X1", pinName: pin.name }],
    });
    document.connectivityEvidence.push({
      id: `hint-${name}`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  const captured = withProjectComponentDefinitions(project);
  captured.componentDefinitions!.find(
    (definition) => definition.symbol.id === symbol.id,
  )!.symbol = structuredClone(symbol);
  return captured;
}

const builtIn = (id: string) =>
  builtInSymbols.find((symbol) => symbol.id === id)!;
const capturedSymbol = (project: ReturnType<typeof parseProject>, id: string) =>
  project.componentDefinitions!.find(
    (definition) => definition.symbol.id === id,
  )!.symbol;

describe("recognized op-amp supply pin snapshot repair (#1833)", () => {
  it.each(FORMS)(
    "gives a saved %s its supply pins, hidden, and keeps the drawing as it was",
    (id) => {
      const old = beforeSupplyPins(builtIn(id));
      const original = savedProject(old);
      const raw = JSON.stringify(original);
      const loaded = parseProject(raw);
      expect(capturedSymbol(loaded, id)).toEqual(builtIn(id));
      // The drawing, its wiring and its netlist are what they were.
      expect(loaded.documents).toEqual(original.documents);
      expect(createDesignNetlistExport(loaded)).toEqual(
        createDesignNetlistExport(original),
      );
      expect(
        renderDocumentSvg(
          loaded.documents[0]!,
          createProjectSymbolResolver(loaded, []),
        ),
      ).toBe(
        renderDocumentSvg(
          original.documents[0]!,
          createProjectSymbolResolver(original, []),
        ),
      );
      // Its supply pins can now be shown.
      expect(
        createProjectSymbolResolver(loaded, []).resolve(id, "supply-pins")
          ?.variant?.hiddenPinNames,
      ).toEqual([]);
      expect(JSON.stringify(original)).toBe(raw);
      const saved = serializeProject(loaded);
      expect(serializeProject(parseProject(saved))).toBe(saved);
    },
  );

  it("leaves a current op-amp, a customized one and one without both supplies", () => {
    const current = savedProject(builtIn("opamp"));
    expect(parseProject(JSON.stringify(current)).componentDefinitions).toEqual(
      current.componentDefinitions,
    );

    const custom = savedProject(beforeSupplyPins(builtIn("opamp")));
    custom.componentDefinitions![0]!.symbol.name = "My own amplifier drawing";
    expect(parseProject(JSON.stringify(custom)).componentDefinitions).toEqual(
      custom.componentDefinitions,
    );

    // An author's interface that takes no VSS has no VSS pin to draw.
    const unipolar = savedProject(beforeSupplyPins(builtIn("opamp")));
    const ports = unipolar.componentDefinitions![0]!.subcircuit!.ports;
    unipolar.componentDefinitions![0]!.subcircuit!.ports = ports.filter(
      (port) => !("supply" in port) || port.supply !== "VSS",
    );
    expect(parseProject(JSON.stringify(unipolar)).componentDefinitions).toEqual(
      unipolar.componentDefinitions,
    );

    // A Circuit Component's artwork maps every pin to its native source.
    const component = savedProject(beforeSupplyPins(builtIn("opamp")));
    component.externalSubcircuitDefinitions.push({
      id: "ea",
      name: "EA",
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: ["VDD", "VSS", "VIP", "VIN", "VOUT"].map((name) => ({
        id: `ea-${name}`,
        name,
        direction: "passive" as const,
      })),
    });
    const { subcircuit: _subcircuit, ...artwork } =
      component.componentDefinitions![0]!;
    component.componentDefinitions![0] = {
      ...artwork,
      circuitBinding: {
        definitionId: "ea",
        terminals: [
          { terminalId: "ea-VDD", supply: "VDD" },
          { terminalId: "ea-VSS", supply: "VSS" },
          { terminalId: "ea-VIP", pinName: "IN+" },
          { terminalId: "ea-VIN", pinName: "IN-" },
          { terminalId: "ea-VOUT", pinName: "OUT" },
        ],
      },
    };
    component.documents[0]!.instances[0]!.netlist = {
      binding: { kind: "external-subcircuit", definitionId: "ea" },
      parameters: {},
    };
    expect(
      parseProject(JSON.stringify(component)).componentDefinitions,
    ).toEqual(component.componentDefinitions);
  });
});

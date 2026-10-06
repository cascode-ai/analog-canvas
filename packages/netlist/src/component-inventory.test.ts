import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  type SchematicDocument,
  type SymbolDefinition,
} from "@icm/model";
import type {
  DeviceDescriptor,
  BuiltInSubcircuitDescriptor,
} from "@icm/devices";
import { analyzeDesignNetlistForAuthoring } from "./extract.js";

// The authoring files are an independent authority from the generated runtime
// registry used by extraction. Distinct nets expose duplicated/swapped mappings.
interface AuthoredComponent {
  symbol: SymbolDefinition;
  electrical: DeviceDescriptor | null;
  subcircuit?: BuiltInSubcircuitDescriptor;
}
const catalog = JSON.parse(
  readFileSync("packages/components/catalog.json", "utf8"),
) as { entries: string[]; extendedEntries: string[] };
const definitions = [...catalog.entries, ...catalog.extendedEntries].map(
  (id) =>
    JSON.parse(
      readFileSync(`packages/components/definitions/${id}.json`, "utf8"),
    ) as AuthoredComponent,
);

function signal(
  document: SchematicDocument,
  name: string,
  instanceId: string,
  pinName: string,
) {
  const netId = `net-${name}`;
  document.nets.push({ id: netId, terminals: [{ instanceId, pinName }] });
  document.connectivityEvidence.push({
    id: `hint-${name}`,
    kind: "net-name-hint",
    netId,
    sourceName: name,
    origin: "spice-import",
  });
}

describe("authoring inventory agrees with real electrical extraction", () => {
  it.each(
    definitions.filter(
      (definition) =>
        definition.electrical && definition.electrical.targetPolicy !== "none",
    ),
  )("preserves primitive pins for $symbol.id", (definition) => {
    const project = createEmptyProject("inventory", "Inventory", "dut"),
      document = project.documents[0]!;
    const electrical = definition.electrical!;
    const parameters = Object.fromEntries(
      electrical.parameters.flatMap((parameter) =>
        parameter.defaultValue === undefined
          ? []
          : [[parameter.name, parameter.defaultValue]],
      ),
    );
    const instance: SchematicDocument["instances"][number] = {
      id: "tested",
      reference: `${electrical.referencePrefix}1`,
      symbolId: definition.symbol.id,
      placement: null,
      netlist: {
        parameters,
        binding:
          electrical.targetPolicy === "required-model"
            ? {
                kind: "model",
                deviceClass: electrical.deviceClass,
                name: "inventory_model",
              }
            : { kind: "primitive", deviceClass: electrical.deviceClass },
      },
    };
    document.instances.push(instance);
    for (const [index, pin] of definition.symbol.pins.entries())
      signal(document, `N${index}`, instance.id, pin.name);
    if (electrical.deviceClass === "vcvs" || electrical.deviceClass === "vccs")
      instance.netlist!.control = {
        kind: "voltage",
        positiveNetId: "net-N0",
        negativeNetId: "net-N1",
      };
    if (
      electrical.deviceClass === "cccs" ||
      electrical.deviceClass === "ccvs"
    ) {
      instance.netlist!.control = {
        kind: "current",
        sensorInstanceId: "sensor",
      };
      document.instances.push({
        id: "sensor",
        reference: "V1",
        symbolId: "voltage-source",
        placement: null,
        netlist: { parameters: { dc: "0" } },
      });
      signal(document, "S0", "sensor", "+");
      signal(document, "S1", "sensor", "-");
    }
    const result = analyzeDesignNetlistForAuthoring(project);
    const call = result.ir?.cells
      .find((cell) => cell.id === document.id)
      ?.instances.find((item) => item.id === instance.id);
    expect(call, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(call!.nodes.slice(0, electrical.pinOrder.length)).toEqual(
      electrical.pinOrder.map((pinName) => ({
        pinName,
        netName: `N${definition.symbol.pins.findIndex((pin) => pin.name === pinName)}`,
      })),
    );
  });

  it.each(definitions.filter((definition) => definition.subcircuit))(
    "preserves signal and supply mapping for $symbol.id",
    (definition) => {
      const project = createEmptyProject("inventory", "Inventory", "dut"),
        document = project.documents[0]!;
      document.instances.push({
        id: "tested",
        reference: "X1",
        symbolId: definition.symbol.id,
        placement: null,
      });
      for (const [index, pin] of definition.symbol.pins.entries())
        signal(document, `N${index}`, "tested", pin.name);
      for (const name of ["VDD", "VSS"]) {
        const marker = `marker-${name}`;
        document.instances.push({
          id: marker,
          symbolId: "port",
          placement: null,
        });
        document.nets.push({
          id: name,
          terminals: [{ instanceId: marker, pinName: "P" }],
        });
        document.netlist!.terminals.push({
          id: `port-${name}`,
          name,
          netId: name,
          direction: "inout",
          interfaceInstanceIds: [marker],
        });
      }
      const result = analyzeDesignNetlistForAuthoring(project);
      const call = result.ir?.cells
        .find((cell) => cell.id === document.id)
        ?.instances.find((item) => item.id === "tested");
      expect(call, JSON.stringify(result.diagnostics)).toBeDefined();
      expect(call!.nodes).toEqual(
        definition.subcircuit!.ports.map((port) => ({
          pinName: port.name,
          netName:
            port.supply ??
            `N${definition.symbol.pins.findIndex((pin) => pin.name === port.pinName)}`,
        })),
      );
    },
  );
});

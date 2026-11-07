import {
  CircuitProjectSchema,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { createDesignNetlistExport } from "./index.js";

// A hand-specified two-resistor ladder with a shunt capacitor. These are
// topology fixtures, not electrical simulation acceptance models.
function ladder(value: string): CircuitProject {
  const project = createEmptyProject("ladder", "Ladder");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances = [
    ...(
      [
        ["R1", "resistor", value],
        ["R2", "resistor", "2k"],
        ["C1", "capacitor", "3p"],
      ] as const
    ).map(([id, deviceClass, value]) => ({
      id,
      reference: id,
      symbolId: deviceClass,
      placement: null,
      netlist: {
        binding: { kind: "primitive" as const, deviceClass },
        parameters: { value },
      },
    })),
    { id: "PIN_IN", symbolId: "port", placement: null },
    { id: "PIN_OUT", symbolId: "port", placement: null },
    { id: "G", symbolId: "ground", placement: null },
  ];
  document.nets = [
    {
      id: "input",
      terminals: [
        { instanceId: "PIN_IN", pinName: "P" },
        { instanceId: "R1", pinName: "1" },
      ],
    },
    {
      id: "middle",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
        { instanceId: "C1", pinName: "1" },
      ],
    },
    {
      id: "output",
      terminals: [
        { instanceId: "R2", pinName: "2" },
        { instanceId: "PIN_OUT", pinName: "P" },
      ],
    },
    {
      id: "ground",
      terminals: [
        { instanceId: "C1", pinName: "2" },
        { instanceId: "G", pinName: "0" },
      ],
    },
  ];
  document.netlist!.terminals = [
    {
      id: "terminal-in",
      name: "IN",
      netId: "input",
      direction: "input",
      interfaceInstanceIds: ["PIN_IN"],
    },
    {
      id: "terminal-out",
      name: "OUT",
      netId: "output",
      direction: "output",
      interfaceInstanceIds: ["PIN_OUT"],
    },
  ];
  document.connectivityEvidence = [
    {
      id: "ground-name",
      kind: "name-claim",
      netId: "ground",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "G" },
    },
  ];
  return CircuitProjectSchema.parse(project);
}

function transform(project: CircuitProject, kind: string): CircuitProject {
  const next = structuredClone(project);
  const document = next.documents[0]!;
  if (kind === "reorder") {
    document.instances.reverse();
    document.nets.reverse();
    for (const net of document.nets) net.terminals.reverse();
  } else if (kind === "paint") {
    for (const instance of document.instances)
      instance.styleOverride = { foreground: "#224488" };
    document.presentation.labelSubscriptItalic = false;
  } else if (kind === "rename") {
    const renamed = (id: string) => `renamed-${id}`;
    next.id = renamed(next.id);
    next.topDocumentId = renamed(next.topDocumentId);
    document.id = renamed(document.id);
    for (const instance of document.instances)
      instance.id = renamed(instance.id);
    for (const net of document.nets) {
      net.id = renamed(net.id);
      for (const terminal of net.terminals)
        terminal.instanceId = renamed(terminal.instanceId);
    }
    for (const terminal of document.netlist!.terminals) {
      terminal.id = renamed(terminal.id);
      terminal.netId = renamed(terminal.netId);
      terminal.interfaceInstanceIds =
        terminal.interfaceInstanceIds.map(renamed);
    }
    for (const evidence of document.connectivityEvidence) {
      evidence.id = renamed(evidence.id);
      evidence.netId = renamed(evidence.netId);
      if (
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "power-marker"
      )
        evidence.owner.objectId = renamed(evidence.owner.objectId);
    }
  }
  return CircuitProjectSchema.parse(next);
}

const cases = [
  { value: "1k", spectreValue: "1k" },
  { value: "3.3k", spectreValue: "3.3k" },
  { value: "2Meg", spectreValue: "2M" },
].flatMap(({ value, spectreValue }) =>
  ["identity", "rename", "reorder", "paint"].flatMap((change) =>
    (["spice", "spectre"] as const).map((format) => ({
      value,
      spectreValue,
      change,
      format,
    })),
  ),
);

describe("portable design-netlist invariants", () => {
  it.each(cases)(
    "keeps the ladder's independent connectivity oracle ($value, $change, $format)",
    ({ value, spectreValue, change, format }) => {
      const original = ladder(value);
      const changed = transform(original, change);
      const saved = serializeProject(changed);
      const reopened = parseProject(saved);
      expect(serializeProject(reopened)).toBe(saved);
      // Check both sides independently: equal round trips alone could hide the
      // same incorrect connection on export and import.
      for (const project of [changed, reopened]) {
        const output = createDesignNetlistExport(project, {
          format,
          includeIr: true,
        });
        expect(output.status).toBe("ready");
        if (output.status !== "ready")
          throw new Error(JSON.stringify(output.diagnostics));
        const cell = output.ir!.cells.find((cell) => cell.name === "dut")!;
        expect(cell.ports.map((port) => port.name)).toEqual([
          "VSS",
          "IN",
          "OUT",
        ]);
        const nodes = new Map<string, string[]>();
        for (const instance of cell.instances)
          for (const node of instance.nodes) {
            const members = nodes.get(node.netName) ?? [];
            members.push(`${instance.reference}.${node.pinName}`);
            nodes.set(node.netName, members);
          }
        expect(
          [...nodes.values()].map((members) => members.sort().join(",")).sort(),
        ).toEqual(["C1.1,R1.2,R2.1", "C1.2", "R1.1", "R2.2"]);
        expect(nodes.get("IN")).toEqual(["R1.1"]);
        expect(nodes.get("OUT")).toEqual(["R2.2"]);
        expect(nodes.get("VSS")).toEqual(["C1.2"]);
        const middle = [...nodes].find(([, members]) =>
          members.includes("R1.2"),
        )![0];
        const cards = output.file.text.split(/\r?\n/u);
        const expectedCards =
          format === "spice"
            ? [
                `R1 IN ${middle} ${value}`,
                `R2 ${middle} OUT 2k`,
                `C1 ${middle} VSS 3p`,
              ]
            : [
                `R1 (IN ${middle}) resistor r=${spectreValue}`,
                `R2 (${middle} OUT) resistor r=2k`,
                `C1 (${middle} VSS) capacitor c=3p`,
              ];
        expect(cards).toEqual(expect.arrayContaining(expectedCards));
        expect(
          cell.instances
            .find((instance) => instance.reference === "R1")!
            .parameters.map((parameter) => parameter.rawValue),
        ).toEqual([value]);
      }
      expect(original).toEqual(ladder(value));
    },
  );
});

import { describe, expect, it } from "vitest";
import { createEmptyProject, ComponentDefinitionSchema } from "@icm/model";
import { builtInSymbols, withProjectComponentDefinitions } from "@icm/symbols";
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
  for (const [index, pin] of builtInSymbols
    .find((symbol) => symbol.id === symbolId)!
    .pins.entries()) {
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
      if (change === "identity") descriptor.id = "authored-interface";
      else if (change === "missing-supply") descriptor.ports.shift();
      else if (change === "duplicate-supply") {
        const vdd = descriptor.ports[0]!;
        if (!("supply" in vdd)) throw Error("Missing supply in fixture");
        vdd.supply = "VSS";
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
    if (valid.status === "ready")
      expect(valid.file.text).toContain("X1 VDD VSS N0 N1 N2 opamp");
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

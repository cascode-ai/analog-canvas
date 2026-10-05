import { createEmptyProject, type CircuitProject } from "@icm/model";
import { analyzeDesignNetlist, createDesignNetlistExport } from "@icm/netlist";
import { describe, expect, it } from "vitest";

import { tryParseProjectWithMetadata } from "./load.js";
import { serializeProject } from "./save.js";

/**
 * From 2026-10-01 (#1272) until #1298 `set-model sky130_fd_pr__cap_var_lvt`
 * was accepted on a Variable Capacitor. The varactor's C0/C1 are the plain
 * capacitor's pins 1/2 and its substrate B is set in Properties, while a Var
 * Cap is wired at P1/P2: the part could be neither wired nor exported, and
 * every Project edit was refused while it existed. This is the state that
 * left behind, beside a plain capacitor that takes the varactor properly.
 */
function projectWithBoundVarCaps(): CircuitProject {
  const project = createEmptyProject("varcap", "Var Cap");
  project.externalSubcircuitDefinitions.push({
    id: "external-varactor",
    name: "sky130_fd_pr__cap_var_lvt",
    terminals: ["C0", "C1", "B"].map((name, index) => ({
      id: `external-varactor-${index}`,
      name,
      direction: "passive" as const,
    })),
    formalParameters: [
      { name: "w", defaultValue: "5" },
      { name: "l", defaultValue: "0.5" },
      { name: "vm", defaultValue: "1" },
    ],
    interfaceStatus: "declared",
  });
  const document = project.documents[0]!;
  const bound = (parameters: Record<string, string>) => ({
    binding: {
      kind: "external-subcircuit" as const,
      definitionId: "external-varactor",
    },
    parameters,
  });
  const at = (x: number) => ({
    position: { x, y: 100 },
    rotation: 0 as const,
    mirror: "none" as const,
  });
  document.instances.push(
    {
      id: "CV1",
      reference: "CV1",
      symbolId: "variable-capacitor",
      placement: at(100),
      // A value the author entered again beside the model's geometry.
      netlist: bound({ w: "5u", l: "500n", vm: "1", value: "2p" }),
    },
    {
      id: "CV2",
      reference: "CV2",
      symbolId: "variable-capacitor",
      placement: at(200),
      // As set-model left it: the model's parameters replaced the value.
      netlist: bound({ w: "5u", l: "500n", vm: "1" }),
    },
    {
      id: "C1",
      reference: "C1",
      symbolId: "capacitor",
      placement: at(300),
      netlist: bound({ w: "5u", l: "500n", vm: "2" }),
    },
  );
  document.nets.push(
    {
      id: "net-tune",
      terminals: [
        { instanceId: "CV1", pinName: "P1" },
        { instanceId: "CV2", pinName: "P1" },
        { instanceId: "C1", pinName: "1" },
      ],
    },
    {
      id: "net-ground",
      terminals: [
        { instanceId: "CV1", pinName: "P2" },
        { instanceId: "CV2", pinName: "P2" },
        { instanceId: "C1", pinName: "2" },
        { instanceId: "CV1", pinName: "B" },
        { instanceId: "CV2", pinName: "B" },
        { instanceId: "C1", pinName: "B" },
      ],
    },
  );
  return project;
}

function open(project: CircuitProject): CircuitProject {
  const opened = tryParseProjectWithMetadata(serializeProject(project));
  if (!opened.ok)
    throw new Error(opened.diagnostics.map((item) => item.message).join("; "));
  return opened.project;
}

function pinsOf(project: CircuitProject, instanceId: string): string[] {
  return project.documents[0]!.nets.flatMap((net) =>
    net.terminals
      .filter((terminal) => terminal.instanceId === instanceId)
      .map((terminal) => terminal.pinName),
  );
}

describe("a Var Cap bound to the SKY130 varactor on file open (#1298)", () => {
  it("opens as an ideal Var Cap, keeping its wires and any value it has", () => {
    const project = open(projectWithBoundVarCaps());
    const instance = (id: string) =>
      project.documents[0]!.instances.find((item) => item.id === id)!;

    expect(instance("CV1")).toMatchObject({
      symbolId: "variable-capacitor",
      reference: "CV1",
    });
    expect(instance("CV1").netlist).toEqual({
      binding: { kind: "primitive", deviceClass: "capacitor" },
      parameters: { value: "2p" },
    });
    // No value is invented for the one the binding removed.
    expect(instance("CV2").netlist).toEqual({
      binding: { kind: "primitive", deviceClass: "capacitor" },
      parameters: {},
    });
    // The substrate the varactor set in Properties is not a Var Cap pin.
    expect(pinsOf(project, "CV1").sort()).toEqual(["P1", "P2"]);
    expect(pinsOf(project, "CV2").sort()).toEqual(["P1", "P2"]);

    // The plain capacitor's varactor is a valid binding and stays.
    expect(instance("C1").netlist).toEqual({
      binding: {
        kind: "external-subcircuit",
        definitionId: "external-varactor",
      },
      parameters: { w: "5u", l: "500n", vm: "2" },
    });
    expect(pinsOf(project, "C1").sort()).toEqual(["1", "2", "B"]);
    expect(project.externalSubcircuitDefinitions).toHaveLength(1);
  });

  it("asks only for the value that was lost, then exports the Var Caps as capacitors", () => {
    const project = open(projectWithBoundVarCaps());
    const diagnostics = analyzeDesignNetlist(project).diagnostics.filter(
      (item) => item.objectIds.some((id) => id === "CV1" || id === "CV2"),
    );
    expect(diagnostics.map((item) => [item.code, item.objectIds[0]])).toEqual([
      ["MISSING_REQUIRED_PARAMETER", "CV2"],
    ]);

    project.documents[0]!.instances.find(
      (item) => item.id === "CV2",
    )!.netlist!.parameters.value = "1p";
    const exported = createDesignNetlistExport(project);
    expect(exported.status).toBe("ready");
    if (exported.status !== "ready") return;
    expect(exported.file.text).toMatch(/^CV1 \S+ \S+ 2p$/mu);
    expect(exported.file.text).toMatch(/^CV2 \S+ \S+ 1p$/mu);
    expect(exported.file.text).toMatch(
      /^XC1 \S+ \S+ \S+ sky130_fd_pr__cap_var_lvt /mu,
    );
  });

  it("saves the repaired Project and reopens it unchanged", () => {
    const once = open(projectWithBoundVarCaps());
    expect(open(once)).toEqual(once);
  });
});

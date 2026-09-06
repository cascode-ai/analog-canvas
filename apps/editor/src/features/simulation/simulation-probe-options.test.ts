import { describe, expect, it } from "vitest";
import { CircuitProjectSchema, createEmptyProject } from "@icm/model";

import fiveTransistorOtaSky130 from "../../examples/five-transistor-ota-sky130.icproj.json";
import {
  deriveSimulationProbeOptions,
  matchSimulationVoltageProbeOptions,
  resolveSimulationVoltageProbeNetId,
  simulationProbeHierarchyPath,
  simulationProbeSelectionKey,
  simulationVoltageProbeTargetsNet,
} from "./simulation-probe-options";

describe("simulation probe choices", () => {
  it("keeps hierarchy occurrences and terminal currents addressable", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const dut = project.documents.find(
      (document) => document.id === "document-ota-5t",
    )!;
    dut.instances.push({
      id: "IINTERNAL",
      symbolId: "current-source",
      placement: null,
      reference: "I1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "current-source" },
        parameters: { dc: "10u" },
      },
    });
    dut.nets[0]!.terminals.push({ instanceId: "IINTERNAL", pinName: "+" });
    dut.nets[1]!.terminals.push({ instanceId: "IINTERNAL", pinName: "-" });
    const options = deriveSimulationProbeOptions(
      project,
      "document-ota-5t-testbench",
    );

    expect(
      options.voltage.find(
        (option) =>
          option.target.anchor.kind === "terminal" &&
          option.target.anchor.instanceId === "M5" &&
          option.target.anchor.pinName === "D",
      ),
    ).toMatchObject({
      label: "XDUT · ota_5t · tail",
      target: {
        kind: "voltage",
        documentId: "document-ota-5t",
        anchor: { kind: "terminal", instanceId: "M5", pinName: "D" },
        occurrence: ["XDUT"],
      },
    });
    expect(
      options.terminalCurrent
        .filter((option) => option.target.instanceId === "IINTERNAL")
        .map((option) => option.label),
    ).toEqual(["XDUT · ota_5t · I1.+ current", "XDUT · ota_5t · I1.- current"]);
    expect(
      options.terminalCurrent.find(
        (option) =>
          option.target.instanceId === "IINTERNAL" &&
          option.target.pinName === "+",
      )?.target,
    ).toEqual({
      kind: "current",
      documentId: "document-ota-5t",
      instanceId: "IINTERNAL",
      pinName: "+",
      occurrence: ["XDUT"],
    });
    expect(
      options.terminalCurrent
        .filter((option) => option.target.instanceId === "M5")
        .map((option) => option.target.pinName),
    ).toEqual(["D", "G", "S", "B"]);
    expect(
      options.terminalCurrent
        .filter((option) => option.target.instanceId === "XDUT")
        .map((option) => option.target.pinName),
    ).toEqual(["vss", "ibias", "vdd", "vinn", "vinp", "vout"]);
  });

  it("names an unnamed hierarchical Net by its terminal aliases", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const dut = project.documents.find(
      (document) => document.id === "document-ota-5t",
    )!;
    const tail = dut.nets.find((net) => net.id === "net-dut-tail")!;
    dut.connectivityEvidence = dut.connectivityEvidence.filter(
      (evidence) => evidence.netId !== tail.id,
    );

    const option = deriveSimulationProbeOptions(
      project,
      "document-ota-5t-testbench",
    ).voltage.find(
      (candidate) =>
        candidate.target.documentId === dut.id &&
        candidate.target.anchor.kind === "terminal" &&
        candidate.target.anchor.instanceId === "M5" &&
        candidate.target.anchor.pinName === "D",
    );

    expect(option?.label).toBe("XDUT · ota_5t · XM5.D / XM1.S / XM2.S");
  });

  it("prefers a formal Cell port name over internal endpoint aliases", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const dut = project.documents.find(
      (document) => document.id === "document-ota-5t",
    )!;
    dut.connectivityEvidence = dut.connectivityEvidence.filter(
      (evidence) => evidence.netId !== "net-cell-pin-pvinp",
    );

    const option = deriveSimulationProbeOptions(
      project,
      "document-ota-5t-testbench",
    ).voltage.find(
      (candidate) =>
        candidate.target.documentId === dut.id &&
        candidate.target.anchor.kind === "terminal" &&
        candidate.target.anchor.instanceId === "PVINP",
    );

    expect(option?.label).toBe("XDUT · ota_5t · vinp");
  });

  it("gives repeated calls of the same Cell different target identities", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const testbench = project.documents.find(
      (document) => document.id === "document-ota-5t-testbench",
    )!;
    const first = testbench.instances.find(
      (instance) => instance.id === "XDUT",
    )!;
    testbench.instances.push({
      ...structuredClone(first),
      id: "XDUT2",
      reference: "XDUT2",
    });

    const targets = deriveSimulationProbeOptions(
      project,
      testbench.id,
    ).voltage.filter(
      (option) =>
        option.target.anchor.kind === "terminal" &&
        option.target.anchor.instanceId === "M5" &&
        option.target.anchor.pinName === "D",
    );
    expect(targets.map((option) => option.target.occurrence)).toEqual([
      ["XDUT"],
      ["XDUT2"],
    ]);
    expect(new Set(targets.map((option) => option.key)).size).toBe(2);
    expect(
      targets.map((option) =>
        simulationProbeSelectionKey(project, option.target),
      ),
    ).toEqual(targets.map((option) => option.key));

    expect(
      matchSimulationVoltageProbeOptions(project, targets, {
        documentId: "document-ota-5t",
        netId: "net-dut-tail",
      }),
    ).toHaveLength(2);
    expect(
      matchSimulationVoltageProbeOptions(project, targets, {
        documentId: "document-ota-5t",
        netId: "net-dut-tail",
        occurrence: ["XDUT2"],
      }).map((option) => option.target.occurrence),
    ).toEqual([["XDUT2"]]);
  });

  it("gives a hierarchical current source one choice per occurrence", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const testbench = project.documents.find(
      (document) => document.id === "document-ota-5t-testbench",
    )!;
    const dut = project.documents.find(
      (document) => document.id === "document-ota-5t",
    )!;
    const first = testbench.instances.find(
      (instance) => instance.id === "XDUT",
    )!;
    testbench.instances.push({
      ...structuredClone(first),
      id: "XDUT2",
      reference: "XDUT2",
    });
    dut.instances.push({
      id: "IINTERNAL",
      symbolId: "current-source",
      placement: null,
      reference: "I1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "current-source" },
        parameters: { dc: "10u" },
      },
    });
    dut.nets[0]!.terminals.push({ instanceId: "IINTERNAL", pinName: "+" });
    dut.nets[1]!.terminals.push({ instanceId: "IINTERNAL", pinName: "-" });

    const targets = deriveSimulationProbeOptions(
      project,
      testbench.id,
    ).terminalCurrent.filter(
      (option) =>
        option.target.instanceId === "IINTERNAL" &&
        option.target.pinName === "+",
    );

    expect(targets.map((option) => option.target.occurrence)).toEqual([
      ["XDUT"],
      ["XDUT2"],
    ]);
    expect(new Set(targets.map((option) => option.key)).size).toBe(2);
  });

  it("resolves an object anchor for canvas focus and matches its whole Logical Net", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);
    const target = deriveSimulationProbeOptions(
      project,
      "document-ota-5t-testbench",
    ).voltage.find(
      (option) =>
        option.target.anchor.kind === "terminal" &&
        option.target.anchor.instanceId === "M5" &&
        option.target.anchor.pinName === "D",
    )!.target;

    expect(resolveSimulationVoltageProbeNetId(project, target)).toBe(
      "net-dut-tail",
    );
    expect(
      simulationVoltageProbeTargetsNet(project, target, "net-dut-tail"),
    ).toBe(true);
    expect(
      simulationVoltageProbeTargetsNet(project, target, "net-dut-vout"),
    ).toBe(false);
  });

  it("resolves a probe occurrence to the canvas hierarchy path", () => {
    const project = CircuitProjectSchema.parse(fiveTransistorOtaSky130);

    expect(
      simulationProbeHierarchyPath(project, "document-ota-5t-testbench", [
        "XDUT",
      ]),
    ).toEqual([
      {
        parentDocumentId: "document-ota-5t-testbench",
        instanceId: "XDUT",
        childDocumentId: "document-ota-5t",
      },
    ]);
    expect(
      simulationProbeHierarchyPath(project, "document-ota-5t-testbench", [
        "missing-instance",
      ]),
    ).toBeNull();
  });

  it("offers repeated Ground markers as one voltage probe", () => {
    const project = createEmptyProject("project", "Project", "main");
    const document = project.documents[0]!;
    document.nets.push(
      { id: "net-ground-a", terminals: [] },
      { id: "net-ground-b", terminals: [] },
    );
    document.junctions.push(
      {
        id: "ground-a-junction",
        netId: "net-ground-a",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "ground-b-junction",
        netId: "net-ground-b",
        position: { x: 20, y: 0 },
        role: "route-anchor",
      },
    );
    document.connectivityEvidence.push(
      {
        id: "ground-a",
        kind: "name-claim",
        netId: "net-ground-a",
        owner: { kind: "power-marker", objectId: "GND1" },
        name: "0",
        scope: "global",
        powerDomain: "ground",
      },
      {
        id: "ground-b",
        kind: "name-claim",
        netId: "net-ground-b",
        owner: { kind: "power-marker", objectId: "GND2" },
        name: "0",
        scope: "global",
        powerDomain: "ground",
      },
    );

    const options = deriveSimulationProbeOptions(project, document.id).voltage;

    expect(options).toHaveLength(1);
    expect(options[0]?.label).toBe("Main · 0");
    expect(options[0]?.key).toContain(":logical:net-ground-a");
  });

  it("omits a lone Cell Pin while keeping an interface Net with a circuit member", () => {
    const project = createEmptyProject("project", "Project", "main");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "PIN_GHOST", symbolId: "port", placement: null },
      { id: "PIN_IN", symbolId: "port", placement: null },
      { id: "R1", symbolId: "resistor", reference: "R1", placement: null },
    );
    document.netlist = {
      name: "main",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-ghost",
          name: "ghost",
          netId: "net-ghost",
          direction: "input",
          interfaceInstanceIds: ["PIN_GHOST"],
        },
        {
          id: "terminal-in",
          name: "in",
          netId: "net-in",
          direction: "input",
          interfaceInstanceIds: ["PIN_IN"],
        },
      ],
    };
    document.nets.push(
      {
        id: "net-ghost",
        terminals: [{ instanceId: "PIN_GHOST", pinName: "P" }],
      },
      {
        id: "net-in",
        terminals: [
          { instanceId: "PIN_IN", pinName: "P" },
          { instanceId: "R1", pinName: "A" },
        ],
      },
    );

    const labels = deriveSimulationProbeOptions(
      project,
      document.id,
    ).voltage.map((option) => option.label);

    expect(labels.some((label) => label.includes("ghost"))).toBe(false);
    expect(labels).toContain("Main · in");
  });
});

import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  deriveStableId,
  type CircuitProject,
} from "@icm/model";

import {
  analyzeDesignNetlist as analyzeCurrentDesignNetlist,
  printSpiceNetlist,
  type DesignNetlistAnalysisOptions,
} from "./index.js";

function analyzeDesignNetlist(
  project: CircuitProject,
  options?: DesignNetlistAnalysisOptions,
) {
  return analyzeCurrentDesignNetlist(project, options);
}

function claimNet(
  document: CircuitProject["documents"][number],
  netId: string,
  name: string,
  scope: "local" | "global" = "local",
  powerDomain?: "vdd" | "ground",
): void {
  const labelId = deriveStableId(
    "fixture-net-label",
    document.id,
    netId,
    name,
    scope,
  );
  document.annotations.push({
    id: labelId,
    kind: powerDomain ? "power-label" : "net-label",
    binding: { kind: "net-name", netId },
    netId,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: deriveStableId("fixture-net-name", document.id, netId),
    kind: "name-claim",
    netId,
    name,
    owner: { kind: "net-label", annotationId: labelId },
    scope,
    ...(powerDomain ? { powerDomain } : {}),
  });
}

function resistorProject(parameters: Record<string, string>) {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: null,
    reference: "R1",
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters,
    },
  });
  document.nets.push(
    {
      id: "net-in",

      terminals: [{ instanceId: "R1", pinName: "1" }],
    },
    {
      id: "net-out",

      terminals: [{ instanceId: "R1", pinName: "2" }],
    },
  );
  claimNet(document, "net-in", "VIN");
  claimNet(document, "net-out", "VOUT");
  return project;
}

describe("current formal cell interface", () => {
  it.each(["spice", "spectre"] as const)(
    "allocates collision-free %s references for unnamed legacy devices without editing the drawing",
    (format) => {
      const project = resistorProject({ value: "1k" });
      const document = project.documents[0]!;
      document.instances.push({
        ...structuredClone(document.instances[0]!),
        id: "unnamed-device",
      });
      delete document.instances[1]!.reference;
      for (const net of document.nets)
        net.terminals.push({
          ...net.terminals[0]!,
          instanceId: "unnamed-device",
        });
      const before = structuredClone(project);
      const result = analyzeDesignNetlist(project, { format });
      expect(
        result.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
      expect(
        result.ir?.cells[0]?.instances.map((instance) => instance.reference),
      ).toEqual(["R1", "R2"]);
      expect(project).toEqual(before);
    },
  );

  it("derives a portable netlist identifier from a readable Cell name", () => {
    const project = resistorProject({ value: "10k" });
    const document = project.documents[0]!;
    document.name = "cascode current mirror";
    document.netlist!.name = "cascode current mirror";
    const before = structuredClone(project);

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.ir?.cells[0]?.name).toBe("cascode_current_mirror");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CELL_NAME_NORMALIZED",
        severity: "warning",
        message:
          "Cell name cascode current mirror exports as cascode_current_mirror",
      }),
    );
    expect(printSpiceNetlist(result.ir!)).toContain(
      ".subckt cascode_current_mirror",
    );
    expect(project).toEqual(before);
  });

  it("uses the same derived Cell identifier in hierarchy definitions and calls", () => {
    const project = createEmptyProject("project", "Project", "top");
    const top = project.documents[0]!;
    top.name = "top level";
    top.netlist!.name = "top level";
    const child = createEmptyDocument("child", "cascode current mirror");
    project.documents.push(child);
    top.instances.push({
      id: "X1",
      symbolId: "cascode-current-mirror-symbol",
      reference: "X1",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.ir?.cells.map((cell) => cell.name)).toEqual([
      "cascode_current_mirror",
      "top_level",
    ]);
    expect(
      result.ir?.cells.find((cell) => cell.id === "top")?.instances[0],
    ).toMatchObject({ target: "cascode_current_mirror" });
    expect(printSpiceNetlist(result.ir!)).toContain(
      "X1 cascode_current_mirror",
    );
  });

  it("blocks ambiguous Cell identifiers after portable normalization", () => {
    const project = createEmptyProject("project", "Project", "top");
    const top = project.documents[0]!;
    top.name = "gain stage";
    top.netlist!.name = "gain stage";
    const child = createEmptyDocument("child", "gain-stage");
    child.netlist!.name = "gain-stage";
    project.documents.push(child);
    top.instances.push({
      id: "X1",
      symbolId: "gain-stage-symbol",
      reference: "X1",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_CELL_NAME",
        message:
          "Cell names gain-stage and gain stage both export as gain_stage under case folding",
      }),
    );
  });

  it("names an unlabeled internal Net from a connected reference and pin", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: null,
        reference: "R2",
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "2k" },
        },
      },
    );
    document.nets.push(
      {
        id: "net-in",
        terminals: [{ instanceId: "R1", pinName: "1" }],
      },
      {
        id: "net-mid",
        terminals: [
          { instanceId: "R1", pinName: "2" },
          { instanceId: "R2", pinName: "1" },
        ],
      },
      {
        id: "net-ground",
        terminals: [{ instanceId: "R2", pinName: "2" }],
      },
    );
    claimNet(document, "net-in", "IN");
    claimNet(document, "net-ground", "0", "global", "ground");

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(printSpiceNetlist(result.ir!)).toContain("R1 IN net0 1k");
    expect(printSpiceNetlist(result.ir!)).toContain("R2 net0 0 2k");
  });

  it("allocates stable ordinal names without inferring device-pin meaning", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    const mos = (reference: string) => ({
      id: reference,
      symbolId: "nmos",
      placement: null,
      reference,
      netlist: {
        binding: {
          kind: "model" as const,
          deviceClass: "mos" as const,
          name: "NMOS",
        },
        parameters: { w: "1u", l: "150n" },
      },
    });
    document.instances.push(mos("M2"), mos("M7"), mos("M8"), mos("M9"));
    document.nets.push({
      id: "body",
      terminals: ["M2", "M7", "M8", "M9"].map((instanceId) => ({
        instanceId,
        pinName: "B",
      })),
    });
    claimNet(document, "body", "BODY");
    document.nets.push(
      {
        id: "net-tail",
        terminals: [
          { instanceId: "M2", pinName: "S" },
          { instanceId: "M9", pinName: "D" },
        ],
      },
      {
        id: "net-mirror",
        terminals: [
          { instanceId: "M2", pinName: "D" },
          { instanceId: "M7", pinName: "D" },
          { instanceId: "M7", pinName: "G" },
          { instanceId: "M8", pinName: "G" },
        ],
      },
    );
    for (const [instanceId, pinNames] of [
      ["M2", ["G"]],
      ["M7", ["S"]],
      ["M8", ["D", "S"]],
      ["M9", ["G", "S"]],
    ] as const) {
      for (const pinName of pinNames) {
        document.noConnects.push({
          id: `nc-${instanceId}-${pinName}`,
          endpoint: { kind: "terminal", instanceId, pinName },
        });
      }
    }

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    const spice = printSpiceNetlist(result.ir!);
    expect(spice).toContain("M2 net0 NC0001 net1 BODY");
    expect(spice).toContain("M7 net0 net0 NC0002 BODY");
    expect(spice).toContain("M9 net1 NC0005 NC0006 BODY");
    expect(spice).not.toMatch(/M[79]_[DG]/u);
  });

  it("skips ordinal names already reserved by an authored Net", () => {
    const project = resistorProject({ value: "10k" });
    const document = project.documents[0]!;
    document.annotations = [];
    document.connectivityEvidence = [];
    claimNet(document, "net-in", "NET0");

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(printSpiceNetlist(result.ir!)).toContain("R1 NET0 net1 10k");
  });

  it("maps formal Cell Pin Instances to the ordered exported interface", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.netlist = {
      name: "inverter",
      formalParameters: [],
      terminals: [
        {
          id: "cell-terminal-in",
          name: "VIN",
          netId: "net-in",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
        {
          id: "cell-terminal-out",
          name: "VOUT",
          netId: "net-out",
          direction: "output",
          interfaceInstanceIds: ["P2"],
        },
      ],
    };
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-in",

        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-out",

        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );

    const result = analyzeDesignNetlist(project);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.ports).toEqual([
      { id: "net-in", name: "VIN", netName: "VIN" },
      { id: "net-out", name: "VOUT", netName: "VOUT" },
    ]);
    expect(result.ir?.cells[0]?.nets.map((net) => net.name)).toEqual([
      "VIN",
      "VOUT",
    ]);
  });

  it.each(["spice", "spectre"] as const)(
    "preserves authored multi-domain interfaces and caller order in %s",
    (format) => {
      const project = createEmptyProject("project", "Project");
      const top = project.documents[0]!;
      const child = createEmptyDocument("child", "child");
      project.documents.push(child);
      top.instances.push({
        id: "X1",
        symbolId: "child-symbol",
        reference: "X1",
        placement: null,
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: child.id },
          parameters: {},
        },
      });
      const names = ["IN", "AVDD", "DVDD", "VDD"];
      child.netlist = { name: "child", terminals: [], formalParameters: [] };
      for (const name of names) {
        child.instances.push({ id: name, symbolId: "port", placement: null });
        child.nets.push({
          id: name,
          terminals: [{ instanceId: name, pinName: "P" }],
        });
        child.netlist.terminals.push({
          id: `terminal-${name}`,
          name,
          netId: name,
          direction: "inout",
          interfaceInstanceIds: [name],
        });
        top.nets.push({
          id: name,
          terminals: [{ instanceId: "X1", pinName: name }],
        });
        claimNet(top, name, `TB_${name}`);
      }
      for (const [id, domain] of [
        ["M1", "AVDD"],
        ["M2", "DVDD"],
      ] as const) {
        child.instances.push({
          id,
          reference: id,
          symbolId: "pmos",
          placement: null,
          mosBulkBinding: { netId: domain, origin: "instance-override" },
          netlist: {
            binding: { kind: "model", deviceClass: "mos", name: "PMOS" },
            parameters: { w: "1u", l: "150n" },
          },
        });
        child.nets
          .find((net) => net.id === domain)!
          .terminals.push(
            ...["D", "S", "B"].map((pinName) => ({ instanceId: id, pinName })),
          );
        child.nets
          .find((net) => net.id === "IN")!
          .terminals.push({ instanceId: id, pinName: "G" });
      }
      const before = structuredClone(project);
      const result = analyzeDesignNetlist(project, { format });
      expect(result.diagnostics).toEqual([]);
      const cell = result.ir!.cells.find((item) => item.id === child.id)!;
      expect(cell.ports.map((port) => port.name)).toEqual(names);
      expect(
        cell.instances.map((instance) => instance.nodes[3]?.netName),
      ).toEqual(["AVDD", "DVDD"]);
      const caller = result.ir!.cells.find((item) => item.id === top.id)!;
      expect(caller.ports).toEqual([]);
      expect(caller.instances[0]!.nodes).toEqual(
        names.map((name) => ({ pinName: name, netName: `TB_${name}` })),
      );
      expect(result.ir!.globals).toEqual([]);
      expect(
        result
          .ir!.cells.flatMap((item) => item.nets)
          .some((net) => net.name === "VSS"),
      ).toBe(false);
      expect(project).toEqual(before);
    },
  );

  it("groups same-name independent Pins only in the exported interface", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.netlist = {
      name: "same_name_ports",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vin-a",
          name: "VIN",
          netId: "net-vin-a",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
        {
          id: "terminal-vin-b",
          name: "vin",
          netId: "net-vin-b",
          direction: "input",
          interfaceInstanceIds: ["P2"],
        },
      ],
    };
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port-filled", placement: null },
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      },
    );
    document.nets.push(
      {
        id: "net-vin-a",
        terminals: [
          { instanceId: "P1", pinName: "P" },
          { instanceId: "R1", pinName: "1" },
        ],
      },
      {
        id: "net-vin-b",
        terminals: [
          { instanceId: "P2", pinName: "P" },
          { instanceId: "R1", pinName: "2" },
        ],
      },
    );
    const before = structuredClone(project);

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "NET_NAME_SPELLING_NORMALIZED",
        severity: "warning",
        message: "local Net spellings [VIN, vin] export as VIN",
      }),
    ]);
    expect(result.ir?.cells[0]?.ports).toEqual([
      {
        id: "net-vin-a",
        name: "VIN",
        netName: "VIN",
      },
    ]);
    expect(result.ir?.cells[0]?.instances[0]?.nodes).toEqual([
      { pinName: "1", netName: "VIN" },
      { pinName: "2", netName: "VIN" },
    ]);
    expect(result.ir?.cells[0]?.nets).toEqual([
      { id: "net-vin-a", name: "VIN", scope: "local" },
    ]);
    expect(printSpiceNetlist(result.ir!)).toContain(
      ".subckt same_name_ports VIN\nR1 VIN VIN 1k",
    );
    expect(project).toEqual(before);
  });

  it("exports matching-name Base Nets as one logical node", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
    });
    document.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "R1", pinName: "1" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "R1", pinName: "2" }],
      },
    );
    claimNet(document, "net-a", "BIAS");
    claimNet(document, "net-b", "BIAS");

    const result = analyzeDesignNetlist(project);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.nets).toEqual([
      { id: "net-a", name: "BIAS", scope: "local" },
    ]);
    expect(result.ir?.cells[0]?.instances[0]?.nodes).toEqual([
      { pinName: "1", netName: "BIAS" },
      { pinName: "2", netName: "BIAS" },
    ]);
  });

  it("keeps copied source-name hints electrically separate and disambiguates export", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
    });
    document.nets.push(
      {
        id: "net-a",
        terminals: [{ instanceId: "R1", pinName: "1" }],
      },
      {
        id: "net-b",
        terminals: [{ instanceId: "R1", pinName: "2" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "hint-a",
        kind: "net-name-hint",
        netId: "net-a",
        sourceName: "OUT",
        origin: "spice-import",
      },
      {
        id: "hint-b",
        kind: "net-name-hint",
        netId: "net-b",
        sourceName: "out",
        origin: "spice-import",
      },
    );

    const result = analyzeDesignNetlist(project);

    expect(result.ir?.cells[0]?.instances[0]?.nodes).toEqual([
      { pinName: "1", netName: "OUT" },
      { pinName: "2", netName: "out__2" },
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DISAMBIGUATED_SOURCE_NET_NAME",
        severity: "warning",
      }),
    );
  });

  it("keeps current authored spelling authoritative after source correspondence changes", () => {
    const project = resistorProject({ value: "10k" });
    const document = project.documents[0]!;
    document.sourceStatus = "connectivity-modified";
    document.connectivityEvidence.push({
      id: "old-source-name",
      kind: "net-name-hint",
      netId: "net-in",
      sourceName: "old_input",
      origin: "spice-import",
    });

    const result = analyzeDesignNetlist(project);

    expect(result.ir?.cells[0]?.instances[0]?.nodes[0]).toEqual({
      pinName: "1",
      netName: "VIN",
    });
    expect(result.ir?.cells[0]?.nets).toContainEqual({
      id: "net-in",
      name: "VIN",
      scope: "local",
    });
  });

  it("exports explicit NoConnect terminals through deterministic floating nodes", () => {
    const project = resistorProject({ value: "10k" });
    const document = project.documents[0]!;
    document.nets[1]!.terminals = [];
    document.nets.push({
      id: "occupied-no-connect-name",

      terminals: [],
    });
    claimNet(document, "occupied-no-connect-name", "NC0001");
    document.noConnects.push({
      id: "no-connect-r1-2",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
    });

    const result = analyzeDesignNetlist(project);

    expect(result.ir?.cells[0]?.instances[0]?.nodes).toEqual([
      { pinName: "1", netName: "VIN" },
      { pinName: "2", netName: "NC0002" },
    ]);
    expect(result.ir?.cells[0]?.nets).toContainEqual({
      id: "no-connect-r1-2",
      name: "NC0002",
      scope: "local",
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "GENERATED_NO_CONNECT_NODE",
        severity: "warning",
        objectIds: ["no-connect-r1-2", "R1"],
      }),
    ]);
  });

  it("blocks required-only Cell formals that structural dialects cannot declare", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.netlist!.formalParameters = [{ name: "required" }];

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNREPRESENTABLE_REQUIRED_FORMAL_PARAMETER",
      }),
    );
  });

  it("uses the same case-folded parameter identity as the deterministic printers", () => {
    const result = analyzeDesignNetlist(resistorProject({ Value: "10k" }));
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.instances).toEqual([
      {
        id: "R1",
        reference: "R1",
        invocationKind: "primitive",
        deviceClass: "resistor",
        target: null,
        nodes: [
          { pinName: "1", netName: "VIN" },
          { pinName: "2", netName: "VOUT" },
        ],
        parameters: [{ name: "Value", rawValue: "10k" }],
      },
    ]);
  });

  it("derives a missing built-in voltage-source target from the device registry", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "V6",
      symbolId: "voltage-source",
      placement: null,
      reference: "V1",
      netlist: { parameters: { dc: "1.8" } },
    });
    document.nets.push(
      {
        id: "net-out",
        terminals: [{ instanceId: "V6", pinName: "+" }],
      },
      {
        id: "net-ground",
        terminals: [{ instanceId: "V6", pinName: "-" }],
      },
    );
    claimNet(document, "net-out", "VOUT");
    claimNet(document, "net-ground", "0", "global", "ground");

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(printSpiceNetlist(result.ir!)).toContain("V1 VOUT 0 DC 1.8");
  });

  it("projects legacy Digital Clock instances onto explicit PULSE intent", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "VCLK",
      symbolId: "pulse-voltage-source",
      placement: null,
      reference: "VCLK",
      netlist: {
        parameters: {
          low: "0",
          high: "1",
          delay: "1ns",
          rise: "1ps",
          fall: "1ps",
          width: "5ns",
          period: "10ns",
          dutyCycle: "50",
          initial: "0",
        },
      },
    });
    document.nets.push(
      {
        id: "net-clock",
        terminals: [{ instanceId: "VCLK", pinName: "+" }],
      },
      {
        id: "net-ground",
        terminals: [{ instanceId: "VCLK", pinName: "-" }],
      },
    );
    claimNet(document, "net-clock", "CLK");
    claimNet(document, "net-ground", "0", "global", "ground");
    const before = JSON.stringify(project);

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.instances[0]?.parameters).toContainEqual({
      name: "waveform",
      rawValue: "pulse",
    });
    expect(printSpiceNetlist(result.ir!)).toContain(
      "VCLK CLK 0 PULSE(0 1 1ns 1ps 1ps 5ns 10ns)",
    );
    expect(JSON.stringify(project)).toBe(before);
  });

  it("uses explicit waveform intent and diagnoses incomplete sources", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "I1",
      symbolId: "current-source",
      placement: null,
      reference: "I1",
      netlist: {
        parameters: {
          dc: "1u",
          waveform: "pulse",
          period: "10ns",
        },
      },
    });
    document.nets.push(
      {
        id: "net-out",
        terminals: [{ instanceId: "I1", pinName: "+" }],
      },
      {
        id: "net-ground",
        terminals: [{ instanceId: "I1", pinName: "-" }],
      },
    );
    claimNet(document, "net-out", "OUT");
    claimNet(document, "net-ground", "0", "global", "ground");

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(
      result.diagnostics.filter(
        (item) => item.code === "MISSING_SOURCE_WAVEFORM_PARAMETER",
      ),
    ).toHaveLength(6);
    expect(result.diagnostics[0]).toMatchObject({ objectIds: ["I1"] });
  });

  it("still rejects an explicitly incompatible built-in binding", () => {
    const project = resistorProject({ value: "10k" });
    project.documents[0]!.instances[0]!.netlist!.binding = {
      kind: "primitive",
      deviceClass: "capacitor",
    };

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "DEVICE_CLASS_MISMATCH" }),
    );
  });

  it("returns stable analysis across repeated and serialized Project reads", () => {
    const project = resistorProject({ Value: "10k" });
    const first = analyzeDesignNetlist(project);
    const repeated = analyzeDesignNetlist(project);
    const reopened = analyzeDesignNetlist(
      JSON.parse(JSON.stringify(project)) as typeof project,
    );

    expect(repeated).toEqual(first);
    expect(reopened).toEqual(first);
  });

  it("preserves the Project top when analyzing an explicit Testbench root", () => {
    const project = createEmptyProject("project", "Project", "dut");
    const dut = project.documents[0]!;
    dut.netlist!.name = "dut";
    const testbench = createEmptyDocument("tb", "Testbench");
    testbench.netlist!.name = "testbench";
    testbench.instances.push({
      id: "X_DUT",
      symbolId: "dut-symbol",
      placement: null,
      reference: "X_DUT",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: dut.id },
        parameters: {},
      },
    });
    const unrelated = createEmptyDocument("unrelated", "Unrelated");
    for (const [document, netId, spelling] of [
      [dut, "net-dut-vdd", "VDD"],
      [testbench, "net-tb-vdd", "vdd"],
      [unrelated, "net-unrelated-vdd", "VDd"],
    ] as const) {
      document.nets.push({ id: netId, terminals: [] });
      claimNet(document, netId, spelling, "global");
    }
    project.documents.push(testbench, unrelated);
    const before = JSON.stringify(project);

    const result = analyzeDesignNetlist(project, { rootDocumentId: "tb" });

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.ir?.topCellId).toBe("tb");
    expect(result.ir?.cells.map((cell) => cell.id)).toEqual(["dut", "tb"]);
    expect(result.ir?.globals).toEqual(["vdd"]);
    expect(
      result.ir?.cells.map(
        (cell) => cell.nets.find((net) => net.scope === "global")?.name,
      ),
    ).toEqual(["vdd", "vdd"]);
    expect(result.ir?.cells.some((cell) => cell.id === "unrelated")).toBe(
      false,
    );
    expect(project.topDocumentId).toBe("dut");
    expect(JSON.stringify(project)).toBe(before);
  });

  it("keeps omitted and explicit Project-top analysis identical", () => {
    const project = resistorProject({ value: "10k" });

    expect(
      analyzeDesignNetlist(project, {
        rootDocumentId: project.topDocumentId,
      }),
    ).toEqual(analyzeDesignNetlist(project));
  });

  it("diagnoses an unknown explicit root without throwing", () => {
    const project = createEmptyProject("project", "Project");

    const result = analyzeDesignNetlist(project, {
      rootDocumentId: "missing-testbench",
    });

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "MISSING_ROOT_CELL",
        documentId: project.topDocumentId,
        objectIds: [],
        message:
          "Simulation root references unknown Document missing-testbench",
        primary: expect.objectContaining({
          documentId: project.topDocumentId,
          kind: "document",
          objectId: project.topDocumentId,
        }),
      }),
    ]);
  });

  it("rejects parameters that would become ambiguous under case folding", () => {
    const result = analyzeDesignNetlist(
      resistorProject({ value: "10k", Value: "20k" }),
    );
    expect(result.ir).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "DUPLICATE_PARAMETER_NAME",
        objectIds: ["R1"],
        message: expect.stringContaining("parameter value"),
      }),
    ]);
    expect(result.diagnostics[0]?.primary).toMatchObject({
      documentId: result.diagnostics[0]?.documentId,
      objectId: "R1",
    });
  });

  it("exports same-name local/global claims on one physical Net as global", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.nets.push({
      id: "net-global",

      terminals: [],
    });
    claimNet(document, "net-global", "BIAS", "local");
    claimNet(document, "net-global", "BIAS", "global");

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.globals).toEqual(["BIAS"]);
    expect(result.ir?.cells[0]?.nets).toEqual([
      { id: "net-global", name: "BIAS", scope: "global" },
    ]);
  });

  it("blocks distinct local and global Nets that encode to the same node token", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.nets.push(
      { id: "net-local-vdd", terminals: [] },
      { id: "net-global-vdd", terminals: [] },
    );
    claimNet(document, "net-local-vdd", "VDD", "local");
    claimNet(document, "net-global-vdd", "vdd", "global");

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DIALECT_NAME_COLLISION",
        objectIds: expect.arrayContaining(["net-local-vdd", "net-global-vdd"]),
      }),
    );
  });

  it("applies the selected dialect codec after semantic Net resolution", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.nets.push({ id: "net-bus", terminals: [] });
    claimNet(document, "net-bus", "DATA<3>");

    const spice = analyzeDesignNetlist(project, { format: "spice" });
    const spectre = analyzeDesignNetlist(project, { format: "spectre" });

    expect(spice.ir).toBeNull();
    expect(spice.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNREPRESENTABLE_NGSPICE_NET_NAME" }),
    );
    expect(spectre.diagnostics).toEqual([]);
    expect(spectre.ir?.cells[0]?.nets).toContainEqual({
      id: "net-bus",
      name: "DATA\\<3\\>",
      scope: "local",
    });
  });

  it("projects typed globals through the explicit Cadence bang profile", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.nets.push({ id: "net-vdd", terminals: [] });
    claimNet(document, "net-vdd", "VDD", "global");

    const native = analyzeDesignNetlist(project, {
      format: "spectre",
      namingProfile: "native",
    });
    const cadence = analyzeDesignNetlist(project, {
      format: "spectre",
      namingProfile: "cadence-bang",
    });

    expect(native.ir?.globals).toEqual(["VDD"]);
    expect(cadence.ir?.globals).toEqual(["VDD!"]);
    expect(cadence.ir?.cells[0]?.nets).toContainEqual({
      id: "net-vdd",
      name: "VDD!",
      scope: "global",
    });
  });

  it("projects one preferred global spelling through every reachable Cell", () => {
    const project = createEmptyProject("project", "Project", "top");
    const top = project.documents[0]!;
    const child = createEmptyProject("child-project", "Child", "child")
      .documents[0]!;
    child.netlist!.name = "child";
    project.documents.push(child);
    top.instances.push({
      id: "X1",
      symbolId: "child-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "child" },
        parameters: {},
      },
    });
    for (const [document, reference, netId, spelling] of [
      [top, "R1", "net-top-vdd", "VDD"],
      [child, "R2", "net-child-vdd", "vdd"],
    ] as const) {
      document.instances.push({
        id: reference,
        symbolId: "resistor",
        placement: null,
        reference,
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      });
      document.nets.push({
        id: netId,
        terminals: [{ instanceId: reference, pinName: "1" }],
      });
      document.noConnects.push({
        id: `nc-${reference}`,
        endpoint: { kind: "terminal", instanceId: reference, pinName: "2" },
      });
      claimNet(document, netId, spelling, "global");
    }

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.ir?.globals).toEqual(["VDD"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "GLOBAL_NAME_SPELLING_NORMALIZED",
        message: "global Net spellings [VDD, vdd] export as VDD",
      }),
    );
    expect(
      result.ir?.cells.map(
        (cell) => cell.nets.find((net) => net.scope === "global")?.name,
      ),
    ).toEqual(["VDD", "VDD"]);
    expect(printSpiceNetlist(result.ir!)).toContain("R2 VDD NC0001 1k");
  });

  it("exports a ground net marker without inventing a netlist record", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "GND",
      symbolId: "ground",
      placement: null,
    });
    document.nets.push({
      id: "net-ground",

      terminals: [{ instanceId: "GND", pinName: "0" }],
    });
    claimNet(document, "net-ground", "0", "global", "ground");

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.instances).toEqual([]);
    expect(result.ir?.globals).toEqual(["0"]);
  });

  it("recovers unnamed visible Ground markers as global node 0", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    for (const suffix of ["1", "2"]) {
      document.instances.push(
        {
          id: `GND${suffix}`,
          symbolId: "ground",
          placement: null,
        },
        {
          id: `R${suffix}`,
          symbolId: "resistor",
          placement: null,
          reference: `R${suffix}`,
          netlist: {
            binding: { kind: "primitive", deviceClass: "resistor" },
            parameters: { value: `${suffix}k` },
          },
        },
      );
      document.nets.push({
        id: `net-ground-${suffix}`,
        terminals: [
          { instanceId: `GND${suffix}`, pinName: "0" },
          { instanceId: `R${suffix}`, pinName: "1" },
        ],
      });
      document.noConnects.push({
        id: `nc-R${suffix}`,
        endpoint: { kind: "terminal", instanceId: `R${suffix}`, pinName: "2" },
      });
    }

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.ir?.globals).toEqual(["0"]);
    expect(printSpiceNetlist(result.ir!)).toMatch(/R1 0 NC0001 1k/u);
    expect(printSpiceNetlist(result.ir!)).toMatch(/R2 0 NC0002 2k/u);
  });

  it("recovers an unnamed visible VDD marker as global node VDD", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      {
        id: "VDD1",
        symbolId: "vdd-port",
        placement: null,
      },
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      },
    );
    document.nets.push({
      id: "net-vdd",
      terminals: [
        { instanceId: "VDD1", pinName: "P" },
        { instanceId: "R1", pinName: "1" },
      ],
    });
    document.noConnects.push({
      id: "nc-R1",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
    });

    const result = analyzeDesignNetlist(project);

    expect(
      result.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    expect(result.ir?.globals).toEqual(["VDD"]);
    expect(printSpiceNetlist(result.ir!)).toMatch(/R1 VDD NC0001 1k/u);
  });

  it("exports a global named VDD Port Net without inventing a marker record", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: null,
    });
    document.nets.push({
      id: "net-vdd",

      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });
    claimNet(document, "net-vdd", "VDD", "global", "vdd");

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.instances).toEqual([]);
    expect(result.ir?.cells[0]?.nets).toContainEqual({
      id: "net-vdd",
      name: "VDD",
      scope: "global",
    });
    expect(result.ir?.globals).toEqual(["VDD"]);
    expect(result.ir?.cells[0]?.ports).toEqual([]);
    expect(printSpiceNetlist(result.ir!)).toContain(".subckt dut");
  });

  it("exports formal VDD Power as a local Cell Pin and preserves its connected PMOS bulk", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "VDD1", symbolId: "vdd-port", placement: null },
      {
        id: "M1",
        symbolId: "pmos",
        placement: null,
        reference: "M1",
        netlist: {
          binding: { kind: "model", deviceClass: "mos", name: "PMOS_MODEL" },
          parameters: { w: "1u", l: "150n", m: "1", nf: "1" },
        },
      },
    );
    document.nets.push({
      id: "net-vdd",
      terminals: [
        { instanceId: "VDD1", pinName: "P" },
        { instanceId: "M1", pinName: "B" },
      ],
    });
    document.netlist!.terminals.push({
      id: "terminal-vdd1",
      name: "VDD",
      netId: "net-vdd",
      direction: "inout",
      interfaceInstanceIds: ["VDD1"],
    });
    for (const pinName of ["D", "G", "S"] as const) {
      const netId = `net-${pinName.toLowerCase()}`;
      document.nets.push({
        id: netId,
        terminals: [{ instanceId: "M1", pinName }],
      });
      claimNet(document, netId, pinName);
    }

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.globals).toEqual([]);
    expect(result.ir?.cells[0]?.ports).toEqual([
      { id: "net-vdd", name: "VDD", netName: "VDD" },
    ]);
    expect(result.ir?.cells[0]?.instances[0]?.nodes[3]).toEqual({
      pinName: "B",
      netName: "VDD",
    });
    expect(printSpiceNetlist(result.ir!)).not.toContain(".global VDD");
  });

  it("blocks export when one VDD Net is both formal and Global", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: null,
    });
    document.nets.push({
      id: "net-vdd",
      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "terminal-vdd1",
      name: "VDD",
      netId: "net-vdd",
      direction: "inout",
      interfaceInstanceIds: ["VDD1"],
    });
    claimNet(document, "net-vdd", "VDD", "global", "vdd");

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FORMAL_PORT_GLOBAL_NET_CONFLICT",
        objectIds: expect.arrayContaining(["net-vdd", "terminal-vdd1"]),
      }),
    );
  });

  it("rejects a VDD Port attached to a named non-VDD Net", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: null,
    });
    document.nets.push({
      id: "net-signal",

      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });
    claimNet(document, "net-signal", "SIGNAL");

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_NET_MARKER",
        objectIds: ["VDD1", "net-signal"],
      }),
    );
  });

  it("emits a resolved shared external interface without inventing an empty Cell", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "external-ota",
      name: "OTA",
      terminals: [
        { id: "external-ota-inp", name: "INP", direction: "passive" },
        { id: "external-ota-inn", name: "INN", direction: "passive" },
        { id: "external-ota-out", name: "OUT", direction: "passive" },
      ],
      formalParameters: [{ name: "gain", defaultValue: "10" }],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "X1",
      symbolId: "external-ota-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-ota" },
        parameters: {},
      },
    });
    for (const [id, name, pinName] of [
      ["net-inp", "INP", "INP"],
      ["net-inn", "INN", "INN"],
      ["net-out", "OUT", "OUT"],
    ] as const) {
      document.nets.push({
        id,

        terminals: [{ instanceId: "X1", pinName }],
      });
      claimNet(document, id, name);
    }

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells).toHaveLength(1);
    expect(result.ir?.cells[0]?.instances).toEqual([
      expect.objectContaining({
        reference: "X1",
        target: "OTA",
        nodes: [
          { pinName: "INP", netName: "INP" },
          { pinName: "INN", netName: "INN" },
          { pinName: "OUT", netName: "OUT" },
        ],
      }),
    ]);
    expect(result.ir?.externalMasters).toEqual([
      expect.objectContaining({
        id: "external-ota",
        name: "OTA",
        terminals: [
          expect.objectContaining({ name: "INP" }),
          expect.objectContaining({ name: "INN" }),
          expect.objectContaining({ name: "OUT" }),
        ],
        formalParameters: [{ name: "gain", defaultValue: "10" }],
      }),
    ]);
  });

  it("requires an override only for formals without a definition default", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "external-gain",
      name: "GAIN",
      terminals: [{ id: "external-gain-in", name: "IN", direction: "passive" }],
      formalParameters: [{ name: "gain" }],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "X1",
      symbolId: "external-gain-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-gain" },
        parameters: {},
      },
    });
    document.nets.push({
      id: "net-in",

      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });
    claimNet(document, "net-in", "IN");

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_SUBCIRCUIT_PARAMETER",
        objectIds: ["X1"],
      }),
    );
  });

  it("permits an external caller to retain raw library-specific parameters", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "external-library",
      name: "LIBRARY_MASTER",
      terminals: [
        { id: "external-library-p1", name: "P1", direction: "passive" },
      ],
      formalParameters: [],
      interfaceStatus: "inferred-positional",
    });
    document.instances.push({
      id: "X1",
      symbolId: "external-library-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: "external-library",
        },
        parameters: { l: "150n", w: "2u", nf: "4" },
      },
    });
    document.nets.push({
      id: "net-in",

      terminals: [{ instanceId: "X1", pinName: "P1" }],
    });
    claimNet(document, "net-in", "IN");

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]!.instances[0]!.parameters).toEqual([
      { name: "l", rawValue: "150n" },
      { name: "nf", rawValue: "4" },
      { name: "w", rawValue: "2u" },
    ]);
  });

  it("uses external terminal array order for X nodes while retaining terminal identities", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "external-order",
      name: "ORDERED",
      terminals: [
        { id: "terminal-b", name: "B", direction: "passive" },
        { id: "terminal-a", name: "A", direction: "passive" },
      ],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "X1",
      symbolId: "external-order-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: "external-order",
        },
        parameters: {},
      },
    });
    document.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "X1", pinName: "A" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "X1", pinName: "B" }],
      },
    );
    claimNet(document, "net-a", "NET_A");
    claimNet(document, "net-b", "NET_B");

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]!.instances[0]!.nodes).toEqual([
      { pinName: "B", netName: "NET_B" },
      { pinName: "A", netName: "NET_A" },
    ]);
  });

  it("exports a canonical X-referenced MOS symbol as an ordered SKY130 call", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "sky130-nfet",
      name: "sky130_fd_pr__nfet_01v8",
      terminals: ["D", "G", "S", "B"].map((name, index) => ({
        id: `terminal-${index}`,
        name,
        direction: "passive",
      })),
      formalParameters: [],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "mos-instance",
      symbolId: "nmos",
      placement: null,
      reference: "XM1",
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: "sky130-nfet",
        },
        parameters: { l: "150n", w: "2u", nf: "4" },
      },
    });
    for (const [pinName, netName] of [
      ["D", "DRAIN"],
      ["G", "GATE"],
      ["S", "SOURCE"],
      ["B", "BODY"],
    ] as const) {
      document.nets.push({
        id: `net-${pinName.toLowerCase()}`,

        terminals: [{ instanceId: "mos-instance", pinName }],
      });
      claimNet(document, `net-${pinName.toLowerCase()}`, netName);
    }

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]!.instances[0]).toMatchObject({
      reference: "XM1",
      target: "sky130_fd_pr__nfet_01v8",
      nodes: [
        { pinName: "D", netName: "DRAIN" },
        { pinName: "G", netName: "GATE" },
        { pinName: "S", netName: "SOURCE" },
        { pinName: "B", netName: "BODY" },
      ],
    });
    expect(printSpiceNetlist(result.ir!)).toContain(
      "XM1 DRAIN GATE SOURCE BODY sky130_fd_pr__nfet_01v8 l=0.15 w=2 nf=4",
    );
  });

  it.each(["spice", "spectre"] as const)(
    "defaults missing schematic MOS bodies in %s while preserving explicit domains",
    (format) => {
      const project = createEmptyProject("project", "Project");
      const document = project.documents[0]!;
      for (const [id, symbolId, model] of [
        ["M1", "nmos", "NMOS_MODEL"],
        ["M2", "pmos", "PMOS_MODEL"],
        ["M3", "nmos", "NMOS_MODEL"],
        ["M4", "pmos", "PMOS_MODEL"],
      ] as const) {
        document.instances.push({
          id,
          symbolId,
          placement: null,
          reference: id,
          netlist: {
            binding: { kind: "model", deviceClass: "mos", name: model },
            parameters: { w: "1u", l: "150n", m: "1", nf: "1" },
          },
        });
        for (const pinName of ["D", "G", "S"] as const) {
          const netId = `${id}-${pinName}`;
          document.nets.push({
            id: netId,
            terminals: [{ instanceId: id, pinName }],
          });
          claimNet(document, netId, `${id}_${pinName}`);
        }
      }
      document.nets.push(
        {
          id: "nmos-body",
          terminals: [{ instanceId: "M3", pinName: "B" }],
        },
        {
          id: "pmos-body",
          terminals: [{ instanceId: "M4", pinName: "B" }],
        },
      );
      claimNet(document, "nmos-body", "VSSB");
      claimNet(document, "pmos-body", "VBP");

      const result = analyzeDesignNetlist(project, { format });

      expect(result.ir).not.toBeNull();
      expect(
        result.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
      expect(
        result.ir?.cells[0]?.instances.map((instance) => instance.nodes[3]),
      ).toEqual([
        { pinName: "B", netName: "0" },
        { pinName: "B", netName: "VDD" },
        { pinName: "B", netName: "VSSB" },
        { pinName: "B", netName: "VBP" },
      ]);
      // Explicit body wiring overrides the conventional default supplies.
      document.nets
        .find((net) => net.id === "nmos-body")!
        .terminals.push({ instanceId: "M1", pinName: "B" });
      document.nets
        .find((net) => net.id === "pmos-body")!
        .terminals.push({ instanceId: "M2", pinName: "B" });
      const connected = analyzeDesignNetlist(project, { format });
      expect(connected.diagnostics).toEqual([]);
      expect(connected.ir?.cells[0]?.ports).toEqual([]);
      expect(connected.ir?.globals).toEqual([]);
      expect(
        connected.ir?.cells[0]?.instances.map((instance) => instance.nodes[3]),
      ).toEqual([
        { pinName: "B", netName: "VSSB" },
        { pinName: "B", netName: "VBP" },
        { pinName: "B", netName: "VSSB" },
        { pinName: "B", netName: "VBP" },
      ]);
    },
  );
});

describe("voltage-controlled switch", () => {
  it("extracts and prints the four-node S card the simulator reads", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "S1",
      symbolId: "voltage-controlled-switch",
      placement: null,
      reference: "S1",
      netlist: {
        binding: { kind: "model", deviceClass: "switch", name: "SW_RLY" },
        parameters: {},
      },
    });
    // Two switched nodes then two control nodes, in the descriptor's pin
    // order, which is the order SPICE reads them.
    const wire = (netId: string, name: string, pinName: string) => {
      document.nets.push({
        id: netId,
        terminals: [{ instanceId: "S1", pinName }],
      });
      claimNet(document, netId, name);
    };
    wire("net-a", "vout", "P");
    wire("net-b", "0", "N");
    wire("net-c", "vctrl", "CP");
    wire("net-d", "vcm", "CN");

    const analysis = analyzeDesignNetlist(project);
    expect(
      analysis.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
    expect(analysis.ir).not.toBeNull();
    expect(printSpiceNetlist(analysis.ir!)).toContain(
      "S1 vout 0 vctrl vcm SW_RLY",
    );
  });

  // The two-terminal Razavi switches are drawn, designated, and read, but they
  // are not simulable: SPICE's S wants four nodes and a model card that a
  // two-terminal drawing cannot supply, which is why the Symbol catalog marks
  // them manual-only. Emission must say so rather than print an S card with a
  // missing target where the model name belongs.
  it("refuses to emit a card for a drawing-only two-terminal switch", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      placement: null,
      reference: "S1",
      netlist: { parameters: {} },
    });
    document.nets.push({
      id: "net-a",
      terminals: [{ instanceId: "S1", pinName: "1" }],
    });
    claimNet(document, "net-a", "vout");
    document.nets.push({
      id: "net-b",
      terminals: [{ instanceId: "S1", pinName: "2" }],
    });
    claimNet(document, "net-b", "0");

    const analysis = analyzeDesignNetlist(project);
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "NON_NETLISTABLE_DEVICE",
    );
    // Without the refusal the printer reaches `instance.target!` holding null
    // and throws inside wrapSpice, so an unsimulable Symbol on the canvas took
    // the whole export down.
    expect(analysis.ir).toBeNull();
  });

  it("projects the reviewed SKY130 MOS and physical passives in production", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    const definitions = [
      {
        id: "sky-nfet",
        name: "sky130_fd_pr__nfet_01v8",
        symbolId: "nmos",
        reference: "XM1",
        terminalNames: ["D", "G", "S", "B"],
        pinNames: ["D", "G", "S", "B"],
        parameters: { w: "1u", l: "150n", nf: "1", m: "2" },
      },
      {
        id: "sky-res",
        name: "sky130_fd_pr__res_high_po",
        symbolId: "resistor",
        reference: "XR1",
        terminalNames: ["R0", "R1", "B"],
        pinNames: ["1", "2", "B"],
        parameters: { w: "1u", l: "5.5u", mult: "3" },
      },
      {
        id: "sky-cap",
        name: "sky130_fd_pr__cap_mim_m3_1",
        symbolId: "capacitor",
        reference: "XC1",
        terminalNames: ["C0", "C1"],
        pinNames: ["1", "2"],
        parameters: { w: "5u", l: "5u", mf: "4" },
      },
      {
        id: "sky-pnp",
        name: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
        symbolId: "pnp",
        reference: "XQ1",
        terminalNames: ["C", "B", "E"],
        pinNames: ["C", "B", "E"],
        parameters: {},
      },
      {
        id: "sky-npn",
        name: "sky130_fd_pr__npn_05v5_W1p00L1p00",
        symbolId: "npn",
        reference: "XQ2",
        terminalNames: ["C", "B", "E", "S"],
        pinNames: ["C", "B", "E", "S"],
        parameters: {},
      },
    ] as const;
    for (const item of definitions) {
      project.externalSubcircuitDefinitions.push({
        id: item.id,
        name: item.name,
        terminals: item.terminalNames.map((name, index) => ({
          id: `${item.id}-terminal-${index}`,
          name,
          direction: "passive",
        })),
        formalParameters: [],
        interfaceStatus: "declared",
      });
      document.instances.push({
        id: item.reference,
        symbolId: item.symbolId,
        placement: null,
        reference: item.reference,
        netlist: {
          binding: { kind: "external-subcircuit", definitionId: item.id },
          parameters: { ...item.parameters },
        },
      });
      item.pinNames.forEach((pinName, index) => {
        const netId = `${item.reference}-${pinName}`;
        document.nets.push({
          id: netId,
          terminals: [{ instanceId: item.reference, pinName }],
        });
        claimNet(document, netId, `${item.reference}_${index}`);
      });
    }

    const analysis = analyzeDesignNetlist(project, { format: "spice" });
    expect(analysis.diagnostics).toEqual([]);
    const text = printSpiceNetlist(analysis.ir!);
    expect(text).toContain(
      "XM1 XM1_0 XM1_1 XM1_2 XM1_3 sky130_fd_pr__nfet_01v8 l=0.15 w=1 nf=1 m=2",
    );
    expect(text).toContain(
      "XR1 XR1_0 XR1_1 XR1_2 sky130_fd_pr__res_high_po w=1 l=5.5 mult=3",
    );
    expect(text).toContain(
      "XC1 XC1_0 XC1_1 sky130_fd_pr__cap_mim_m3_1 w=5 l=5 mf=4",
    );
    expect(text).toContain(
      "XQ1 XQ1_0 XQ1_1 XQ1_2 sky130_fd_pr__pnp_05v5_W0p68L0p68",
    );
    expect(text).toContain(
      "XQ2 XQ2_0 XQ2_1 XQ2_2 XQ2_3 sky130_fd_pr__npn_05v5_W1p00L1p00",
    );
    expect(
      analysis.ir?.cells[0]?.instances.map((instance) => instance.reference),
    ).toEqual(["XC1", "XM1", "XQ1", "XQ2", "XR1"]);
  });
});

import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";

import { analyzeDesignNetlist } from "./index.js";

function resistorProject(parameters: Record<string, string>) {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: {
      reference: "R1",
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters,
    },
  });
  document.nets.push(
    {
      id: "net-in",
      name: "VIN",
      scope: "local",
      terminals: [{ instanceId: "R1", pinName: "1" }],
    },
    {
      id: "net-out",
      name: "VOUT",
      scope: "local",
      terminals: [{ instanceId: "R1", pinName: "2" }],
    },
  );
  return project;
}

describe("current formal cell interface", () => {
  it("maps formal Cell Port Instances to the ordered exported interface", () => {
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
        scope: "local",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-out",
        scope: "local",
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

  it("treats a Free Net Port as a connected non-emitting Net marker", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "net-vin",
      name: "VIN",
      scope: "local",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.instances).toEqual([]);
    expect(result.ir?.cells[0]?.nets).toContainEqual({
      id: "net-vin",
      name: "VIN",
      scope: "local",
    });
  });

  it("blocks an unconnected Free Net Port", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.instances.push({
      id: "P1",
      symbolId: "port-filled",
      placement: null,
    });

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "MISSING_PIN_NET",
        objectIds: ["P1"],
      }),
    );
  });

  it("exports explicit NoConnect terminals through deterministic floating nodes", () => {
    const project = resistorProject({ value: "10k" });
    const document = project.documents[0]!;
    document.nets[1]!.terminals = [];
    document.nets.push({
      id: "occupied-no-connect-name",
      name: "NC0001",
      scope: "local",
      terminals: [],
    });
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

  it("reports the shared global-name contract violation", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.nets.push({
      id: "net-global",
      scope: "global",
      terminals: [],
    });

    const result = analyzeDesignNetlist(project);

    expect(result.ir).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNNAMED_GLOBAL_NET",
        objectIds: ["net-global"],
      }),
    );
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
      name: "0",
      scope: "global",
      terminals: [{ instanceId: "GND", pinName: "0" }],
    });

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]?.instances).toEqual([]);
    expect(result.ir?.globals).toEqual(["0"]);
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
      netlist: {
        reference: "X1",
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
        name,
        scope: "local",
        terminals: [{ instanceId: "X1", pinName }],
      });
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
      netlist: {
        reference: "X1",
        binding: { kind: "external-subcircuit", definitionId: "external-gain" },
        parameters: {},
      },
    });
    document.nets.push({
      id: "net-in",
      name: "IN",
      scope: "local",
      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });

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
      netlist: {
        reference: "X1",
        binding: {
          kind: "external-subcircuit",
          definitionId: "external-library",
        },
        parameters: { l: "150n", w: "2u", nf: "4" },
      },
    });
    document.nets.push({
      id: "net-in",
      name: "IN",
      scope: "local",
      terminals: [{ instanceId: "X1", pinName: "P1" }],
    });

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
      netlist: {
        reference: "X1",
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
        name: "NET_A",
        scope: "local",
        terminals: [{ instanceId: "X1", pinName: "A" }],
      },
      {
        id: "net-b",
        name: "NET_B",
        scope: "local",
        terminals: [{ instanceId: "X1", pinName: "B" }],
      },
    );

    const result = analyzeDesignNetlist(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.cells[0]!.instances[0]!.nodes).toEqual([
      { pinName: "B", netName: "NET_B" },
      { pinName: "A", netName: "NET_A" },
    ]);
  });

  it("exports a canonical MOS symbol as an ordered external SKY130 X call", () => {
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
      id: "XM1",
      symbolId: "nmos",
      placement: null,
      netlist: {
        reference: "XM1",
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
        name: netName,
        scope: "local",
        terminals: [{ instanceId: "XM1", pinName }],
      });
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
  });
});

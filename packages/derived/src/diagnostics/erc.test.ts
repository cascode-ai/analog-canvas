import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectConnectivityIndex } from "../connectivity-index.js";
import { runErcChecks } from "./erc.js";

const dual = {
  schemaVersion: 1 as const,
  id: "dual",
  name: "Dual",
  viewBox: { x: -20, y: -20, width: 40, height: 40 },
  pins: [
    {
      name: "L",
      role: "passive",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "R",
      role: "passive",
      at: { x: 20, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  primitives: [
    { kind: "line" as const, from: { x: -10, y: 0 }, to: { x: 10, y: 0 } },
  ],
  variants: [],
};

const resolver = new InMemorySymbolResolver([...builtInSymbols, dual]);

const mos = {
  ...dual,
  id: "mos",
  name: "MOS",
  pins: [
    {
      name: "G",
      role: "gate",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "D",
      role: "drain",
      at: { x: 0, y: -20 },
      direction: "north" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "S",
      role: "source",
      at: { x: 0, y: 20 },
      direction: "south" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "B",
      role: "bulk",
      at: { x: 20, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  variants: [{ id: "three-terminal", hiddenPinNames: ["B"] }],
};

const roleResolver = new InMemorySymbolResolver([mos]);

function emptyProject(): CircuitProject {
  return createEmptyProject("erc", "ERC", "doc");
}

function instance(id: string, spiceName?: string) {
  return {
    id,
    symbolId: "dual",
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    ...(spiceName ? { netlist: { reference: spiceName, parameters: {} } } : {}),
  };
}

function run(project: CircuitProject) {
  return runErcChecks(
    project,
    buildProjectConnectivityIndex(project, resolver),
    resolver,
  );
}

function codes(project: CircuitProject): string[] {
  return run(project).map((diagnostic) => diagnostic.code);
}

function roleRun(project: CircuitProject) {
  return runErcChecks(
    project,
    buildProjectConnectivityIndex(project, roleResolver),
    roleResolver,
  );
}

function roleInstance(variant?: string) {
  return {
    ...instance("M1"),
    symbolId: "mos",
    ...(variant ? { symbolVariantId: variant } : {}),
  };
}

function connectDrainAndSource(project: CircuitProject): void {
  project.documents[0]!.nets.push({
    id: "net-channel",

    terminals: [
      { instanceId: "M1", pinName: "D" },
      { instanceId: "M1", pinName: "S" },
    ],
  });
}

describe("ERC engine", () => {
  it("does not group independent same-name Cell Pins for live ERC", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      { id: "net-a", terminals: [{ instanceId: "P1", pinName: "P" }] },
      { id: "net-b", terminals: [{ instanceId: "P2", pinName: "P" }] },
    );
    document.netlist!.terminals.push(
      {
        id: "terminal-a",
        name: "BUS",
        netId: "net-a",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-b",
        name: "bus",
        netId: "net-b",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    );
    const before = structuredClone(project);

    expect(
      run(project).some(
        (diagnostic) => diagnostic.code === "ERC_CELL_PORT_DIRECTION_CONFLICT",
      ),
    ).toBe(false);
    expect(project).toEqual(before);
  });

  it("is silent on a clean project where every pin is connected", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [instance("I1", "M1")];
    document.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];
    expect(run(project)).toEqual([]);
  });

  it("flags unconnected visible pins and suppresses them via NoConnect", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [instance("I1")];
    expect(codes(project)).toEqual([
      "ERC_UNCONNECTED_PIN",
      "ERC_UNCONNECTED_PIN",
    ]);

    // Declaring L as NoConnect removes its warning; R remains.
    project.documents[0]!.noConnects = [
      {
        id: "nc1",
        endpoint: { kind: "terminal", instanceId: "I1", pinName: "L" },
      },
    ];
    expect(codes(project)).toEqual(["ERC_UNCONNECTED_PIN"]);
    expect(run(project)[0]!.primary).toMatchObject({
      kind: "terminal",
      endpoint: { kind: "terminal", instanceId: "I1", pinName: "R" },
    });
  });

  it("accepts an otherwise-singleton pin explicitly declared by imported SPICE", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [instance("I1")];
    document.nets.push({
      id: "net-imported-singleton",
      terminals: [{ instanceId: "I1", pinName: "L" }],
    });
    document.connectivityEvidence.push({
      id: "source-singleton",
      kind: "spice-source",
      netId: "net-imported-singleton",
      sourceNetId: "source-nbit",
    });
    document.noConnects.push({
      id: "nc-right",
      endpoint: { kind: "terminal", instanceId: "I1", pinName: "R" },
    });

    expect(run(project)).toEqual([]);
  });

  it("does not flag an implicit pin even when unconnected", () => {
    const implicitResolver = new InMemorySymbolResolver([
      {
        ...dual,
        id: "withImplicit",
        pins: [
          ...dual.pins,
          {
            name: "X",
            role: "passive",
            at: { x: 0, y: -20 },
            direction: "north" as const,
            presentation: { visibility: "implicit" as const },
          },
        ],
      },
    ]);
    const project = emptyProject();
    project.documents[0]!.instances = [
      { ...instance("I1"), symbolId: "withImplicit" },
    ];
    project.documents[0]!.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];
    // L and R are connected; X is implicit and therefore not required.
    expect(
      runErcChecks(
        project,
        buildProjectConnectivityIndex(project, implicitResolver),
        implicitResolver,
      ),
    ).toEqual([]);
  });

  it("distinguishes an electrically floating gate from generic pins", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [roleInstance()];
    connectDrainAndSource(project);
    document.nets.push(
      {
        id: "net-gate-only",

        terminals: [{ instanceId: "M1", pinName: "G" }],
      },
      {
        id: "net-vss",

        terminals: [{ instanceId: "M1", pinName: "B" }],
      },
    );

    const diagnostics = roleRun(project);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ERC_FLOATING_GATE",
        primary: expect.objectContaining({ objectId: "M1:G" }),
        related: [expect.objectContaining({ objectId: "net-gate-only" })],
      }),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "ERC_UNCONNECTED_PIN",
    );
  });

  it("reports a Net that shorts reviewed VDD and ground symbols", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      { id: "VDD1", symbolId: "vdd-port", placement: null },
      { id: "GND1", symbolId: "ground", placement: null },
    ];
    document.nets = [
      {
        id: "net-short",

        terminals: [
          { instanceId: "VDD1", pinName: "P" },
          { instanceId: "GND1", pinName: "0" },
        ],
      },
    ];
    document.connectivityEvidence = [
      {
        id: "claim-vdd-short",
        kind: "name-claim",
        netId: "net-short",
        name: "VDD",
        scope: "local",
        powerDomain: "vdd",
        owner: { kind: "explicit-net-property" },
      },
      {
        id: "claim-ground-short",
        kind: "name-claim",
        netId: "net-short",
        name: "0",
        scope: "local",
        powerDomain: "ground",
        owner: { kind: "explicit-net-property" },
      },
    ];

    expect(run(project)).toContainEqual(
      expect.objectContaining({
        code: "ERC_POWER_DOMAIN_CONFLICT",
        severity: "error",
        primary: expect.objectContaining({ objectId: "net-short" }),
      }),
    );
  });

  it("suppresses role-specific ERC warnings with explicit NoConnect", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [roleInstance()];
    connectDrainAndSource(project);
    document.noConnects = [
      {
        id: "nc-gate",
        endpoint: { kind: "terminal", instanceId: "M1", pinName: "G" },
      },
      {
        id: "nc-bulk",
        endpoint: { kind: "terminal", instanceId: "M1", pinName: "B" },
      },
    ];

    expect(roleRun(project)).toEqual([]);
  });

  it("does not treat MOS bulk pins alone as an external body reference", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      roleInstance("three-terminal"),
      { ...roleInstance("three-terminal"), id: "M2" },
    ];
    document.nets.push({
      id: "net-bulk-only",

      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "M2", pinName: "B" },
      ],
    });

    expect(
      roleRun(project).filter(
        (diagnostic) => diagnostic.code === "ERC_BULK_UNRESOLVED",
      ),
    ).toHaveLength(2);
  });

  it("does not treat SPICE source provenance as an electrical bulk connection", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [roleInstance("three-terminal")];
    connectDrainAndSource(project);
    document.nets.push({
      id: "net-source-bulk",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.connectivityEvidence.push({
      id: "source-bulk",
      kind: "spice-source",
      netId: "net-source-bulk",
      sourceNetId: "source-vss",
    });

    expect(
      roleRun(project).filter(
        (diagnostic) => diagnostic.code === "ERC_BULK_UNRESOLVED",
      ),
    ).toHaveLength(1);
  });

  it("flags two instances sharing a normalized netlist reference", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      instance("I1", "M1"),
      instance("I2", "m1"),
    ];
    project.documents[0]!.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "L" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    const diagnostic = run(project).find(
      (item) => item.code === "ERC_DUPLICATE_INSTANCE_NAME",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.severity).toBe("error");
    expect(diagnostic!.related).toHaveLength(1);
  });

  it("treats equal local names as one logical Net without physically merging", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [instance("I1"), instance("I2")];
    project.documents[0]!.nets = [
      {
        id: "net-a",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "I1", pinName: "R" }],
      },
    ];
    expect(run(project).map((item) => item.code)).not.toContain(
      "ERC_NET_NAME_CONFLICT",
    );
  });

  it("accepts repeated global ground markers as one logical Net", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      {
        id: "GND1",
        symbolId: "ground",
        placement: null,
      },
      {
        id: "GND2",
        symbolId: "ground",
        placement: null,
      },
      {
        id: "M1",
        symbolId: "nmos",
        placement: null,
      },
    ];
    project.documents[0]!.nets = [
      {
        id: "net-ground-1",

        terminals: [{ instanceId: "GND1", pinName: "0" }],
      },
      {
        id: "net-ground-2",

        terminals: [{ instanceId: "GND2", pinName: "0" }],
      },
      {
        id: "net-global-0",

        terminals: [{ instanceId: "M1", pinName: "B" }],
      },
    ];

    expect(codes(project)).not.toContain("ERC_NET_NAME_CONFLICT");
    expect(codes(project)).not.toContain("ERC_POWER_DOMAIN_CONFLICT");
  });

  it("defensively reports a NoConnect endpoint that is also on a Net", () => {
    // The schema invariant (WP-R7) rejects this at parse/Edit-Engine time; ERC
    // repeats the check defensively. Construct the invalid state via a cast.
    const project = emptyProject();
    project.documents[0]!.instances = [instance("I1"), instance("I2")];
    project.documents[0]!.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
    ];
    project.documents[0]!.noConnects = [
      {
        id: "nc1",
        endpoint: { kind: "terminal", instanceId: "I1", pinName: "L" },
      },
    ];
    const diagnostics = runErcChecks(
      project as CircuitProject,
      buildProjectConnectivityIndex(project as CircuitProject, resolver),
      resolver,
    );
    expect(
      diagnostics.some((item) => item.code === "ERC_NO_CONNECT_CONFLICT"),
    ).toBe(true);
  });

  it("reports unresolved symbols instead of silently skipping their pins", () => {
    const project = emptyProject();
    project.documents[0]!.instances = [
      { ...instance("I1"), symbolId: "missing-symbol" },
    ];
    const diagnostics = run(project);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ERC_UNRESOLVED_SYMBOL",
        primary: expect.objectContaining({ objectId: "I1" }),
      }),
    );
  });

  it("uses only typed binding evidence for missing and unsupported model ERC", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      {
        ...instance("I1"),
        importProvenance: {
          kind: "model",
          name: "missing-model",
          sourceTarget: "model:missing-model",
          status: "missing",
        },
      },
    ];
    document.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];

    expect(codes(project)).toContain("ERC_MISSING_MODEL");
    expect(codes(project)).not.toContain("ERC_UNSUPPORTED_MODEL");

    document.instances[0] = {
      ...document.instances[0]!,
      importProvenance: {
        kind: "opaque",
        name: "unsupported-device",
        sourceTarget: "opaque:unsupported-device",
        status: "unsupported",
      },
    };
    document.revision += 1;
    expect(codes(project)).toContain("ERC_UNSUPPORTED_MODEL");
    expect(codes(project)).not.toContain("ERC_MISSING_MODEL");
  });

  it("reports a missing X-call master separately from a missing device model", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      {
        ...instance("I1"),
        netlist: {
          reference: "XI1",
          binding: {
            kind: "external-subcircuit",
            definitionId: "external-missing",
          },
          parameters: {},
        },
        importProvenance: {
          kind: "opaque",
          name: "missing_external_master",
          sourceTarget: "external-subcircuit:missing_external_master",
          status: "missing",
        },
      },
    ];
    document.nets = [
      {
        id: "net-1",
        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];

    expect(codes(project)).toContain("ERC_MISSING_EXTERNAL_MASTER");
    expect(codes(project)).not.toContain("ERC_MISSING_MODEL");
  });

  it("diagnoses only persisted imported pin facts that drift from a symbol", () => {
    const project = emptyProject();
    const document = project.documents[0]!;
    document.instances = [
      {
        ...instance("I1"),
        netlist: {
          reference: "I1",
          parameters: {},
        },
        importProvenance: {
          kind: "opaque",
          name: "fixture",
          sourceTarget: "fixture:terminal-mapping",
          terminalMapping: [
            { sourcePosition: 0, pinName: "L" },
            { sourcePosition: 1, pinName: "MISSING" },
            { sourcePosition: 2, pinName: "L" },
          ],
        },
      },
    ];
    document.nets = [
      {
        id: "net-1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I1", pinName: "R" },
        ],
      },
    ];
    const mappingDiagnostics = run(project).filter(
      (diagnostic) => diagnostic.code === "ERC_ILLEGAL_PIN_NAME",
    );
    expect(mappingDiagnostics).toHaveLength(2);
    expect(
      mappingDiagnostics.map((diagnostic) => diagnostic.parameters.position),
    ).toEqual([1, 2]);

    document.instances[0] = instance("I1");
    document.revision += 1;
    expect(codes(project)).not.toContain("ERC_ILLEGAL_PIN_NAME");
  });
});

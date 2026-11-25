import {
  createEmptyProject,
  createRoutePath,
  createSimulationFolder,
  type CircuitProject,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  evaluateSubmissionGates,
  isLabelClearanceAdvice,
} from "./submission-gates.js";

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
  ],
  variants: [],
};

const resolver = new InMemorySymbolResolver([dual, mos]);

function project(): CircuitProject {
  return createEmptyProject("gates", "Gates", "doc");
}

function dualInstance(id: string, reference?: string, x = 0) {
  return {
    id,
    symbolId: "dual",
    placement: {
      position: { x, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    ...(reference ? { reference, netlist: { parameters: {} } } : {}),
  };
}

function gates(target: CircuitProject) {
  return evaluateSubmissionGates(target, resolver);
}

function failureCodes(target: CircuitProject): string[] {
  return gates(target).failures.map((failure) => failure.code);
}

describe("evaluateSubmissionGates", () => {
  it("passes a clean, fully wired two-instance schematic", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "R1"), dualInstance("I2", "R2")];
    document.nets = [
      {
        id: "n1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "n2",

        terminals: [
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    expect(gates(target)).toEqual({ ok: true, failures: [] });
  });

  it("blocks floating pins with terminal examples, released by NoConnect", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "R1"), dualInstance("I2", "R2")];
    document.nets = [
      {
        id: "n1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
    ];
    const report = gates(target);
    expect(report.ok).toBe(false);
    const floating = report.failures.find(
      (failure) => failure.code === "floating-endpoints",
    );
    expect(floating?.count).toBe(2);
    expect(floating?.examples).toContain("I1.R");

    document.noConnects = [
      {
        id: "nc1",
        endpoint: { kind: "terminal", instanceId: "I1", pinName: "R" },
      },
      {
        id: "nc2",
        endpoint: { kind: "terminal", instanceId: "I2", pinName: "R" },
      },
    ];
    expect(gates(target).ok).toBe(true);
  });

  it("keeps a named singleton gate floating until it has a sanctioned boundary", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [
      { ...dualInstance("M1", "M1", 0), symbolId: "mos" },
      { ...dualInstance("M2", "M2", 100), symbolId: "mos" },
    ];
    document.nets = [
      {
        id: "channel",

        terminals: [
          { instanceId: "M1", pinName: "D" },
          { instanceId: "M1", pinName: "S" },
          { instanceId: "M2", pinName: "G" },
          { instanceId: "M2", pinName: "D" },
          { instanceId: "M2", pinName: "S" },
        ],
      },
      {
        id: "gate-net",

        terminals: [{ instanceId: "M1", pinName: "G" }],
      },
    ];
    expect(failureCodes(target)).toEqual(["floating-endpoints"]);

    document.connectivityEvidence.push({
      id: "claim-clk",
      kind: "name-claim",
      netId: "gate-net",
      name: "CLK",
      scope: "local",
      owner: { kind: "net-label", annotationId: "test-net-label-1" },
    });
    expect(failureCodes(target)).toEqual(["floating-endpoints"]);
  });

  it("reports ERC errors such as duplicate Instance References", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "X1"), dualInstance("I2", "X1")];
    document.nets = [
      {
        id: "n1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "n2",

        terminals: [
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    const report = gates(target);
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toEqual([
      "erc-errors",
    ]);
    expect(report.failures[0]?.examples[0]).toContain(
      "ERC_DUPLICATE_INSTANCE_REFERENCE",
    );
  });

  it("reports non-floating ERC warnings in Publish advice without duplicating floating endpoints", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [
      { ...dualInstance("M1", "M1", 0), symbolId: "mos" },
      { ...dualInstance("M2", "M2", 100), symbolId: "mos" },
    ];
    document.nets = [
      {
        id: "channel",
        terminals: [
          { instanceId: "M1", pinName: "D" },
          { instanceId: "M1", pinName: "S" },
          { instanceId: "M2", pinName: "D" },
          { instanceId: "M2", pinName: "S" },
        ],
      },
      {
        id: "undriven-gates",
        terminals: [
          { instanceId: "M1", pinName: "G" },
          { instanceId: "M2", pinName: "G" },
        ],
      },
    ];
    document.connectivityEvidence.push(
      {
        id: "claim-x0",
        kind: "name-claim",
        netId: "channel",
        name: "X0",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-x0" },
      },
      {
        id: "claim-xo",
        kind: "name-claim",
        netId: "undriven-gates",
        name: "XO",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-xo" },
      },
    );
    const report = gates(target);
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toEqual([
      "erc-warnings",
    ]);
    expect(report.failures[0]!.count).toBe(2);
    expect(report.failures[0]!.examples).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ERC_UNDRIVEN_GATE_NET"),
        expect.stringContaining("ERC_LOOKALIKE_NET_NAMES"),
      ]),
    );
  });

  it("blocks near-empty projects but accepts a substantial block diagram", () => {
    const empty = project();
    expect(failureCodes(empty)).toEqual(["empty-project"]);

    const diagram = project();
    diagram.documents[0]!.drafting = {
      objects: [
        { kind: "text" },
        { kind: "rectangle" },
        { kind: "arrow" },
      ] as never,
    } as never;
    expect(gates(diagram).ok).toBe(true);
  });

  it("warns about spec-less scratch folders alongside @spec testbenches and broken circuit bindings (#2617)", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "R1"), dualInstance("I2", "R2")];
    document.nets = [
      {
        id: "n1",
        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "n2",
        terminals: [
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    const primary = createSimulationFolder({
      id: "f-primary",
      name: "Primary TB",
      profileId: "hosted-sky130-ngspice-v1",
      documentId: document.id,
    });
    primary.input.files.find((f) => f.path === primary.input.entry)!.text +=
      "\n* @spec vout range 0.4 0.6 unit=V\n";
    const scratch = createSimulationFolder({
      id: "f-scratch",
      name: "Old Scratch",
      profileId: "hosted-sky130-ngspice-v1",
      documentId: document.id,
    });
    const broken = createSimulationFolder({
      id: "f-broken",
      name: "Deleted Cell TB",
      profileId: "hosted-sky130-ngspice-v1",
      documentId: "missing-doc",
    });
    target.simulationFolders = [primary, scratch, broken];

    const report = gates(target);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual([
      expect.objectContaining({
        code: "stale-simulation-folders",
        count: 2,
        examples: [
          "Old Scratch (no @spec)",
          "Deleted Cell TB (missing Cell missing-doc)",
        ],
      }),
    ]);

    // Keeping only valid folders with @spec clears the advisory.
    target.simulationFolders = [primary];
    expect(gates(target)).toEqual({ ok: true, failures: [] });

    // Multi-folder interactive examples where no folder declares @spec and all
    // bindings exist remain quiet.
    const demoA = createSimulationFolder({
      id: "f-demo-a",
      name: "DC Sweep",
      profileId: "hosted-sky130-ngspice-v1",
      documentId: document.id,
    });
    const demoB = createSimulationFolder({
      id: "f-demo-b",
      name: "AC Sweep",
      profileId: "hosted-sky130-ngspice-v1",
      documentId: document.id,
    });
    target.simulationFolders = [demoA, demoB];
    expect(gates(target)).toEqual({ ok: true, failures: [] });
  });

  it("advises on labels drawn over a wire with the part each names (#2619)", () => {
    const builtIn = new InMemorySymbolResolver(builtInSymbols);
    const target = project();
    const document = target.documents[0]!;
    const at = (x: number) => ({
      position: { x, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    });
    document.instances = [
      { ...dualInstance("r", "R7"), symbolId: "resistor", placement: at(100) },
      { ...dualInstance("r2", "R8"), symbolId: "resistor", placement: at(600) },
    ];
    document.nets = [{ id: "n", terminals: [] }];
    document.junctions = [
      { id: "a", netId: "n", position: { x: 300, y: 190 } },
      { id: "b", netId: "n", position: { x: 500, y: 190 } },
    ];
    document.routes = [
      createRoutePath({
        id: "w",
        netId: "n",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    ];
    document.annotations = [
      {
        id: "on-wire",
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: "R7" }] },
        anchor: {
          kind: "object",
          objectId: "r",
          localOffset: { x: 300, y: 100 },
          fallbackPosition: { x: 400, y: 200 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    ];
    const labels = evaluateSubmissionGates(target, builtIn).failures.find(
      (failure) => failure.code === "label-clearance",
    );
    expect(labels).toMatchObject({
      count: 1,
      examples: ["R7"],
      findings: [
        {
          code: "VISUAL_LABEL_CLEARANCE",
          documentId: document.id,
          objectIds: ["on-wire", "w"],
          subject: "R7",
        },
      ],
    });
    // Advice: the far-from-its-part note is information and stays out.
    expect(
      labels!.findings!.some(
        (finding) => finding.code === "VISUAL_LABEL_OWNER_DISTANCE",
      ),
    ).toBe(false);
  });

  it("lists ERC warnings with their messages and objects", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [
      { ...dualInstance("M1", "M1", 0), symbolId: "mos" },
      { ...dualInstance("M2", "M2", 100), symbolId: "mos" },
    ];
    document.nets = [
      {
        id: "channel",
        terminals: [
          { instanceId: "M1", pinName: "D" },
          { instanceId: "M1", pinName: "S" },
          { instanceId: "M2", pinName: "D" },
          { instanceId: "M2", pinName: "S" },
        ],
      },
      {
        id: "gates",
        terminals: [
          { instanceId: "M1", pinName: "G" },
          { instanceId: "M2", pinName: "G" },
        ],
      },
    ];
    const warnings = gates(target).failures.find(
      (failure) => failure.code === "erc-warnings",
    );
    expect(warnings!.findings).toEqual([
      expect.objectContaining({
        code: "ERC_UNDRIVEN_GATE_NET",
        documentId: document.id,
        message: expect.any(String),
      }),
    ]);
    expect(warnings!.findings).toHaveLength(warnings!.count);
  });

  it("advises in Publish when an output Net Label has no formal Port (#2557)", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "R1"), dualInstance("I2", "R2")];
    document.nets = [
      {
        id: "n-in",
        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "n-out",
        terminals: [
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    document.connectivityEvidence.push({
      id: "claim-vout",
      kind: "name-claim",
      netId: "n-out",
      name: "Vout",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label-vout" },
    });

    const report = gates(target);
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toEqual([
      "erc-warnings",
    ]);
    expect(report.failures[0]!.findings).toEqual([
      expect.objectContaining({
        code: "ERC_IO_LABEL_WITHOUT_PORT",
        documentId: document.id,
        objectIds: ["n-out"],
      }),
    ]);
  });

  it("advises on every label code above info, a new one included", () => {
    expect(
      [
        { code: "VISUAL_LABEL_CLEARANCE", severity: "warning" },
        { code: "VISUAL_LABEL_OVERLAP", severity: "warning" },
        { code: "VISUAL_LABEL_CROWDED", severity: "warning" },
        { code: "VISUAL_LABEL_OWNER_DISTANCE", severity: "info" },
        { code: "VISUAL_LABEL_RUN_ON", severity: "info" },
        { code: "VISUAL_SYMBOL_OVERLAP", severity: "warning" },
      ].map(isLabelClearanceAdvice),
    ).toEqual([true, true, true, false, false, false]);
  });
});

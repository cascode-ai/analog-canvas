import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "./factories.js";
import {
  AnnotationSchema,
  CircuitProjectJsonSchema,
  CircuitProjectSchema,
  DraftTextSchema,
  SchematicDocumentSchema,
} from "./schema.js";

describe("CircuitProject schema", () => {
  it("accepts only the three persisted polarity-label forms", () => {
    const text = {
      id: "polarity-1",
      kind: "text" as const,
      locked: false,
      zIndex: 0,
      anchor: { kind: "free" as const, position: { x: 20, y: 20 } },
      content: { runs: [{ kind: "text" as const, value: "V_x" }] },
      alignment: "middle" as const,
      rotation: 0 as const,
    };
    for (const polarity of ["both", "positive", "negative"] as const) {
      expect(DraftTextSchema.safeParse({ ...text, polarity }).success).toBe(
        true,
      );
    }
    expect(
      DraftTextSchema.safeParse({ ...text, polarity: "plus-minus" }).success,
    ).toBe(false);
  });

  it("accepts a minimal Project with one Document", () => {
    const project = createEmptyProject("project-test", "Test Project");
    expect(CircuitProjectSchema.parse(project)).toEqual(project);
    expect(CircuitProjectJsonSchema).toMatchObject({ type: "object" });
  });

  it("rejects retired logical projections on physical Base Nets", () => {
    const project = createEmptyProject("project-net", "Net");
    for (const projection of [
      { name: "VDD" },
      { scope: "global" },
      { powerDomain: "vdd" },
      { origin: { kind: "authored" } },
    ]) {
      const candidate = structuredClone(project) as unknown as Record<
        string,
        unknown
      >;
      const documents = candidate.documents as Array<Record<string, unknown>>;
      documents[0]!.nets = [{ id: "net-vdd", terminals: [], ...projection }];
      expect(CircuitProjectSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("has no legacy Instance property authority and validates external definitions", () => {
    const project = createEmptyProject("project-netlist", "Netlist");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        reference: "R1",
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
    });
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
    expect(
      CircuitProjectSchema.safeParse({
        ...project,
        documents: [
          {
            ...document,
            instances: [{ ...document.instances[0]!, properties: {} }],
          },
        ],
      }).success,
    ).toBe(false);

    project.externalSubcircuitDefinitions.push({
      id: "external-opamp",
      name: "OPA",
      terminals: [
        { id: "external-opamp-in", name: "IN", direction: "passive" },
        { id: "external-opamp-out", name: "OUT", direction: "passive" },
      ],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "X1",
      symbolId: "generic-block-2",
      placement: null,
      netlist: {
        reference: "X1",
        binding: {
          kind: "external-subcircuit",
          definitionId: "external-opamp",
        },
        parameters: {},
      },
    });
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
    document.instances[1]!.netlist!.binding = {
      kind: "external-subcircuit",
      definitionId: "missing-definition",
    };
    expect(CircuitProjectSchema.safeParse(project).success).toBe(false);
  });

  it("uses Razavi textbook presentation for a new Project", () => {
    const project = createEmptyProject("project-style", "Style");

    expect(project.documents[0]!.presentation.styleProfileId).toBe(
      "razavi-textbook-v1",
    );
  });

  it("rejects a schematic Reference on a formal Cell Pin", () => {
    const document = createEmptyProject("formal-cell-pin", "Formal Cell Pin")
      .documents[0]!;
    document.instances.push({
      id: "port-object",
      symbolId: "port",
      schematicReference: "P1",
      placement: null,
    });
    document.nets.push({
      id: "net-vout",

      terminals: [{ instanceId: "port-object", pinName: "P" }],
    });
    document.netlist = {
      name: "Child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vout",
          name: "Vout",
          netId: "net-vout",
          direction: "output",
          interfaceInstanceIds: ["port-object"],
        },
      ],
    };

    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
    delete document.instances[0]!.schematicReference;
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.annotations.push({
      id: "label-port",
      kind: "instance-label",
      binding: {
        kind: "instance-schematic-name",
        instanceId: "port-object",
      },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
    document.annotations[0]!.binding = {
      kind: "cell-terminal-name",
      terminalId: "terminal-vout",
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.annotations[0]!.formatOverride = {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "Vout" }],
        },
      ],
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.annotations[0]!.formatOverride = {
      runs: [{ kind: "text", value: "Different alias" }],
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
  });

  it("holds electrical objects to the Document grid while annotations position freely", () => {
    const document = createEmptyProject("project-grid", "Grid").documents[0]!;
    // Schema 29: drafting and annotation anchors are 1-unit precise.
    document.drafting!.objects.push({
      id: "draft-fine",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 15, y: 21 } },
      content: { runs: [{ kind: "text", value: "fine placed" }] },
      alignment: "start",
      rotation: 0,
    });
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);

    // The electrical grid contract is unchanged: an off-grid Instance
    // placement still fails Document validation.
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      schematicReference: "R1",
      placement: { position: { x: 15, y: 20 }, rotation: 0, mirror: "none" },
    });
    const result = SchematicDocumentSchema.safeParse(document);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["instances", 0, "placement", "position", "x"],
      }),
    );
  });

  it("rejects a missing top Document", () => {
    const project = createEmptyProject("project-test", "Test Project");
    expect(() =>
      CircuitProjectSchema.parse({
        ...project,
        topDocumentId: "document-missing",
      }),
    ).toThrow(/Unknown top document/);
  });

  it("requires every hierarchy target to exist and rejects cycles", () => {
    const project = createEmptyProject("project-hierarchy", "Hierarchy");
    const parent = project.documents[0]!;
    const child = createEmptyDocument("document-child", "Child");
    project.documents.push(child);
    parent.instances.push({
      id: "X1",
      symbolId: "hierarchical-child",
      placement: null,
      netlist: {
        reference: "X1",
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: child.id,
        },
      },
    });
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);

    parent.nets.push({
      id: "net-parent",

      terminals: [{ instanceId: "X1", pinName: "MISSING" }],
    });
    expect(() => CircuitProjectSchema.parse(project)).toThrow(
      /unknown child terminal MISSING/,
    );
    parent.nets = [];

    child.instances.push({
      id: "XBACK",
      symbolId: "hierarchical-main",
      placement: null,
      netlist: {
        reference: "XBACK",
        parameters: {},
        binding: {
          kind: "subcircuit",
          childDocumentId: parent.id,
        },
      },
    });
    expect(() => CircuitProjectSchema.parse(project)).toThrow(
      /Hierarchy cycle/,
    );

    child.instances[0]!.netlist!.binding = {
      kind: "subcircuit",
      childDocumentId: "document-missing",
    };
    expect(() => CircuitProjectSchema.parse(project)).toThrow(
      /unknown Document/,
    );
  });

  it("binds a formal Cell terminal to an ordinary Port Instance and Net", () => {
    const project = createEmptyProject("project-port", "Formal port");
    const document = project.documents[0]!;
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "net-input",

      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "cell-terminal-vin",
      name: "VIN",
      netId: "net-input",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);

    document.nets[0]!.terminals = [];
    expect(() => CircuitProjectSchema.parse(project)).toThrow(
      /is not connected to Net/,
    );
  });

  it("keeps same-named Cell Pins as independent singleton terminal records", () => {
    const project = createEmptyProject("project-pins", "Independent pins");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port-filled", placement: null },
    );
    document.nets.push(
      {
        id: "net-vin-a",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-vin-b",
        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.netlist!.terminals.push(
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
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    );

    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);

    document.netlist!.terminals[0]!.interfaceInstanceIds.push("P2");
    expect(() => CircuitProjectSchema.parse(project)).toThrow(
      /exactly one|at most 1|too big/i,
    );
  });

  it("validates owner-addressable Connectivity Evidence", () => {
    const project = createEmptyProject("project-evidence", "Evidence");
    const document = project.documents[0]!;
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: null,
    });
    document.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      { id: "net-b", terminals: [] },
    );
    document.netlist = {
      name: "Evidence",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-p1",
          name: "P1",
          netId: "net-a",
          direction: "passive",
          interfaceInstanceIds: ["P1"],
        },
      ],
    };
    document.annotations.push({
      id: "label-a",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-a" },
      netId: "net-a",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net-a",
        name: "A",
        owner: { kind: "net-label", annotationId: "label-a" },
        scope: "local",
      },
      {
        id: "source-a",
        kind: "spice-source",
        netId: "net-a",
        sourceNetId: "source-a",
      },
      {
        id: "claim-a-conflict",
        kind: "name-claim",
        netId: "net-a",
        name: "ALIAS",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "equivalence-ab",
        kind: "explicit-equivalence",
        memberNetIds: ["net-a", "net-b"],
      },
    );
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    const originalLabelClaim = document.connectivityEvidence[0]!;
    if (originalLabelClaim.kind !== "name-claim") {
      throw new Error("Expected name claim");
    }

    document.annotations[0]!.formatOverride = {
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [{ kind: "text", value: "A" }],
        },
      ],
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.annotations[0]!.anchor = {
      kind: "object",
      objectId: "P1",
      localOffset: { x: 0, y: 0 },
      fallbackPosition: { x: 0, y: 0 },
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.annotations[0]!.anchor = {
      kind: "free",
      position: { x: 0, y: 0 },
    };
    document.connectivityEvidence[0] = {
      ...originalLabelClaim,
      owner: { kind: "net-label", annotationId: "label-a" },
    };
    document.connectivityEvidence[0] = {
      ...originalLabelClaim,
      name: "RENAMED",
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
    delete document.annotations[0]!.formatOverride;

    document.connectivityEvidence[0] = {
      id: "claim-a",
      kind: "name-claim",
      netId: "net-a",
      name: "A",
      owner: { kind: "net-label", annotationId: "missing-label" },
      scope: "local",
    };
    expect(() => SchematicDocumentSchema.parse(document)).toThrow(
      /not a matching Net Label/,
    );
    document.connectivityEvidence[0] = {
      id: "claim-a",
      kind: "name-claim",
      netId: "net-a",
      name: "A",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    };
    document.connectivityEvidence[3] = {
      id: "equivalence-ab",
      kind: "explicit-equivalence",
      memberNetIds: ["net-a", "net-a"],
    };
    expect(() => SchematicDocumentSchema.parse(document)).toThrow(
      /Duplicate explicit-equivalence member/,
    );
  });

  it("accepts a rail label format override whose power claim is owned by the label itself", () => {
    // A drawn power rail's name-claim owner is the label annotation, not the
    // junction the label anchors to; the override check must find that claim.
    const document = createEmptyProject("project-rail", "Rail").documents[0]!;
    document.nets.push({ id: "net-power-vdd1", terminals: [] });
    document.junctions.push({
      id: "junction-vdd1-start",
      netId: "net-power-vdd1",
      position: { x: 0, y: 0 },
    });
    document.annotations.push({
      id: "label-VDD1",
      kind: "power-label",
      binding: { kind: "net-name", netId: "net-power-vdd1" },
      netId: "net-power-vdd1",
      anchor: {
        kind: "object",
        objectId: "junction-vdd1-start",
        localOffset: { x: 10, y: 10 },
        fallbackPosition: { x: 10, y: 10 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
      formatOverride: { runs: [{ kind: "text", value: "AVDD" }] },
    });
    document.connectivityEvidence.push({
      id: "claim-rail-vdd1",
      kind: "name-claim",
      netId: "net-power-vdd1",
      name: "AVDD",
      owner: { kind: "power-marker", objectId: "label-VDD1" },
      scope: "global",
      powerDomain: "vdd",
    });
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);

    document.annotations.at(-1)!.formatOverride = {
      runs: [{ kind: "text", value: "OTHER" }],
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
  });

  it("rejects every removed first-class Port shape", () => {
    const project = createEmptyProject("project-port", "Port contract");
    const document = project.documents[0]!;
    expect(
      CircuitProjectSchema.safeParse({
        ...project,
        documents: [{ ...document, ports: [] }],
      }).success,
    ).toBe(false);
    expect(
      CircuitProjectSchema.safeParse({
        ...project,
        documents: [
          {
            ...document,
            nets: [
              {
                id: "net",
                scope: "local",
                terminals: [],
                ports: [],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects geometry-only crossings as implicit connectivity data", () => {
    const project = createEmptyProject("project-test", "Test Project");
    const [document] = project.documents;
    expect(
      CircuitProjectSchema.safeParse({
        ...project,
        documents: [{ ...document, geometricConnections: [] }],
      }).success,
    ).toBe(false);
  });

  it("validates route-marker annotations with a markerKind and route VisualAnchor", () => {
    const project = createEmptyProject("project-marker", "Marker");
    const document = project.documents[0]!;
    document.annotations.push({
      id: "marker-1",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_x" }] },
      anchor: {
        kind: "free",
        position: { x: 20, y: 20 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
    // markerKind is only valid on a route-marker annotation.
    document.annotations[0] = {
      ...document.annotations[0]!,
      kind: "instance-label",
    };
    expect(CircuitProjectSchema.safeParse(project).success).toBe(false);
  });
  it("accepts an instance-value annotation without a Net relation", () => {
    const project = createEmptyProject("project-value", "Value");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
    });
    const value = {
      id: "instance-value-R1",
      kind: "instance-value" as const,
      content: { runs: [{ kind: "text" as const, value: "10k" }] },
      anchor: {
        kind: "object" as const,
        objectId: "R1",
        localOffset: { x: 40, y: 0 },
        fallbackPosition: { x: 140, y: 100 },
      },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    document.annotations.push(value);
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
    // instance-value is not a Net-bound kind.
    expect(
      AnnotationSchema.safeParse({ ...value, netId: "net-1" }).success,
    ).toBe(false);
  });
  it("accepts an optional presentation-only visible flag on annotations", () => {
    const project = createEmptyProject("project-visible", "Visible");
    const document = project.documents[0]!;
    const label = {
      id: "label-1",
      kind: "instance-label" as const,
      content: { runs: [{ kind: "text" as const, value: "R1" }] },
      anchor: { kind: "free" as const, position: { x: 20, y: 20 } },
      alignment: "middle" as const,
      rotation: 0 as const,
      locked: false,
    };
    document.annotations.push(label);
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
    document.annotations[0] = { ...label, visible: false };
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
    document.annotations[0] = { ...label, visible: true };
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
  });

  it("validates definition-level Cell symbol placement against stable formal terminals", () => {
    const project = createEmptyProject("project-cell-symbol", "Cell symbol");
    const document = project.documents[0]!;
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "net-input",

      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "terminal-input",
      name: "VIN",
      netId: "net-input",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    document.presentation.cellSymbol = {
      minimumBodySize: { width: 100, height: 60 },
      pinPlacements: [
        { terminalId: "terminal-input", side: "north", offset: 20 },
      ],
    };
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);

    document.presentation.cellSymbol.pinPlacements = [
      { terminalId: "missing-terminal", side: "north", offset: 20 },
    ];
    expect(CircuitProjectSchema.safeParse(project).success).toBe(false);

    document.presentation.cellSymbol.pinPlacements = [
      { terminalId: "terminal-input", side: "north", offset: 20 },
      { terminalId: "terminal-input", side: "north", offset: 20 },
    ];
    expect(CircuitProjectSchema.safeParse(project).success).toBe(false);
  });
});

describe("presentation style overrides", () => {
  function projectWithOverrides(styleOverrides: unknown) {
    const project = JSON.parse(
      JSON.stringify(createEmptyProject("style", "Style")),
    );
    project.documents[0].presentation.styleOverrides = styleOverrides;
    return project;
  }

  it("accepts bounded scale factors and preserves them", () => {
    const parsed = CircuitProjectSchema.parse(
      projectWithOverrides({ fontScale: 1.5, junctionRadiusScale: 0.5 }),
    );
    expect(parsed.documents[0]!.presentation.styleOverrides).toEqual({
      fontScale: 1.5,
      junctionRadiusScale: 0.5,
    });
  });

  it("rejects out-of-range factors and unknown knobs", () => {
    expect(
      CircuitProjectSchema.safeParse(projectWithOverrides({ fontScale: 0.4 }))
        .success,
    ).toBe(false);
    expect(
      CircuitProjectSchema.safeParse(
        projectWithOverrides({ wireStrokeScale: 2.5 }),
      ).success,
    ).toBe(false);
    expect(
      CircuitProjectSchema.safeParse(projectWithOverrides({ glowIntensity: 1 }))
        .success,
    ).toBe(false);
  });
});

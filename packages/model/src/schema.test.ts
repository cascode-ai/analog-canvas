import { createSimulationFolder } from "./simulation-source-authoring.js";
import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "./factories.js";
import {
  AnnotationSchema,
  CircuitProjectJsonSchema,
  CircuitProjectSchema,
  DraftTextSchema,
  SchematicDocumentSchema,
  LegacySimulationSetupSchema,
  ProjectSimulationFolderSchema,
} from "./schema.js";
import type {
  SimulationRawSetup,
  SimulationStructuredInput,
  SimulationStructuredSetup,
} from "./schema.js";

describe("CircuitProject schema", () => {
  it("accepts closed-shape fill and circuit-relative stacking planes", () => {
    const document = createEmptyDocument("document", "Shapes");
    document.drafting = {
      objects: [
        {
          id: "shape",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          layer: "background",
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          width: 40,
          height: 20,
          rotation: 0,
          lineStyle: "solid",
          styleOverride: { color: "#2563eb", fillColor: "#9ca3af" },
        },
      ],
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.drafting.objects[0] = {
      id: "line",
      kind: "construction-line",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      lineStyle: "solid",
      styleOverride: { fillColor: "#9ca3af" },
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
  });

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

  it("rejects the retired hidden electrical Net-name owner", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push({ id: "net-out", terminals: [] });
    const candidate = {
      ...document,
      connectivityEvidence: [
        {
          id: "claim-out",
          kind: "name-claim",
          netId: "net-out",
          name: "OUT",
          owner: { kind: "explicit-net-property" },
          scope: "local",
        },
      ],
    };
    expect(SchematicDocumentSchema.safeParse(candidate).success).toBe(false);
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
      reference: "R1",
      netlist: {
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
      reference: "X1",
      netlist: {
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
      reference: "P1",
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
    delete document.instances[0]!.reference;
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.annotations.push({
      id: "label-port",
      kind: "instance-label",
      binding: {
        kind: "instance-reference",
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

  it("rejects a fabricated Instance Reference on a power marker", () => {
    const document = createEmptyProject(
      "power-marker-reference",
      "Power Marker",
    ).documents[0]!;
    document.instances.push({
      id: "vdd-marker",
      symbolId: "vdd-port",
      reference: "VDD1",
      placement: null,
    });

    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
    delete document.instances[0]!.reference;
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("holds electrical objects to the Document grid while annotations position freely", () => {
    const document = createEmptyProject("project-grid", "Grid").documents[0]!;
    // Schema 32 retains 1-unit-precise drafting and annotation anchors.
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
      reference: "R1",
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
      reference: "X1",
      netlist: {
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
      reference: "XBACK",
      netlist: {
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
    document.nets.push({
      id: "net-a",

      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
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
        id: "hint-a",
        kind: "net-name-hint",
        netId: "net-a",
        sourceName: "ALIAS",
        origin: "spice-import",
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
    document.connectivityEvidence[0] = {
      ...originalLabelClaim,
      name: "A1_wi",
    };
    document.annotations[0]!.formatOverride = {
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [{ kind: "text", value: "A1_wi" }],
        },
      ],
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    document.connectivityEvidence[0] = originalLabelClaim;
    document.annotations[0]!.formatOverride = {
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [{ kind: "text", value: "A" }],
        },
      ],
    };
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
      kind: "net-name-hint",
      netId: "net-a",
      sourceName: "A",
      origin: "legacy-explicit-net-property",
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
    const retired = structuredClone(document) as unknown as Record<
      string,
      unknown
    >;
    (retired.connectivityEvidence as unknown[])[0] = {
      id: "claim-a",
      kind: "name-claim",
      netId: "net-a",
      name: "A",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    };
    expect(SchematicDocumentSchema.safeParse(retired).success).toBe(false);
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

  it("accepts an optional presentation-only textColor on annotations", () => {
    const project = createEmptyProject("project-text-color", "Text color");
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
    document.annotations.push({ ...label, textColor: "#123ABC" });
    expect(CircuitProjectSchema.safeParse(project).success).toBe(true);

    document.annotations[0] = { ...label, textColor: "blue" };
    expect(CircuitProjectSchema.safeParse(project).success).toBe(false);
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

describe("legacy SimulationFolderInput reader (one-way migration input)", () => {
  function folder(): SimulationStructuredSetup {
    return {
      version: 3,
      input: {
        kind: "structured",
        designVariables: [],
        runPlan: { mode: "nominal" },
        rootDocumentId: "testbench",
        analyses: [
          { kind: "op" },
          { kind: "ac", sweep: "dec", points: 20, startHz: 1, stopHz: 1e9 },
        ],
        outputs: [
          {
            id: "probe-out",
            label: "Vout",
            expression: {
              kind: "voltage",
              documentId: "testbench",
              anchor: {
                kind: "terminal",
                instanceId: "load",
                pinName: "1",
              },
              occurrence: [],
            },
          },
          {
            id: "probe-tail",
            label: "Itail",
            expression: {
              kind: "current",
              documentId: "ota",
              instanceId: "I1",
              pinName: "+",
              occurrence: ["X1"],
            },
          },
        ],
        environment: {
          profileId: "sky130-core-continuous-ngspice46-v1",
          corner: "tt",
          temperatureC: 27,
        },
      },
    };
  }

  function projectWithSetup(simulation: unknown) {
    const project = createEmptyProject("simulated", "Simulated", "testbench");
    project.documents.push(createEmptyDocument("ota", "OTA"));
    return {
      ...project,
      simulationFolders: [
        { id: "folder-1", name: "Setup 1", ...(simulation as object) },
      ],
    };
  }

  it("round-trips a named collection while preserving the reusable folder shape", () => {
    const project = createEmptyProject("plain", "Plain");
    expect(CircuitProjectSchema.parse(project).simulationFolders).toEqual([]);
    expect(LegacySimulationSetupSchema.parse(folder())).toEqual(folder());
    expect(
      CircuitProjectSchema.safeParse(projectWithSetup(folder())).success,
    ).toBe(false);
    const source = createSimulationFolder({
      id: "folder-1",
      name: "Setup 1",
      profileId: "test",
      documentId: "testbench",
    });
    expect(ProjectSimulationFolderSchema.parse(source)).toEqual(source);
    expect(
      CircuitProjectSchema.parse(projectWithSetup(source)).simulationFolders[0],
    ).toEqual(source);
    expect(CircuitProjectJsonSchema).toMatchObject({
      properties: { simulationFolders: expect.anything() },
    });
  });

  it("persists explicit Design Variable bindings and a reusable Run Plan", () => {
    const candidate = folder();
    candidate.input.designVariables = [
      {
        id: "load",
        name: "RLOAD",
        value: "10k",
        bindings: [
          {
            documentId: "testbench",
            instanceId: "load",
            parameter: "resistance",
          },
        ],
      },
    ];
    candidate.input.runPlan = {
      mode: "sweep",
      axes: [
        { kind: "corner", values: ["tt", "ff"] },
        { kind: "variable", variableId: "load", values: ["5k", "10k"] },
      ],
    };
    expect(LegacySimulationSetupSchema.parse(candidate)).toEqual(candidate);

    const duplicateBinding = structuredClone(candidate);
    duplicateBinding.input.designVariables.push({
      id: "load-2",
      name: "OTHER",
      value: "20k",
      bindings: [...candidate.input.designVariables[0]!.bindings],
    });
    expect(
      LegacySimulationSetupSchema.safeParse(duplicateBinding).error?.issues,
    ).toContainEqual(
      expect.objectContaining({
        message:
          "An Instance parameter can be bound to only one Design Variable",
      }),
    );
  });

  it("preserves an unresolved simulation root for preparation diagnostics", () => {
    const orphaned = createSimulationFolder({
      id: "folder-1",
      name: "Setup 1",
      profileId: "test",
      documentId: "missing-testbench",
    });
    const result = CircuitProjectSchema.safeParse(projectWithSetup(orphaned));
    expect(result.success).toBe(true);
    expect(result.data?.simulationFolders[0]).toEqual(orphaned);
  });

  it("holds one analysis per kind and unique output ids", () => {
    const repeatedAnalysis = folder();
    repeatedAnalysis.input.analyses.push({ kind: "op" });
    expect(
      LegacySimulationSetupSchema.safeParse(repeatedAnalysis).error?.issues,
    ).toEqual([
      expect.objectContaining({
        message: "Duplicate simulation analysis: op",
        path: ["input", "analyses", 2, "kind"],
      }),
    ]);
    const repeatedProbe = folder();
    repeatedProbe.input.outputs.push({
      ...repeatedProbe.input.outputs[0]!,
      label: "other-output",
    });
    expect(
      LegacySimulationSetupSchema.safeParse(repeatedProbe).error?.issues,
    ).toEqual([
      expect.objectContaining({
        message: "Duplicate ID: probe-out",
        path: ["input", "outputs", 2, "id"],
      }),
    ]);
    const repeatedLabel = folder();
    repeatedLabel.input.outputs[1] = {
      ...repeatedLabel.input.outputs[1]!,
      label: repeatedLabel.input.outputs[0]!.label.toUpperCase(),
    };
    expect(
      LegacySimulationSetupSchema.safeParse(repeatedLabel).error?.issues,
    ).toEqual([
      expect.objectContaining({
        message: `Duplicate simulation output label: ${repeatedLabel.input.outputs[1]!.label}`,
        path: ["input", "outputs", 1, "label"],
      }),
    ]);
    const noAnalysis = folder();
    noAnalysis.input.analyses = [];
    expect(LegacySimulationSetupSchema.safeParse(noAnalysis).success).toBe(
      false,
    );
  });

  it("persists bounded measurement rules with analysis-appropriate methods", () => {
    const measured = folder();
    measured.input.measurements = [
      {
        id: "measurement-op",
        label: "Output bias",
        analysis: "op",
        outputId: "probe-out",
        method: { kind: "value" },
      },
      {
        id: "measurement-gain",
        label: "Gain at 10 kHz",
        analysis: "ac",
        outputId: "probe-out",
        method: { kind: "sample-at", coordinate: 10_000 },
      },
    ];
    expect(LegacySimulationSetupSchema.parse(measured)).toEqual(measured);

    const invalid = structuredClone(measured);
    invalid.input.measurements![1]!.method = {
      kind: "rms",
      window: { start: 1, stop: 10 },
    };
    expect(
      LegacySimulationSetupSchema.safeParse(invalid).error?.issues,
    ).toContainEqual(
      expect.objectContaining({
        message:
          "Mean and RMS measurements are currently supported only for transient analysis",
        path: ["input", "measurements", 1, "method"],
      }),
    );
  });

  it("persists selected hierarchy-aware MOS operating-point details", () => {
    const selected = folder();
    selected.input.deviceOperatingPoints = [
      {
        id: "op-m1",
        documentId: "ota",
        instanceId: "M1",
        occurrence: ["X1"],
      },
    ];
    expect(LegacySimulationSetupSchema.parse(selected)).toEqual(selected);

    const withoutOp = structuredClone(selected);
    withoutOp.input.analyses = withoutOp.input.analyses.filter(
      (analysis) => analysis.kind !== "op",
    );
    expect(
      LegacySimulationSetupSchema.safeParse(withoutOp).error?.issues,
    ).toContainEqual(
      expect.objectContaining({
        message:
          "Device operating-point details require an operating-point analysis",
        path: ["input", "deviceOperatingPoints"],
      }),
    );
  });

  it("persists a hierarchy-aware differential Noise request", () => {
    const noisy = folder();
    noisy.input.analyses = [
      {
        kind: "noise",
        output: {
          positive: {
            documentId: "testbench",
            anchor: {
              kind: "terminal",
              instanceId: "load",
              pinName: "1",
            },
            occurrence: [],
          },
          negative: {
            documentId: "testbench",
            anchor: { kind: "base-net", netId: "ground" },
            occurrence: [],
          },
        },
        inputSourceInstanceId: "vin",
        sweep: "dec",
        points: 20,
        startHz: 1,
        stopHz: 1e9,
      },
    ];
    expect(LegacySimulationSetupSchema.parse(noisy)).toEqual(noisy);

    const invalid = structuredClone(noisy);
    const analysis = invalid.input.analyses[0];
    if (analysis?.kind === "noise") analysis.stopHz = analysis.startHz;
    expect(LegacySimulationSetupSchema.safeParse(invalid).success).toBe(false);
  });

  it("bounds the AC sweep and the environment selection", () => {
    const ac = (overrides: Record<string, unknown>) => {
      const candidate = folder();
      candidate.input.analyses = [
        {
          kind: "ac",
          sweep: "dec",
          points: 10,
          startHz: 10,
          stopHz: 1e6,
          ...overrides,
        } as SimulationStructuredInput["analyses"][number],
      ];
      return LegacySimulationSetupSchema.safeParse(candidate).success;
    };
    expect(ac({})).toBe(true);
    expect(ac({ sweep: "lin" })).toBe(true);
    expect(ac({ sweep: "log" })).toBe(false);
    expect(ac({ points: 0 })).toBe(false);
    expect(ac({ points: 2.5 })).toBe(false);
    expect(ac({ startHz: 0 })).toBe(false);
    expect(ac({ stopHz: 10 })).toBe(false);
    expect(ac({ stopHz: 5 })).toBe(false);
    expect(ac({ stopHz: Number.POSITIVE_INFINITY })).toBe(false);
    expect(ac({ tstop: 1 })).toBe(false);
    const tran = (overrides: Record<string, unknown>) =>
      LegacySimulationSetupSchema.safeParse({
        ...folder(),
        input: {
          ...folder().input,
          analyses: [
            {
              kind: "tran",
              stepSeconds: 1e-9,
              stopSeconds: 1e-6,
              ...overrides,
            },
          ],
        },
      }).success;
    expect(tran({})).toBe(true);
    expect(tran({ startSeconds: 0, maxStepSeconds: 1e-10 })).toBe(true);
    expect(tran({ stepSeconds: 0 })).toBe(false);
    expect(tran({ stopSeconds: Number.POSITIVE_INFINITY })).toBe(false);
    expect(tran({ startSeconds: -1 })).toBe(false);
    expect(tran({ startSeconds: 2e-6 })).toBe(false);
    expect(tran({ maxStepSeconds: 0 })).toBe(false);
    expect(tran({ tstop: 1 })).toBe(false);

    const environment = (overrides: Record<string, unknown>) => {
      const candidate = folder();
      candidate.input.environment = {
        ...candidate.input.environment,
        ...overrides,
      } as SimulationStructuredInput["environment"];
      return LegacySimulationSetupSchema.safeParse(candidate).success;
    };
    expect(environment({ corner: undefined, temperatureC: undefined })).toBe(
      true,
    );
    expect(environment({ profileId: "" })).toBe(false);
    expect(environment({ corner: "" })).toBe(false);
    expect(environment({ temperatureC: Number.NaN })).toBe(false);
    expect(environment({ modelLibraryPath: "/opt/sky130" })).toBe(false);
  });

  it("accepts one finite, non-zero-range DC source sweep", () => {
    const dc = (overrides: Record<string, unknown>) => {
      const candidate = folder();
      candidate.input.analyses = [
        {
          kind: "dc",
          sourceInstanceId: "V1",
          startValue: 0,
          stopValue: 1.8,
          stepValue: 0.01,
          ...overrides,
        } as SimulationStructuredInput["analyses"][number],
      ];
      return LegacySimulationSetupSchema.safeParse(candidate).success;
    };
    expect(dc({})).toBe(true);
    expect(dc({ startValue: 1.8, stopValue: 0 })).toBe(true);
    expect(dc({ sourceInstanceId: "" })).toBe(false);
    expect(dc({ startValue: 1, stopValue: 1 })).toBe(false);
    expect(dc({ stepValue: 0 })).toBe(false);
    expect(dc({ stepValue: -0.1 })).toBe(false);
    expect(dc({ stopValue: Number.POSITIVE_INFINITY })).toBe(false);
    expect(dc({ secondSource: "V2" })).toBe(false);
  });

  it("persists a bounded raw authoring bundle without host paths", () => {
    const raw: SimulationRawSetup = {
      version: 3,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [
          { path: "tb.cir", text: ".include dut.spi\n.end\n" },
          { path: "dut.spi", text: ".subckt DUT a b\n.ends DUT\n" },
        ],
        dependencies: [
          {
            id: "sky130-core",
            mountPath: "models/sky130.lib.spice",
            sha256: "0".repeat(64),
          },
        ],
        environment: { profileId: "custom-ngspice46-v1" },
      },
    };
    expect(LegacySimulationSetupSchema.parse(raw)).toEqual(raw);
    expect(CircuitProjectSchema.safeParse(projectWithSetup(raw)).success).toBe(
      false,
    );
  });

  it("rejects ambiguous, unsafe, and oversized raw bundles", () => {
    const rawInput = (overrides: Record<string, unknown> = {}) => ({
      version: 3,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: ".end\n" }],
        dependencies: [],
        environment: { profileId: "profile" },
        ...overrides,
      },
    });
    expect(LegacySimulationSetupSchema.safeParse(rawInput()).success).toBe(
      true,
    );
    expect(
      LegacySimulationSetupSchema.safeParse(rawInput({ entry: "missing.cir" }))
        .success,
    ).toBe(false);
    for (const path of ["../tb.cir", "/tb.cir", "C:/tb.cir", ".spiceinit"]) {
      expect(
        LegacySimulationSetupSchema.safeParse(
          rawInput({ files: [{ path, text: ".end\n" }], entry: path }),
        ).success,
      ).toBe(false);
    }
    expect(
      LegacySimulationSetupSchema.safeParse(
        rawInput({
          files: [
            { path: "tb.cir", text: "" },
            { path: "tb.cir", text: "" },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      LegacySimulationSetupSchema.safeParse(
        rawInput({
          files: [{ path: "tb.cir", text: "x".repeat(1024 * 1024 + 1) }],
        }),
      ).success,
    ).toBe(false);
    expect(
      LegacySimulationSetupSchema.safeParse(
        rawInput({
          dependencies: [
            {
              id: "model",
              mountPath: "tb.cir",
              sha256: "0".repeat(64),
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects transient run data and unknown input forms", () => {
    expect(
      LegacySimulationSetupSchema.safeParse({ ...folder(), lastRunId: "run-1" })
        .success,
    ).toBe(false);
    expect(
      LegacySimulationSetupSchema.safeParse({ ...folder(), version: 1 })
        .success,
    ).toBe(false);
    expect(
      LegacySimulationSetupSchema.safeParse({
        version: 1,
        input: { kind: "legacy-raw", entryPath: "tb.cir", files: [] },
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planCreateCellPin } from "./cell-pin-planner.js";
import type { SchematicEdit } from "./edit-schema.js";
import { executeProjectTransaction } from "./project-transaction.js";
import { executeTransaction } from "./transaction.js";

function projectWithLabelledNet(
  options: {
    labelName?: string;
    labelSignal?: { expression: string; memberName: string };
    scope?: "local" | "global";
    aliased?: boolean;
    withRemoteNet?: boolean;
    junctionStyleColor?: string;
    junctionContactAnchor?: { instanceId: string; pinName: string };
    withRouteToJunction?: boolean;
  } = {},
): CircuitProject {
  const labelName = options.labelName ?? "V_out1";
  const project = createEmptyProject("port-dedup", "Port dedup");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    reference: "R1",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  document.nets.push({
    id: "net-out",
    terminals: [{ instanceId: "R1", pinName: "2" }],
  });
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const pin2Landing = resolveEndpointConnection(document, resolver, {
    kind: "terminal",
    instanceId: "R1",
    pinName: "2",
  })!.gridLanding;
  const junctionPosition = options.junctionContactAnchor
    ? pin2Landing
    : { x: pin2Landing.x + 60, y: pin2Landing.y };
  document.junctions.push({
    id: "j-label",
    position: junctionPosition,
    netId: "net-out",
    role: "route-anchor",
    ...(options.junctionStyleColor
      ? { styleOverride: { color: options.junctionStyleColor } }
      : {}),
    ...(options.junctionContactAnchor
      ? { contactAnchor: options.junctionContactAnchor }
      : {}),
  });
  if (options.withRouteToJunction) {
    document.routes.push({
      id: "route-out",
      netId: "net-out",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      legs: [
        {
          id: "leg-1",
          to: {
            kind: "endpoint",
            endpoint: { kind: "junction", junctionId: "j-label" },
          },
          mode: "auto",
        },
      ],
    });
  }
  document.connectivityEvidence.push({
    id: "claim-out",
    kind: "name-claim",
    netId: "net-out",
    name: options.labelSignal?.expression ?? labelName,
    scope: options.scope ?? "local",
    ...(options.labelSignal
      ? {
          signal: {
            expression: options.labelSignal.expression,
            members: [
              {
                id: "m0",
                name: options.labelSignal.memberName,
                netId: "net-out",
              },
            ],
          },
        }
      : {}),
    owner: { kind: "net-label", annotationId: "label-out" },
  });
  document.annotations.push({
    id: "label-out",
    kind: "net-label",
    ...(options.aliased
      ? { content: { runs: [{ kind: "text" as const, value: "V_{out,1}" }] } }
      : { binding: { kind: "net-name" as const, netId: "net-out" } }),
    anchor: {
      kind: "object",
      objectId: "j-label",
      localOffset: { x: 0, y: -10 },
      fallbackPosition: { x: 160, y: 90 },
    },
    netId: "net-out",
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  if (options.withRemoteNet) {
    document.instances.push({
      id: "R2",
      symbolId: "resistor",
      reference: "R2",
      placement: { position: { x: 400, y: 100 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "net-remote",
      terminals: [{ instanceId: "R2", pinName: "1" }],
    });
    document.connectivityEvidence.push({
      id: "claim-remote",
      kind: "name-claim",
      netId: "net-remote",
      name: labelName,
      scope: "local",
      owner: { kind: "net-label", annotationId: "label-remote" },
    });
    document.annotations.push({
      id: "label-remote",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-remote" },
      anchor: { kind: "free", position: { x: 380, y: 90 } },
      netId: "net-remote",
      alignment: "start",
      rotation: 0,
      locked: false,
    });
  }
  return project;
}

function addPortOnNet(
  project: CircuitProject,
  portName: string,
  options: {
    symbolId?: "port" | "port-filled";
    extraPrecedingEdits?: SchematicEdit[];
    withPortAnnotation?: boolean;
    portFormatOverride?: NonNullable<
      CircuitProject["documents"][number]["annotations"][number]["formatOverride"]
    >;
  } = {},
) {
  const document = project.documents[0]!;
  const plan = planCreateCellPin(project, document.id, {
    instance: {
      id: "P1",
      symbolId: options.symbolId ?? "port",
      placement: {
        position: { x: 200, y: 100 },
        rotation: 180,
        mirror: "none",
      },
    },
    signalExpression: portName,
    terminal: {
      id: "terminal-p1",
      name: portName,
      netId: "net-out",
      direction: "output",
      interfaceInstanceIds: ["P1"],
    },
    ...(options.withPortAnnotation
      ? {
          annotation: {
            id: "label-port-p1",
            kind: "instance-label" as const,
            binding: {
              kind: "cell-terminal-name" as const,
              terminalId: "terminal-p1",
            },
            anchor: {
              kind: "object" as const,
              objectId: "P1",
              localOffset: { x: 10, y: 0 },
              fallbackPosition: { x: 210, y: 100 },
            },
            alignment: "start" as const,
            rotation: 0 as const,
            locked: false,
            ...(options.portFormatOverride
              ? { formatOverride: options.portFormatOverride }
              : {}),
          },
        }
      : {}),
    connectionEdits: [
      {
        kind: "connect_endpoints",
        from: { kind: "terminal", instanceId: "P1", pinName: "P" },
        to: { kind: "terminal", instanceId: "R1", pinName: "2" },
      },
    ],
  });
  const edits = options.extraPrecedingEdits?.length
    ? plan.map((entry) =>
        entry.kind === "transact_document" && entry.documentId === document.id
          ? {
              ...entry,
              edits: [...options.extraPrecedingEdits!, ...entry.edits],
            }
          : entry,
      )
    : plan;
  return executeProjectTransaction(project, {
    transactionId: `add-port-${portName}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
}

describe("retiring redundant Net Labels on scalar formal Port addition", () => {
  it("retires same-net same-name local Net Labels and unused anchor Junctions while preserving remote folding", () => {
    const project = projectWithLabelledNet({
      labelName: "V_out1",
      withRemoteNet: true,
    });
    const result = addPortOnNet(project, "v_out1");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    expect(authored.annotations.map((item) => item.id)).not.toContain(
      "label-out",
    );
    expect(authored.annotations.map((item) => item.id)).toContain(
      "label-remote",
    );
    expect(authored.connectivityEvidence.map((item) => item.id)).not.toContain(
      "claim-out",
    );
    expect(authored.connectivityEvidence.map((item) => item.id)).toContain(
      "claim-remote",
    );
    expect(authored.junctions.map((item) => item.id)).not.toContain("j-label");

    const logical = resolveDocumentLogicalNets(authored);
    const group = logical.byBaseNetId.get("net-out");
    expect(group?.baseNetIds).toEqual(
      expect.arrayContaining(["net-out", "net-remote"]),
    );
  });

  it("retires a 1-member range signal Net Label (DATA<0:0>) when scalar Port DATA<0> lands on the Net", () => {
    const project = projectWithLabelledNet({
      labelSignal: { expression: "DATA<0:0>", memberName: "DATA<0>" },
    });
    const result = addPortOnNet(project, "DATA<0>", {
      symbolId: "port-filled",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    expect(authored.annotations.map((item) => item.id)).not.toContain(
      "label-out",
    );
    expect(authored.connectivityEvidence.map((item) => item.id)).not.toContain(
      "claim-out",
    );
  });

  it("retires the redundant Net Label after physical-contact normalization merges a fresh-Net Port", () => {
    const project = projectWithLabelledNet({
      labelName: "V_out1",
      withRouteToJunction: true,
    });
    const document = project.documents[0]!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const pin2 = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId: "R1",
      pinName: "2",
    })!.gridLanding;
    const portOriginOffset = resolveEndpointConnection(
      {
        ...document,
        instances: [
          ...document.instances,
          {
            id: "P_PROBE",
            symbolId: "port",
            placement: {
              position: { x: 0, y: 0 },
              rotation: 180,
              mirror: "none",
            },
          },
        ],
      },
      resolver,
      { kind: "terminal", instanceId: "P_PROBE", pinName: "P" },
    )!.gridLanding;
    const portPosition = {
      x: pin2.x - portOriginOffset.x,
      y: pin2.y - portOriginOffset.y,
    };
    const result = executeTransaction(
      document,
      {
        transactionId: "physical-contact-port",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "add_instance",
            instance: {
              id: "P1",
              symbolId: "port",
              placement: {
                position: portPosition,
                rotation: 180,
                mirror: "none",
              },
            },
          },
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P1", pinName: "P" },
            to: { kind: "terminal", instanceId: "P1", pinName: "P" },
            newNetId: "net-fresh-port",
          },
          {
            kind: "add_cell_terminal",
            terminal: {
              id: "terminal-p1",
              name: "V_out1",
              netId: "net-fresh-port",
              direction: "output",
              interfaceInstanceIds: ["P1"],
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect(result.document.annotations.map((item) => item.id)).not.toContain(
      "label-out",
    );
    expect(
      result.document.connectivityEvidence.map((item) => item.id),
    ).not.toContain("claim-out");
    // Routed junction j-label stays because route-out still ends at it.
    expect(result.document.junctions.map((item) => item.id)).toContain(
      "j-label",
    );
  });

  it("keeps styled, contact-anchored, and drafting-referenced anchor Junctions when retiring the label", () => {
    const styled = projectWithLabelledNet({
      labelName: "V_out1",
      junctionStyleColor: "#cc2222",
    });
    const styledRes = addPortOnNet(styled, "V_out1");
    expect(styledRes.ok, JSON.stringify(styledRes)).toBe(true);
    if (styledRes.ok) {
      const authored = styledRes.project.documents[0]!;
      expect(authored.annotations.map((item) => item.id)).not.toContain(
        "label-out",
      );
      expect(authored.junctions.map((item) => item.id)).toContain("j-label");
    }

    const contactAnchored = projectWithLabelledNet({
      labelName: "V_out1",
      junctionContactAnchor: { instanceId: "R1", pinName: "2" },
    });
    const anchoredRes = addPortOnNet(contactAnchored, "V_out1");
    expect(anchoredRes.ok, JSON.stringify(anchoredRes)).toBe(true);
    if (anchoredRes.ok) {
      const authored = anchoredRes.project.documents[0]!;
      expect(authored.annotations.map((item) => item.id)).not.toContain(
        "label-out",
      );
      expect(authored.junctions.map((item) => item.id)).toContain("j-label");
    }

    const withDrafting = projectWithLabelledNet({ labelName: "V_out1" });
    const draftingRes = addPortOnNet(withDrafting, "V_out1", {
      extraPrecedingEdits: [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "note-1",
            kind: "text",
            content: { runs: [{ kind: "text", value: "tap" }] },
            anchor: {
              kind: "object",
              objectId: "j-label",
              localOffset: { x: 10, y: 10 },
              fallbackPosition: { x: 170, y: 110 },
            },
            alignment: "start",
            rotation: 0,
            zIndex: 1,
            locked: false,
          },
        },
      ],
    });
    expect(draftingRes.ok, JSON.stringify(draftingRes)).toBe(true);
    if (draftingRes.ok) {
      const authored = draftingRes.project.documents[0]!;
      expect(authored.annotations.map((item) => item.id)).not.toContain(
        "label-out",
      );
      expect(authored.junctions.map((item) => item.id)).toContain("j-label");
    }
  });

  it("preserves rejection boundaries and protected, aliased, layout-referenced, same-tx-upserted, or re-claimed labels", () => {
    const conflict = addPortOnNet(
      projectWithLabelledNet({ labelName: "V_int" }),
      "V_out1",
    );
    expect(conflict.ok).toBe(false);

    const globalConflict = addPortOnNet(
      projectWithLabelledNet({ labelName: "V_out1", scope: "global" }),
      "V_out1",
    );
    expect(globalConflict.ok).toBe(false);

    const aliased = addPortOnNet(
      projectWithLabelledNet({ labelName: "V_out1", aliased: true }),
      "V_out1",
    );
    expect(aliased.ok, JSON.stringify(aliased)).toBe(true);
    if (aliased.ok) {
      expect(
        aliased.project.documents[0]!.annotations.map((item) => item.id),
      ).toContain("label-out");
    }

    const lockedProject = projectWithLabelledNet({ labelName: "V_out1" });
    lockedProject.documents[0]!.annotations[0]!.locked = true;
    const lockedRes = addPortOnNet(lockedProject, "V_out1");
    expect(lockedRes.ok, JSON.stringify(lockedRes)).toBe(true);
    if (lockedRes.ok) {
      expect(
        lockedRes.project.documents[0]!.annotations.map((item) => item.id),
      ).toContain("label-out");
    }

    // Layout group added in the SAME transaction protects the label.
    const layoutTxRes = addPortOnNet(
      projectWithLabelledNet({ labelName: "V_out1" }),
      "V_out1",
      {
        extraPrecedingEdits: [
          {
            kind: "set_layout_group",
            group: {
              id: "group-label",
              kind: "custom",
              objectIds: ["label-out"],
              locked: false,
            },
          },
        ],
      },
    );
    expect(layoutTxRes.ok, JSON.stringify(layoutTxRes)).toBe(true);
    if (layoutTxRes.ok) {
      expect(
        layoutTxRes.project.documents[0]!.annotations.map((item) => item.id),
      ).toContain("label-out");
    }

    // Preceding edit replacing the label's claim with global scope keeps the
    // label and rejects with FORMAL_PORT_GLOBAL_NET_CONFLICT.
    const replacedGlobal = addPortOnNet(
      projectWithLabelledNet({ labelName: "V_out1" }),
      "V_out1",
      {
        extraPrecedingEdits: [
          { kind: "remove_connectivity_evidence", evidenceId: "claim-out" },
          {
            kind: "upsert_connectivity_evidence",
            evidence: {
              id: "claim-out-global",
              kind: "name-claim",
              netId: "net-out",
              name: "V_out1",
              scope: "global",
              owner: { kind: "net-label", annotationId: "label-out" },
            },
          },
        ],
      },
    );
    expect(replacedGlobal.ok).toBe(false);

    // Explicitly upserting a Net Label in the same transaction (e.g. copy/paste)
    // is never stripped by the Port added beside it.
    const upsertedProject = projectWithLabelledNet({ labelName: "V_out1" });
    const existingLabel = upsertedProject.documents[0]!.annotations[0]!;
    const sameTxLabelRes = addPortOnNet(upsertedProject, "V_out1", {
      extraPrecedingEdits: [
        { kind: "upsert_schematic_annotation", annotation: existingLabel },
      ],
    });
    expect(sameTxLabelRes.ok, JSON.stringify(sameTxLabelRes)).toBe(true);
    if (sameTxLabelRes.ok) {
      expect(
        sameTxLabelRes.project.documents[0]!.annotations.map((item) => item.id),
      ).toContain("label-out");
    }
  });

  it("coalesces a now-unowned degree-two wire Junction after retiring its label", () => {
    const project = projectWithLabelledNet({
      labelName: "V_out1",
      withRouteToJunction: true,
    });
    const document = project.documents[0]!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const jPos = document.junctions[0]!.position;
    // Place R2 so its pin 1 lands collinearly east of j-label and add a second route leg.
    document.instances.push({
      id: "R2",
      symbolId: "resistor",
      reference: "R2",
      placement: {
        position: { x: jPos.x + 100, y: jPos.y },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets[0]!.terminals.push({ instanceId: "R2", pinName: "1" });
    document.routes.push({
      id: "route-out-2",
      netId: "net-out",
      start: { kind: "junction", junctionId: "j-label" },
      legs: [
        {
          id: "leg-2",
          to: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "R2", pinName: "1" },
          },
          mode: "auto",
        },
      ],
    });
    const r2Pin1 = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId: "R2",
      pinName: "1",
    })!.gridLanding;
    // Align j-label on the horizontal segment between R1.2 and R2.1.
    document.junctions[0]!.position = { x: jPos.x, y: r2Pin1.y };

    const result = addPortOnNet(project, "V_out1");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    expect(authored.annotations.map((item) => item.id)).not.toContain(
      "label-out",
    );
    expect(authored.junctions.map((item) => item.id)).not.toContain("j-label");
    expect(authored.routes).toHaveLength(1);
  });

  it("retires a matching local Net Label even when a remote supply Pin shares the folded name", () => {
    const project = projectWithLabelledNet({ labelName: "VDD" });
    const document = project.documents[0]!;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: { position: { x: 400, y: 100 }, rotation: 0, mirror: "none" },
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

    const result = addPortOnNet(project, "VDD");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    expect(authored.annotations.map((item) => item.id)).not.toContain(
      "label-out",
    );
    expect(authored.connectivityEvidence.map((item) => item.id)).not.toContain(
      "claim-out",
    );
    expect(authored.junctions.map((item) => item.id)).not.toContain("j-label");
    const logical = resolveDocumentLogicalNets(authored);
    expect(logical.byBaseNetId.get("net-out")?.baseNetIds).toEqual(
      expect.arrayContaining(["net-out", "net-vdd"]),
    );
  });

  it("inherits rich-text formatOverride from the retired Net Label onto the new Port (#2607)", () => {
    const project = projectWithLabelledNet({ labelName: "S_out1" });
    const formatOverride = {
      runs: [
        {
          kind: "span" as const,
          style: "bold" as const,
          children: [{ kind: "text" as const, value: "S" }],
        },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "out1" }],
        },
      ],
    };
    project.documents[0]!.annotations[0]!.formatOverride = formatOverride;

    const result = addPortOnNet(project, "S_out1", {
      withPortAnnotation: true,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    expect(authored.annotations.map((item) => item.id)).not.toContain(
      "label-out",
    );
    const portLabel = authored.annotations.find(
      (item) => item.binding?.kind === "cell-terminal-name",
    );
    expect(portLabel?.formatOverride).toEqual(formatOverride);
  });

  it("does not inherit a formatOverride whose identifier spelling differs from the Port name (#2607)", () => {
    const project = projectWithLabelledNet({ labelName: "V_out1" });
    project.documents[0]!.annotations[0]!.formatOverride = {
      runs: [
        {
          kind: "span" as const,
          style: "italic" as const,
          children: [{ kind: "text" as const, value: "V" }],
        },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "out1" }],
        },
      ],
    };

    const result = addPortOnNet(project, "V_OUT1", {
      withPortAnnotation: true,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    const portLabel = authored.annotations.find(
      (item) => item.binding?.kind === "cell-terminal-name",
    );
    expect(portLabel?.formatOverride).toBeUndefined();
  });

  it("preserves an explicit custom formatOverride supplied on the new Port (#2607)", () => {
    const project = projectWithLabelledNet({ labelName: "S_out1" });
    project.documents[0]!.annotations[0]!.formatOverride = {
      runs: [
        {
          kind: "span" as const,
          style: "italic" as const,
          children: [{ kind: "text" as const, value: "S" }],
        },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "out1" }],
        },
      ],
    };
    const explicitPortFormat = {
      runs: [
        {
          kind: "span" as const,
          style: "bold" as const,
          children: [{ kind: "text" as const, value: "S_out1" }],
        },
      ],
    };

    const result = addPortOnNet(project, "S_out1", {
      withPortAnnotation: true,
      portFormatOverride: explicitPortFormat,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    const portLabel = authored.annotations.find(
      (item) => item.binding?.kind === "cell-terminal-name",
    );
    expect(portLabel?.formatOverride).toEqual(explicitPortFormat);
  });
});

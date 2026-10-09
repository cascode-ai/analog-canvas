// Cell Pins: adding one, the supply-edge rule for a supply Pin, VDD as a
// Cell Pin or a Global name, and a Pin's direction and order.
import type { Annotation, CircuitProject, SchematicDocument } from "@icm/model";
import { deriveStableId, foldNetName, projectCellInterface } from "@icm/model";
import {
  derivePowerRailComponent,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { ProjectStructureEdit } from "./project-transaction.js";
import {
  requireDocument,
  transactDocument,
  type DocumentEdits,
} from "./cell-document-edits.js";
import { planRemoveCellTerminals } from "./cell-interface-change-planner.js";

/** The textbook edge for a supply terminal: VDD-like on top, ground-like
 * below. Undefined for a signal. */
function supplyEdge(
  name: string,
  vddPower: boolean,
): "north" | "south" | undefined {
  if (vddPower || /^(?:v(?:dd|cc|pp|pwr)|avdd|dvdd)\w*$/iu.test(name))
    return "north";
  if (/^(?:v(?:ss|ee)|gnd|vgnd|avss|dvss|agnd|dgnd)\w*$/iu.test(name))
    return "south";
  return undefined;
}

/**
 * A supply terminal added to a Cell no parent has placed yet goes on the
 * block's top or bottom edge, where the textbook draws it and where its
 * supply wire need not cross the body (#1257). The edit follows the
 * terminal's own addition. A Cell already placed somewhere keeps the layout
 * its drawings were made with, so existing symbols never move.
 */
function supplyEdgePlacement(
  project: CircuitProject,
  document: SchematicDocument,
  terminals: readonly { id: string; name: string; vddPower: boolean }[],
): DocumentEdits {
  const placed = project.documents.some((parent) =>
    parent.instances.some((instance) => {
      const binding = instance.netlist?.binding;
      return (
        binding?.kind === "subcircuit" &&
        binding.childDocumentId === document.id
      );
    }),
  );
  if (placed) return [];
  const current = document.presentation.cellSymbol;
  const placements = [...(current?.pinPlacements ?? [])];
  for (const terminal of terminals) {
    const side = supplyEdge(terminal.name, terminal.vddPower);
    if (!side) continue;
    const taken = new Set(
      placements
        .filter((placement) => placement.side === side)
        .map((placement) => placement.offset),
    );
    let offset = 0;
    for (let step = 1; taken.has(offset); step += 1)
      offset = (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 20;
    placements.push({ terminalId: terminal.id, side, offset });
  }
  if (placements.length === (current?.pinPlacements?.length ?? 0)) return [];
  return [
    {
      kind: "set_cell_symbol_presentation",
      presentation: {
        ...(current?.minimumBodySize
          ? { minimumBodySize: current.minimumBodySize }
          : {}),
        pinPlacements: placements,
      },
    },
  ];
}

/**
 * The supply edge rule (#1257) for a Cell Pin that no Cell Pin command adds:
 * a local Power Rail adds its VDD terminal itself, and that terminal went to
 * the block's left side, under its inputs. A ring oscillator's three
 * inverters each took their VDD wire down past the incoming signal.
 */
export function planSupplyTerminalEdge(
  project: CircuitProject,
  documentId: string,
  terminals: readonly { id: string; name: string; vddPower: boolean }[],
): DocumentEdits {
  return supplyEdgePlacement(
    project,
    requireDocument(project, documentId),
    terminals,
  );
}

export function planCreateCellPin(
  project: CircuitProject,
  documentId: string,
  input: {
    instance: SchematicDocument["instances"][number];
    connectionEdits: DocumentEdits;
    terminal: NonNullable<SchematicDocument["netlist"]>["terminals"][number];
    annotation?: Annotation;
  },
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  if (!document.netlist)
    throw new Error(`Cell has no interface: ${documentId}`);
  if (
    input.terminal.interfaceInstanceIds.length !== 1 ||
    input.terminal.interfaceInstanceIds[0] !== input.instance.id
  ) {
    throw new Error(
      "A Cell terminal must own exactly its placed Port Instance",
    );
  }
  if (
    input.instance.symbolId !== "port" &&
    input.instance.symbolId !== "port-filled" &&
    input.instance.symbolId !== "vdd-port"
  ) {
    throw new Error(
      `Cell interface marker must be a Port or VDD Power: ${input.instance.symbolId}`,
    );
  }
  return [
    transactDocument(project, documentId, [
      { kind: "add_instance", instance: input.instance },
      ...input.connectionEdits,
      { kind: "add_cell_terminal", terminal: input.terminal },
      ...supplyEdgePlacement(project, document, [
        {
          ...input.terminal,
          vddPower: input.instance.symbolId === "vdd-port",
        },
      ]),
      ...(input.annotation
        ? [
            {
              kind: "upsert_schematic_annotation" as const,
              annotation: input.annotation,
            },
          ]
        : []),
    ]),
  ];
}

export type VddConnectionMode = "cell-pin" | "global";

/**
 * Switch the electrical role of the VDD artwork without touching its Base-Net
 * membership or geometry. Cell-Pin mode is represented by the existing formal
 * interface object; Global mode is represented by the existing marker-owned
 * name claim. The target is a Port instance ID or Rail route ID. Markers
 * sharing one physical Base Net move together so the same
 * conductor can never be both interface styles at once.
 */
export function planSetVddConnectionMode(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  mode: VddConnectionMode,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  if (!document.netlist) {
    throw new Error(`Cell has no interface: ${documentId}`);
  }
  const selected = document.instances.find(
    (instance) => instance.id === instanceId,
  );
  const selectedRail = document.routes.find(
    (route) => route.id === instanceId && route.presentation === "power-rail",
  );
  if (selected?.symbolId !== "vdd-port" && !selectedRail) {
    throw new Error(`Instance is not VDD Power: ${instanceId}`);
  }
  const net = document.nets.find((candidate) =>
    selectedRail
      ? candidate.id === selectedRail.netId
      : candidate.terminals.some(
          (terminal) =>
            terminal.instanceId === instanceId && terminal.pinName === "P",
        ),
  );
  if (!net) throw new Error(`VDD Power has no Net: ${instanceId}`);

  const markerIds = new Set(
    net.terminals.flatMap((terminal) => {
      const instance = document.instances.find(
        (candidate) => candidate.id === terminal.instanceId,
      );
      return terminal.pinName === "P" && instance?.symbolId === "vdd-port"
        ? [instance.id]
        : [];
    }),
  );
  // A Rail is owned by its power label, whereas a Port is owned by its
  // instance. Resolve both into the same supply-role transaction. Do not
  // infer ownership from unrelated labels on the same electrical Net.
  const railLabels = new Map<string, Annotation>();
  const legacyRailOwners = new Set<string>();
  const preparation: DocumentEdits = [];
  const visitedRoutes = new Set<string>();
  let selectedMarkerId = instanceId;
  for (const route of document.routes) {
    if (
      route.netId !== net.id ||
      route.presentation !== "power-rail" ||
      visitedRoutes.has(route.id)
    )
      continue;
    const rail = derivePowerRailComponent(document, route.id);
    if (!rail) continue;
    for (const id of rail.routeIds) {
      visitedRoutes.add(id);
      legacyRailOwners.add(id);
    }
    for (const id of rail.junctionIds) legacyRailOwners.add(id);
    const labels = document.annotations.filter(
      (annotation) =>
        annotation.kind === "power-label" &&
        annotation.anchor.kind === "object" &&
        rail.junctionIds.includes(annotation.anchor.objectId),
    );
    if (labels.length === 0) {
      const junction = document.junctions.find(
        (item) => item.id === rail.endpointJunctionIds[0],
      );
      if (!junction) throw new Error("Power rail has no endpoint");
      const label: Annotation = {
        id: deriveStableId("power-label", document.id, route.id),
        kind: "power-label",
        netId: net.id,
        binding: { kind: "net-name", netId: net.id },
        anchor: {
          kind: "object",
          objectId: junction.id,
          localOffset: { x: 10, y: 10 },
          fallbackPosition: {
            x: junction.position.x + 10,
            y: junction.position.y + 10,
          },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
        visible: false,
      };
      labels.push(label);
      preparation.push({
        kind: "upsert_schematic_annotation",
        annotation: label,
      });
    }
    for (const label of labels) {
      markerIds.add(label.id);
      railLabels.set(label.id, label);
    }
    if (selectedRail && rail.routeIds.includes(selectedRail.id))
      selectedMarkerId = labels[0]!.id;
  }
  const markerForTerminal = (
    terminal: NonNullable<SchematicDocument["netlist"]>["terminals"][number],
  ) =>
    terminal.interfaceAnnotationId &&
    railLabels.has(terminal.interfaceAnnotationId)
      ? terminal.interfaceAnnotationId
      : terminal.interfaceInstanceIds[0]!;
  const annotationsForMarker = (markerId: string) =>
    railLabels.has(markerId)
      ? [railLabels.get(markerId)!]
      : document.annotations.filter(
          (annotation) =>
            annotation.kind === "power-label" &&
            annotation.anchor.kind === "object" &&
            annotation.anchor.objectId === markerId,
        );
  const terminalByMarkerId = new Map(
    document.netlist.terminals.flatMap((terminal) =>
      terminal.netId === net.id && markerIds.has(markerForTerminal(terminal))
        ? [[markerForTerminal(terminal), terminal] as const]
        : [],
    ),
  );
  const selectedTerminal = terminalByMarkerId.get(selectedMarkerId);
  const ownedClaims = document.connectivityEvidence.filter(
    (
      evidence,
    ): evidence is Extract<
      SchematicDocument["connectivityEvidence"][number],
      { kind: "name-claim" }
    > =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker" &&
      (markerIds.has(evidence.owner.objectId) ||
        legacyRailOwners.has(evidence.owner.objectId)) &&
      evidence.netId === net.id,
  );
  const logicalName = resolveDocumentLogicalNets(document).byBaseNetId.get(
    net.id,
  )?.name;

  if (mode === "global") {
    if (!selectedTerminal) return [];
    const terminals = [...terminalByMarkerId.values()];
    const names = new Map<string, string>();
    for (const terminal of terminals) {
      const folded = foldNetName(terminal.name);
      if (!names.has(folded)) names.set(folded, terminal.name);
    }
    if (names.size !== 1) {
      throw new Error(
        "One physical VDD Net exposes several Cell Pin names; unify them before making it Global",
      );
    }
    const retainedFormalOnNet = document.netlist.terminals.find(
      (terminal) =>
        terminal.netId === net.id &&
        !terminalByMarkerId.has(markerForTerminal(terminal)),
    );
    if (retainedFormalOnNet) {
      throw new Error(
        `Net ${retainedFormalOnNet.name} still has a non-VDD formal Cell Pin; disconnect it before making VDD Global`,
      );
    }
    const name = [...names.values()][0] ?? logicalName ?? "VDD";
    const annotationEdits: DocumentEdits = [
      ...preparation,
      ...ownedClaims
        .filter(
          (claim) =>
            claim.owner.kind === "power-marker" &&
            legacyRailOwners.has(claim.owner.objectId),
        )
        .map((claim) => ({
          kind: "remove_connectivity_evidence" as const,
          evidenceId: claim.id,
        })),
    ];
    for (const markerId of markerIds) {
      const priorClaim = ownedClaims.find(
        (claim) =>
          claim.owner.kind === "power-marker" &&
          claim.owner.objectId === markerId,
      );
      annotationEdits.push({
        kind: "upsert_connectivity_evidence",
        evidence: {
          id:
            priorClaim?.id ??
            deriveStableId(
              "connectivity-evidence",
              document.id,
              "power-marker",
              markerId,
              net.id,
            ),
          kind: "name-claim",
          netId: net.id,
          name,
          scope: "global",
          powerDomain: "vdd",
          owner: { kind: "power-marker", objectId: markerId },
        },
      });
      for (const annotation of annotationsForMarker(markerId)) {
        annotationEdits.push({
          kind: "upsert_schematic_annotation",
          annotation: {
            ...annotation,
            netId: net.id,
            binding: { kind: "net-name", netId: net.id },
          },
        });
      }
    }
    const removal = planRemoveCellTerminals(
      project,
      documentId,
      terminals.map((terminal) => terminal.id),
      [],
    );
    return removal.map((edit) =>
      edit.kind === "transact_document" && edit.documentId === documentId
        ? { ...edit, edits: [...edit.edits, ...annotationEdits] }
        : edit,
    );
  }

  if (selectedTerminal) return [];
  const blockingClaim = document.connectivityEvidence.find(
    (evidence) =>
      evidence.kind === "name-claim" &&
      evidence.netId === net.id &&
      evidence.scope === "global" &&
      !(
        evidence.owner.kind === "power-marker" &&
        (markerIds.has(evidence.owner.objectId) ||
          legacyRailOwners.has(evidence.owner.objectId))
      ),
  );
  if (blockingClaim) {
    throw new Error(
      "This conductor still has another Global declaration; remove or change that owner before making VDD a Cell Pin",
    );
  }
  const claimNames = new Map<string, string>();
  for (const claim of ownedClaims) {
    const folded = foldNetName(claim.name);
    if (!claimNames.has(folded)) claimNames.set(folded, claim.name);
  }
  if (claimNames.size > 1) {
    throw new Error(
      "One physical VDD Net has several Global names; unify them before making it a Cell Pin",
    );
  }
  const name = [...claimNames.values()][0] ?? logicalName ?? "VDD";
  const occupiedIds = new Set([
    ...document.instances.map((item) => item.id),
    ...document.nets.map((item) => item.id),
    ...document.routes.map((item) => item.id),
    ...document.junctions.map((item) => item.id),
    ...document.annotations.map((item) => item.id),
    ...document.connectivityEvidence.map((item) => item.id),
    ...document.noConnects.map((item) => item.id),
    ...document.netlist.terminals.map((item) => item.id),
  ]);
  const edits: DocumentEdits = [
    ...preparation,
    ...ownedClaims.map((claim) => ({
      kind: "remove_connectivity_evidence" as const,
      evidenceId: claim.id,
    })),
  ];
  const addedTerminalIds: string[] = [];
  for (const markerId of markerIds) {
    const existingTerminal = terminalByMarkerId.get(markerId);
    if (railLabels.has(markerId)) {
      edits.push({
        kind: "upsert_connectivity_evidence",
        evidence: {
          id: deriveStableId(
            "connectivity-evidence",
            document.id,
            "power-marker",
            markerId,
            net.id,
          ),
          kind: "name-claim",
          netId: net.id,
          name,
          scope: "local",
          powerDomain: "vdd",
          owner: { kind: "power-marker", objectId: markerId },
        },
      });
    }
    let terminalId =
      existingTerminal?.id ?? `terminal-${markerId.toLowerCase()}`;
    if (!existingTerminal) {
      let suffix = 2;
      while (occupiedIds.has(terminalId)) {
        terminalId = `terminal-${markerId.toLowerCase()}-${suffix}`;
        suffix += 1;
      }
      occupiedIds.add(terminalId);
      edits.push({
        kind: "add_cell_terminal",
        terminal: {
          id: terminalId,
          name,
          netId: net.id,
          direction: "inout",
          interfaceInstanceIds: railLabels.has(markerId) ? [] : [markerId],
          ...(railLabels.has(markerId)
            ? { interfaceAnnotationId: markerId }
            : {}),
        },
      });
      addedTerminalIds.push(terminalId);
    }
    for (const annotation of annotationsForMarker(markerId)) {
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          netId: net.id,
          binding: { kind: "cell-terminal-name", terminalId },
        },
      });
    }
  }
  // The markers of one Net form one Cell Pin; the first new one stands for
  // it on the block, on top, when no marker of it had a terminal before.
  if (addedTerminalIds.length === markerIds.size && addedTerminalIds[0])
    edits.push(
      ...supplyEdgePlacement(project, document, [
        { id: addedTerminalIds[0], name, vddPower: true },
      ]),
    );
  return [transactDocument(project, documentId, edits)];
}

export function planUpdateCellTerminalDirection(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  direction: "input" | "output" | "inout" | "passive",
): ProjectStructureEdit[] {
  return [
    transactDocument(project, documentId, [
      { kind: "update_cell_terminal", terminalId, direction },
    ]),
  ];
}

/** Update every authored declaration represented by one projected formal Port. */
export function planUpdateCellPortDirection(
  project: CircuitProject,
  documentId: string,
  portId: string,
  direction: "input" | "output" | "inout" | "passive",
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  const port = projectCellInterface(document.netlist).ports.find(
    (candidate) => candidate.id === portId,
  );
  if (!port)
    throw new Error(`Cell port does not exist: ${documentId}.${portId}`);
  const edits = port.terminalIds.flatMap((terminalId) => {
    const terminal = document.netlist?.terminals.find(
      (candidate) => candidate.id === terminalId,
    );
    return terminal?.direction === direction
      ? []
      : [
          {
            kind: "update_cell_terminal" as const,
            terminalId,
            direction,
          },
        ];
  });
  return edits.length > 0 ? [transactDocument(project, documentId, edits)] : [];
}

export function planReorderCellTerminal(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  delta: -1 | 1,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  const terminals = document.netlist?.terminals ?? [];
  const index = terminals.findIndex((terminal) => terminal.id === terminalId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= terminals.length) return [];
  const terminalIds = terminals.map((terminal) => terminal.id);
  [terminalIds[index], terminalIds[next]] = [
    terminalIds[next]!,
    terminalIds[index]!,
  ];
  return [
    transactDocument(project, documentId, [
      { kind: "reorder_cell_terminals", terminalIds },
    ]),
  ];
}

/** Reorder projected formal Ports while keeping each Port's marker declarations together. */
export function planReorderCellPort(
  project: CircuitProject,
  documentId: string,
  portId: string,
  delta: -1 | 1,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  const ports = projectCellInterface(document.netlist).ports;
  const index = ports.findIndex((port) => port.id === portId);
  const next = index + delta;
  if (index < 0)
    throw new Error(`Cell port does not exist: ${documentId}.${portId}`);
  if (next < 0 || next >= ports.length) return [];
  const orderedGroups = ports.map((port) => [...port.terminalIds]);
  [orderedGroups[index], orderedGroups[next]] = [
    orderedGroups[next]!,
    orderedGroups[index]!,
  ];
  return [
    transactDocument(project, documentId, [
      {
        kind: "reorder_cell_terminals",
        terminalIds: orderedGroups.flat(),
      },
    ]),
  ];
}

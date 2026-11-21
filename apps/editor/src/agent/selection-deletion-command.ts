import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
} from "@icm/agent-adapter";
import {
  gateRoutingOperationPlan,
  planCellSelectionDeletion,
  planRemoveCellTerminals,
  type RoutingDeletionSeed,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  foldNetName,
  polylineIntersectsRect,
  routeEnd,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

/**
 * A selection deleted as the GUI deletes it, except that a locked text it
 * names is refused rather than kept: an Agent never believes it gone.
 */
export function planSelectionDeletion(
  project: CircuitProject,
  documentId: string,
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingDeletionSeed,
  sequence: number,
): {
  plan: AgentCommandPlan;
  edits: readonly SchematicEdit[];
  /** The Cell once deleted, when it is known without a Project commit. */
  after?: SchematicDocument;
} {
  const selected = planCellSelectionDeletion(
    document,
    resolver,
    seed,
    sequence,
  );
  const locked = [
    ...selected.locked.draftingIds,
    ...selected.locked.annotationIds,
  ];
  if (locked.length)
    throw new Error(
      `selection: ${locked.join(", ")} ${locked.length === 1 ? "is" : "are"} locked; unlock before deleting; no objects were deleted`,
    );
  if (selected.terminalIds.length)
    return {
      plan: {
        structureEdits: planRemoveCellTerminals(
          project,
          documentId,
          selected.terminalIds,
          [...selected.routing.edits],
        ),
      },
      edits: selected.routing.edits,
    };
  const gate = gateRoutingOperationPlan(document, selected.routing, {
    symbolResolver: resolver,
  });
  if (!gate.ok) throw new Error(gate.message);
  return {
    plan: { edits: [...gate.edits] },
    edits: selected.routing.edits,
    after: gate.evaluated.finalDocument,
  };
}

type DeleteWires = Extract<AgentAuthoringCommand, { kind: "delete-wires" }>;

/** The wires one selector names, and how to say which they are. */
function selectedWires(
  document: SchematicDocument,
  resolver: SymbolResolver,
  command: DeleteWires,
): { routeIds: string[]; which: string } {
  if (command.net !== undefined) {
    const wanted = command.net;
    const { groups } = resolveDocumentLogicalNets(document);
    const byId = groups.find(
      (group) => group.id === wanted || group.baseNetIds.includes(wanted),
    );
    const named = byId
      ? [byId]
      : groups.filter((group) => group.name === wanted).length
        ? groups.filter((group) => group.name === wanted)
        : groups.filter(
            (group) =>
              group.name !== undefined &&
              foldNetName(group.name) === foldNetName(wanted),
          );
    if (named.length === 0)
      throw new Error(`no Net matches "${wanted}"; nothing was deleted`);
    if (named.length > 1)
      throw new Error(
        `"${wanted}" names ${named.length} Nets (${named.map((group) => group.id).join(", ")}); give one ID; nothing was deleted`,
      );
    const net = named[0]!;
    const baseNetIds = new Set(net.baseNetIds);
    return {
      // A bus wire goes only when all its lanes are this Net's.
      routeIds: document.routes
        .filter((route) =>
          (route.members ?? [route]).every((member) =>
            baseNetIds.has(member.netId),
          ),
        )
        .map((route) => route.id),
      which: `on Net ${net.name ?? net.id}`,
    };
  }
  if (command.instance !== undefined) {
    const wanted = command.instance;
    const byId = document.instances.find((item) => item.id === wanted);
    const named = byId
      ? [byId]
      : document.instances.filter(
          (item) =>
            item.reference === wanted ||
            document.netlist?.terminals.some(
              (terminal) =>
                terminal.name === wanted &&
                terminal.interfaceInstanceIds.includes(item.id),
            ),
        );
    if (named.length === 0)
      throw new Error(
        `no instance matches Reference or ID "${wanted}"; nothing was deleted`,
      );
    if (named.length > 1)
      throw new Error(
        `"${wanted}" names ${named.length} parts (${named.map((item) => item.id).join(", ")}); give one ID; nothing was deleted`,
      );
    const instance = named[0]!;
    return {
      routeIds: document.routes
        .filter((route) =>
          [route.start, routeEnd(route)].some(
            (end) => end.kind === "terminal" && end.instanceId === instance.id,
          ),
        )
        .map((route) => route.id),
      which: `on ${instance.reference ?? wanted}'s pins`,
    };
  }
  const box = command.bbox!;
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  return {
    routeIds: document.routes
      .filter((route) => {
        const centerline = geometry.routes.get(route.id)?.centerline;
        return (
          centerline !== undefined && polylineIntersectsRect(centerline, box)
        );
      })
      .map((route) => route.id),
    which: `in the box at (${box.x}, ${box.y}), ${box.width} by ${box.height}`,
  };
}

const counted = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The wires a Net, a box or a part names, deleted as one selection of them:
 * the Junctions and Net labels they leave alone go too, every part stays.
 */
export function planDeleteWires(
  project: CircuitProject,
  documentId: string,
  document: SchematicDocument,
  resolver: SymbolResolver,
  command: DeleteWires,
  sequence: number,
): AgentCommandPlan {
  const { routeIds, which } = selectedWires(document, resolver, command);
  if (!routeIds.length)
    throw new Error(`no wire is ${which}; nothing was deleted`);
  const { plan, edits, after } = planSelectionDeletion(
    project,
    documentId,
    document,
    resolver,
    { instanceIds: [], routeIds, junctionIds: [], annotationIds: [] },
    sequence,
  );
  // What went, read off the Cell once deleted: the commit also sweeps the
  // Junctions the wires leave bare. A Cell Pin's removal commits through the
  // Project, so there only the plan's own removals are known.
  const planned = (kind: SchematicEdit["kind"]) =>
    edits.flatMap((edit) =>
      edit.kind !== kind
        ? []
        : edit.kind === "cut_connection"
          ? [edit.routeId]
          : edit.kind === "remove_junction"
            ? [edit.junctionId]
            : edit.kind === "remove_schematic_annotation"
              ? [edit.annotationId]
              : [],
    );
  const gone = (
    before: readonly { id: string }[],
    remaining: readonly { id: string }[] | undefined,
    kind: SchematicEdit["kind"],
  ) => {
    if (!remaining) return [...new Set(planned(kind))];
    const kept = new Set(remaining.map((item) => item.id));
    return before.map((item) => item.id).filter((id) => !kept.has(id));
  };
  // A remaining run whose Junction went is redrawn as one wire under a new
  // ID: only the wires chosen, and those the plan cuts, count as deleted.
  const cut = new Set([...routeIds, ...planned("cut_connection")]);
  const wires = gone(document.routes, after?.routes, "cut_connection").filter(
    (id) => cut.has(id),
  );
  const junctions = gone(
    document.junctions,
    after?.junctions,
    "remove_junction",
  );
  const labels = gone(
    document.annotations,
    after?.annotations,
    "remove_schematic_annotation",
  );
  return {
    ...plan,
    notes: [
      {
        code: "WIRES_DELETED",
        message: `Deleted ${counted(wires.length, "wire")}, ${counted(junctions.length, "Junction")} and ${counted(labels.length, "label")} ${which}; every part stays.`,
        objectIds: [...wires, ...junctions, ...labels],
      },
    ],
  };
}

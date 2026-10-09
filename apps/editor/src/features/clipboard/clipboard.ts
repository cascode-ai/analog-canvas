// What a copy carries, captured from a selection or from a whole Document.
import {
  captureRoutingCopyFragment,
  withPowerMarkerOwnership,
} from "@icm/edit-engine";
import {
  hasExplicitMosBulkRoute,
  resolveMosBulkConnection,
  strandedMosBulkNet,
} from "@icm/derived";
import type {
  Annotation,
  CellNetlistTerminal,
  ConnectivityEvidence,
  DraftingObject,
  Instance,
  LayoutConstraint,
  LayoutGroup,
  Net,
  NoConnect,
  RouteBranch,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { routeEnd } from "@icm/model";

import type { CopyContext } from "./project-copy";

export interface SchematicClipboard {
  context?: CopyContext;
  intent: "clone-selection" | "compose-document";
  sourceDocumentId: string;
  sourceGrid: number;
  instances: Instance[];
  cellTerminals: CellNetlistTerminal[];
  formalParameters: NonNullable<
    SchematicDocument["netlist"]
  >["formalParameters"];
  /**
   * Nets entirely inside the copied selection. They are duplicated when the
   * copy is committed.
   */
  nets: Net[];
  routes: RouteBranch[];
  junctions: SchematicDocument["junctions"];
  annotations: Annotation[];
  noConnects: NoConnect[];
  connectivityEvidence: ConnectivityEvidence[];
  /**
   * Selected drafting objects — text, arrows, lines, rectangles, circles.
   * They carry no connectivity, so they copy as themselves and are the only
   * thing a copy needs when nothing electrical is selected.
   */
  draftingObjects: DraftingObject[];
  /** Layout ownership records wholly contained in the copied closure. */
  layoutGroups: LayoutGroup[];
  /** Layout constraints wholly contained in the copied closure. */
  constraints: LayoutConstraint[];
}

/** Electrical objects the person explicitly included in the visual selection. */
export interface ExplicitCopyRoutingSelection {
  routeIds: readonly string[];
  junctionIds: readonly string[];
  annotationIds: readonly string[];
}

/**
 * Copy a whole Document as one fragment.
 *
 * `copySelection` is driven by the instances a user picked, so it keeps only
 * Nets every terminal of which is inside that selection. Importing a circuit
 * is a different question — everything drawn belongs — and a Net with no
 * instance terminals at all, such as a Power Rail that has been drawn but not
 * yet wired to a device, would otherwise be dropped along with its rail
 * geometry and label.
 */
export function captureDocumentComposition(
  document: SchematicDocument,
): SchematicClipboard | null {
  document = withPowerMarkerOwnership(document);
  const draftingObjects = document.drafting?.objects ?? [];
  if (
    document.instances.length === 0 &&
    document.routes.length === 0 &&
    document.junctions.length === 0 &&
    document.annotations.length === 0 &&
    draftingObjects.length === 0
  ) {
    return null;
  }
  const instances = structuredClone(document.instances);
  const nets = structuredClone(document.nets);
  const copiedInstancesById = new Map(
    instances.map((instance) => [instance.id, instance]),
  );
  const copiedNetsById = new Map(nets.map((net) => [net.id, net]));
  // A body default is context, not portable ownership. Close the composition
  // snapshot by materializing any still-derived source default; proposePaste
  // will then convert every policy binding to an instance-owned override.
  for (const sourceInstance of document.instances) {
    const resolution = resolveMosBulkConnection(document, sourceInstance);
    const copiedInstance = copiedInstancesById.get(sourceInstance.id);
    if (!copiedInstance) continue;
    // A policy residue is not an authored connection, even when no current
    // default can resolve it. Never promote it to an explicit copied body.
    const residue = strandedMosBulkNet(document, sourceInstance);
    const copiedResidue = residue && copiedNetsById.get(residue.id);
    if (copiedResidue) {
      copiedResidue.terminals = [];
      delete copiedInstance.mosBulkBinding;
    }
    if (
      (resolution?.status !== "cell-default" &&
        resolution?.status !== "supply-default") ||
      resolution.materialized ||
      !resolution.net
    ) {
      continue;
    }
    const copiedNet = copiedNetsById.get(resolution.net.id);
    if (!copiedNet) continue;
    copiedInstance.mosBulkBinding = {
      origin: resolution.status,
      netId: copiedNet.id,
    };
    if (
      !copiedNet.terminals.some(
        (terminal) =>
          terminal.instanceId === copiedInstance.id && terminal.pinName === "B",
      )
    ) {
      copiedNet.terminals.push({
        instanceId: copiedInstance.id,
        pinName: "B",
      });
    }
  }
  return structuredClone({
    intent: "compose-document",
    sourceDocumentId: document.id,
    sourceGrid: document.presentation.grid,
    instances,
    cellTerminals: document.netlist?.terminals ?? [],
    formalParameters: document.netlist?.formalParameters ?? [],
    nets,
    routes: document.routes,
    junctions: document.junctions,
    annotations: document.annotations,
    noConnects: document.noConnects,
    connectivityEvidence: document.connectivityEvidence,
    draftingObjects,
    layoutGroups: document.layoutGroups,
    constraints: document.constraints,
  });
}

export function copySelection(
  document: SchematicDocument,
  instanceIds: readonly string[],
  draftingIds: readonly string[] = [],
  routingSelection?: ExplicitCopyRoutingSelection,
  resolver?: SymbolResolver,
): SchematicClipboard | null {
  document = withPowerMarkerOwnership(document);
  const selectedIds = new Set(instanceIds);
  const instances = document.instances.filter((instance) =>
    selectedIds.has(instance.id),
  );
  const selectedDrafting = new Set(draftingIds);
  const draftingObjects = (document.drafting?.objects ?? []).filter((object) =>
    selectedDrafting.has(object.id),
  );
  // A drawing-only selection is a complete copy: notes and callouts are
  // worth duplicating on their own, and requiring a part alongside them made
  // C look broken to anyone who had only selected a piece of text.
  const hasExplicitRoutingSelection = Boolean(
    routingSelection &&
    (routingSelection.routeIds.length > 0 ||
      routingSelection.junctionIds.length > 0 ||
      routingSelection.annotationIds.length > 0),
  );
  if (
    instances.length === 0 &&
    draftingObjects.length === 0 &&
    !hasExplicitRoutingSelection
  ) {
    return null;
  }
  const capture = captureRoutingCopyFragment(
    document,
    {
      instanceIds,
      routeIds: routingSelection?.routeIds ?? [],
      junctionIds: routingSelection?.junctionIds ?? [],
      annotationIds: routingSelection?.annotationIds ?? [],
    },
    {
      // Only explicitly selected wires travel with a new component.
      includeImplicitInstanceRoutes: false,
    },
  );
  const netIds = new Set(capture.clonedNetIds);
  const routeIds = new Set(capture.affected.internalRoutes);
  const junctionIds = new Set(capture.affected.internalJunctions);
  const attachedIds = new Set<string>([
    ...selectedIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
  ]);
  const annotations = document.annotations.filter(
    (annotation) =>
      routingSelection?.annotationIds.includes(annotation.id) ||
      (annotation.anchor.kind === "object" &&
        attachedIds.has(annotation.anchor.objectId)) ||
      (annotation.anchor.kind === "route" &&
        routeIds.has(annotation.anchor.routeId)),
  );
  const copiedTerminalKeys = new Set(
    document.routes
      .filter((route) => routeIds.has(route.id))
      .flatMap((route) => [route.start, routeEnd(route)])
      .filter((endpoint) => endpoint.kind === "terminal")
      .map((endpoint) => `${endpoint.instanceId}\0${endpoint.pinName}`),
  );
  const ownedMarkerIds = new Set([
    ...(document.netlist?.terminals.flatMap(
      (terminal) => terminal.interfaceInstanceIds,
    ) ?? []),
    ...document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "name-claim" && evidence.owner.kind === "power-marker"
        ? [evidence.owner.objectId]
        : [],
    ),
  ]);
  // A copy keeps each MOS body where its source put it whenever that Net
  // travels with the copy: the Net the body joins, or the Cell default or
  // supply it follows. A body whose Net stays behind follows the target. A
  // body drawn with a dashed wire is wired like any pin: it comes with its
  // wire or not at all.
  const bodyNets = new Map<string, string>();
  for (const instance of instances) {
    if (hasExplicitMosBulkRoute(document, instance.id)) continue;
    const body = resolveMosBulkConnection(document, instance);
    if (body?.net && netIds.has(body.net.id))
      bodyNets.set(instance.id, body.net.id);
  }
  // A pin its symbol does not draw, such as the substrate of a bipolar
  // model, has no place for a wire either: it travels with its Net, as a
  // body does, and is left for the target to bind when its Net stays behind.
  const undrawnPin = (instanceId: string, pinName: string): boolean => {
    const instance = instances.find((item) => item.id === instanceId);
    const symbol =
      instance &&
      resolver?.resolve(instance.symbolId, instance.symbolVariantId);
    return Boolean(
      symbol && !symbol.definition.pins.some((pin) => pin.name === pinName),
    );
  };
  const annotationIds = new Set(annotations.map((annotation) => annotation.id));
  const copiedLayoutObjectIds = new Set<string>([
    ...selectedIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
    ...annotationIds,
    ...selectedDrafting,
  ]);
  const layoutGroups = document.layoutGroups.filter((group) =>
    group.objectIds.every((objectId) => copiedLayoutObjectIds.has(objectId)),
  );
  const constraints = document.constraints.filter((constraint) =>
    constraint.objectIds.every((objectId) =>
      copiedLayoutObjectIds.has(objectId),
    ),
  );
  const clipboard: SchematicClipboard = structuredClone({
    intent: "clone-selection",
    sourceDocumentId: document.id,
    sourceGrid: document.presentation.grid,
    instances,
    cellTerminals:
      document.netlist?.terminals.flatMap((terminal) => {
        const interfaceInstanceIds = terminal.interfaceInstanceIds.filter(
          (instanceId) => selectedIds.has(instanceId),
        );
        const interfaceAnnotationId = terminal.interfaceAnnotationId;
        return interfaceInstanceIds.length > 0 ||
          (interfaceAnnotationId !== undefined &&
            annotationIds.has(interfaceAnnotationId))
          ? [
              {
                ...terminal,
                interfaceInstanceIds,
                ...(interfaceAnnotationId ? { interfaceAnnotationId } : {}),
              },
            ]
          : [];
      }) ?? [],
    formalParameters: [],
    nets: document.nets
      .filter((net) => netIds.has(net.id))
      .map((net) => ({
        ...net,
        // Only terminals whose instance is actually copied travel: an
        // explicitly selected Route promotes its whole net to internal, but
        // that net can still land on instances outside the copy, and their
        // terminals would map to nothing at paste time.
        terminals: [
          ...net.terminals.filter(
            (terminal) =>
              selectedIds.has(terminal.instanceId) &&
              (ownedMarkerIds.has(terminal.instanceId) ||
                copiedTerminalKeys.has(
                  `${terminal.instanceId}\0${terminal.pinName}`,
                ) ||
                undrawnPin(terminal.instanceId, terminal.pinName) ||
                (terminal.pinName === "B" &&
                  bodyNets.get(terminal.instanceId) === net.id)),
          ),
          // A body that followed a default joins that Net explicitly.
          ...[...bodyNets]
            .filter(
              ([instanceId, netId]) =>
                netId === net.id &&
                !net.terminals.some(
                  (terminal) =>
                    terminal.instanceId === instanceId &&
                    terminal.pinName === "B",
                ),
            )
            .map(([instanceId]) => ({ instanceId, pinName: "B" })),
        ],
      })),
    routes: document.routes.filter((route) => routeIds.has(route.id)),
    junctions: document.junctions.filter((junction) =>
      junctionIds.has(junction.id),
    ),
    annotations,
    noConnects: [],
    connectivityEvidence: document.connectivityEvidence.filter((evidence) => {
      if (!netIds.has(evidence.netId)) return false;
      if (evidence.kind !== "name-claim") return false;
      switch (evidence.owner.kind) {
        case "global-declaration":
          return false;
        case "net-label":
          return annotationIds.has(evidence.owner.annotationId);
        case "power-marker":
          return (
            attachedIds.has(evidence.owner.objectId) ||
            annotationIds.has(evidence.owner.objectId)
          );
      }
    }),
    draftingObjects,
    layoutGroups,
    constraints,
  });
  // Copied electrical names and rich-text labels remain authored content,
  // including customized power markers. Fresh object IDs do not imply fresh names.
  // Two selected Port markers must not retain a shared invisible source Net.
  // Their selected wires, when present, remain the only reason to share it.
  for (const instance of clipboard.instances) {
    if (
      clipboard.routes.some((route) =>
        [route.start, routeEnd(route)].some(
          (endpoint) =>
            endpoint.kind === "terminal" && endpoint.instanceId === instance.id,
        ),
      )
    )
      continue;
    const terminal = clipboard.cellTerminals.find((candidate) =>
      candidate.interfaceInstanceIds.includes(instance.id),
    );
    const net = clipboard.nets.find((candidate) =>
      candidate.terminals.some(
        (endpoint) => endpoint.instanceId === instance.id,
      ),
    );
    if (!terminal || !net || net.terminals.length < 2) continue;
    const netId = `${net.id}-insert-${instance.id}`;
    clipboard.nets.push({
      id: netId,
      terminals: net.terminals.filter(
        (endpoint) => endpoint.instanceId === instance.id,
      ),
    });
    net.terminals = net.terminals.filter(
      (endpoint) => endpoint.instanceId !== instance.id,
    );
    terminal.netId = netId;
    for (const annotation of clipboard.annotations) {
      if (
        annotation.anchor.kind !== "object" ||
        annotation.anchor.objectId !== instance.id
      )
        continue;
      if (annotation.netId === net.id) annotation.netId = netId;
      if (annotation.binding?.kind === "net-name")
        annotation.binding.netId = netId;
      if (annotation.binding?.kind === "cell-terminal-name")
        annotation.binding.terminalId = terminal.id;
    }
    for (const evidence of clipboard.connectivityEvidence) {
      if (
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "power-marker" &&
        evidence.owner.objectId === instance.id
      )
        evidence.netId = netId;
    }
  }
  return clipboard;
}

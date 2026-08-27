import {
  createReferenceIndex,
  nextReference,
  referencePolicyForInstance,
  referenceSuffixForPolicy,
} from "@icm/devices";
import {
  captureRoutingCopyFragment,
  createRoutingOperationPlan,
  executeTransaction,
  type OperationIdRemap,
  type RoutingOperationPlan,
} from "@icm/edit-engine";
import { translateDraftingObject } from "@icm/edit-engine";
import type { SchematicEdit } from "@icm/edit-engine";
import type {
  Annotation,
  CellNetlistTerminal,
  ConnectivityEvidence,
  DraftingObject,
  Instance,
  Net,
  NoConnect,
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  createRoutePath,
  flattenRichText,
  inverseTransformPoint,
  routeBends,
  routeEnd,
  semanticTextDocument,
  transformPoint,
} from "@icm/model";

import {
  applyOrientationOperations,
  type PlacementOrientationOperation,
} from "../../interaction/shortcut-orientation";

export interface SchematicClipboard {
  instances: Instance[];
  cellTerminals: CellNetlistTerminal[];
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
}

export interface PasteProposal {
  edits: SchematicEdit[];
  instanceIds: string[];
  errors: string[];
  idRemap: OperationIdRemap;
  operationPlan: RoutingOperationPlan;
}

/**
 * Compile the transient copy-placement commands into the same ordered
 * instance edits used by ordinary canvas rotation and reflection.  Keeping
 * every intermediate operation matters: a screen-space reflection can change
 * both the persisted mirror bit and rotation, and that intermediate state is
 * where the Edit Engine follows labels and connected Routes.
 */
export function copyPlacementOrientationEdits(
  instances: readonly Instance[],
  pastedInstanceIds: readonly string[],
  operations: readonly PlacementOrientationOperation[],
): SchematicEdit[] {
  return pastedInstanceIds.flatMap((instanceId, index): SchematicEdit[] => {
    const placement = instances[index]?.placement;
    if (!placement) return [];
    let current = { rotation: placement.rotation, mirror: placement.mirror };
    const edits: SchematicEdit[] = [];
    for (const operation of operations) {
      const next = applyOrientationOperations(current, [operation]);
      if (operation.kind === "reflect") {
        if (next.mirror !== current.mirror) {
          edits.push({
            kind: "mirror_instance",
            instanceId,
            mirror: next.mirror,
          });
        }
        if (next.rotation !== current.rotation) {
          edits.push({
            kind: "rotate_instance",
            instanceId,
            rotation: next.rotation,
          });
        }
      } else if (next.rotation !== current.rotation) {
        edits.push({
          kind: "rotate_instance",
          instanceId,
          rotation: next.rotation,
        });
      }
      current = next;
    }
    return edits;
  });
}

/**
 * Returns the stable local origin used to attach a copied subgraph to the
 * pointer. Prefer an instance origin because it is also the point designers
 * intuitively grab when duplicating a component group.
 */
export function clipboardPlacementAnchor(
  clipboard: SchematicClipboard,
): Point | null {
  const annotation = clipboard.annotations[0];
  const annotationPosition = annotation
    ? annotation.anchor.kind === "free"
      ? annotation.anchor.position
      : annotation.anchor.fallbackPosition
    : null;
  return (
    clipboard.instances.find((instance) => instance.placement)?.placement
      ?.position ??
    clipboard.junctions[0]?.position ??
    (clipboard.routes[0] ? routeBends(clipboard.routes[0])[0] : undefined) ??
    annotationPosition ??
    draftingOrigin(clipboard.draftingObjects[0]) ??
    null
  );
}

/** Where a drafting object sits, for a copy that holds only drawing. */
function draftingOrigin(object: DraftingObject | undefined): Point | null {
  if (!object) return null;
  if (object.kind === "rectangle" || object.kind === "circle") {
    return object.center;
  }
  return object.anchor.kind === "free"
    ? object.anchor.position
    : object.anchor.kind === "object"
      ? object.anchor.fallbackPosition
      : null;
}

/** Builds the isolated fallback copy ghost used when dry-run is unavailable. */
function fallbackClipboardPreviewDocument(
  base: SchematicDocument,
  clipboard: SchematicClipboard,
  offset: Point,
  orientationOperations: readonly PlacementOrientationOperation[] = [],
): SchematicDocument {
  const copiedInstances = new Map(
    clipboard.instances.map((instance) => [instance.id, instance]),
  );
  const annotations = clipboard.annotations.map((annotation) => {
    const preview = structuredClone(annotation);
    if (preview.anchor.kind === "free") {
      preview.anchor.position = movePoint(preview.anchor.position, offset);
    } else if ("fallbackPosition" in preview.anchor) {
      preview.anchor.fallbackPosition = movePoint(
        preview.anchor.fallbackPosition,
        offset,
      );
      if (preview.anchor.kind === "object") {
        const instance = copiedInstances.get(preview.anchor.objectId);
        if (instance?.placement) {
          const nextOrientation = applyOrientationOperations(
            instance.placement,
            orientationOperations,
          );
          // This is the same old-local -> new-world calculation performed by
          // followAttachedAnnotations in the Edit Engine.  Applying the
          // operation to an identity orientation was wrong for already
          // rotated/mirrored copied Symbols.
          preview.anchor.localOffset = transformPoint(
            inverseTransformPoint(
              preview.anchor.localOffset,
              { x: 0, y: 0 },
              instance.placement,
            ),
            { x: 0, y: 0 },
            nextOrientation,
          );
          preview.anchor.fallbackPosition = {
            x:
              instance.placement.position.x +
              offset.x +
              preview.anchor.localOffset.x,
            y:
              instance.placement.position.y +
              offset.y +
              preview.anchor.localOffset.y,
          };
        }
      }
    }
    return preview;
  });
  return {
    ...base,
    instances: clipboard.instances.map((instance) => ({
      ...structuredClone(instance),
      placement: instance.placement
        ? {
            ...instance.placement,
            ...applyOrientationOperations(
              instance.placement,
              orientationOperations,
            ),
            position: movePoint(instance.placement.position, offset),
          }
        : null,
    })),
    nets: structuredClone([
      ...clipboard.nets,
      // Implicit MOS bulk bindings are a Cell policy, not an ordinary copied
      // boundary Wire. Keep their referenced Base Net in the isolated ghost
      // so preview validation matches the eventual add_instance semantics.
      ...base.nets
        .filter(
          (net) =>
            clipboard.instances.some(
              (instance) => instance.mosBulkBinding?.netId === net.id,
            ) && !clipboard.nets.some((copied) => copied.id === net.id),
        )
        .map((net) => ({
          ...net,
          terminals: net.terminals.filter((terminal) =>
            copiedInstances.has(terminal.instanceId),
          ),
        })),
    ]),
    routes: clipboard.routes.map((route) => ({
      ...structuredClone(route),
      legs: route.legs.map((leg) => ({
        ...structuredClone(leg),
        to:
          leg.to.kind === "bend"
            ? {
                ...leg.to,
                position: movePoint(leg.to.position, offset),
              }
            : leg.to,
      })),
    })),
    junctions: clipboard.junctions.map((junction) => ({
      ...structuredClone(junction),
      position: movePoint(junction.position, offset),
    })),
    noConnects: structuredClone(clipboard.noConnects),
    annotations,
    drafting:
      clipboard.draftingObjects.length > 0
        ? { objects: structuredClone(clipboard.draftingObjects) }
        : undefined,
    // A copy ghost is an isolated fragment, not a filtered view of the base
    // Document. Every reference-bearing Document field must therefore be
    // owned explicitly here. Inheriting any of these through `...base` leaves
    // references to objects deliberately omitted from the ghost and makes the
    // renderer reject otherwise valid clipboard content.
    netlist:
      clipboard.cellTerminals.length > 0
        ? {
            name: base.netlist?.name ?? base.name,
            formalParameters: [],
            terminals: structuredClone(clipboard.cellTerminals),
          }
        : undefined,
    mosBulkDefaults: undefined,
    connectivityEvidence: structuredClone(clipboard.connectivityEvidence),
    layoutGroups: [],
    constraints: [],
  };
}

/**
 * Build the copy ghost from the same dry-run transaction as its eventual
 * commit.  The fallback keeps rendering resilient while the Symbol resolver
 * is unavailable during isolated unit callers.
 */
export function clipboardPreviewDocument(
  base: SchematicDocument,
  clipboard: SchematicClipboard,
  offset: Point,
  orientationOperations: readonly PlacementOrientationOperation[] = [],
  resolver?: SymbolResolver,
  sequence = 0,
): SchematicDocument {
  if (resolver) {
    const proposal = proposePaste(base, clipboard, offset, sequence);
    if (proposal.errors.length === 0) {
      const result = executeTransaction(
        base,
        {
          transactionId: "copy-placement-preview",
          documentId: base.id,
          expectedRevision: base.revision,
          actor: { kind: "human", id: "copy-placement-preview" },
          dryRun: true,
          edits: [
            ...proposal.edits,
            ...copyPlacementOrientationEdits(
              clipboard.instances,
              proposal.instanceIds,
              orientationOperations,
            ),
          ],
        },
        { symbolResolver: resolver },
      );
      if (result.ok) {
        const instanceIds = new Set(proposal.instanceIds);
        const routeIds = new Set(Object.values(proposal.idRemap.routes));
        const junctionIds = new Set(Object.values(proposal.idRemap.junctions));
        const annotationIds = new Set(
          Object.values(proposal.idRemap.annotations),
        );
        const evidenceIds = new Set(Object.values(proposal.idRemap.evidence));
        const instances = result.document.instances.filter((instance) =>
          instanceIds.has(instance.id),
        );
        const routes = result.document.routes.filter((route) =>
          routeIds.has(route.id),
        );
        const annotations = result.document.annotations.filter((annotation) =>
          annotationIds.has(annotation.id),
        );
        const cellTerminals =
          result.document.netlist?.terminals.filter((terminal) =>
            terminal.interfaceInstanceIds.some((id) => instanceIds.has(id)),
          ) ?? [];
        const netIds = new Set([
          ...routes.map((route) => route.netId),
          ...annotations.flatMap((annotation) =>
            annotation.netId ? [annotation.netId] : [],
          ),
          ...cellTerminals.map((terminal) => terminal.netId),
          ...result.document.nets.flatMap((net) =>
            net.terminals.some((terminal) =>
              instanceIds.has(terminal.instanceId),
            )
              ? [net.id]
              : [],
          ),
        ]);
        const previewClipboard: SchematicClipboard = structuredClone({
          instances,
          cellTerminals,
          nets: result.document.nets
            .filter((net) => netIds.has(net.id))
            .map((net) => ({
              ...net,
              terminals: net.terminals.filter((terminal) =>
                instanceIds.has(terminal.instanceId),
              ),
            })),
          routes,
          junctions: result.document.junctions.filter((junction) =>
            junctionIds.has(junction.id),
          ),
          annotations,
          noConnects: result.document.noConnects.filter(
            (noConnect) =>
              noConnect.endpoint.kind === "terminal" &&
              instanceIds.has(noConnect.endpoint.instanceId),
          ),
          connectivityEvidence: result.document.connectivityEvidence.filter(
            (evidence) => evidenceIds.has(evidence.id),
          ),
          draftingObjects: [],
        });
        return fallbackClipboardPreviewDocument(
          result.document,
          previewClipboard,
          { x: 0, y: 0 },
        );
      }
    }
  }
  return fallbackClipboardPreviewDocument(
    base,
    clipboard,
    offset,
    orientationOperations,
  );
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
export function copyWholeDocument(
  document: SchematicDocument,
): SchematicClipboard | null {
  if (document.instances.length === 0 && document.routes.length === 0) {
    return null;
  }
  const netIds = new Set<string>([
    ...document.nets.flatMap((net) =>
      net.terminals.length > 0 ? [net.id] : [],
    ),
    ...document.routes.map((route) => route.netId),
    ...document.junctions.map((junction) => junction.netId),
    ...document.annotations.flatMap((annotation) => [
      ...(annotation.netId ? [annotation.netId] : []),
      ...(annotation.binding?.kind === "net-name"
        ? [annotation.binding.netId]
        : []),
    ]),
    ...(document.netlist?.terminals.map((terminal) => terminal.netId) ?? []),
    ...document.instances.flatMap((instance) =>
      instance.mosBulkBinding ? [instance.mosBulkBinding.netId] : [],
    ),
    ...(document.mosBulkDefaults?.nmosNetId
      ? [document.mosBulkDefaults.nmosNetId]
      : []),
    ...(document.mosBulkDefaults?.pmosNetId
      ? [document.mosBulkDefaults.pmosNetId]
      : []),
  ]);
  // Explicit equivalence is an intentional connectivity edge, so retain its
  // complete member set when any member is otherwise reachable.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const evidence of document.connectivityEvidence) {
      if (
        evidence.kind !== "explicit-equivalence" ||
        !evidence.memberNetIds.some((netId) => netIds.has(netId))
      ) {
        continue;
      }
      for (const netId of evidence.memberNetIds) {
        if (netIds.has(netId)) continue;
        netIds.add(netId);
        expanded = true;
      }
    }
  }
  return structuredClone({
    instances: document.instances,
    cellTerminals: document.netlist?.terminals ?? [],
    nets: document.nets.filter((net) => netIds.has(net.id)),
    routes: document.routes,
    junctions: document.junctions,
    annotations: document.annotations,
    noConnects: document.noConnects,
    connectivityEvidence: document.connectivityEvidence.filter((evidence) =>
      evidence.kind === "explicit-equivalence"
        ? evidence.memberNetIds.every((netId) => netIds.has(netId))
        : netIds.has(evidence.netId),
    ),
    draftingObjects: [],
  });
}

export function copySelection(
  document: SchematicDocument,
  instanceIds: readonly string[],
  draftingIds: readonly string[] = [],
): SchematicClipboard | null {
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
  if (instances.length === 0 && draftingObjects.length === 0) return null;
  const capture = captureRoutingCopyFragment(document, {
    instanceIds,
    routeIds: [],
    junctionIds: [],
  });
  const netIds = new Set(capture.clonedNetIds);
  const internalNetIds = new Set(capture.internalNetIds);
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
      (annotation.netId !== undefined && attachedIds.has(annotation.netId)) ||
      (annotation.anchor.kind === "object" &&
        attachedIds.has(annotation.anchor.objectId)) ||
      (annotation.anchor.kind === "route" &&
        routeIds.has(annotation.anchor.routeId)),
  );
  const annotationIds = new Set(annotations.map((annotation) => annotation.id));
  return structuredClone({
    instances,
    cellTerminals:
      document.netlist?.terminals.flatMap((terminal) => {
        const interfaceInstanceIds = terminal.interfaceInstanceIds.filter(
          (instanceId) => selectedIds.has(instanceId),
        );
        return interfaceInstanceIds.length > 0
          ? [{ ...terminal, interfaceInstanceIds }]
          : [];
      }) ?? [],
    nets: document.nets
      .filter((net) => netIds.has(net.id))
      .map((net) => ({
        ...net,
        // Owner-retained boundary Nets become a new physical Base Net around
        // the copied owner. Ordinary boundary terminals remain disconnected.
        terminals: internalNetIds.has(net.id)
          ? net.terminals
          : net.terminals.filter((terminal) =>
              selectedIds.has(terminal.instanceId),
            ),
      })),
    routes: document.routes.filter((route) => routeIds.has(route.id)),
    junctions: document.junctions.filter((junction) =>
      junctionIds.has(junction.id),
    ),
    annotations,
    noConnects: document.noConnects.filter(
      (noConnect) =>
        noConnect.endpoint.kind === "terminal" &&
        selectedIds.has(noConnect.endpoint.instanceId),
    ),
    connectivityEvidence: document.connectivityEvidence.filter((evidence) => {
      if (evidence.kind === "explicit-equivalence") {
        return evidence.memberNetIds.every((netId) => netIds.has(netId));
      }
      if (!netIds.has(evidence.netId)) return false;
      if (evidence.kind !== "name-claim") return true;
      switch (evidence.owner.kind) {
        case "explicit-net-property":
          return true;
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
  });
}

function uniqueCopyId(
  sourceId: string,
  sequence: number,
  occupied: Set<string>,
): string {
  let candidate = `${sourceId}-copy-${sequence}`;
  let collision = 1;
  while (occupied.has(candidate)) {
    collision += 1;
    candidate = `${sourceId}-copy-${sequence}-${collision}`;
  }
  occupied.add(candidate);
  return candidate;
}

/**
 * A pasted instance receives a fresh electrical designator while its internal
 * object ID remains independently stable. Legacy projects often used the same
 * string for both, so preserve that convenient convention only when it does
 * not collide; presentation bindings are rewritten separately below.
 */
function pastedInstanceId(
  source: Instance,
  nextReference: string | undefined,
  sequence: number,
  occupied: Set<string>,
): string {
  if (
    nextReference !== undefined &&
    source.id === source.netlist?.reference &&
    !occupied.has(nextReference)
  ) {
    occupied.add(nextReference);
    return nextReference;
  }
  return uniqueCopyId(source.id, sequence, occupied);
}

/**
 * Allocate the copied schematic reference independently while preserving the
 * common case where schematic and emitted references intentionally agree.
 */
function pastedSchematicReference(
  source: Instance,
  nextNetlistReference: string | undefined,
  sequence: number,
  reserved: Set<string>,
): string | undefined {
  const current = source.schematicReference;
  if (!current) return undefined;
  // Only a freshly allocated netlist reference may be adopted verbatim.
  // Falling back to the pasted object id was wrong for a device with no
  // netlist block — an ideal switch, say — because that id is a copy id, so
  // "X1" came back onto the canvas reading "X1-copy-3". Those instances now
  // fall through to the sequence below and get an ordinary next designator.
  const synchronized =
    nextNetlistReference &&
    (current === source.netlist?.reference || current === source.id)
      ? nextNetlistReference
      : undefined;
  if (synchronized) {
    reserved.add(synchronized.toLowerCase());
    return synchronized;
  }

  const suffix = /^(.*?)(\d+)$/u.exec(current);
  const prefix = suffix?.[1] || `${current}-copy-`;
  let index = suffix ? Number(suffix[2]) + 1 : sequence;
  const candidateFor = (value: number): string => {
    const digits = String(value);
    return `${prefix.slice(0, Math.max(1, 128 - digits.length))}${digits}`;
  };
  let candidate = candidateFor(index);
  while (reserved.has(candidate.toLowerCase())) {
    index += 1;
    candidate = candidateFor(index);
  }
  reserved.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Rewrites a pasted instance-label whose text is still the copied reference
 * (or copied id) to the new reference, so a pasted R1 reads R2 on canvas.
 * The replacement content is rebuilt exactly like a freshly placed label
 * (semantic base + subscript runs). Hand-edited label text is preserved
 * verbatim.
 */
function rewriteInstanceLabelText(
  annotation: Annotation,
  source: Instance | undefined,
  nextId: string,
  nextReference: string | undefined,
): void {
  if (
    source === undefined ||
    annotation.kind !== "instance-label" ||
    annotation.anchor.kind !== "object"
  ) {
    return;
  }
  if (annotation.binding?.kind === "instance-designator") {
    annotation.binding = { kind: "instance-designator", instanceId: nextId };
    return;
  }
  if (!annotation.content) return;
  const plain = flattenRichText(annotation.content);
  if (
    plain !== source.id &&
    (source.netlist === undefined || plain !== source.netlist.reference)
  ) {
    return;
  }
  annotation.content = semanticTextDocument(
    nextReference ?? nextId,
    "instance-label",
  );
}

function movePoint(point: Point, offset: Point): Point {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function mapEndpoint(
  endpoint: RouteEndpoint,
  instanceIds: ReadonlyMap<string, string>,
  junctionIds: ReadonlyMap<string, string>,
): RouteEndpoint {
  switch (endpoint.kind) {
    case "terminal":
      return {
        ...endpoint,
        instanceId: instanceIds.get(endpoint.instanceId) ?? endpoint.instanceId,
      };
    case "junction":
      return {
        ...endpoint,
        junctionId: junctionIds.get(endpoint.junctionId) ?? endpoint.junctionId,
      };
  }
}

export function proposePaste(
  document: SchematicDocument,
  clipboard: SchematicClipboard,
  offset: Point,
  sequence: number,
): PasteProposal {
  const occupied = new Set<string>(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.layoutGroups,
      ...document.constraints,
      ...document.connectivityEvidence,
      ...(document.netlist?.terminals ?? []),
    ].map((object) => object.id),
  );
  const referenceIndex = createReferenceIndex(document);
  const reservedReferences = new Set<string>();
  const occupiedReferences = new Set(
    document.instances.flatMap((instance) =>
      instance.netlist ? [instance.netlist.reference.toLowerCase()] : [],
    ),
  );
  /**
   * Schematic-only markers (ground, power ports) carry a netlist reference
   * without a device reference policy, so the policy-driven allocator above
   * cannot renumber them. Their references are still unique per Document, so
   * pasting one has to claim the next free ordinal of its own prefix.
   */
  const nextMarkerReference = (current: string): string | undefined => {
    const parsed = /^(.*?)(\d+)$/u.exec(current);
    if (!parsed) return undefined;
    const prefix = parsed[1]!;
    for (
      let suffix = Number(parsed[2]);
      suffix < Number(parsed[2]) + 1000;
      suffix += 1
    ) {
      const candidate = `${prefix}${suffix}`;
      const folded = candidate.toLowerCase();
      if (occupiedReferences.has(folded) || reservedReferences.has(folded)) {
        continue;
      }
      return candidate;
    }
    return undefined;
  };
  const instanceReferences = new Map(
    clipboard.instances.flatMap((instance) => {
      if (!instance.netlist) return [];
      const policy = referencePolicyForInstance(instance);
      if (policy.kind === "none") {
        const reference = nextMarkerReference(instance.netlist.reference);
        if (!reference) return [];
        reservedReferences.add(reference.toLowerCase());
        return [[instance.id, reference] as const];
      }
      const sourceSuffix = referenceSuffixForPolicy(
        instance.netlist.reference,
        policy,
      );
      const reference = nextReference(referenceIndex, policy, {
        ...(sourceSuffix !== null ? { startAt: sourceSuffix + 1 } : {}),
        reservedReferences,
      });
      if (!reference) return [];
      reservedReferences.add(reference.toLowerCase());
      return [[instance.id, reference] as const];
    }),
  );
  const instanceIds = new Map(
    clipboard.instances.map((instance) => [
      instance.id,
      pastedInstanceId(
        instance,
        instanceReferences.get(instance.id),
        sequence,
        occupied,
      ),
    ]),
  );
  const reservedSchematicReferences = new Set([
    ...document.instances.flatMap((instance) =>
      [instance.schematicReference, instance.netlist?.reference]
        .filter((reference): reference is string => reference !== undefined)
        .map((reference) => reference.toLowerCase()),
    ),
    ...[...instanceReferences.values()].map((reference) =>
      reference.toLowerCase(),
    ),
  ]);
  const instanceSchematicReferences = new Map(
    clipboard.instances.flatMap((instance) => {
      const reference = pastedSchematicReference(
        instance,
        instanceReferences.get(instance.id),
        sequence,
        reservedSchematicReferences,
      );
      return reference ? [[instance.id, reference] as const] : [];
    }),
  );
  const routeIds = new Map(
    clipboard.routes.map((route) => [
      route.id,
      uniqueCopyId(route.id, sequence, occupied),
    ]),
  );
  const junctionIds = new Map(
    clipboard.junctions.map((junction) => [
      junction.id,
      uniqueCopyId(junction.id, sequence, occupied),
    ]),
  );
  const netIds = new Map<string, string>();
  const noConnectIds = new Map(
    clipboard.noConnects.map((noConnect) => [
      noConnect.id,
      uniqueCopyId(noConnect.id, sequence, occupied),
    ]),
  );
  const annotationIds = new Map(
    clipboard.annotations.map((annotation) => [
      annotation.id,
      uniqueCopyId(annotation.id, sequence, occupied),
    ]),
  );
  const evidenceIds = new Map(
    clipboard.connectivityEvidence.map((evidence) => [
      evidence.id,
      uniqueCopyId(evidence.id, sequence, occupied),
    ]),
  );
  const errors: string[] = [];
  const terminalIds = new Map(
    clipboard.cellTerminals.map((terminal) => [
      terminal.id,
      uniqueCopyId(terminal.id, sequence, occupied),
    ]),
  );
  for (const net of clipboard.nets) {
    netIds.set(net.id, uniqueCopyId(net.id, sequence, occupied));
  }
  const objectIds = new Map<string, string>([
    ...instanceIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
  ]);
  const edits: SchematicEdit[] = clipboard.instances.map(
    (instance): SchematicEdit => ({
      kind: "add_instance",
      instance: {
        ...structuredClone(instance),
        id: instanceIds.get(instance.id)!,
        ...(instanceSchematicReferences.has(instance.id)
          ? {
              schematicReference: instanceSchematicReferences.get(instance.id)!,
            }
          : {}),
        ...(instance.netlist && instanceReferences.has(instance.id)
          ? {
              netlist: {
                ...structuredClone(instance.netlist),
                reference: instanceReferences.get(instance.id)!,
              },
            }
          : {}),
        ...(instance.mosBulkBinding
          ? {
              mosBulkBinding: {
                ...instance.mosBulkBinding,
                netId:
                  netIds.get(instance.mosBulkBinding.netId) ??
                  instance.mosBulkBinding.netId,
              },
            }
          : {}),
        placement: instance.placement
          ? {
              ...instance.placement,
              position: movePoint(instance.placement.position, offset),
            }
          : null,
      },
    }),
  );

  for (const terminal of clipboard.cellTerminals) {
    const copiedMarkerIds = terminal.interfaceInstanceIds.flatMap(
      (instanceId) => {
        const copiedId = instanceIds.get(instanceId);
        return copiedId ? [copiedId] : [];
      },
    );
    if (copiedMarkerIds.length === 0) continue;
    edits.push({
      kind: "add_cell_terminal",
      terminal: {
        ...terminal,
        id: terminalIds.get(terminal.id)!,
        netId: netIds.get(terminal.netId) ?? terminal.netId,
        interfaceInstanceIds: copiedMarkerIds,
      },
    });
  }

  for (const net of clipboard.nets) {
    const mappedTerminals = net.terminals.map((terminal): RouteEndpoint => ({
      kind: "terminal",
      instanceId: instanceIds.get(terminal.instanceId)!,
      pinName: terminal.pinName,
    }));
    const netId = netIds.get(net.id)!;
    if (mappedTerminals[0]) {
      edits.push({
        kind: "connect_endpoints",
        from: mappedTerminals[0],
        to: mappedTerminals[1] ?? mappedTerminals[0],
        newNetId: netId,
      });
      for (const terminal of mappedTerminals.slice(2)) {
        edits.push({
          kind: "connect_endpoints",
          from: mappedTerminals[0],
          to: terminal,
        });
      }
    }
  }
  // An implicit MOS bulk binding is a Cell policy, not a copied boundary
  // Wire. Re-materialize that one declared policy connection explicitly;
  // ordinary boundary terminals never enter this loop.
  for (const instance of clipboard.instances) {
    const binding = instance.mosBulkBinding;
    if (!binding || netIds.has(binding.netId)) continue;
    const sourceNet = document.nets.find((net) => net.id === binding.netId);
    const sourceBulk = sourceNet?.terminals.find(
      (terminal) => terminal.instanceId === instance.id,
    );
    const anchor = sourceNet?.terminals[0];
    const copiedInstanceId = instanceIds.get(instance.id);
    if (!sourceBulk || !anchor || !copiedInstanceId) {
      errors.push(
        `Cannot copy implicit bulk policy for ${instance.id}: ${binding.netId} is unavailable`,
      );
      continue;
    }
    edits.push({
      kind: "connect_endpoints",
      from: { kind: "terminal", ...anchor },
      to: {
        kind: "terminal",
        instanceId: copiedInstanceId,
        pinName: sourceBulk.pinName,
      },
    });
  }
  edits.push(
    ...clipboard.noConnects.map((noConnect): SchematicEdit => {
      if (noConnect.endpoint.kind !== "terminal") {
        throw new Error("Clipboard NoConnect must target a copied terminal");
      }
      return {
        kind: "add_no_connect",
        noConnect: {
          id: noConnectIds.get(noConnect.id)!,
          endpoint: {
            kind: "terminal",
            instanceId: instanceIds.get(noConnect.endpoint.instanceId)!,
            pinName: noConnect.endpoint.pinName,
          },
        },
      };
    }),
  );
  const availableNetIds = new Set([
    ...document.nets.map((net) => net.id),
    ...clipboard.nets
      .filter((net) => net.terminals.length > 0)
      .map((net) => netIds.get(net.id)!),
  ]);
  edits.push(
    ...clipboard.junctions.map((junction): SchematicEdit => {
      const netId = netIds.get(junction.netId)!;
      const createNet = !availableNetIds.has(netId);
      availableNetIds.add(netId);
      return {
        kind: "add_junction",
        junctionId: junctionIds.get(junction.id)!,
        netId,
        position: movePoint(junction.position, offset),
        ...(createNet ? { createNet: true } : {}),
      };
    }),
  );
  // Name/source evidence must exist before a copied power-rail Route is
  // validated. Owners may be added later in the same atomic transaction; the
  // final Document validator checks their complete lifecycle closure.
  edits.push(
    ...clipboard.connectivityEvidence.map((evidence): SchematicEdit => {
      const clone = structuredClone(evidence);
      clone.id = evidenceIds.get(evidence.id)!;
      if (clone.kind === "explicit-equivalence") {
        clone.memberNetIds = clone.memberNetIds.map(
          (netId) => netIds.get(netId) ?? netId,
        );
      } else {
        clone.netId = netIds.get(clone.netId) ?? clone.netId;
        if (clone.kind === "name-claim") {
          switch (clone.owner.kind) {
            case "net-label":
              clone.owner.annotationId =
                annotationIds.get(clone.owner.annotationId) ??
                clone.owner.annotationId;
              break;
            case "power-marker":
              clone.owner.objectId =
                objectIds.get(clone.owner.objectId) ??
                annotationIds.get(clone.owner.objectId) ??
                clone.owner.objectId;
              break;
            case "explicit-net-property":
              break;
          }
        }
      }
      return { kind: "upsert_connectivity_evidence", evidence: clone };
    }),
  );
  edits.push(
    ...clipboard.routes.map((route): SchematicEdit => ({
      kind: "set_route_path",
      route: createRoutePath({
        id: routeIds.get(route.id)!,
        netId: netIds.get(route.netId)!,
        start: mapEndpoint(route.start, instanceIds, junctionIds),
        end: mapEndpoint(routeEnd(route), instanceIds, junctionIds),
        bends: routeBends(route).map((point) => movePoint(point, offset)),
        modes: route.legs.map((leg) => leg.mode),
        ...(route.presentation ? { presentation: route.presentation } : {}),
      }),
    })),
  );
  const sourceInstancesById = new Map(
    clipboard.instances.map((instance) => [instance.id, instance]),
  );
  edits.push(
    ...clipboard.annotations.map((annotation): SchematicEdit => {
      const clone = structuredClone(annotation);
      if (clone.anchor.kind === "object") {
        rewriteInstanceLabelText(
          clone,
          sourceInstancesById.get(clone.anchor.objectId),
          objectIds.get(clone.anchor.objectId) ?? clone.anchor.objectId,
          instanceReferences.get(clone.anchor.objectId),
        );
      }
      return {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...clone,
          id: annotationIds.get(annotation.id)!,
          ...(clone.binding?.kind === "net-name"
            ? {
                binding: {
                  kind: "net-name" as const,
                  netId: netIds.get(clone.binding.netId) ?? clone.binding.netId,
                },
              }
            : clone.binding?.kind === "cell-terminal-name"
              ? {
                  binding: {
                    kind: "cell-terminal-name" as const,
                    terminalId:
                      terminalIds.get(clone.binding.terminalId) ??
                      clone.binding.terminalId,
                  },
                }
              : clone.binding?.kind === "instance-value" ||
                  clone.binding?.kind === "instance-designator" ||
                  clone.binding?.kind === "instance-schematic-name" ||
                  clone.binding?.kind === "instance-master-name"
                ? {
                    binding: {
                      kind: clone.binding.kind,
                      instanceId:
                        objectIds.get(clone.binding.instanceId) ??
                        clone.binding.instanceId,
                    },
                  }
                : {}),
          ...(annotation.netId
            ? { netId: netIds.get(annotation.netId) ?? annotation.netId }
            : {}),
          anchor:
            annotation.anchor.kind === "free"
              ? {
                  kind: "free",
                  position: movePoint(annotation.anchor.position, offset),
                }
              : annotation.anchor.kind === "object"
                ? {
                    ...annotation.anchor,
                    objectId:
                      objectIds.get(annotation.anchor.objectId) ??
                      annotation.anchor.objectId,
                    fallbackPosition: movePoint(
                      annotation.anchor.fallbackPosition,
                      offset,
                    ),
                  }
                : {
                    ...annotation.anchor,
                    routeId:
                      routeIds.get(annotation.anchor.routeId) ??
                      annotation.anchor.routeId,
                    fallbackPosition: movePoint(
                      annotation.anchor.fallbackPosition,
                      offset,
                    ),
                  },
        },
      };
    }),
  );
  const clonedRoutesBySource = new Map(
    clipboard.routes.flatMap((source) => {
      const clonedId = routeIds.get(source.id);
      const edit = edits.find(
        (candidate) =>
          candidate.kind === "set_route_path" &&
          candidate.route.id === clonedId,
      );
      return edit?.kind === "set_route_path"
        ? [[source, edit.route] as const]
        : [];
    }),
  );
  const idRemap: OperationIdRemap = {
    instances: Object.fromEntries(instanceIds),
    nets: Object.fromEntries(netIds),
    routes: Object.fromEntries(routeIds),
    legs: Object.fromEntries(
      [...clonedRoutesBySource].flatMap(([source, clone]) =>
        source.legs.map((leg, index) => [leg.id, clone.legs[index]!.id]),
      ),
    ),
    bends: Object.fromEntries(
      [...clonedRoutesBySource].flatMap(([source, clone]) =>
        source.legs.flatMap((leg, index) => {
          const target = clone.legs[index]?.to;
          return leg.to.kind === "bend" && target?.kind === "bend"
            ? [[leg.to.bendId, target.bendId] as const]
            : [];
        }),
      ),
    ),
    junctions: Object.fromEntries(junctionIds),
    annotations: Object.fromEntries(annotationIds),
    evidence: Object.fromEntries(evidenceIds),
  };
  const operationPlan = createRoutingOperationPlan(document, {
    intent: "clone",
    affected: {
      instances: clipboard.instances.map((item) => item.id),
      internalRoutes: clipboard.routes.map((item) => item.id),
      boundaryRoutes: [],
      externalRoutes: [],
      internalJunctions: clipboard.junctions.map((item) => item.id),
      boundaryJunctions: [],
      electricalAnnotationIds: clipboard.annotations.map((item) => item.id),
      protectedObjectIds: [],
    },
    expectedElectricalEffect: {
      kind: "clone",
      mapping: idRemap.instances,
      boundaryPolicy: "disconnect",
    },
    idRemap,
    edits,
    diagnostics: errors.map((message) => ({
      code: "ROUTING_CLONE_SOURCE_UNAVAILABLE",
      severity: "error" as const,
      message,
    })),
  });
  // Drafting objects carry no connectivity, so a copy is the object itself
  // under a fresh id, shifted by the same placement offset as everything else.
  for (const object of clipboard.draftingObjects) {
    edits.push({
      kind: "upsert_drafting_object",
      object: {
        ...translateDraftingObject(object, offset, document.presentation.grid),
        id: uniqueCopyId(object.id, sequence, occupied),
      },
    });
  }

  return {
    edits,
    instanceIds: [...instanceIds.values()],
    errors,
    idRemap,
    operationPlan,
  };
}

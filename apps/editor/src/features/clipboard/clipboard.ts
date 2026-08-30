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
  LayoutGroup,
  Net,
  NoConnect,
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
  VisualAnchor,
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
  /** Layout groups wholly contained in the copied drafting selection. */
  draftingGroups: LayoutGroup[];
}

export interface PasteProposal {
  edits: SchematicEdit[];
  instanceIds: string[];
  errors: string[];
  idRemap: OperationIdRemap;
  operationPlan: RoutingOperationPlan;
}

/** Electrical objects the person explicitly included in the visual selection. */
export interface ExplicitCopyRoutingSelection {
  routeIds: readonly string[];
  junctionIds: readonly string[];
  annotationIds: readonly string[];
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
 * Turn or reflect the copied subgraph as ONE rigid body about the placement
 * anchor, exactly like the canvas group transform: positions, wire bends,
 * junctions, and annotations orbit together while each part also changes its
 * own orientation. R / Shift+R during copy placement previously spun every
 * part in place and left positions and wires untouched, which scrambled the
 * ghost and the stamped result.
 */
export function orientClipboard(
  clipboard: SchematicClipboard,
  operations: readonly PlacementOrientationOperation[],
  pivot?: Point,
): SchematicClipboard {
  if (operations.length === 0) return clipboard;
  const anchor = pivot ?? clipboardPlacementAnchor(clipboard) ?? { x: 0, y: 0 };
  const mapPoint = (point: Point): Point =>
    operations.reduce((current, operation) => {
      if (operation.kind === "reflect") {
        return operation.direction === "left-right"
          ? { x: 2 * anchor.x - current.x, y: current.y }
          : { x: current.x, y: 2 * anchor.y - current.y };
      }
      const dx = current.x - anchor.x;
      const dy = current.y - anchor.y;
      return operation.deltaDegrees === 90
        ? { x: anchor.x - dy, y: anchor.y + dx }
        : { x: anchor.x + dy, y: anchor.y - dx };
    }, point);
  const mapVector = (vector: Point): Point => {
    const mapped = mapPoint({ x: anchor.x + vector.x, y: anchor.y + vector.y });
    return { x: mapped.x - anchor.x, y: mapped.y - anchor.y };
  };
  const flipsWorldX = mapVector({ x: 1, y: 0 }).x < 0;
  return {
    ...clipboard,
    instances: clipboard.instances.map((instance) => ({
      ...structuredClone(instance),
      placement: instance.placement
        ? {
            ...applyOrientationOperations(instance.placement, operations),
            position: mapPoint(instance.placement.position),
          }
        : null,
    })),
    routes: clipboard.routes.map((route) => ({
      ...structuredClone(route),
      legs: route.legs.map((leg) => ({
        ...structuredClone(leg),
        to:
          leg.to.kind === "bend"
            ? { ...leg.to, position: mapPoint(leg.to.position) }
            : leg.to,
      })),
    })),
    junctions: clipboard.junctions.map((junction) => ({
      ...structuredClone(junction),
      position: mapPoint(junction.position),
    })),
    annotations: clipboard.annotations.map((annotation) => {
      const clone = structuredClone(annotation);
      if (clone.anchor.kind === "free") {
        clone.anchor.position = mapPoint(clone.anchor.position);
      } else if (clone.anchor.kind === "object") {
        clone.anchor.localOffset = mapVector(clone.anchor.localOffset);
        clone.anchor.fallbackPosition = mapPoint(clone.anchor.fallbackPosition);
      } else {
        clone.anchor.fallbackPosition = mapPoint(clone.anchor.fallbackPosition);
      }
      // Upright text never mirrors as glyphs: when the body flips the world
      // x-axis the anchor swaps sides, so the extent direction swaps too.
      if (flipsWorldX && clone.alignment !== "middle") {
        clone.alignment = clone.alignment === "start" ? "end" : "start";
      }
      return clone;
    }),
    // Drafting objects are part of the same rigid body: their anchors and
    // kind-specific geometry orbit the anchor exactly like routes and
    // junctions do, or a rotated paste tears the group apart.
    draftingObjects: clipboard.draftingObjects.map((object) => {
      const clone = structuredClone(object);
      const mapAnchor = (anchor: typeof clone.anchor): typeof clone.anchor => {
        if (anchor.kind === "free") {
          return { ...anchor, position: mapPoint(anchor.position) };
        }
        if (anchor.kind === "object") {
          return {
            ...anchor,
            localOffset: mapVector(anchor.localOffset),
            fallbackPosition: mapPoint(anchor.fallbackPosition),
          };
        }
        return {
          ...anchor,
          fallbackPosition: mapPoint(anchor.fallbackPosition),
        };
      };
      const mappedAngle = (degrees: number): number => {
        const radians = (degrees * Math.PI) / 180;
        const turned = mapVector({
          x: Math.cos(radians),
          y: Math.sin(radians),
        });
        const next = (Math.atan2(turned.y, turned.x) * 180) / Math.PI;
        const normalized = ((next % 360) + 360) % 360;
        // Quarter turns and mirrors keep the angle exact in real math; only
        // strip the trig float dust, never a genuinely fractional angle.
        return Math.abs(normalized - Math.round(normalized)) < 1e-9
          ? Math.round(normalized) % 360
          : normalized;
      };
      const quarterTurns = operations.reduce(
        (total, operation) =>
          operation.kind === "rotate"
            ? (((total + operation.deltaDegrees / 90) % 4) + 4) % 4
            : total,
        0,
      );
      const turnedRotation = (
        rotation: 0 | 90 | 180 | 270,
      ): 0 | 90 | 180 | 270 =>
        (((rotation / 90 + quarterTurns) % 4) * 90) as 0 | 90 | 180 | 270;
      clone.anchor = mapAnchor(clone.anchor);
      switch (clone.kind) {
        case "text": {
          clone.rotation = turnedRotation(clone.rotation);
          if (flipsWorldX && clone.alignment !== "middle") {
            clone.alignment = clone.alignment === "start" ? "end" : "start";
          }
          break;
        }
        case "callout": {
          clone.rotation = turnedRotation(clone.rotation);
          clone.target = mapAnchor(clone.target);
          if (flipsWorldX && clone.alignment !== "middle") {
            clone.alignment = clone.alignment === "start" ? "end" : "start";
          }
          break;
        }
        case "leader": {
          clone.target = mapAnchor(clone.target);
          break;
        }
        case "arrow": {
          clone.from = mapAnchor(clone.from);
          clone.to = mapAnchor(clone.to);
          if (clone.waypoints) clone.waypoints = clone.waypoints.map(mapPoint);
          if (clone.curveControls) {
            clone.curveControls = clone.curveControls.map((control) =>
              control ? mapPoint(control) : control,
            );
          }
          break;
        }
        case "construction-line": {
          clone.points = clone.points.map(mapPoint);
          if (clone.curveControls) {
            clone.curveControls = clone.curveControls.map((control) =>
              control ? mapPoint(control) : control,
            );
          }
          break;
        }
        case "rectangle": {
          clone.center = mapPoint(clone.center);
          clone.rotation = mappedAngle(clone.rotation);
          break;
        }
        case "circle": {
          clone.center = mapPoint(clone.center);
          break;
        }
        case "floating-symbol": {
          clone.transform = applyOrientationOperations(
            clone.transform,
            operations,
          );
          break;
        }
      }
      return clone;
    }),
  };
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
          // The clipboard arrives pre-oriented (orientClipboard); only the
          // translation to the pointer remains.
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
    layoutGroups: structuredClone(clipboard.draftingGroups),
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
  const oriented = orientClipboard(clipboard, orientationOperations);
  if (resolver) {
    const proposal = proposePaste(base, oriented, offset, sequence);
    if (proposal.errors.length === 0) {
      const result = executeTransaction(
        base,
        {
          transactionId: "copy-placement-preview",
          documentId: base.id,
          expectedRevision: base.revision,
          actor: { kind: "human", id: "copy-placement-preview" },
          dryRun: true,
          edits: [...proposal.edits],
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
        const draftingIds = new Set(
          proposal.edits.flatMap((edit) =>
            edit.kind === "upsert_drafting_object" ? [edit.object.id] : [],
          ),
        );
        const layoutGroupIds = new Set(
          proposal.edits.flatMap((edit) =>
            edit.kind === "set_layout_group" ? [edit.group.id] : [],
          ),
        );
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
          draftingObjects: (result.document.drafting?.objects ?? []).filter(
            (object) => draftingIds.has(object.id),
          ),
          draftingGroups: result.document.layoutGroups.filter((group) =>
            layoutGroupIds.has(group.id),
          ),
        });
        return fallbackClipboardPreviewDocument(
          result.document,
          previewClipboard,
          { x: 0, y: 0 },
        );
      }
    }
  }
  return fallbackClipboardPreviewDocument(base, oriented, offset);
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
  const draftingObjects = document.drafting?.objects ?? [];
  if (
    document.instances.length === 0 &&
    document.routes.length === 0 &&
    draftingObjects.length === 0
  ) {
    return null;
  }
  const draftingIds = new Set(draftingObjects.map((object) => object.id));
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
    draftingObjects,
    draftingGroups: document.layoutGroups.filter(
      (group) =>
        group.objectIds.length > 0 &&
        group.objectIds.every((objectId) => draftingIds.has(objectId)),
    ),
  });
}

export function copySelection(
  document: SchematicDocument,
  instanceIds: readonly string[],
  draftingIds: readonly string[] = [],
  routingSelection?: ExplicitCopyRoutingSelection,
): SchematicClipboard | null {
  const selectedIds = new Set(instanceIds);
  const instances = document.instances.filter((instance) =>
    selectedIds.has(instance.id),
  );
  const selectedDrafting = new Set(draftingIds);
  const draftingObjects = (document.drafting?.objects ?? []).filter((object) =>
    selectedDrafting.has(object.id),
  );
  const draftingGroups = document.layoutGroups.filter(
    (group) =>
      group.objectIds.length > 0 &&
      group.objectIds.every((objectId) => selectedDrafting.has(objectId)),
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
      // Supplying the visual routing selection is an explicit copy contract:
      // only those Routes travel. Legacy/programmatic callers that omit it
      // retain connected-subgraph capture.
      includeImplicitInstanceRoutes: routingSelection === undefined,
    },
  );
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
        // Only terminals whose instance is actually copied travel: an
        // explicitly selected Route promotes its whole net to internal, but
        // that net can still land on instances outside the copy, and their
        // terminals would map to nothing at paste time.
        terminals: net.terminals.filter((terminal) =>
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
    draftingGroups,
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

function remapPastedVisualAnchor(
  anchor: VisualAnchor,
  objectIds: ReadonlyMap<string, string>,
  routeIds: ReadonlyMap<string, string>,
  legIds: ReadonlyMap<string, string>,
  offset: Point,
  translateFree = false,
): VisualAnchor {
  if (anchor.kind === "free") {
    return translateFree
      ? { ...anchor, position: movePoint(anchor.position, offset) }
      : anchor;
  }
  if (anchor.kind === "object") {
    return {
      ...anchor,
      objectId: objectIds.get(anchor.objectId) ?? anchor.objectId,
      fallbackPosition: movePoint(anchor.fallbackPosition, offset),
    };
  }
  return {
    ...anchor,
    routeId: routeIds.get(anchor.routeId) ?? anchor.routeId,
    legId: legIds.get(anchor.legId) ?? anchor.legId,
    fallbackPosition: movePoint(anchor.fallbackPosition, offset),
  };
}

function remapPastedDraftingAnchors(
  object: DraftingObject,
  objectIds: ReadonlyMap<string, string>,
  routeIds: ReadonlyMap<string, string>,
  legIds: ReadonlyMap<string, string>,
  offset: Point,
): DraftingObject {
  const clone = structuredClone(object);
  const remap = (anchor: VisualAnchor): VisualAnchor =>
    remapPastedVisualAnchor(anchor, objectIds, routeIds, legIds, offset);
  clone.anchor = remap(clone.anchor);
  if (clone.kind === "arrow") {
    clone.from = remap(clone.from);
    clone.to = remap(clone.to);
  } else if (clone.kind === "leader" || clone.kind === "callout") {
    // translateDraftingObject moves the primary anchor, while the leader tip
    // is independent geometry and still needs the paste offset here.
    clone.target = remapPastedVisualAnchor(
      clone.target,
      objectIds,
      routeIds,
      legIds,
      offset,
      true,
    );
  }
  return clone;
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
      ...(document.drafting?.objects ?? []),
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
  for (const junction of clipboard.junctions) {
    // A junction can arrive without its net (a junction-only marquee copy
    // clones no internal Route, so the net is never cloned): the paste
    // creates a fresh net for it instead of emitting an undefined netId.
    if (!netIds.has(junction.netId)) {
      netIds.set(
        junction.netId,
        uniqueCopyId(junction.netId, sequence, occupied),
      );
    }
  }
  const objectIds = new Map<string, string>([
    ...instanceIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
  ]);
  const draftingIds = new Map(
    clipboard.draftingObjects.map((object) => [
      object.id,
      uniqueCopyId(object.id, sequence, occupied),
    ]),
  );
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
    const mappedTerminals = net.terminals.flatMap(
      (terminal): RouteEndpoint[] => {
        const instanceId = instanceIds.get(terminal.instanceId);
        if (!instanceId) {
          // Legacy clipboards could carry terminals of uncopied instances;
          // surface a plan-time error instead of a raw schema rejection.
          errors.push(`Unknown terminal instance: ${terminal.instanceId}`);
          return [];
        }
        return [{ kind: "terminal", instanceId, pinName: terminal.pinName }];
      },
    );
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
        ...(route.styleOverride
          ? { styleOverride: structuredClone(route.styleOverride) }
          : {}),
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
  const pastedAnchorObjectIds = new Map([...objectIds, ...draftingIds]);
  const pastedLegIds = new Map(Object.entries(idRemap.legs));
  for (const object of clipboard.draftingObjects) {
    const id = draftingIds.get(object.id)!;
    const translated = translateDraftingObject(
      object,
      offset,
      document.presentation.grid,
    );
    edits.push({
      kind: "upsert_drafting_object",
      object: {
        ...remapPastedDraftingAnchors(
          translated,
          pastedAnchorObjectIds,
          routeIds,
          pastedLegIds,
          offset,
        ),
        id,
      },
    });
  }
  for (const group of clipboard.draftingGroups) {
    const objectIds = group.objectIds.flatMap((objectId) => {
      const mapped = draftingIds.get(objectId);
      return mapped ? [mapped] : [];
    });
    if (objectIds.length === 0) continue;
    edits.push({
      kind: "set_layout_group",
      group: {
        ...structuredClone(group),
        id: uniqueCopyId(group.id, sequence, occupied),
        objectIds,
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

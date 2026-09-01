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
  gridAlignmentDiagnostics,
  type OperationIdRemap,
  type RoutingOperationPlan,
} from "@icm/edit-engine";
import { resolveMosBulkConnection } from "@icm/derived";
import { translateDraftingObject } from "@icm/edit-engine";
import type { SchematicEdit } from "@icm/edit-engine";
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
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
  VisualAnchor,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  createRoutePath,
  inverseTransformPoint,
  rewriteRichTextPlainText,
  routeBends,
  routeEnd,
  transformPoint,
} from "@icm/model";

import {
  applyOrientationOperations,
  type PlacementOrientationOperation,
} from "../../interaction/shortcut-orientation";

export interface SchematicClipboard {
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

export interface PasteProposal {
  edits: SchematicEdit[];
  instanceIds: string[];
  errors: string[];
  idRemap: OperationIdRemap;
  /**
   * Non-electrical provenance for this one flattened Document insertion.
   * It can identify two imports of the same source without changing target
   * Net naming, topology, or Evidence resolution.
   */
  compositionOccurrence?: {
    id: string;
    sourceDocumentId: string;
    targetDocumentId: string;
    objectIdRemap: OperationIdRemap;
  };
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
      clipboard.cellTerminals.length > 0 ||
      clipboard.formalParameters.length > 0
        ? {
            name: base.netlist?.name ?? base.name,
            formalParameters: structuredClone(clipboard.formalParameters),
            terminals: structuredClone(clipboard.cellTerminals),
          }
        : undefined,
    mosBulkDefaults: undefined,
    connectivityEvidence: structuredClone(clipboard.connectivityEvidence),
    layoutGroups: structuredClone(clipboard.layoutGroups),
    constraints: structuredClone(clipboard.constraints),
  };
}

/**
 * How far a preview paste must sit from the circuit to be read as its own
 * copy rather than as landing on the original. One span past the rightmost
 * coordinate the Document uses clears every existing object, and the offset
 * is a whole number so the fragment translates back exactly.
 */
function previewClearanceOffset(base: SchematicDocument): Point {
  let extent = 0;
  const consider = (value: number): void => {
    if (Number.isFinite(value)) extent = Math.max(extent, Math.abs(value));
  };
  for (const instance of base.instances) {
    if (instance.placement) {
      consider(instance.placement.position.x);
      consider(instance.placement.position.y);
    }
  }
  for (const junction of base.junctions) {
    consider(junction.position.x);
    consider(junction.position.y);
  }
  for (const route of base.routes) {
    for (const leg of route.legs) {
      if (leg.to.kind === "bend") {
        consider(leg.to.position.x);
        consider(leg.to.position.y);
      }
    }
  }
  return { x: Math.ceil(extent) * 2 + 10_000, y: 0 };
}

/**
 * Build the copy ghost from the same dry-run transaction as its eventual
 * commit.  The fallback keeps rendering resilient while the Symbol resolver
 * is unavailable during isolated unit callers.
 *
 * The dry run is placed clear of the circuit and the result translated back,
 * because the ghost's own coordinates start on top of the objects it was
 * copied from — it is drawn at the origin and moved to the pointer by an SVG
 * transform. Pasting onto the source is a real gesture with a real meaning:
 * commit-time canonicalisation reads the copied pins as landing on the
 * originals and folds the copied Net and its Routes into them. That is right
 * for a paste and wrong for a preview, which then showed parts with no wires
 * between them.
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
    const clearance = previewClearanceOffset(base);
    const proposal = proposePaste(
      base,
      oriented,
      { x: offset.x + clearance.x, y: offset.y + clearance.y },
      sequence,
    );
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
        const constraintIds = new Set(
          proposal.edits.flatMap((edit) =>
            edit.kind === "set_layout_constraint" ? [edit.constraint.id] : [],
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
          ...Object.values(proposal.idRemap.nets),
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
          intent: oriented.intent,
          sourceDocumentId: base.id,
          sourceGrid: base.presentation.grid,
          instances,
          cellTerminals,
          formalParameters: oriented.formalParameters,
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
          layoutGroups: result.document.layoutGroups.filter((group) =>
            layoutGroupIds.has(group.id),
          ),
          constraints: result.document.constraints.filter((constraint) =>
            constraintIds.has(constraint.id),
          ),
        });
        // Back from the clearance the dry run needed, so the ghost lands
        // where the caller asked for it.
        return fallbackClipboardPreviewDocument(
          result.document,
          previewClipboard,
          { x: -clearance.x, y: -clearance.y },
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
export function captureDocumentComposition(
  document: SchematicDocument,
): SchematicClipboard | null {
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
  // A Cell default is context, not portable ownership. Close the composition
  // snapshot by materializing any still-derived source default; proposePaste
  // will then convert every policy binding to an instance-owned override.
  for (const sourceInstance of document.instances) {
    const resolution = resolveMosBulkConnection(document, sourceInstance);
    if (
      resolution?.status !== "cell-default" ||
      resolution.materialized ||
      !resolution.net
    ) {
      continue;
    }
    const copiedInstance = copiedInstancesById.get(sourceInstance.id);
    const copiedNet = copiedNetsById.get(resolution.net.id);
    if (!copiedInstance || !copiedNet) continue;
    copiedInstance.mosBulkBinding = {
      origin: "cell-default",
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
  return structuredClone({
    intent: "clone-selection",
    sourceDocumentId: document.id,
    sourceGrid: document.presentation.grid,
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
    formalParameters: [],
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
      if (!netIds.has(evidence.netId)) return false;
      if (evidence.kind !== "name-claim") return true;
      switch (evidence.owner.kind) {
        case "global-declaration":
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
    layoutGroups,
    constraints,
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

function pastedInstanceId(
  source: Instance,
  sequence: number,
  occupied: Set<string>,
): string {
  return uniqueCopyId(source.id, sequence, occupied);
}

/** Allocate a sole authored Reference for schematic-only Instance kinds. */
function nextUnconstrainedReference(
  current: string,
  sequence: number,
  occupied: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
): string {
  const suffix = /^(.*?)(\d+)$/u.exec(current);
  const prefix = suffix?.[1] || `${current}-copy-`;
  let ordinal = suffix ? Number(suffix[2]) + 1 : sequence;
  while (true) {
    const digits = String(ordinal);
    const candidate = `${prefix.slice(0, Math.max(1, 128 - digits.length))}${digits}`;
    const folded = candidate.toLowerCase();
    if (!occupied.has(folded) && !reserved.has(folded)) return candidate;
    ordinal += 1;
  }
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
  const compositionOccurrenceId =
    clipboard.intent === "compose-document"
      ? uniqueCopyId(
          `composition-${clipboard.sourceDocumentId}`,
          sequence,
          occupied,
        )
      : undefined;
  const referenceIndex = createReferenceIndex(document);
  const reservedReferences = new Set<string>();
  const occupiedReferences = new Set(
    document.instances.flatMap((instance) =>
      instance.reference ? [instance.reference.toLowerCase()] : [],
    ),
  );
  const instanceReferences = new Map(
    clipboard.instances.flatMap((instance) => {
      if (!instance.reference) return [];
      if (
        clipboard.intent === "compose-document" &&
        !occupiedReferences.has(instance.reference.toLowerCase()) &&
        !reservedReferences.has(instance.reference.toLowerCase())
      ) {
        reservedReferences.add(instance.reference.toLowerCase());
        return [[instance.id, instance.reference] as const];
      }
      const policy = referencePolicyForInstance(instance);
      if (policy.kind === "none") {
        const reference = nextUnconstrainedReference(
          instance.reference,
          sequence,
          occupiedReferences,
          reservedReferences,
        );
        reservedReferences.add(reference.toLowerCase());
        return [[instance.id, reference] as const];
      }
      const sourceSuffix = referenceSuffixForPolicy(instance.reference, policy);
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
      pastedInstanceId(instance, sequence, occupied),
    ]),
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
  const layoutGroupIds = new Map(
    clipboard.layoutGroups.map((group) => [
      group.id,
      uniqueCopyId(group.id, sequence, occupied),
    ]),
  );
  const constraintIds = new Map(
    clipboard.constraints.map((constraint) => [
      constraint.id,
      uniqueCopyId(constraint.id, sequence, occupied),
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
  const draftingIds = new Map(
    clipboard.draftingObjects.map((object) => [
      object.id,
      uniqueCopyId(object.id, sequence, occupied),
    ]),
  );
  const objectIds = new Map<string, string>([
    ...instanceIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
    ...annotationIds,
    ...draftingIds,
  ]);
  const interfaceEdits: SchematicEdit[] = [];
  const sourceNeedsCellInterface =
    clipboard.cellTerminals.length > 0 || clipboard.formalParameters.length > 0;
  if (sourceNeedsCellInterface && !document.netlist) {
    if (clipboard.intent === "compose-document") {
      interfaceEdits.push({
        kind: "create_cell_interface",
        name: document.name,
      });
    } else {
      errors.push("Target Document has no formal Cell interface");
    }
  }
  if (
    clipboard.intent === "compose-document" &&
    clipboard.formalParameters.length > 0
  ) {
    const merged = structuredClone(document.netlist?.formalParameters ?? []);
    const byName = new Map(
      merged.map((parameter) => [parameter.name.toLowerCase(), parameter]),
    );
    for (const parameter of clipboard.formalParameters) {
      const existing = byName.get(parameter.name.toLowerCase());
      if (existing) {
        if (existing.defaultValue !== parameter.defaultValue) {
          errors.push(
            `Cell formal parameter conflict: ${parameter.name} has incompatible defaults`,
          );
        }
        continue;
      }
      const copy = structuredClone(parameter);
      merged.push(copy);
      byName.set(copy.name.toLowerCase(), copy);
    }
    interfaceEdits.push({
      kind: "set_cell_formal_parameters",
      formalParameters: merged,
    });
  }
  const edits: SchematicEdit[] = [
    ...interfaceEdits,
    ...clipboard.instances.map((instance): SchematicEdit => ({
      kind: "add_instance",
      instance: {
        ...structuredClone(instance),
        id: instanceIds.get(instance.id)!,
        ...(instanceReferences.has(instance.id)
          ? {
              reference: instanceReferences.get(instance.id)!,
            }
          : {}),
        ...(instance.mosBulkBinding
          ? {
              mosBulkBinding: {
                ...instance.mosBulkBinding,
                ...(clipboard.intent === "compose-document"
                  ? { origin: "instance-override" as const }
                  : {}),
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
    })),
  ];
  edits.push(
    ...[...new Set(netIds.values())].map((netId): SchematicEdit => ({
      kind: "create_base_net",
      netId,
    })),
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
  edits.push(
    ...clipboard.junctions.map((junction): SchematicEdit => {
      const netId = netIds.get(junction.netId)!;
      return {
        kind: "add_junction",
        junctionId: junctionIds.get(junction.id)!,
        netId,
        position: movePoint(junction.position, offset),
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
          case "global-declaration":
            break;
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
  edits.push(
    ...clipboard.annotations.map((annotation): SchematicEdit => {
      const clone = structuredClone(annotation);
      if (
        clone.binding?.kind === "instance-reference" &&
        clone.formatOverride
      ) {
        const mappedReference = instanceReferences.get(
          clone.binding.instanceId,
        );
        if (mappedReference) {
          clone.formatOverride = rewriteRichTextPlainText(
            clone.formatOverride,
            mappedReference,
          );
        }
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
                  clone.binding?.kind === "instance-reference"
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
    noConnects: Object.fromEntries(noConnectIds),
    draftingObjects: Object.fromEntries(draftingIds),
    layoutGroups: Object.fromEntries(layoutGroupIds),
    constraints: Object.fromEntries(constraintIds),
    cellTerminals: Object.fromEntries(terminalIds),
  };
  // Drafting objects carry no connectivity, so a copy is the object itself
  // under a fresh id, shifted by the same placement offset as everything else.
  const pastedAnchorObjectIds = new Map([...objectIds, ...draftingIds]);
  const pastedLegIds = new Map(Object.entries(idRemap.legs));
  for (const object of clipboard.draftingObjects) {
    const id = draftingIds.get(object.id)!;
    const translated = translateDraftingObject(
      object,
      offset,
      clipboard.intent === "compose-document" ? 1 : document.presentation.grid,
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
  for (const group of clipboard.layoutGroups) {
    const mappedObjectIds = group.objectIds.flatMap((objectId) => {
      const mapped = objectIds.get(objectId);
      if (!mapped) {
        errors.push(
          `Layout group ${group.id} references unavailable object ${objectId}`,
        );
        return [];
      }
      return [mapped];
    });
    if (mappedObjectIds.length !== group.objectIds.length) continue;
    edits.push({
      kind: "set_layout_group",
      group: {
        ...structuredClone(group),
        id: layoutGroupIds.get(group.id)!,
        objectIds: mappedObjectIds,
      },
    });
  }
  for (const constraint of clipboard.constraints) {
    const mappedObjectIds = constraint.objectIds.flatMap((objectId) => {
      const mapped = objectIds.get(objectId);
      if (!mapped) {
        errors.push(
          `Layout constraint ${constraint.id} references unavailable object ${objectId}`,
        );
        return [];
      }
      return [mapped];
    });
    if (mappedObjectIds.length !== constraint.objectIds.length) continue;
    edits.push({
      kind: "set_layout_constraint",
      constraint: {
        ...structuredClone(constraint),
        id: constraintIds.get(constraint.id)!,
        objectIds: mappedObjectIds,
      },
    });
  }
  if (clipboard.intent === "compose-document") {
    const gridErrors = edits.flatMap((edit) =>
      gridAlignmentDiagnostics(edit, document.presentation.grid),
    );
    if (gridErrors.length > 0) {
      errors.push(
        `Source geometry is incompatible with target grid ${document.presentation.grid}; composition does not rescale or snap electrical geometry`,
      );
    }
  }
  const operationPlan = createRoutingOperationPlan(document, {
    intent: clipboard.intent === "compose-document" ? "compose" : "clone",
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
    expectedElectricalEffect:
      clipboard.intent === "compose-document"
        ? {
            kind: "compose",
            mapping: idRemap.instances,
            boundaryPolicy: "preserve-target-physical",
          }
        : {
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

  return {
    edits,
    instanceIds: [...instanceIds.values()],
    errors,
    idRemap,
    ...(compositionOccurrenceId
      ? {
          compositionOccurrence: {
            id: compositionOccurrenceId,
            sourceDocumentId: clipboard.sourceDocumentId,
            targetDocumentId: document.id,
            objectIdRemap: idRemap,
          },
        }
      : {}),
    operationPlan,
  };
}

// The copy ghost: the Document a pending paste draws under the pointer.
import { executeTransaction } from "@icm/edit-engine";
import { translateDraftingObject } from "@icm/edit-engine";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { PlacementOrientationOperation } from "../../interaction/shortcut-orientation";

import type { SchematicClipboard } from "./clipboard";
import { orientClipboard } from "./copy-placement";
import { proposePaste } from "./paste-proposal";
import { movePoint, remapPastedDraftingAnchors } from "./paste-remap";

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
  // The dry run has already remapped ownership; this step only moves its
  // isolated geometry back from the clearance position. Use the paste
  // transforms for every drafting coordinate, including leader/callout tips
  // and attached-anchor fallbacks, without renaming or re-snapping the copy.
  const unchangedIds = new Map<string, string>();
  const draftingObjects = clipboard.draftingObjects.map((object) =>
    remapPastedDraftingAnchors(
      translateDraftingObject(object, offset, base.presentation.grid),
      unchangedIds,
      unchangedIds,
      unchangedIds,
      offset,
    ),
  );
  // The Cell's block layout names the Cell's Pins, of which the ghost holds
  // none or some: inherited, it failed validation and no ghost was drawn.
  const { cellSymbol: _cellSymbol, ...presentation } = base.presentation;
  return {
    ...base,
    presentation,
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
      draftingObjects.length > 0 ? { objects: draftingObjects } : undefined,
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
  const oriented = orientClipboard(
    clipboard,
    orientationOperations,
    undefined,
    resolver ? { resolver, presentation: base.presentation } : undefined,
  );
  if (resolver) {
    const clearance = previewClearanceOffset(base);
    const proposal = proposePaste(
      base,
      oriented,
      { x: offset.x + clearance.x, y: offset.y + clearance.y },
      sequence,
      undefined,
      resolver,
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
        // The dry run lands clear of the circuit, so every wire and Junction
        // on the copy's Nets is the copy's. Normalization may split a copied
        // wire or join two at a Junction of its own, under new IDs: a ghost
        // keeping only the renamed ones dropped part of a rail, and one whose
        // wires named a Junction it lacked failed validation, so nothing was
        // drawn (Gallery drawings copied whole).
        const copiedNetIds = new Set(Object.values(proposal.idRemap.nets));
        const routeIds = new Set([
          ...Object.values(proposal.idRemap.routes),
          ...result.document.routes
            .filter((route) => copiedNetIds.has(route.netId))
            .map((route) => route.id),
        ]);
        const junctionIds = new Set([
          ...Object.values(proposal.idRemap.junctions),
          ...result.document.junctions
            .filter((junction) => copiedNetIds.has(junction.netId))
            .map((junction) => junction.id),
        ]);
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
          result.document.netlist?.terminals.filter(
            (terminal) =>
              terminal.interfaceInstanceIds.some((id) => instanceIds.has(id)) ||
              (terminal.interfaceAnnotationId !== undefined &&
                annotationIds.has(terminal.interfaceAnnotationId)),
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

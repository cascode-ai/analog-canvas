import type {
  DerivedPoint,
  GridPoint,
  SchematicDocument,
  VisualAnchor,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";
import { resolveRouteAttachment } from "./route-attachment.js";

// ADR 0010 general VisualAnchor resolver. It generalizes the existing
// route attachment resolution (current-marker-specific) to the free | object |
// route union. Anchor resolution reads derived geometry only; it never mutates
// a Route or Net. An unresolved anchor returns the last-known fallbackPosition
// and a diagnostic; it never silently re-attaches to another conductor.

export interface ResolvedAnchor {
  position: DerivedPoint;
  rotation: 0 | 90 | 180 | 270;
  resolved: boolean;
  /**
   * Present only when the anchor could not be resolved (deleted Route/object,
   * removed segment, non-orthogonal segment). Warning state is derived here,
   * never persisted as a boolean.
   */
  diagnostic?: AnchorDiagnostic;
}

export type AnchorDiagnosticCode =
  "anchor-target-missing" | "DRAFTING_ROUTE_SEGMENT_INVALID";

export interface AnchorDiagnostic {
  code: AnchorDiagnosticCode;
  message: string;
  objectId?: string;
}

/**
 * Resolve a VisualAnchor against a Document. A `route` anchor resolves against
 * canonical route geometry; an `object` anchor resolves to the target's
 * placement plus localOffset; a `free` anchor is its own position.
 */
export function resolveVisualAnchor(
  document: SchematicDocument,
  resolver: SymbolResolver,
  anchor: VisualAnchor,
  routingGeometry = resolveDocumentRoutingGeometry(document, resolver),
): ResolvedAnchor {
  switch (anchor.kind) {
    case "free":
      return { position: anchor.position, rotation: 0, resolved: true };
    case "object":
      return resolveObjectAnchor(document, anchor);
    case "route":
      return resolveRouteAnchor(document, anchor, routingGeometry);
  }
}

function resolveObjectAnchor(
  document: SchematicDocument,
  anchor: Extract<VisualAnchor, { kind: "object" }>,
): ResolvedAnchor {
  const target = resolveAnchorTargetPosition(document, anchor.objectId);
  if (!target) {
    return {
      position: anchor.fallbackPosition,
      rotation: 0,
      resolved: false,
      diagnostic: {
        code: "anchor-target-missing",
        message: `Anchor target ${anchor.objectId} is missing; using fallback position.`,
        objectId: anchor.objectId,
      },
    };
  }
  return {
    position: {
      x: target.x + anchor.localOffset.x,
      y: target.y + anchor.localOffset.y,
    },
    rotation: 0,
    resolved: true,
  };
}

function resolveRouteAnchor(
  document: SchematicDocument,
  anchor: Extract<VisualAnchor, { kind: "route" }>,
  routingGeometry: ResolvedDocumentRoutingGeometry,
): ResolvedAnchor {
  const route = document.routes.find(
    (candidate) => candidate.id === anchor.routeId,
  );
  if (!route) {
    return unresolvedRoute(
      anchor,
      "DRAFTING_ANCHOR_TARGET_MISSING",
      `Route ${anchor.routeId} is missing; using fallback position.`,
    );
  }
  const geometry = routingGeometry.routes.get(route.id);
  if (!geometry) {
    return unresolvedRoute(
      anchor,
      "DRAFTING_ANCHOR_TARGET_MISSING",
      `Route ${anchor.routeId} has no resolvable polyline; using fallback position.`,
    );
  }
  const placement = resolveRouteAttachment(geometry, {
    routeId: anchor.routeId,
    legId: anchor.legId,
    t: anchor.t,
    normalOffset: anchor.normalOffset,
    direction: anchor.direction,
  });
  if (!placement) {
    // P2: a valid route whose segment is gone/out-of-range is a distinct,
    // actionable failure (re-select the segment), not a missing target.
    return unresolvedRoute(
      anchor,
      "DRAFTING_ROUTE_SEGMENT_INVALID",
      `Route ${anchor.routeId} leg ${anchor.legId} is no longer valid; using fallback position.`,
    );
  }
  return {
    position:
      anchor.orientation === "horizontal"
        ? placement.conductorPoint
        : placement.labelPoint,
    rotation: anchor.orientation === "horizontal" ? 0 : placement.rotation,
    resolved: true,
  };
}

function unresolvedRoute(
  anchor: Extract<VisualAnchor, { kind: "route" }>,
  code: "DRAFTING_ANCHOR_TARGET_MISSING" | "DRAFTING_ROUTE_SEGMENT_INVALID",
  message: string,
): ResolvedAnchor {
  return {
    position: anchor.fallbackPosition,
    rotation: 0,
    resolved: false,
    diagnostic: {
      code:
        code === "DRAFTING_ROUTE_SEGMENT_INVALID"
          ? "DRAFTING_ROUTE_SEGMENT_INVALID"
          : "anchor-target-missing",
      message,
      objectId: anchor.routeId,
    },
  };
}

/**
 * Find the placement Point of an attachable object: an Instance or Junction.
 * Junction. A DraftingObject is intentionally not a valid V1 anchor target
 * (ADR 0010: no drafting-to-drafting attachment).
 */
/**
 * The position an `object` anchor hangs off. Exported because anchor
 * resolution is not the only caller: a drag that rewrites localOffset must
 * measure against the same target this resolves, or the two disagree and the
 * dragged label renders back where it started.
 */
export function resolveAnchorTargetPosition(
  document: SchematicDocument,
  objectId: string,
): GridPoint | null {
  const instance = document.instances.find(
    (candidate) => candidate.id === objectId,
  );
  if (instance?.placement) return instance.placement.position;
  const junction = document.junctions.find(
    (candidate) => candidate.id === objectId,
  );
  if (junction) return junction.position;
  // A drafting rectangle anchors dependents (e.g. its centered label) at its
  // persisted center. Other drafting kinds stay unresolved so anchor
  // resolution cannot recurse through derived drafting geometry.
  const drafting = document.drafting?.objects.find(
    (candidate) => candidate.id === objectId,
  );
  if (drafting?.kind === "rectangle") return drafting.center;
  if (drafting?.kind === "circle") return drafting.center;
  return null;
}

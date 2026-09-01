import { foldNetName } from "@icm/model";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";

import type { SchematicEdit } from "./edit-schema.js";
import { endpointOwnerNetId } from "./transaction-routing.js";

export type DirectEndpointConnectionPlan =
  | {
      ok: true;
      netId: string;
      edits: readonly SchematicEdit[];
    }
  | {
      ok: false;
      message: string;
      relatedNetIds: readonly string[];
    };

/**
 * Retire the net labels that name these Base Nets, annotation and claim both.
 *
 * Only claims a **label** owns are retired. A claim owned by a power marker
 * comes from a symbol the author placed on the canvas — a VDD or VSS part,
 * not a piece of text — and deleting parts is not what naming a node meant.
 * Contact between two supply domains is refused earlier for that reason.
 */
function retireNetLabelClaims(
  document: SchematicDocument,
  netIds: readonly string[],
): SchematicEdit[] {
  const edits: SchematicEdit[] = [];
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "name-claim") continue;
    if (!netIds.includes(evidence.netId)) continue;
    if (evidence.owner.kind !== "net-label") continue;
    edits.push(
      { kind: "remove_connectivity_evidence", evidenceId: evidence.id },
      {
        kind: "remove_schematic_annotation",
        annotationId: evidence.owner.annotationId,
      },
    );
  }
  return edits;
}

export interface DirectEndpointConnectionRequest {
  from: RouteEndpoint;
  to: RouteEndpoint;
  newNetId: string;
}

/**
 * Plan one explicit zero-length electrical contact. The strict transaction
 * primitive still refuses cross-Net connection; this authoring layer emits an
 * equally explicit merge first when the two authored Nets are compatible.
 */
export function planDirectEndpointConnection(
  document: SchematicDocument,
  request: DirectEndpointConnectionRequest,
): DirectEndpointConnectionPlan {
  const fromNetId = endpointOwnerNetId(document, request.from);
  const toNetId = endpointOwnerNetId(document, request.to);
  if (!fromNetId && !toNetId) {
    return {
      ok: true,
      netId: request.newNetId,
      edits: [
        {
          kind: "connect_endpoints",
          from: request.from,
          to: request.to,
          newNetId: request.newNetId,
        },
      ],
    };
  }

  const netId = fromNetId ?? toNetId!;
  if (!fromNetId || !toNetId || fromNetId === toNetId) {
    return {
      ok: true,
      netId,
      edits: [
        { kind: "connect_endpoints", from: request.from, to: request.to },
      ],
    };
  }

  const logical = resolveDocumentLogicalNets(document);
  const fromLogical = logical.byBaseNetId.get(fromNetId);
  const toLogical = logical.byBaseNetId.get(toNetId);
  const relatedNetIds = [fromNetId, toNetId].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  // Two differently named Nets brought into contact DO join, and BOTH names
  // go with the join. Neither one describes the result: the author named two
  // nodes precisely to say they were different, so keeping either would have
  // the drawing assert something they never said, while keeping both would
  // leave one node claiming two names. Retiring the pair says only what is
  // true — this node is not named yet — and two labels vanishing is visible
  // in a way one quiet survivor would not be.
  const namesConflict = Boolean(
    fromLogical?.name &&
    toLogical?.name &&
    foldNetName(fromLogical.name) !== foldNetName(toLogical.name),
  );
  const retiredLabelEdits = namesConflict
    ? retireNetLabelClaims(document, [fromNetId, toNetId])
    : [];
  if (
    fromLogical?.powerDomain === "conflict" ||
    toLogical?.powerDomain === "conflict" ||
    (fromLogical?.powerDomain !== "none" &&
      toLogical?.powerDomain !== "none" &&
      fromLogical?.powerDomain !== toLogical?.powerDomain)
  ) {
    return {
      ok: false,
      message: "Cannot directly connect Nets with incompatible power domains",
      relatedNetIds,
    };
  }
  const fromHasSemantics = Boolean(
    fromLogical?.evidenceIds.length || fromLogical?.sourceNetIds.length,
  );
  const toHasSemantics = Boolean(
    toLogical?.evidenceIds.length || toLogical?.sourceNetIds.length,
  );
  const targetNetId = !fromHasSemantics && toHasSemantics ? toNetId : fromNetId;
  const sourceNetId = targetNetId === fromNetId ? toNetId : fromNetId;
  return {
    ok: true,
    netId: targetNetId,
    edits: [
      // The names go first: the merge that follows must not have to hold a
      // Net carrying two of them, even for one intermediate step.
      ...retiredLabelEdits,
      { kind: "merge_nets", targetNetId, sourceNetId },
      { kind: "connect_endpoints", from: request.from, to: request.to },
    ],
  };
}

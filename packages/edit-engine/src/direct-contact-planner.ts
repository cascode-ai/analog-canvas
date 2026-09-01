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
  if (
    fromLogical?.name &&
    toLogical?.name &&
    foldNetName(fromLogical.name) !== foldNetName(toLogical.name)
  ) {
    return {
      ok: false,
      message: `Cannot directly connect named Nets ${fromLogical.name} and ${toLogical.name}`,
      relatedNetIds,
    };
  }
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
      { kind: "merge_nets", targetNetId, sourceNetId },
      { kind: "connect_endpoints", from: request.from, to: request.to },
    ],
  };
}

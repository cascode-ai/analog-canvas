import type { SchematicDocument } from "@icm/model";

import type { SchematicEdit } from "./edit-schema.js";
import type { EditDiagnostic } from "./transaction-result.js";

export type ConnectivityIntent =
  | "draw_wire"
  | "connect_without_wire"
  | "attach_endpoint_to_wire"
  | "rename_or_merge_named_net"
  | "disconnect_endpoint"
  | "remove_wire_geometry"
  | "delete_connection_intent"
  | "remove_bulk_override"
  | "edit_route_geometry"
  | "move_connected_selection"
  | "add_or_remove_no_connect";

export interface ConnectivityDelta {
  readonly netIds: readonly string[];
  readonly endpointKeys: readonly string[];
}

export interface ConnectivityGeometryDelta {
  readonly routeIds: readonly string[];
  readonly junctionIds: readonly string[];
}

export interface ConnectivityProposal {
  readonly source: {
    readonly documentId: string;
    readonly revision: number;
  };
  readonly intent: ConnectivityIntent;
  readonly logical: ConnectivityDelta;
  readonly geometry: ConnectivityGeometryDelta;
  /** Existing planner-specific, non-persisted preview facts. */
  readonly preview?: unknown;
  readonly diagnostics: readonly EditDiagnostic[];
  readonly affectedObjectIds: readonly string[];
  readonly edits: readonly SchematicEdit[];
}

function endpointKey(endpoint: {
  kind: string;
  [key: string]: unknown;
}): string {
  return endpoint.kind === "terminal"
    ? `terminal:${endpoint.instanceId}:${endpoint.pinName}`
    : `junction:${endpoint.junctionId}`;
}

function unique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

/**
 * Wraps existing specialist output. The proposal is a transient commit
 * contract: the low-level edits remain the sole persisted mutation protocol.
 */
export function createConnectivityProposal(
  document: SchematicDocument,
  input: Omit<
    ConnectivityProposal,
    "source" | "logical" | "geometry" | "affectedObjectIds"
  > & {
    readonly logical?: Partial<ConnectivityDelta>;
    readonly geometry?: Partial<ConnectivityGeometryDelta>;
    readonly affectedObjectIds?: readonly string[];
  },
): ConnectivityProposal {
  const netIds: string[] = [...(input.logical?.netIds ?? [])];
  const endpointKeys: string[] = [...(input.logical?.endpointKeys ?? [])];
  const routeIds: string[] = [...(input.geometry?.routeIds ?? [])];
  const junctionIds: string[] = [...(input.geometry?.junctionIds ?? [])];
  const affectedObjectIds: string[] = [...(input.affectedObjectIds ?? [])];
  for (const edit of input.edits) {
    switch (edit.kind) {
      case "connect_endpoints":
        endpointKeys.push(endpointKey(edit.from), endpointKey(edit.to));
        if (edit.newNetId) netIds.push(edit.newNetId);
        break;
      case "merge_nets":
        netIds.push(edit.targetNetId, edit.sourceNetId);
        break;
      case "upsert_connectivity_evidence":
        affectedObjectIds.push(edit.evidence.id);
        if (edit.evidence.kind === "explicit-equivalence") {
          netIds.push(...edit.evidence.memberNetIds);
        } else {
          netIds.push(edit.evidence.netId);
        }
        break;
      case "remove_connectivity_evidence":
        affectedObjectIds.push(edit.evidenceId);
        break;
      case "set_route_points":
      case "cut_connection":
      case "remove_route_geometry":
        routeIds.push(edit.routeId);
        if (edit.kind === "set_route_points") netIds.push(edit.netId);
        break;
      case "add_power_rail":
        netIds.push(edit.netId);
        routeIds.push(edit.routeId);
        junctionIds.push(edit.startJunctionId, edit.endJunctionId);
        affectedObjectIds.push(edit.labelId);
        break;
      case "add_junction":
        junctionIds.push(edit.junctionId);
        netIds.push(edit.netId);
        break;
      case "move_junction":
      case "remove_junction":
        junctionIds.push(edit.junctionId);
        break;
      case "attach_endpoint_to_route":
        routeIds.push(edit.routeId, edit.firstRouteId, edit.secondRouteId);
        endpointKeys.push(endpointKey(edit.endpoint));
        break;
      case "disconnect_endpoint":
        endpointKeys.push(endpointKey(edit.endpoint));
        break;
      case "add_no_connect":
        affectedObjectIds.push(edit.noConnect.id);
        endpointKeys.push(endpointKey(edit.noConnect.endpoint));
        break;
      case "remove_no_connect":
        affectedObjectIds.push(edit.noConnectId);
        break;
      case "add_instance":
        affectedObjectIds.push(edit.instance.id);
        break;
      case "remove_instance":
      case "move_instance":
      case "rotate_instance":
      case "mirror_instance":
      case "clear_mos_bulk_default":
        affectedObjectIds.push(edit.instanceId);
        break;
      case "align_instances":
        affectedObjectIds.push(...edit.instanceIds);
        break;
      case "upsert_schematic_annotation":
        affectedObjectIds.push(edit.annotation.id);
        break;
      case "remove_schematic_annotation":
        affectedObjectIds.push(edit.annotationId);
        break;
      default:
        break;
    }
  }
  return {
    source: { documentId: document.id, revision: document.revision },
    intent: input.intent,
    logical: { netIds: unique(netIds), endpointKeys: unique(endpointKeys) },
    geometry: { routeIds: unique(routeIds), junctionIds: unique(junctionIds) },
    ...(input.preview === undefined ? {} : { preview: input.preview }),
    diagnostics: input.diagnostics,
    affectedObjectIds: unique(affectedObjectIds),
    edits: input.edits,
  };
}

export type ConnectivityProposalGate =
  | { readonly ok: true; readonly edits: readonly SchematicEdit[] }
  | { readonly ok: false; readonly message: string };

/** Reject stale or cross-Cell previews before they become a transaction. */
export function gateConnectivityProposal(
  document: SchematicDocument,
  proposal: ConnectivityProposal,
): ConnectivityProposalGate {
  if (proposal.source.documentId !== document.id) {
    return { ok: false, message: "Connectivity proposal targets another Cell" };
  }
  if (proposal.source.revision !== document.revision) {
    return { ok: false, message: "Connectivity proposal is stale" };
  }
  if (proposal.edits.length === 0) {
    return { ok: false, message: "Connectivity proposal has no edits" };
  }
  if (
    proposal.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return {
      ok: false,
      message: proposal.diagnostics.find((item) => item.severity === "error")!
        .message,
    };
  }
  return { ok: true, edits: proposal.edits };
}

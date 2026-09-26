import { JunctionSchema, routeEndpoints } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { endpointKey, resolveEndpointConnection } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import { missingPowerMarkerClaims } from "./power-marker-ownership.js";
import {
  type EditMutationOutcome,
  type RejectEdit,
  rejectedEditMutation,
} from "./transaction-domain.js";
import {
  removeConnectivityEvidenceOwnedBy,
  retargetConnectivityEvidenceOwner,
} from "./transaction-connectivity.js";
import {
  captureNetLabelRouteAnchors,
  captureRouteMarkerAnchors,
} from "./transaction-route-annotations.js";
import {
  remapNetLabelsAfterSplit,
  remapRouteMarkersAfterSplit,
} from "./transaction-route-annotation-follow.js";
import { splitRoute } from "./transaction-route-follow.js";
import {
  addEndpointToNet,
  endpointOwnerNetId,
  routeIsProtected,
  validateConnectableEndpoint,
  validateRoute,
} from "./transaction-routing.js";

type RouteTopologyEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      | "add_junction"
      | "attach_endpoint_to_route"
      | "remove_junction"
      | "move_junction"
      | "cut_connection"
      | "connect_endpoints"
      | "disconnect_endpoint";
  }
>;

export interface RouteTopologyEditContext {
  draft: SchematicDocument;
  resolver: SymbolResolver | undefined;
  explicitlyAuthoredRouteIds: ReadonlySet<string>;
  changedObjectIds: Set<string>;
  deferNetPrune(netId: string): void;
  reject: RejectEdit;
}

export type RouteTopologyEditOutcome = EditMutationOutcome;

export function applyRouteTopologyEdit(
  edit: RouteTopologyEdit,
  editContext: RouteTopologyEditContext,
): RouteTopologyEditOutcome {
  const {
    draft,
    resolver,
    explicitlyAuthoredRouteIds,
    changedObjectIds,
    deferNetPrune,
    reject,
  } = editContext;
  const context = { symbolResolver: resolver };
  const rejectAt = (...args: Parameters<RejectEdit>) =>
    rejectedEditMutation(reject, ...args);
  let connectivityChanged = false;

  switch (edit.kind) {
    case "add_junction": {
      if (!draft.nets.some((net) => net.id === edit.netId)) {
        if (!edit.createNet) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Junction net does not exist: ${edit.netId}`,
          );
        }
        draft.nets.push({
          id: edit.netId,
          terminals: [],
        });
        changedObjectIds.add(edit.netId);
      }
      if (draft.junctions.some((junction) => junction.id === edit.junctionId)) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Junction already exists: ${edit.junctionId}`,
        );
      }
      draft.junctions.push(
        JunctionSchema.parse({
          id: edit.junctionId,
          netId: edit.netId,
          position: edit.position,
          role: edit.role ?? "branch",
        }),
      );
      changedObjectIds.add(edit.junctionId);
      if (edit.split) {
        const resolver = context.symbolResolver;
        if (!resolver) {
          return rejectAt(
            "EDIT_CONTEXT_REQUIRED",
            "Route splitting requires a Symbol Resolver",
          );
        }
        const routeIndex = draft.routes.findIndex(
          (route) => route.id === edit.split!.routeId,
        );
        const route = draft.routes[routeIndex];
        if (!route) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Route does not exist: ${edit.split.routeId}`,
          );
        }
        if (route.netId !== edit.netId) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Junction and split route must belong to the same Net",
          );
        }
        if (routeIsProtected(route)) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Route contains a locked segment: ${route.id}`,
          );
        }
        const splitMarkerAnchors = captureRouteMarkerAnchors(
          draft,
          resolver,
        ).filter((anchor) => anchor.routeId === route.id);
        const splitNetLabelAnchors = captureNetLabelRouteAnchors(
          draft,
          resolver,
        ).filter((anchor) => anchor.routeId === route.id);
        const splitIndex = route.legs.findIndex(
          (leg) => leg.id === edit.split!.legId,
        );
        if (splitIndex < 0) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Route leg does not exist: ${edit.split.legId}`,
          );
        }
        const split = splitRoute(
          draft,
          route,
          { kind: "junction", junctionId: edit.junctionId },
          edit.position,
          edit.split.firstRouteId,
          edit.split.secondRouteId,
          splitIndex,
          resolver,
        );
        if (typeof split === "string") {
          return rejectAt("EDIT_PRECONDITION", split);
        }
        draft.routes.splice(routeIndex, 1, split.first, split.second);
        for (const splitRouteCandidate of [split.first, split.second]) {
          const routeError = validateRoute(
            draft,
            splitRouteCandidate,
            resolver,
            undefined,
            // A preceding set_route_path may still have pending membership.
            // Validate geometry here; the transaction validates committed
            // membership after rebuilding the complete physical graph.
            "pending",
          );
          if (routeError) {
            return rejectAt("EDIT_PRECONDITION", routeError);
          }
        }
        remapRouteMarkersAfterSplit(
          draft,
          resolver,
          splitMarkerAnchors,
          [split.first.id, split.second.id],
          changedObjectIds,
        );
        remapNetLabelsAfterSplit(
          draft,
          resolver,
          splitNetLabelAnchors,
          [split.first.id, split.second.id],
          changedObjectIds,
        );
        changedObjectIds.add(route.id);
        changedObjectIds.add(split.first.id);
        changedObjectIds.add(split.second.id);
      }
      connectivityChanged = true;
      break;
    }
    case "attach_endpoint_to_route": {
      const resolver = context.symbolResolver;
      if (!resolver) {
        return rejectAt(
          "EDIT_CONTEXT_REQUIRED",
          "Route attachment requires a Symbol Resolver",
        );
      }
      const endpointError = validateConnectableEndpoint(
        draft,
        edit.endpoint,
        resolver,
      );
      if (endpointError) {
        return rejectAt("EDIT_PRECONDITION", endpointError);
      }
      const routeIndex = draft.routes.findIndex(
        (candidate) => candidate.id === edit.routeId,
      );
      const route = draft.routes[routeIndex];
      if (!route) {
        return rejectAt(
          "OBJECT_NOT_FOUND",
          `Route does not exist: ${edit.routeId}`,
        );
      }
      if (routeIsProtected(route)) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Route contains a locked segment: ${route.id}`,
        );
      }
      const owner = endpointOwnerNetId(draft, edit.endpoint);
      if (owner && owner !== route.netId) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Endpoint belongs to ${owner}; merge it with ${route.netId} explicitly`,
        );
      }
      const endpointConnection = resolveEndpointConnection(
        draft,
        resolver,
        edit.endpoint,
      );
      if (
        !endpointConnection ||
        endpointConnection.contactPoint.x !== edit.point.x ||
        endpointConnection.contactPoint.y !== edit.point.y
      ) {
        return rejectAt(
          "EDIT_PRECONDITION",
          "Attached endpoint must resolve exactly at the Route contact point",
        );
      }
      const markerAnchors = captureRouteMarkerAnchors(draft, resolver).filter(
        (anchor) => anchor.routeId === route.id,
      );
      const netLabelAnchors = captureNetLabelRouteAnchors(
        draft,
        resolver,
      ).filter((anchor) => anchor.routeId === route.id);
      const splitIndex = route.legs.findIndex((leg) => leg.id === edit.legId);
      if (splitIndex < 0) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Route leg does not exist: ${edit.legId}`,
        );
      }
      const split = splitRoute(
        draft,
        route,
        edit.endpoint,
        edit.point,
        edit.firstRouteId,
        edit.secondRouteId,
        splitIndex,
        resolver,
      );
      if (typeof split === "string") {
        return rejectAt("EDIT_PRECONDITION", split);
      }
      addEndpointToNet(draft, route.netId, edit.endpoint);
      draft.routes.splice(routeIndex, 1, split.first, split.second);
      retargetConnectivityEvidenceOwner(
        draft,
        route.id,
        split.first.id,
        changedObjectIds,
      );
      for (const candidate of [split.first, split.second]) {
        const routeError = validateRoute(draft, candidate, resolver);
        if (routeError) return rejectAt("EDIT_PRECONDITION", routeError);
      }
      remapRouteMarkersAfterSplit(
        draft,
        resolver,
        markerAnchors,
        [split.first.id, split.second.id],
        changedObjectIds,
      );
      remapNetLabelsAfterSplit(
        draft,
        resolver,
        netLabelAnchors,
        [split.first.id, split.second.id],
        changedObjectIds,
      );
      changedObjectIds.add(route.id);
      changedObjectIds.add(split.first.id);
      changedObjectIds.add(split.second.id);
      changedObjectIds.add(route.netId);
      connectivityChanged = true;
      break;
    }
    case "remove_junction": {
      const junctionIndex = draft.junctions.findIndex(
        (junction) => junction.id === edit.junctionId,
      );
      if (junctionIndex < 0) {
        return rejectAt(
          "OBJECT_NOT_FOUND",
          `Junction does not exist: ${edit.junctionId}`,
        );
      }
      if (
        draft.routes.some((route) =>
          routeEndpoints(route).some(
            (endpoint) =>
              endpoint.kind === "junction" &&
              endpoint.junctionId === edit.junctionId,
          ),
        )
      ) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Junction is still used by a Route: ${edit.junctionId}`,
        );
      }
      const junction = draft.junctions[junctionIndex]!;
      const ownerNetIds = removeConnectivityEvidenceOwnedBy(
        draft,
        new Set([edit.junctionId]),
        changedObjectIds,
      );
      draft.junctions.splice(junctionIndex, 1);
      changedObjectIds.add(edit.junctionId);
      for (const netId of new Set([junction.netId, ...ownerNetIds])) {
        deferNetPrune(netId);
      }
      connectivityChanged = true;
      break;
    }
    case "move_junction": {
      const junction = draft.junctions.find(
        (candidate) => candidate.id === edit.junctionId,
      );
      if (!junction) {
        return rejectAt(
          "OBJECT_NOT_FOUND",
          `Junction does not exist: ${edit.junctionId}`,
        );
      }
      const incidentRoutes = draft.routes.filter((route) =>
        routeEndpoints(route).some(
          (endpoint) =>
            endpoint.kind === "junction" && endpoint.junctionId === junction.id,
        ),
      );
      const routeWithoutGeometry = incidentRoutes.find(
        (route) => !explicitlyAuthoredRouteIds.has(route.id),
      );
      if (routeWithoutGeometry) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Moving Junction ${junction.id} requires explicit geometry for incident Route ${routeWithoutGeometry.id}`,
          [],
          [junction.id, routeWithoutGeometry.id],
        );
      }
      const protectedRoute = draft.routes.find(
        (route) =>
          routeEndpoints(route).some(
            (endpoint) =>
              endpoint.kind === "junction" &&
              endpoint.junctionId === junction.id,
          ) && routeIsProtected(route),
      );
      if (protectedRoute) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Junction is attached to protected Route ${protectedRoute.id}`,
        );
      }
      junction.position = { ...edit.position };
      changedObjectIds.add(junction.id);
      break;
    }
    case "cut_connection": {
      const routeIndex = draft.routes.findIndex(
        (route) => route.id === edit.routeId,
      );
      const route = draft.routes[routeIndex];
      if (!route) {
        return rejectAt(
          "OBJECT_NOT_FOUND",
          `Route does not exist: ${edit.routeId}`,
        );
      }
      if (routeIsProtected(route)) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Route contains a locked segment: ${route.id}`,
        );
      }
      const anchoredAnnotation = draft.annotations.find(
        (annotation) =>
          annotation.anchor.kind === "route" &&
          annotation.anchor.routeId === route.id,
      );
      if (anchoredAnnotation) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Remove Route annotation ${anchoredAnnotation.id} before cutting Route ${route.id}`,
          [],
          [anchoredAnnotation.id, route.id],
        );
      }
      const net = draft.nets.find((candidate) => candidate.id === route.netId);
      if (!net) {
        return rejectAt(
          "OBJECT_NOT_FOUND",
          `Route Net does not exist: ${route.netId}`,
        );
      }
      // Capture inherited marker authority before any physical partition.
      // Owner retargeting below then follows every surviving marker, not just
      // the component that happens to retain the imported Base-Net ID.
      for (const claim of missingPowerMarkerClaims(draft, { netId: net.id })) {
        draft.connectivityEvidence.push(claim);
        changedObjectIds.add(claim.id);
      }
      // Once visible Ground markers own node 0, an inherited source-wide
      // declaration must not keep a newly detached, unmarked pin grounded.
      const hasGroundOwner = draft.connectivityEvidence.some(
        (claim) =>
          claim.kind === "name-claim" &&
          claim.netId === net.id &&
          claim.name === "0" &&
          claim.scope === "global" &&
          claim.owner.kind === "power-marker" &&
          draft.instances.some(
            (instance) =>
              claim.owner.kind === "power-marker" &&
              instance.id === claim.owner.objectId &&
              instance.symbolId === "ground",
          ),
      );
      if (hasGroundOwner) {
        draft.connectivityEvidence = draft.connectivityEvidence.filter(
          (claim) => {
            if (
              claim.kind !== "name-claim" ||
              claim.netId !== net.id ||
              claim.owner.kind !== "global-declaration" ||
              claim.name !== "0"
            )
              return true;
            changedObjectIds.add(claim.id);
            return false;
          },
        );
      }
      const candidateOrphanJunctionIds = new Set(
        routeEndpoints(route).flatMap((endpoint) =>
          endpoint.kind === "junction" ? [endpoint.junctionId] : [],
        ),
      );
      const ownerNetIds = new Set(
        removeConnectivityEvidenceOwnedBy(
          draft,
          new Set([route.id]),
          changedObjectIds,
        ),
      );
      draft.routes.splice(routeIndex, 1);
      changedObjectIds.add(route.id);

      const referencedJunctionIds = new Set(
        draft.routes.flatMap((candidate) =>
          routeEndpoints(candidate).flatMap((endpoint) =>
            endpoint.kind === "junction" ? [endpoint.junctionId] : [],
          ),
        ),
      );
      const preservedObjectIds = new Set([
        ...draft.annotations.flatMap((annotation) =>
          annotation.anchor.kind === "object"
            ? [annotation.anchor.objectId]
            : [],
        ),
        ...draft.layoutGroups.flatMap((group) => group.objectIds),
        ...draft.constraints.flatMap((constraint) => constraint.objectIds),
      ]);
      const removedJunctionIds = draft.junctions
        .filter(
          (junction) =>
            junction.netId === net.id &&
            candidateOrphanJunctionIds.has(junction.id) &&
            !referencedJunctionIds.has(junction.id) &&
            !preservedObjectIds.has(junction.id),
        )
        .map((junction) => junction.id);
      for (const netId of removeConnectivityEvidenceOwnedBy(
        draft,
        new Set(removedJunctionIds),
        changedObjectIds,
      )) {
        ownerNetIds.add(netId);
      }
      draft.junctions = draft.junctions.filter(
        (junction) => !removedJunctionIds.includes(junction.id),
      );
      for (const junctionId of removedJunctionIds) {
        changedObjectIds.add(junctionId);
      }

      // The final topology owns partitioning. A replacement Route later in
      // this same transaction may reconnect both sides of this cut.
      for (const netId of ownerNetIds) deferNetPrune(netId);
      deferNetPrune(net.id);
      break;
    }
    case "connect_endpoints": {
      const fromError = validateConnectableEndpoint(
        draft,
        edit.from,
        context.symbolResolver,
      );
      const toError = validateConnectableEndpoint(
        draft,
        edit.to,
        context.symbolResolver,
      );
      if (fromError || toError) {
        return rejectAt("EDIT_PRECONDITION", fromError ?? toError!);
      }
      const fromOwner = endpointOwnerNetId(draft, edit.from);
      const toOwner = endpointOwnerNetId(draft, edit.to);
      if (fromOwner && toOwner && fromOwner !== toOwner) {
        // The final graph joins these endpoints after all geometry edits.
        connectivityChanged = true;
        break;
      }
      let netId = fromOwner ?? toOwner;
      if (!netId) {
        if (!edit.newNetId) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Two unconnected endpoints require newNetId",
          );
        }
        const preparedNet = draft.nets.find((net) => net.id === edit.newNetId);
        if (preparedNet) {
          const alreadyReferenced =
            preparedNet.terminals.length > 0 ||
            draft.routes.some((route) => route.netId === preparedNet.id) ||
            draft.junctions.some(
              (junction) => junction.netId === preparedNet.id,
            ) ||
            draft.annotations.some(
              (annotation) =>
                annotation.netId === preparedNet.id ||
                (annotation.binding?.kind === "net-name" &&
                  annotation.binding.netId === preparedNet.id),
            ) ||
            draft.connectivityEvidence.some(
              (evidence) => evidence.netId === preparedNet.id,
            );
          if (alreadyReferenced) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Prepared Base Net is already populated: ${edit.newNetId}`,
            );
          }
          netId = preparedNet.id;
        } else {
          netId = edit.newNetId;
          draft.nets.push({
            id: netId,
            terminals: [],
          });
          changedObjectIds.add(netId);
        }
      }
      addEndpointToNet(draft, netId, edit.from);
      addEndpointToNet(draft, netId, edit.to);
      changedObjectIds.add(netId);
      connectivityChanged = true;
      break;
    }
    case "disconnect_endpoint": {
      const error = validateConnectableEndpoint(
        draft,
        edit.endpoint,
        context.symbolResolver,
      );
      if (error) {
        return rejectAt("EDIT_PRECONDITION", error);
      }
      const ownerId = endpointOwnerNetId(draft, edit.endpoint);
      if (!ownerId) {
        return rejectAt(
          "EDIT_PRECONDITION",
          "Endpoint is not connected to a Net",
        );
      }
      if (
        draft.routes.some((route) =>
          routeEndpoints(route).some(
            (endpoint) => endpointKey(endpoint) === endpointKey(edit.endpoint),
          ),
        )
      ) {
        return rejectAt(
          "EDIT_PRECONDITION",
          "Remove route geometry before disconnecting its endpoint",
        );
      }
      const owner = draft.nets.find((net) => net.id === ownerId)!;
      const endpoint = edit.endpoint;
      owner.terminals = owner.terminals.filter(
        (terminal) =>
          terminal.instanceId !== endpoint.instanceId ||
          terminal.pinName !== endpoint.pinName,
      );
      if (endpoint.pinName === "B") {
        const instance = draft.instances.find(
          (candidate) => candidate.id === endpoint.instanceId,
        );
        if (instance?.mosBulkBinding) {
          delete instance.mosBulkBinding;
          changedObjectIds.add(instance.id);
        }
      }
      changedObjectIds.add(owner.id);
      deferNetPrune(owner.id);
      connectivityChanged = true;
      break;
    }
  }

  return { ok: true, connectivityChanged };
}

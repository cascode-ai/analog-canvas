import { JunctionSchema, deriveStableId, routeEndpoints } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import {
  endpointKey,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import {
  type EditMutationOutcome,
  type RejectEdit,
  rejectedEditMutation,
} from "./transaction-domain.js";
import {
  type BulkDefaultIdentity,
  propagateSpiceSourceEvidenceAfterSplit,
  removeConnectivityEvidenceOwnedBy,
  retargetConnectivityEvidenceOwner,
  retargetMosBulkDefaultsAfterSplit,
  retargetOwnerEvidenceAfterSplit,
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
  netEndpointGroups,
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
      const bulkDefaultBeforeCut =
        draft.mosBulkDefaults?.nmosNetId === net.id ||
        draft.mosBulkDefaults?.pmosNetId === net.id
          ? resolveDocumentLogicalNets(draft).byBaseNetId.get(net.id)
          : undefined;
      const bulkDefaultIdentity: BulkDefaultIdentity | undefined =
        bulkDefaultBeforeCut
          ? {
              ...(bulkDefaultBeforeCut.name
                ? { name: bulkDefaultBeforeCut.name }
                : {}),
              ...(bulkDefaultBeforeCut.scope
                ? { scope: bulkDefaultBeforeCut.scope }
                : {}),
              ...(bulkDefaultBeforeCut.powerDomain === "ground" ||
              bulkDefaultBeforeCut.powerDomain === "vdd"
                ? { powerDomain: bulkDefaultBeforeCut.powerDomain }
                : {}),
            }
          : undefined;
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

      const groups = netEndpointGroups(draft, net.id, context.symbolResolver);
      if (groups.length === 0) {
        for (const netId of new Set([net.id, ...ownerNetIds])) {
          deferNetPrune(netId);
        }
        if (!draft.nets.some((candidate) => candidate.id === net.id)) {
          if (draft.mosBulkDefaults?.nmosNetId === net.id) {
            delete draft.mosBulkDefaults.nmosNetId;
          }
          if (draft.mosBulkDefaults?.pmosNetId === net.id) {
            delete draft.mosBulkDefaults.pmosNetId;
          }
        }
        connectivityChanged = true;
        break;
      }
      if (groups.length > 1) {
        // The component containing the authored Route's `from` endpoint (or
        // `to` when `from` was an orphan Junction removed by this cut)
        // retains the original Base-Net identity and non-owner Evidence.
        // Every detached component receives a new Base Net; logical/global/
        // imported Evidence is never allowed to suppress physical splitting.
        const primaryIndex = routeEndpoints(route)
          .map((endpoint) => endpointKey(endpoint))
          .map((key) => groups.findIndex((group) => group.includes(key)))
          .find((index) => index >= 0);
        if (primaryIndex !== undefined && primaryIndex > 0) {
          groups.unshift(...groups.splice(primaryIndex, 1));
        }
        const netIdByEndpoint = new Map<string, string>();
        const splitNetIds = groups
          .slice(1)
          .map((group) =>
            deriveStableId("net-split", net.id, route.id, group[0]!),
          );
        const collidingNetId = splitNetIds.find((splitNetId) =>
          draft.nets.some((candidate) => candidate.id === splitNetId),
        );
        if (collidingNetId) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Derived split Net already exists: ${collidingNetId}`,
            [],
            [collidingNetId],
          );
        }
        groups.forEach((group, index) => {
          const groupNetId =
            index === 0
              ? net.id
              : deriveStableId("net-split", net.id, route.id, group[0]!);
          for (const key of group) netIdByEndpoint.set(key, groupNetId);
        });
        for (const instance of draft.instances) {
          if (instance.mosBulkBinding?.netId !== net.id) continue;
          const bodyNetId = netIdByEndpoint.get(
            endpointKey({
              kind: "terminal",
              instanceId: instance.id,
              pinName: "B",
            }),
          );
          if (bodyNetId && bodyNetId !== net.id) {
            instance.mosBulkBinding.netId = bodyNetId;
            changedObjectIds.add(instance.id);
          }
        }
        const originalTerminals = [...net.terminals];
        const terminalsFor = (groupNetId: string) =>
          originalTerminals.filter(
            (terminal) =>
              netIdByEndpoint.get(
                endpointKey({ kind: "terminal", ...terminal }),
              ) === groupNetId,
          );
        net.terminals = terminalsFor(net.id);
        changedObjectIds.add(net.id);
        for (const group of groups.slice(1)) {
          const groupNetId = netIdByEndpoint.get(group[0]!)!;
          draft.nets.push({
            id: groupNetId,
            terminals: terminalsFor(groupNetId),
          });
          changedObjectIds.add(groupNetId);
        }
        for (const cellTerminal of draft.netlist?.terminals ?? []) {
          if (cellTerminal.netId !== net.id) continue;
          const interfaceInstanceId = cellTerminal.interfaceInstanceIds[0];
          const groupNetId = interfaceInstanceId
            ? netIdByEndpoint.get(
                endpointKey({
                  kind: "terminal",
                  instanceId: interfaceInstanceId,
                  pinName: "P",
                }),
              )
            : undefined;
          if (groupNetId && groupNetId !== cellTerminal.netId) {
            cellTerminal.netId = groupNetId;
            changedObjectIds.add(cellTerminal.id);
          }
        }
        for (const junction of draft.junctions.filter(
          (candidate) => candidate.netId === net.id,
        )) {
          const groupNetId = netIdByEndpoint.get(
            endpointKey({ kind: "junction", junctionId: junction.id }),
          );
          if (groupNetId && groupNetId !== junction.netId) {
            junction.netId = groupNetId;
            changedObjectIds.add(junction.id);
          }
        }
        for (const remainingRoute of draft.routes.filter(
          (candidate) => candidate.netId === net.id,
        )) {
          const fromNetId = netIdByEndpoint.get(
            endpointKey(remainingRoute.start),
          );
          const toNetId = netIdByEndpoint.get(
            endpointKey(routeEndpoints(remainingRoute)[1]),
          );
          if (!fromNetId || fromNetId !== toNetId) {
            return rejectAt(
              "INVALID_RESULT",
              `Cut leaves Route ${remainingRoute.id} across split Nets`,
              [],
              [remainingRoute.id],
            );
          }
          if (remainingRoute.netId !== fromNetId) {
            remainingRoute.netId = fromNetId;
            changedObjectIds.add(remainingRoute.id);
          }
        }
        retargetOwnerEvidenceAfterSplit(
          draft,
          net.id,
          netIdByEndpoint,
          changedObjectIds,
        );
        propagateSpiceSourceEvidenceAfterSplit(
          draft,
          net.id,
          [...new Set(netIdByEndpoint.values())],
          changedObjectIds,
        );
        retargetMosBulkDefaultsAfterSplit(
          draft,
          net.id,
          [...new Set(netIdByEndpoint.values())],
          bulkDefaultIdentity,
          changedObjectIds,
        );
        connectivityChanged = true;
      }
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
        return rejectAt(
          "EDIT_PRECONDITION",
          `Endpoints belong to different Nets; merge ${fromOwner} and ${toOwner} explicitly`,
        );
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

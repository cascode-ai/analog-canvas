import { routeEnd, SchematicDocumentSchema } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import {
  endpointKey,
  logicalNetContractIssueKey,
  validateLogicalNetContract,
} from "@icm/derived";
import { EditTransactionSchema, type EditTransaction } from "./edit-schema.js";
import {
  affectedConductorNetIds,
  normalizeSameNetConductorTopology,
} from "./conductor-topology.js";
import { resolveRouteEditPath } from "./route-operations.js";
import {
  followNetLabelsOnChangedRoutes,
  followRouteMarkersOnChangedRoutes,
  remapRouteMarkersAfterSplit,
  remapNetLabelsAfterSplit,
} from "./transaction-route-annotation-follow.js";
import {
  captureNetLabelRouteAnchors,
  captureRouteMarkerAnchors,
  closestRouteMarkerAnchor,
  pointAtArcFraction,
  type NetLabelRouteAnchor,
  type RouteMarkerAnchor,
} from "./transaction-route-annotations.js";
import {
  applyInstancesRouteFollow,
  splitRoute,
} from "./transaction-route-follow.js";
import {
  reconcileTransformDirectContacts,
  transformMaySeparateDirectContact,
} from "./transaction-direct-contact.js";
import { nextPhysicalContactOperation } from "./transaction-connectivity-normalizer.js";
import { applyCellResetEdit } from "./transaction-cell-reset.js";
import { applyCellInterfaceEdit } from "./transaction-cell-interface.js";
import { applyInstanceLifecycleEdit } from "./transaction-instance-lifecycle.js";
import { applyInstanceNetlistEdit } from "./transaction-instance-netlist.js";
import { applyInstanceSignalFlowEdit } from "./transaction-instance-signal-flow.js";
import { applyInstanceStyleOverrideEdit } from "./transaction-instance-style.js";
import { applyInstanceTransformEdit } from "./transaction-instance-transform.js";
import { applyMosBulkEdit } from "./transaction-mos-bulk.js";
import { applyNetPowerEdit } from "./transaction-net-power.js";
import { applyRouteGeometryEdit } from "./transaction-route-geometry.js";
import { applyRouteStyleOverrideEdit } from "./transaction-route-style.js";
import { applyRouteTopologyEdit } from "./transaction-route-topology.js";
import { applyPresentationLayoutEdit } from "./transaction-presentation-layout.js";
import {
  mergeBaseNets,
  physicalContactLicenseForTransaction,
  preferredPhysicalMergeTarget,
  pruneUnreachableLocalNet,
  reconcileMaterializedMosBulkBindings,
  removeNoConnectForEndpoint,
  retargetConnectivityEvidenceOwner,
  revokeInvalidatedSupplyBulkDefaults,
  uniquePhysicalContactId,
} from "./transaction-connectivity.js";
import {
  addEndpointToNet,
  endpointOwnerNetId,
  routeIsProtected,
  sameResolvedRoutePoints,
  validateRoute,
} from "./transaction-routing.js";
import {
  gridAlignmentDiagnostics,
  isHistoryEdit,
  schemaDiagnostics,
} from "./transaction-preflight.js";
import {
  rejectTransaction,
  type EditDiagnostic,
  type EditDiff,
  type EditErrorCode,
  type EditExecutionContext,
  type EditTransactionResult,
  type RejectedTransaction,
} from "./transaction-result.js";

export * from "./edit-schema.js";
export * from "./transaction-result.js";

export function executeTransaction(
  document: SchematicDocument,
  input: EditTransaction | unknown,
  context: EditExecutionContext = {},
): EditTransactionResult {
  const parsed = EditTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return rejectTransaction(
      document,
      "INVALID_TRANSACTION",
      "Transaction schema validation failed",
      schemaDiagnostics(parsed.error, "INVALID_TRANSACTION"),
    );
  }

  const transaction = parsed.data;
  if (transaction.documentId !== document.id) {
    return rejectTransaction(
      document,
      "DOCUMENT_MISMATCH",
      `Transaction targets ${transaction.documentId}, but the open Document is ${document.id}`,
    );
  }
  if (transaction.expectedRevision !== document.revision) {
    return rejectTransaction(
      document,
      "STALE_REVISION",
      `Expected revision ${transaction.expectedRevision}, actual revision ${document.revision}`,
    );
  }
  if (transaction.edits.some(isHistoryEdit)) {
    return rejectTransaction(
      document,
      "HISTORY_CONTEXT_REQUIRED",
      "Undo and redo require a Document History session",
    );
  }

  const proposedRevision = document.revision + 1;
  const draft = structuredClone(document);
  const explicitlyAuthoredRouteIds = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "set_route_path" || edit.kind === "route_orthogonal"
        ? [edit.kind === "set_route_path" ? edit.route.id : edit.routeId]
        : [],
    ),
  );
  const changedObjectIds = new Set<string>();
  const deferredNetPruneIds = new Set<string>();
  const protectedEvidenceIds = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "upsert_connectivity_evidence" ? [edit.evidence.id] : [],
    ),
  );
  const deferNetPrune = (netId: string): void =>
    pruneUnreachableLocalNet(draft, netId, changedObjectIds, {
      deferInto: deferredNetPruneIds,
    });
  const resolver = context.symbolResolver;
  const transformedInstanceIds = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "move_instance" ||
      edit.kind === "rotate_instance" ||
      edit.kind === "mirror_instance"
        ? [edit.instanceId]
        : // Alignment rewrites placements exactly like a move; leaving it out
          // of the follow set let aligned instances shear their routes.
          edit.kind === "align_instances"
          ? edit.instanceIds
          : // Signal Flow parameters resize the body, which carries the
            // pins with it, and a symbol swap replaces the pin geometry
            // outright: the incident Routes have to re-derive their leads
            // exactly as they do for a move.
            edit.kind === "set_instance_signal_flow_parameters" ||
              edit.kind === "set_instance_symbol"
            ? [edit.instanceId]
            : [],
    ),
  );
  const routeValidationIds = transaction.edits.every((edit) =>
    [
      "noop",
      "move_instance",
      "rotate_instance",
      "mirror_instance",
      "align_instances",
      "set_instance_signal_flow_parameters",
    ].includes(edit.kind),
  )
    ? new Set(
        document.routes.flatMap((route) =>
          [route.start, routeEnd(route)].some(
            (endpoint) =>
              endpoint.kind === "terminal" &&
              transformedInstanceIds.has(endpoint.instanceId),
          )
            ? [route.id]
            : [],
        ),
      )
    : undefined;
  const originalRouteStates = new Map(
    resolver
      ? document.routes
          .filter(
            (route) =>
              routeValidationIds === undefined ||
              routeValidationIds.has(route.id),
          )
          .map((route) => {
            const resolvedPath = resolveRouteEditPath(
              document,
              resolver,
              route,
            );
            return [
              route.id,
              {
                points: resolvedPath?.points ?? null,
                error: validateRoute(document, route, resolver, resolvedPath),
              },
            ];
          })
      : [],
  );
  const originalNetLabelAnchors = resolver
    ? captureNetLabelRouteAnchors(document, resolver, routeValidationIds)
    : [];
  const originalRouteMarkerAnchors = resolver
    ? captureRouteMarkerAnchors(document, resolver, routeValidationIds)
    : [];
  const changedRouteIds = new Set<string>();
  let geometryChanged = false;
  let connectivityChanged = false;

  for (let editIndex = 0; editIndex < transaction.edits.length; editIndex++) {
    const edit = transaction.edits[editIndex]!;
    // rejectAt localizes a runtime rejection to this edit's position in the
    // transaction (`["edits", editIndex]`) so a caller can pinpoint which edit
    // failed without parsing the message string. objectIds are forwarded so a
    // rejection can name the offending route/instance.
    const rejectAt = (
      code: EditErrorCode,
      message: string,
      diagnostics: readonly EditDiagnostic[] = [],
      objectIds?: readonly string[],
    ): RejectedTransaction =>
      rejectTransaction(
        document,
        code,
        message,
        diagnostics,
        ["edits", editIndex],
        objectIds,
      );
    const coordinateDiagnostics = gridAlignmentDiagnostics(
      edit,
      draft.presentation.grid,
    );
    if (coordinateDiagnostics.length > 0) {
      return rejectAt(
        "EDIT_PRECONDITION",
        `Edit coordinates must align to Document grid ${draft.presentation.grid}`,
        coordinateDiagnostics,
      );
    }
    if (
      edit.kind === "align_instances" &&
      edit.coordinate !== undefined &&
      edit.coordinate % draft.presentation.grid !== 0
    ) {
      return rejectAt(
        "EDIT_PRECONDITION",
        `Alignment coordinate must align to Document grid ${draft.presentation.grid}`,
        [
          {
            code: "GRID_ALIGNMENT",
            severity: "error",
            message: `Document page coordinates must align to grid ${draft.presentation.grid}`,
            path: ["coordinate"],
          },
        ],
      );
    }
    switch (edit.kind) {
      case "noop":
      case "undo":
      case "redo":
        continue;
      case "clear_cell_drawing":
      case "reset_cell_placement":
      case "reset_cell_body": {
        const outcome = applyCellResetEdit(edit, {
          draft,
          changedObjectIds,
          deferNetPrune,
        });
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        geometryChanged ||= outcome.geometryChanged;
        break;
      }
      case "add_instance":
      case "remove_instance":
      case "add_no_connect":
      case "remove_no_connect":
      case "set_instance_symbol": {
        const outcome = applyInstanceLifecycleEdit(edit, {
          draft,
          resolver,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "place_instance":
      case "unplace_instance":
      case "move_instance":
      case "rotate_instance":
      case "mirror_instance": {
        const outcome = applyInstanceTransformEdit(edit, {
          draft,
          resolver,
          changedObjectIds,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        break;
      }
      case "set_instance_style_override": {
        const outcome = applyInstanceStyleOverrideEdit(edit, {
          draft,
          changedObjectIds,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        break;
      }
      case "set_route_style_override": {
        const outcome = applyRouteStyleOverrideEdit(edit, {
          draft,
          changedObjectIds,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        break;
      }
      case "set_instance_signal_flow_parameters": {
        const outcome = applyInstanceSignalFlowEdit(edit, {
          draft,
          changedObjectIds,
          resolver,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        geometryChanged ||= outcome.geometryChanged ?? false;
        break;
      }
      case "patch_instance_netlist_parameters":
      case "set_instance_reference":
      case "set_instance_schematic_reference":
      case "set_instance_schematic_name":
      case "set_instance_binding":
      case "set_instance_netlist":
      case "bulk_patch_instance_netlist": {
        const outcome = applyInstanceNetlistEdit(edit, {
          draft,
          changedObjectIds,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "add_cell_terminal":
      case "update_cell_terminal":
      case "remove_cell_terminal":
      case "reorder_cell_terminals":
      case "set_cell_formal_parameters": {
        const outcome = applyCellInterfaceEdit(edit, {
          draft,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        if (outcome.connectivityChanged) connectivityChanged = true;
        break;
      }
      case "set_route_path":
      case "route_orthogonal": {
        const outcome = applyRouteGeometryEdit(edit, {
          draft,
          resolver,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "add_junction":
      case "attach_endpoint_to_route":
      case "remove_junction":
      case "move_junction": {
        const outcome = applyRouteTopologyEdit(edit, {
          draft,
          resolver,
          explicitlyAuthoredRouteIds,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "remove_route_geometry": {
        const outcome = applyRouteGeometryEdit(edit, {
          draft,
          resolver,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "cut_connection":
      case "connect_endpoints": {
        const outcome = applyRouteTopologyEdit(edit, {
          draft,
          resolver,
          explicitlyAuthoredRouteIds,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "add_power_rail":
      case "merge_nets":
      case "upsert_connectivity_evidence":
      case "remove_connectivity_evidence": {
        const outcome = applyNetPowerEdit(edit, {
          draft,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "set_mos_bulk_defaults":
      case "reconcile_mos_bulk":
      case "clear_mos_bulk_default": {
        const outcome = applyMosBulkEdit(edit, {
          draft,
          resolver,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "disconnect_endpoint": {
        const outcome = applyRouteTopologyEdit(edit, {
          draft,
          resolver,
          explicitlyAuthoredRouteIds,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        connectivityChanged ||= outcome.connectivityChanged ?? false;
        break;
      }
      case "set_presentation_style":
      case "set_cell_symbol_presentation":
      case "upsert_schematic_annotation":
      case "remove_schematic_annotation":
      case "upsert_drafting_object":
      case "remove_drafting_object":
      case "set_layout_group":
      case "remove_layout_group":
      case "set_layout_constraint":
      case "remove_layout_constraint":
      case "align_instances": {
        const outcome = applyPresentationLayoutEdit(edit, {
          draft,
          resolver,
          changedObjectIds,
          deferNetPrune,
          reject: rejectAt,
        });
        if (!outcome.ok) return outcome.rejection;
        if (outcome.connectivityChanged) connectivityChanged = true;
        break;
      }
    }
    geometryChanged = true;
  }

  if (resolver && transformedInstanceIds.size > 0) {
    // One user-visible transform may require several persisted orientation
    // edits (for example a top-bottom screen reflection is mirror + rotate).
    // Follow Routes once from the transaction's original geometry to the
    // final placement, never through invalid intermediate orientations.
    const followedRouteIds = applyInstancesRouteFollow(
      draft,
      document,
      resolver,
      resolver,
      transformedInstanceIds,
      explicitlyAuthoredRouteIds,
    );
    for (const routeId of followedRouteIds) {
      const collapsed = !draft.routes.some((route) => route.id === routeId);
      if (collapsed) {
        const anchoredAnnotation = draft.annotations.find(
          (annotation) =>
            annotation.anchor.kind === "route" &&
            annotation.anchor.routeId === routeId,
        );
        const layoutReference = [
          ...draft.layoutGroups,
          ...draft.constraints,
        ].find((item) => item.objectIds.includes(routeId));
        const evidenceReference = draft.connectivityEvidence.find(
          (evidence) =>
            evidence.kind === "name-claim" &&
            evidence.owner.kind === "power-marker" &&
            evidence.owner.objectId === routeId,
        );
        const referenceId =
          anchoredAnnotation?.id ??
          layoutReference?.id ??
          evidenceReference?.id ??
          null;
        if (referenceId) {
          return rejectTransaction(
            document,
            "EDIT_PRECONDITION",
            `Transform would collapse Route ${routeId} into direct contact while ${referenceId} still references it`,
            [],
            [routeId, referenceId],
          );
        }
      }
      changedObjectIds.add(routeId);
      changedRouteIds.add(routeId);
    }
  }

  if (
    resolver &&
    transaction.edits.some(
      (edit) =>
        edit.kind === "move_instance" ||
        edit.kind === "rotate_instance" ||
        edit.kind === "mirror_instance" ||
        // Any edit that moves a pin can pull a zero-length direct contact
        // apart, leaving invisible connectivity behind: alignment, junction
        // moves, and a Signal Flow resize that carries the pins outward.
        edit.kind === "align_instances" ||
        edit.kind === "move_junction" ||
        edit.kind === "set_instance_signal_flow_parameters" ||
        edit.kind === "set_instance_symbol",
    )
  ) {
    const movedJunctionIds = new Set(
      transaction.edits.flatMap((edit) =>
        edit.kind === "move_junction" ? [edit.junctionId] : [],
      ),
    );
    if (
      transformMaySeparateDirectContact(
        document,
        resolver,
        transformedInstanceIds,
        movedJunctionIds,
      )
    ) {
      const directContact = reconcileTransformDirectContacts(
        document,
        draft,
        resolver,
        transaction.transactionId,
        changedObjectIds,
      );
      geometryChanged ||= directContact.geometryChanged;
      for (const routeId of directContact.changedRouteIds) {
        changedRouteIds.add(routeId);
      }
    }
  }

  if (resolver) {
    // Keep geometry incidence separate from the broader transaction diff.
    // Net merges retarget many Routes for bookkeeping, but that must not turn
    // an otherwise local edit into a whole-document geometry repair.
    const physicalContactLicense =
      physicalContactLicenseForTransaction(transaction);
    const suppressedPhysicalEndpointKeys = new Set(
      transaction.edits.flatMap((edit) =>
        edit.kind === "disconnect_endpoint" ? [endpointKey(edit.endpoint)] : [],
      ),
    );
    const operationLimit = Math.max(
      32,
      (draft.instances.length + draft.junctions.length) *
        Math.max(2, draft.routes.length + 1) *
        2,
    );
    for (
      let operationIndex = 0;
      operationIndex < operationLimit;
      operationIndex += 1
    ) {
      const operation = nextPhysicalContactOperation(
        draft,
        resolver,
        physicalContactLicense,
        suppressedPhysicalEndpointKeys,
      );
      if (!operation) break;

      if (operation.kind === "connect-endpoints") {
        let leftOwner = endpointOwnerNetId(draft, operation.left);
        let rightOwner = endpointOwnerNetId(draft, operation.right);
        if (!leftOwner && !rightOwner) {
          const netId = uniquePhysicalContactId(
            draft,
            "net",
            transaction.transactionId,
            [endpointKey(operation.left), endpointKey(operation.right)]
              .sort((left, right) => left.localeCompare(right, "en"))
              .join("--"),
          );
          draft.nets.push({ id: netId, terminals: [] });
          changedObjectIds.add(netId);
          leftOwner = netId;
          rightOwner = netId;
        } else if (!leftOwner) {
          leftOwner = rightOwner;
        } else if (!rightOwner) {
          rightOwner = leftOwner;
        }
        if (!leftOwner || !rightOwner) {
          return rejectTransaction(
            document,
            "INVALID_RESULT",
            "Physical contact normalization could not assign a Base Net",
          );
        }
        if (leftOwner !== rightOwner) {
          const [targetNetId, sourceNetId] = preferredPhysicalMergeTarget(
            draft,
            leftOwner,
            rightOwner,
          );
          const merge = mergeBaseNets(
            draft,
            targetNetId,
            sourceNetId,
            changedObjectIds,
          );
          if (!merge.ok) {
            return rejectTransaction(
              document,
              merge.code,
              merge.message,
              [],
              merge.netIds,
            );
          }
          leftOwner = targetNetId;
          rightOwner = targetNetId;
        }
        addEndpointToNet(draft, leftOwner, operation.left);
        addEndpointToNet(draft, rightOwner, operation.right);
        removeNoConnectForEndpoint(draft, operation.left, changedObjectIds);
        removeNoConnectForEndpoint(draft, operation.right, changedObjectIds);
        changedObjectIds.add(leftOwner);
        connectivityChanged = true;
        continue;
      }

      let route = draft.routes.find(
        (candidate) => candidate.id === operation.routeId,
      );
      if (!route) {
        return rejectTransaction(
          document,
          "INVALID_RESULT",
          `Physical contact Route disappeared: ${operation.routeId}`,
        );
      }
      if (routeIsProtected(route)) {
        return rejectTransaction(
          document,
          "EDIT_PRECONDITION",
          `Cannot attach a physical contact to locked Route ${route.id}`,
          [],
          [route.id],
        );
      }
      const endpointOwner = endpointOwnerNetId(draft, operation.endpoint);
      if (endpointOwner && endpointOwner !== route.netId) {
        const [targetNetId, sourceNetId] = preferredPhysicalMergeTarget(
          draft,
          endpointOwner,
          route.netId,
        );
        const merge = mergeBaseNets(
          draft,
          targetNetId,
          sourceNetId,
          changedObjectIds,
        );
        if (!merge.ok) {
          return rejectTransaction(
            document,
            merge.code,
            merge.message,
            [],
            merge.netIds,
          );
        }
        route = draft.routes.find(
          (candidate) => candidate.id === operation.routeId,
        );
        if (!route) {
          return rejectTransaction(
            document,
            "INVALID_RESULT",
            `Physical contact Route disappeared after Net merge: ${operation.routeId}`,
          );
        }
      }
      const markerAnchors = captureRouteMarkerAnchors(draft, resolver).filter(
        (anchor) => anchor.routeId === route.id,
      );
      const netLabelAnchors = captureNetLabelRouteAnchors(
        draft,
        resolver,
      ).filter((anchor) => anchor.routeId === route.id);
      const seed = `${route.id}:${endpointKey(operation.endpoint)}:${operation.point.x},${operation.point.y}`;
      // Keep the original ID on the from-side so selection, drag state, and
      // callers holding a revision-local Route address remain valid after an
      // automatic split. Only the newly created far side needs a fresh ID.
      const firstRouteId = route.id;
      const secondRouteId = uniquePhysicalContactId(
        draft,
        "route",
        transaction.transactionId,
        `${seed}:second`,
      );
      const split = splitRoute(
        draft,
        route,
        operation.endpoint,
        operation.point,
        firstRouteId,
        secondRouteId,
        operation.segmentIndex,
        resolver,
      );
      if (typeof split === "string") {
        return rejectTransaction(
          document,
          "EDIT_PRECONDITION",
          split,
          [],
          [route.id],
        );
      }
      addEndpointToNet(draft, route.netId, operation.endpoint);
      const routeIndex = draft.routes.findIndex(
        (candidate) => candidate.id === route!.id,
      );
      draft.routes.splice(routeIndex, 1, split.first, split.second);
      retargetConnectivityEvidenceOwner(
        draft,
        route.id,
        split.first.id,
        changedObjectIds,
      );
      for (const candidate of [split.first, split.second]) {
        const routeError = validateRoute(draft, candidate, resolver);
        if (routeError) {
          return rejectTransaction(
            document,
            "EDIT_PRECONDITION",
            routeError,
            [],
            [candidate.id],
          );
        }
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
      removeNoConnectForEndpoint(draft, operation.endpoint, changedObjectIds);
      for (const routeId of [route.id, split.first.id, split.second.id]) {
        changedObjectIds.add(routeId);
        changedRouteIds.add(routeId);
      }
      // Split products inherit only the license the split consumed: a
      // conductor this transaction introduced stays licensed end to end,
      // and a typed attach point stays licensed wherever it now lies — but
      // a split forced by a licensed Junction must not open the rest of
      // the conductor to unrelated parked geometry.
      if (physicalContactLicense.objectIds.has(route.id)) {
        physicalContactLicense.objectIds.add(split.first.id);
        physicalContactLicense.objectIds.add(split.second.id);
      }
      const licensedPoints = physicalContactLicense.routePoints.get(route.id);
      if (licensedPoints) {
        for (const productId of [split.first.id, split.second.id]) {
          const points =
            physicalContactLicense.routePoints.get(productId) ??
            new Set<string>();
          for (const point of licensedPoints) points.add(point);
          physicalContactLicense.routePoints.set(productId, points);
        }
      }
      changedObjectIds.add(route.netId);
      connectivityChanged = true;
      geometryChanged = true;

      if (operationIndex === operationLimit - 1) {
        return rejectTransaction(
          document,
          "INVALID_RESULT",
          "Physical contact normalization did not converge",
        );
      }
    }
  }

  if (resolver) {
    const affectedNetIds = affectedConductorNetIds(
      document,
      draft,
      changedObjectIds,
      changedRouteIds,
      transformedInstanceIds,
    );
    const normalized = normalizeSameNetConductorTopology(
      draft,
      resolver,
      affectedNetIds,
      {
        preserveJunctionIds: new Set(
          transaction.edits.flatMap((edit) =>
            edit.kind === "add_junction" ? [edit.junctionId] : [],
          ),
        ),
      },
    );
    if (normalized.changed) {
      geometryChanged = true;
      for (const objectId of normalized.changedObjectIds) {
        changedObjectIds.add(objectId);
      }
      for (const routeId of normalized.changedRouteIds) {
        changedRouteIds.add(routeId);
      }
    }
  }

  const invalidatedBulkDefault = revokeInvalidatedSupplyBulkDefaults(
    document,
    draft,
    changedObjectIds,
    deferNetPrune,
  );
  connectivityChanged ||= invalidatedBulkDefault;
  const reconciledBulkBinding = reconcileMaterializedMosBulkBindings(
    draft,
    changedObjectIds,
    deferNetPrune,
  );
  connectivityChanged ||= reconciledBulkBinding;
  const netCountBeforeDeferredPrune = draft.nets.length;
  const evidenceCountBeforeDeferredPrune = draft.connectivityEvidence.length;
  for (const netId of deferredNetPruneIds) {
    pruneUnreachableLocalNet(draft, netId, changedObjectIds, {
      protectedEvidenceIds,
    });
  }
  connectivityChanged ||=
    draft.nets.length !== netCountBeforeDeferredPrune ||
    draft.connectivityEvidence.length !== evidenceCountBeforeDeferredPrune;

  const originalNetContractIssueKeys = connectivityChanged
    ? new Set(
        validateLogicalNetContract(document).map(logicalNetContractIssueKey),
      )
    : new Set<string>();
  const introducedNetContractIssue = connectivityChanged
    ? validateLogicalNetContract(draft).find(
        (issue) =>
          !originalNetContractIssueKeys.has(logicalNetContractIssueKey(issue)),
      )
    : undefined;
  if (introducedNetContractIssue) {
    const message =
      introducedNetContractIssue.code === "CONFLICTING_LOGICAL_NET_SCOPE"
        ? "Transaction introduces conflicting Logical Net scopes"
        : introducedNetContractIssue.code ===
            "CONFLICTING_LOGICAL_NET_POWER_DOMAIN"
          ? "Transaction connects incompatible power markers"
          : "Transaction introduces conflicting Logical Net names";
    return rejectTransaction(
      document,
      "INVALID_RESULT",
      message,
      [],
      introducedNetContractIssue.netIds,
    );
  }

  if (resolver) {
    const routesToValidate =
      routeValidationIds === undefined
        ? draft.routes
        : draft.routes.filter(
            (route) =>
              routeValidationIds.has(route.id) || changedRouteIds.has(route.id),
          );
    for (const route of routesToValidate) {
      const original = originalRouteStates.get(route.id);
      const resolvedPath = resolveRouteEditPath(draft, resolver, route);
      const routeError = validateRoute(draft, route, resolver, resolvedPath);
      const resolvedPoints = resolvedPath?.points ?? null;
      const resolvedGeometryChanged =
        original === undefined ||
        !sameResolvedRoutePoints(original.points, resolvedPoints);
      if (routeError) {
        const unchangedPreexistingError =
          original !== undefined &&
          !resolvedGeometryChanged &&
          original.error === routeError;
        if (!unchangedPreexistingError) {
          return rejectTransaction(
            document,
            "INVALID_RESULT",
            `Transaction leaves invalid Route geometry for ${route.id}: ${routeError}`,
            [],
            ["routes", route.id],
          );
        }
      }
      if (original !== undefined && resolvedGeometryChanged) {
        changedObjectIds.add(route.id);
        changedRouteIds.add(route.id);
      }
    }
    followNetLabelsOnChangedRoutes(
      draft,
      resolver,
      originalNetLabelAnchors,
      changedRouteIds,
      changedObjectIds,
    );
    followRouteMarkersOnChangedRoutes(
      draft,
      resolver,
      originalRouteMarkerAnchors,
      changedRouteIds,
      changedObjectIds,
    );
  }

  if (connectivityChanged) {
    draft.sourceStatus = "connectivity-modified";
  } else if (geometryChanged && draft.sourceStatus === "in-sync") {
    draft.sourceStatus = "geometry-only-changed";
  }
  draft.revision = proposedRevision;

  const candidate = SchematicDocumentSchema.safeParse(draft);
  if (!candidate.success) {
    return rejectTransaction(
      document,
      "INVALID_RESULT",
      "Transaction result failed Document validation",
      schemaDiagnostics(candidate.error, "INVALID_RESULT"),
    );
  }

  const diff: EditDiff = {
    documentId: document.id,
    fromRevision: document.revision,
    toRevision: proposedRevision,
    editKinds: transaction.edits.map((edit) => edit.kind),
    changedObjectIds: [...changedObjectIds].sort(),
  };

  if (transaction.dryRun === true) {
    // Return the validated candidate (draft) so callers can inspect the
    // proposed geometry, not the pre-edit Document. The caller never commits
    // this: the Adapter only commits when `applied` is true.
    return {
      ok: true,
      applied: false,
      revision: document.revision,
      proposedRevision,
      document: candidate.data,
      diff,
      diagnostics: [],
    };
  }

  return {
    ok: true,
    applied: true,
    revision: candidate.data.revision,
    proposedRevision,
    document: candidate.data,
    diff,
    diagnostics: [],
  };
}

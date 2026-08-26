import {
  AnnotationSchema,
  ConnectivityEvidenceSchema,
  InstanceSchema,
  JunctionSchema,
  NoConnectSchema,
  SchematicDocumentSchema,
  deriveStableId,
} from "@icm/model";
import { createReferenceIndex, referenceIssuesForInstance } from "@icm/devices";
import type { RouteBranch, SchematicDocument } from "@icm/model";
import {
  endpointKey,
  hasExplicitMosBulkRoute,
  isMosBulkRoute,
  logicalNetContractIssueKey,
  mosBulkKind,
  resolveDetachedMosBulkDefault,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  resolveMosBulkConnection,
  validateLogicalNetContract,
} from "@icm/derived";
import { EditTransactionSchema, type EditTransaction } from "./edit-schema.js";
import {
  buildOrthogonalEscapeRoute,
  normalizeRouteGeometry,
} from "./route-geometry-edit.js";
import { resolveRouteEditPath } from "./route-operations.js";
import {
  followNetLabelsOnChangedRoutes,
  followRouteMarkersOnChangedRoutes,
  remapRouteMarkersAfterSplit,
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
  applyInstanceRouteFollow,
  splitRoute,
} from "./transaction-route-follow.js";
import {
  followAttachedAnnotations,
  refreshInstanceValueAnnotation,
} from "./transaction-instance-annotations.js";
import { reconcileTransformDirectContacts } from "./transaction-direct-contact.js";
import { nextPhysicalContactOperation } from "./transaction-connectivity-normalizer.js";
import { applyCellInterfaceEdit } from "./transaction-cell-interface.js";
import { applyPresentationLayoutEdit } from "./transaction-presentation-layout.js";
import {
  type BulkDefaultIdentity,
  connectivityEvidenceNetIds,
  implicitBulkPresentation,
  mergeBaseNets,
  physicalContactObjectIdsForTransaction,
  preferredPhysicalMergeTarget,
  propagateSpiceSourceEvidenceAfterSplit,
  pruneUnreachableLocalNet,
  reconcileMaterializedMosBulkBindings,
  removeConnectivityEvidenceOwnedBy,
  removeNoConnectForEndpoint,
  retargetConnectivityEvidenceOwner,
  retargetMosBulkDefaultsAfterSplit,
  retargetOwnerEvidenceAfterSplit,
  revokeInvalidatedSupplyBulkDefaults,
  uniquePhysicalContactId,
} from "./transaction-connectivity.js";
import {
  addEndpointToNet,
  endpointOwnerNetId,
  lockedLayoutOwner,
  netEndpointGroups,
  routeFromEdit,
  routeIsProtected,
  sameResolvedRoutePoints,
  validateConnectableEndpoint,
  validateRoute,
} from "./transaction-routing.js";
import {
  gridAlignmentDiagnostics,
  isHistoryEdit,
  schemaDiagnostics,
  snapPointToDocumentGrid,
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

function referencePolicyFailure(
  draft: SchematicDocument,
  instanceId: string,
): string | null {
  const issue = referenceIssuesForInstance(
    createReferenceIndex(draft),
    instanceId,
  )[0];
  if (!issue) return null;
  switch (issue.code) {
    case "MISSING_REFERENCE":
      return "This component requires a netlist reference";
    case "UNEXPECTED_REFERENCE":
      return "This symbol does not emit a netlist reference";
    case "WRONG_REFERENCE_PREFIX":
      return `Reference ${issue.reference} does not match this component prefix`;
    case "DUPLICATE_REFERENCE":
      return `Reference ${issue.reference} is already used by ${issue.otherInstanceId}`;
  }
}

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
  const originalNetContractIssueKeys = new Set(
    validateLogicalNetContract(document).map(logicalNetContractIssueKey),
  );
  const explicitlyAuthoredRouteIds = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "set_route_points" || edit.kind === "route_orthogonal"
        ? [edit.routeId]
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
  const originalRouteStates = new Map(
    resolver
      ? document.routes.map((route) => [
          route.id,
          {
            points:
              resolveRouteEditPath(document, resolver, route)?.points ?? null,
            error: validateRoute(document, route, resolver),
          },
        ])
      : [],
  );
  const originalNetLabelAnchors = resolver
    ? captureNetLabelRouteAnchors(document, resolver)
    : [];
  const originalRouteMarkerAnchors = resolver
    ? captureRouteMarkerAnchors(document, resolver)
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
      case "clear_cell_drawing": {
        const routeIds = new Set(draft.routes.map((route) => route.id));
        const ownerNetIds = removeConnectivityEvidenceOwnedBy(
          draft,
          routeIds,
          changedObjectIds,
        );
        for (const object of [
          ...draft.routes,
          ...(draft.drafting?.objects ?? []),
        ]) {
          changedObjectIds.add(object.id);
        }
        draft.routes = [];
        draft.drafting = { objects: [] };
        for (const netId of ownerNetIds) {
          deferNetPrune(netId);
        }
        if (ownerNetIds.length > 0) connectivityChanged = true;
        geometryChanged = true;
        break;
      }
      case "reset_cell_placement": {
        const routeIds = new Set(draft.routes.map((route) => route.id));
        const ownerNetIds = removeConnectivityEvidenceOwnedBy(
          draft,
          routeIds,
          changedObjectIds,
        );
        for (const object of [
          ...draft.instances.filter((instance) => instance.placement !== null),
          ...draft.routes,
          ...draft.layoutGroups,
          ...draft.constraints,
        ]) {
          changedObjectIds.add(object.id);
        }
        for (const instance of draft.instances) instance.placement = null;
        draft.routes = [];
        draft.layoutGroups = [];
        draft.constraints = [];
        for (const netId of ownerNetIds) {
          deferNetPrune(netId);
        }
        if (ownerNetIds.length > 0) connectivityChanged = true;
        geometryChanged = true;
        break;
      }
      case "reset_cell_body": {
        const cellPinInstanceIds = new Set(
          draft.netlist?.terminals.flatMap(
            (terminal) => terminal.interfaceInstanceIds,
          ) ?? [],
        );
        const interfaceNetIds = new Set(
          draft.netlist?.terminals.map((terminal) => terminal.netId) ?? [],
        );
        const retainedInstances = draft.instances.filter((instance) =>
          cellPinInstanceIds.has(instance.id),
        );
        const retainedNets = draft.nets
          .filter((net) => interfaceNetIds.has(net.id))
          .map((net) => ({
            ...net,
            terminals: net.terminals.filter((terminal) =>
              cellPinInstanceIds.has(terminal.instanceId),
            ),
          }));
        const retainedAnnotations = draft.annotations.filter(
          (annotation) =>
            annotation.anchor.kind === "object" &&
            cellPinInstanceIds.has(annotation.anchor.objectId),
        );
        const retainedAnnotationIds = new Set(
          retainedAnnotations.map((annotation) => annotation.id),
        );
        const retainedEvidence = draft.connectivityEvidence.filter(
          (evidence) => {
            if (evidence.kind === "explicit-equivalence") {
              return evidence.memberNetIds.every((netId) =>
                interfaceNetIds.has(netId),
              );
            }
            if (!interfaceNetIds.has(evidence.netId)) return false;
            if (evidence.kind !== "name-claim") return true;
            switch (evidence.owner.kind) {
              case "explicit-net-property":
                return true;
              case "net-label":
                return retainedAnnotationIds.has(evidence.owner.annotationId);
              case "power-marker":
                return (
                  cellPinInstanceIds.has(evidence.owner.objectId) ||
                  retainedAnnotationIds.has(evidence.owner.objectId)
                );
            }
          },
        );
        const retainedIds = new Set([
          ...retainedInstances.map((instance) => instance.id),
          ...retainedNets.map((net) => net.id),
          ...retainedAnnotations.map((annotation) => annotation.id),
          ...retainedEvidence.map((evidence) => evidence.id),
        ]);
        for (const object of [
          ...draft.instances,
          ...draft.nets,
          ...draft.routes,
          ...draft.junctions,
          ...draft.noConnects,
          ...draft.annotations,
          ...draft.connectivityEvidence,
          ...draft.layoutGroups,
          ...draft.constraints,
          ...(draft.drafting?.objects ?? []),
        ]) {
          if (!retainedIds.has(object.id)) changedObjectIds.add(object.id);
        }
        for (const retainedNet of retainedNets) {
          const sourceNet = draft.nets.find((net) => net.id === retainedNet.id);
          if (sourceNet?.terminals.length !== retainedNet.terminals.length) {
            changedObjectIds.add(retainedNet.id);
          }
        }
        draft.instances = retainedInstances;
        draft.nets = retainedNets;
        draft.routes = [];
        draft.junctions = [];
        draft.noConnects = [];
        draft.annotations = retainedAnnotations;
        draft.connectivityEvidence = retainedEvidence;
        draft.layoutGroups = [];
        draft.constraints = [];
        draft.drafting = { objects: [] };
        if (draft.mosBulkDefaults) changedObjectIds.add(draft.id);
        delete draft.mosBulkDefaults;
        connectivityChanged = true;
        geometryChanged = true;
        break;
      }
      case "add_instance": {
        const objectIdExists = [
          ...draft.instances,
          ...draft.nets,
          ...draft.routes,
          ...draft.junctions,
          ...draft.noConnects,
          ...draft.annotations,
          ...draft.layoutGroups,
          ...draft.constraints,
        ].some((candidate) => candidate.id === edit.instance.id);
        if (objectIdExists) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Object ID already exists: ${edit.instance.id}`,
          );
        }
        const resolver = context.symbolResolver;
        if (
          !resolver?.resolve(
            edit.instance.symbolId,
            edit.instance.symbolVariantId,
          )
        ) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Symbol does not exist: ${edit.instance.symbolId}`,
          );
        }
        draft.instances.push(InstanceSchema.parse(edit.instance));
        changedObjectIds.add(edit.instance.id);
        connectivityChanged = true;
        break;
      }
      case "remove_instance": {
        const index = draft.instances.findIndex(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (index < 0) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const referenced =
          draft.nets.some((net) =>
            net.terminals.some(
              (terminal) => terminal.instanceId === edit.instanceId,
            ),
          ) ||
          draft.noConnects.some(
            (noConnect) =>
              noConnect.endpoint.kind === "terminal" &&
              noConnect.endpoint.instanceId === edit.instanceId,
          ) ||
          draft.annotations.some(
            (annotation) =>
              annotation.anchor.kind === "object" &&
              annotation.anchor.objectId === edit.instanceId,
          ) ||
          draft.layoutGroups.some((group) =>
            group.objectIds.includes(edit.instanceId),
          ) ||
          draft.constraints.some((constraint) =>
            constraint.objectIds.includes(edit.instanceId),
          );
        if (referenced) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance is still connected or referenced: ${edit.instanceId}`,
          );
        }
        const ownerNetIds = removeConnectivityEvidenceOwnedBy(
          draft,
          new Set([edit.instanceId]),
          changedObjectIds,
        );
        draft.instances.splice(index, 1);
        changedObjectIds.add(edit.instanceId);
        for (const netId of ownerNetIds) {
          deferNetPrune(netId);
        }
        connectivityChanged = true;
        break;
      }
      case "add_no_connect": {
        const idExists = [
          ...draft.instances,
          ...draft.nets,
          ...draft.routes,
          ...draft.junctions,
          ...draft.noConnects,
          ...draft.annotations,
          ...draft.layoutGroups,
          ...draft.constraints,
        ].some((candidate) => candidate.id === edit.noConnect.id);
        if (idExists) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Object ID already exists: ${edit.noConnect.id}`,
          );
        }
        draft.noConnects.push(NoConnectSchema.parse(edit.noConnect));
        changedObjectIds.add(edit.noConnect.id);
        connectivityChanged = true;
        break;
      }
      case "remove_no_connect": {
        const index = draft.noConnects.findIndex(
          (candidate) => candidate.id === edit.noConnectId,
        );
        if (index < 0) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `NoConnect does not exist: ${edit.noConnectId}`,
            [],
            [edit.noConnectId],
          );
        }
        draft.noConnects.splice(index, 1);
        changedObjectIds.add(edit.noConnectId);
        connectivityChanged = true;
        break;
      }
      case "set_instance_symbol": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
        if (lockOwner) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
          );
        }
        const resolver = context.symbolResolver;
        if (!resolver) {
          return rejectAt(
            "EDIT_CONTEXT_REQUIRED",
            "Symbol edits require a Symbol Resolver",
          );
        }
        const symbolVariantId = edit.symbolVariantId ?? undefined;
        const resolved = resolver.resolve(edit.symbolId, symbolVariantId);
        if (!resolved) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Symbol or variant does not exist: ${edit.symbolId}${symbolVariantId ? `/${symbolVariantId}` : ""}`,
          );
        }
        const targetPins = new Set(
          resolved.definition.pins.map((pin) => pin.name),
        );
        const pinMap = edit.pinMap ?? {};
        if (
          instance.netlist?.binding?.kind === "subcircuit" &&
          instance.importProvenance?.terminalMapping
        ) {
          instance.importProvenance.terminalMapping =
            instance.importProvenance.terminalMapping.filter((terminal) =>
              targetPins.has(pinMap[terminal.pinName] ?? terminal.pinName),
            );
        }
        const currentPins = new Set(
          draft.nets.flatMap((net) =>
            net.terminals
              .filter((terminal) => terminal.instanceId === edit.instanceId)
              .map((terminal) => terminal.pinName),
          ),
        );
        for (const route of draft.routes) {
          for (const endpoint of [route.from, route.to]) {
            if (
              endpoint.kind === "terminal" &&
              endpoint.instanceId === edit.instanceId
            ) {
              currentPins.add(endpoint.pinName);
            }
          }
        }
        for (const noConnect of draft.noConnects) {
          if (noConnect.endpoint.instanceId === edit.instanceId) {
            currentPins.add(noConnect.endpoint.pinName);
          }
        }
        for (const terminal of instance.importProvenance?.terminalMapping ??
          []) {
          currentPins.add(terminal.pinName);
        }
        for (const sourcePin of Object.keys(pinMap)) {
          if (!currentPins.has(sourcePin)) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Pin map source is not connected or routed: ${edit.instanceId}.${sourcePin}`,
            );
          }
        }
        const mappedPins = new Map<string, string>();
        for (const sourcePin of currentPins) {
          const targetPin = pinMap[sourcePin] ?? sourcePin;
          if (!targetPins.has(targetPin)) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Target symbol pin does not exist: ${edit.instanceId}.${targetPin}`,
            );
          }
          const previousSource = mappedPins.get(targetPin);
          if (previousSource && previousSource !== sourcePin) {
            const ownerNetIds = new Set(
              draft.nets.flatMap((net) =>
                net.terminals.some(
                  (terminal) =>
                    terminal.instanceId === edit.instanceId &&
                    (terminal.pinName === previousSource ||
                      terminal.pinName === sourcePin),
                )
                  ? [net.id]
                  : [],
              ),
            );
            if (ownerNetIds.size > 1) {
              return rejectAt(
                "EDIT_PRECONDITION",
                `Pin map aliases ${previousSource} and ${sourcePin} to ${targetPin} before their Nets are merged`,
              );
            }
          }
          mappedPins.set(targetPin, sourcePin);
        }
        for (const net of draft.nets) {
          let changed = false;
          for (const terminal of net.terminals) {
            if (terminal.instanceId !== edit.instanceId) continue;
            terminal.pinName = pinMap[terminal.pinName] ?? terminal.pinName;
            changed = true;
          }
          if (changed) changedObjectIds.add(net.id);
          if (changed) {
            net.terminals = net.terminals.filter(
              (terminal, index, terminals) =>
                terminals.findIndex(
                  (candidate) =>
                    candidate.instanceId === terminal.instanceId &&
                    candidate.pinName === terminal.pinName,
                ) === index,
            );
          }
        }
        for (const route of draft.routes) {
          let changed = false;
          for (const endpoint of [route.from, route.to]) {
            if (
              endpoint.kind === "terminal" &&
              endpoint.instanceId === edit.instanceId
            ) {
              endpoint.pinName = pinMap[endpoint.pinName] ?? endpoint.pinName;
              changed = true;
            }
          }
          if (changed) changedObjectIds.add(route.id);
        }
        for (const noConnect of draft.noConnects) {
          if (noConnect.endpoint.instanceId !== edit.instanceId) continue;
          noConnect.endpoint.pinName =
            pinMap[noConnect.endpoint.pinName] ?? noConnect.endpoint.pinName;
          changedObjectIds.add(noConnect.id);
        }
        if (instance.importProvenance?.terminalMapping) {
          instance.importProvenance.terminalMapping =
            instance.importProvenance.terminalMapping.map((terminal) => ({
              ...terminal,
              pinName: pinMap[terminal.pinName] ?? terminal.pinName,
            }));
        }
        instance.symbolId = edit.symbolId;
        if (symbolVariantId === undefined) delete instance.symbolVariantId;
        else instance.symbolVariantId = symbolVariantId;
        changedObjectIds.add(instance.id);
        break;
      }
      case "place_instance": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
        if (lockOwner) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
          );
        }
        if (instance.placement !== null) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance is already placed: ${edit.instanceId}`,
          );
        }
        instance.placement = structuredClone(edit.placement);
        changedObjectIds.add(edit.instanceId);
        break;
      }
      case "unplace_instance": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
        if (lockOwner) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
          );
        }
        if (instance.placement === null) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance is already unplaced: ${edit.instanceId}`,
          );
        }
        if (
          draft.routes.some((route) =>
            [route.from, route.to].some(
              (endpoint) =>
                endpoint.kind === "terminal" &&
                endpoint.instanceId === edit.instanceId,
            ),
          )
        ) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance has routed terminals; detach routes before unplacing: ${edit.instanceId}`,
          );
        }
        instance.placement = null;
        changedObjectIds.add(edit.instanceId);
        break;
      }
      case "move_instance": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
        if (lockOwner) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
          );
        }
        if (instance.placement === null) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance is not placed: ${edit.instanceId}`,
          );
        }
        const beforeTransform = structuredClone(draft);
        const oldPlacement = structuredClone(instance.placement);
        instance.placement.position = structuredClone(edit.position);
        followAttachedAnnotations(
          draft,
          edit.instanceId,
          oldPlacement.position,
          oldPlacement,
          instance.placement.position,
          instance.placement,
          changedObjectIds,
          context.symbolResolver,
        );
        // Use the snapshot taken immediately before this edit. This is still
        // progressive for multi-edit transactions, but unlike the old path it
        // retains the terminal's actual pre-move coordinates.
        const resolver = context.symbolResolver;
        if (resolver) {
          const stretched = applyInstanceRouteFollow(
            draft,
            beforeTransform,
            resolver,
            edit.instanceId,
            explicitlyAuthoredRouteIds,
          );
          for (const routeId of stretched) changedObjectIds.add(routeId);
        }
        changedObjectIds.add(edit.instanceId);
        break;
      }
      case "rotate_instance": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
        if (lockOwner) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
          );
        }
        if (instance.placement === null) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance is not placed: ${edit.instanceId}`,
          );
        }
        const beforeTransform = structuredClone(draft);
        const oldPlacement = structuredClone(instance.placement);
        instance.placement.rotation = edit.rotation;
        followAttachedAnnotations(
          draft,
          edit.instanceId,
          oldPlacement.position,
          oldPlacement,
          instance.placement.position,
          instance.placement,
          changedObjectIds,
          context.symbolResolver,
        );
        const rotateResolver = context.symbolResolver;
        if (rotateResolver) {
          for (const routeId of applyInstanceRouteFollow(
            draft,
            beforeTransform,
            rotateResolver,
            edit.instanceId,
            explicitlyAuthoredRouteIds,
          )) {
            changedObjectIds.add(routeId);
          }
        }
        changedObjectIds.add(edit.instanceId);
        break;
      }
      case "mirror_instance": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const lockOwner = lockedLayoutOwner(draft, edit.instanceId);
        if (lockOwner) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance ${edit.instanceId} is locked by layout intent ${lockOwner}`,
          );
        }
        if (instance.placement === null) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Instance is not placed: ${edit.instanceId}`,
          );
        }
        const beforeTransform = structuredClone(draft);
        const oldPlacement = structuredClone(instance.placement);
        instance.placement.mirror = edit.mirror;
        followAttachedAnnotations(
          draft,
          edit.instanceId,
          oldPlacement.position,
          oldPlacement,
          instance.placement.position,
          instance.placement,
          changedObjectIds,
          context.symbolResolver,
        );
        const mirrorResolver = context.symbolResolver;
        if (mirrorResolver) {
          for (const routeId of applyInstanceRouteFollow(
            draft,
            beforeTransform,
            mirrorResolver,
            edit.instanceId,
            explicitlyAuthoredRouteIds,
          )) {
            changedObjectIds.add(routeId);
          }
        }
        changedObjectIds.add(edit.instanceId);
        break;
      }
      case "patch_instance_netlist_parameters": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        const set = edit.set ?? {};
        const unset = edit.unset ?? [];
        if (Object.keys(set).length === 0 && unset.length === 0) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Netlist parameter patch must set or unset at least one parameter",
            [],
            [edit.instanceId],
          );
        }
        const duplicateUnset = new Set(unset);
        if (duplicateUnset.size !== unset.length) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Netlist parameter patch cannot unset the same parameter more than once",
            [],
            [edit.instanceId],
          );
        }
        const conflictingKey = Object.keys(set).find((key) =>
          duplicateUnset.has(key),
        );
        if (conflictingKey) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Netlist parameter patch cannot set and unset ${conflictingKey}`,
            [],
            [edit.instanceId],
          );
        }
        const before: SchematicDocument["instances"][number] =
          structuredClone(instance);
        const netlist = instance.netlist;
        if (!netlist) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Netlist parameter patch requires an instance netlist record",
            [],
            [edit.instanceId],
          );
        }
        const nextParameters = { ...netlist.parameters };
        // Delete first so a case-only rename (for example `w` to `W`) is one
        // valid atomic field change instead of a transient duplicate.
        for (const key of unset) {
          delete nextParameters[key];
        }
        for (const [key, value] of Object.entries(set)) {
          nextParameters[key] = value;
        }
        const namesByFoldedName = new Map<string, string>();
        for (const name of Object.keys(nextParameters)) {
          const foldedName = name.toLowerCase();
          const prior = namesByFoldedName.get(foldedName);
          if (prior && prior !== name) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Netlist parameter ${name} duplicates ${prior} under case folding`,
              [],
              [edit.instanceId],
            );
          }
          namesByFoldedName.set(foldedName, name);
        }
        const changed =
          Object.keys(nextParameters).length !==
            Object.keys(netlist.parameters).length ||
          Object.entries(nextParameters).some(
            ([key, value]) => netlist.parameters[key] !== value,
          );
        if (!changed) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Netlist parameter patch does not change the instance",
            [],
            [edit.instanceId],
          );
        }
        netlist.parameters = nextParameters;
        refreshInstanceValueAnnotation(
          draft,
          before,
          edit.instanceId,
          changedObjectIds,
        );
        changedObjectIds.add(edit.instanceId);
        break;
      }
      case "set_instance_reference": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance?.netlist) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Reference edit requires an instance netlist record",
            [],
            [edit.instanceId],
          );
        }
        if (instance.netlist.reference === edit.reference) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Reference edit does not change the instance",
            [],
            [edit.instanceId],
          );
        }
        instance.netlist.reference = edit.reference;
        const failure = referencePolicyFailure(draft, instance.id);
        if (failure) {
          return rejectAt("EDIT_PRECONDITION", failure, [], [instance.id]);
        }
        changedObjectIds.add(edit.instanceId);
        break;
      }
      case "set_instance_schematic_reference": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        if (
          draft.netlist?.terminals.some((terminal) =>
            terminal.interfaceInstanceIds.includes(instance.id),
          )
        ) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "A formal Cell Pin is identified by its Cell terminal name, not a schematic reference",
            [],
            [instance.id],
          );
        }
        if (instance.schematicReference === edit.reference) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Schematic reference edit does not change the instance",
            [],
            [edit.instanceId],
          );
        }
        const duplicate = draft.instances.find(
          (candidate) =>
            candidate.id !== instance.id &&
            (
              candidate.schematicReference ?? candidate.netlist?.reference
            )?.toLowerCase() === edit.reference.toLowerCase(),
        );
        if (duplicate) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Schematic reference is already in use: ${edit.reference}`,
            [],
            [duplicate.id],
          );
        }
        instance.schematicReference = edit.reference;
        changedObjectIds.add(instance.id);
        for (const annotation of draft.annotations) {
          if (
            annotation.binding?.kind === "instance-schematic-name" &&
            annotation.binding.instanceId === instance.id
          ) {
            changedObjectIds.add(annotation.id);
          }
        }
        break;
      }
      case "set_instance_schematic_name": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        if (
          JSON.stringify(instance.schematicName ?? null) ===
          JSON.stringify(edit.content)
        ) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Schematic name edit does not change the instance",
            [],
            [edit.instanceId],
          );
        }
        instance.schematicName = structuredClone(edit.content);
        changedObjectIds.add(edit.instanceId);
        for (const annotation of draft.annotations) {
          if (
            annotation.binding?.kind === "instance-schematic-name" &&
            annotation.binding.instanceId === instance.id
          ) {
            changedObjectIds.add(annotation.id);
          }
        }
        break;
      }
      case "set_instance_binding": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance?.netlist) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Binding edit requires an instance netlist record",
            [],
            [edit.instanceId],
          );
        }
        const current = instance.netlist.binding ?? null;
        if (JSON.stringify(current) === JSON.stringify(edit.binding)) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Binding edit does not change the instance",
            [],
            [edit.instanceId],
          );
        }
        if (edit.binding)
          instance.netlist.binding = structuredClone(edit.binding);
        else delete instance.netlist.binding;
        const failure = referencePolicyFailure(draft, instance.id);
        if (failure) {
          return rejectAt("EDIT_PRECONDITION", failure, [], [instance.id]);
        }
        changedObjectIds.add(edit.instanceId);
        connectivityChanged = true;
        break;
      }
      case "set_instance_netlist": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
            [],
            [edit.instanceId],
          );
        }
        if (
          instance.netlist &&
          JSON.stringify(instance.netlist) === JSON.stringify(edit.netlist)
        ) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Netlist edit does not change the instance",
            [],
            [edit.instanceId],
          );
        }
        const before: SchematicDocument["instances"][number] =
          structuredClone(instance);
        instance.netlist = structuredClone(edit.netlist);
        const failure = referencePolicyFailure(draft, instance.id);
        if (failure) {
          return rejectAt("EDIT_PRECONDITION", failure, [], [instance.id]);
        }
        refreshInstanceValueAnnotation(
          draft,
          before,
          edit.instanceId,
          changedObjectIds,
        );
        changedObjectIds.add(edit.instanceId);
        connectivityChanged = true;
        break;
      }
      case "bulk_patch_instance_netlist": {
        const assignedIds = new Set<string>();
        for (const assignment of edit.assignments) {
          if (assignedIds.has(assignment.instanceId)) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Bulk netlist patch repeats instance ${assignment.instanceId}`,
              [],
              [assignment.instanceId],
            );
          }
          assignedIds.add(assignment.instanceId);
          const instance = draft.instances.find(
            (candidate) => candidate.id === assignment.instanceId,
          );
          if (!instance?.netlist) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Bulk netlist patch requires a netlist record: ${assignment.instanceId}`,
              [],
              [assignment.instanceId],
            );
          }
          const before: SchematicDocument["instances"][number] =
            structuredClone(instance);
          let changed = false;
          let parametersChanged = false;
          if (
            assignment.reference !== undefined &&
            instance.netlist.reference !== assignment.reference
          ) {
            instance.netlist.reference = assignment.reference;
            changed = true;
          }
          if (assignment.binding !== undefined) {
            const current = instance.netlist.binding ?? null;
            if (
              JSON.stringify(current) !== JSON.stringify(assignment.binding)
            ) {
              if (assignment.binding) {
                instance.netlist.binding = structuredClone(assignment.binding);
              } else {
                delete instance.netlist.binding;
              }
              changed = true;
              connectivityChanged = true;
            }
          }
          const set = assignment.set ?? {};
          const unset = assignment.unset ?? [];
          const unsetNames = new Set(unset.map((name) => name.toLowerCase()));
          if (unsetNames.size !== unset.length) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Bulk netlist patch repeats an unset parameter on ${instance.id}`,
              [],
              [instance.id],
            );
          }
          const conflictingKey = Object.keys(set).find((key) =>
            unsetNames.has(key.toLowerCase()),
          );
          if (conflictingKey) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Bulk netlist patch cannot set and unset ${conflictingKey}`,
              [],
              [instance.id],
            );
          }
          if (Object.keys(set).length > 0 || unset.length > 0) {
            const nextParameters = { ...instance.netlist.parameters };
            for (const key of unset) delete nextParameters[key];
            for (const [key, value] of Object.entries(set)) {
              nextParameters[key] = value;
            }
            const namesByFoldedName = new Map<string, string>();
            for (const name of Object.keys(nextParameters)) {
              const folded = name.toLowerCase();
              const prior = namesByFoldedName.get(folded);
              if (prior && prior !== name) {
                return rejectAt(
                  "EDIT_PRECONDITION",
                  `Netlist parameter ${name} duplicates ${prior} under case folding`,
                  [],
                  [instance.id],
                );
              }
              namesByFoldedName.set(folded, name);
            }
            parametersChanged =
              Object.keys(nextParameters).length !==
                Object.keys(instance.netlist.parameters).length ||
              Object.entries(nextParameters).some(
                ([key, value]) => instance.netlist!.parameters[key] !== value,
              );
            if (parametersChanged) {
              instance.netlist.parameters = nextParameters;
              changed = true;
            }
          }
          if (!changed) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Bulk netlist patch does not change ${instance.id}`,
              [],
              [instance.id],
            );
          }
          if (parametersChanged) {
            refreshInstanceValueAnnotation(
              draft,
              before,
              instance.id,
              changedObjectIds,
            );
          }
          changedObjectIds.add(instance.id);
        }
        for (const instanceId of assignedIds) {
          const failure = referencePolicyFailure(draft, instanceId);
          if (failure) {
            return rejectAt("EDIT_PRECONDITION", failure, [], [instanceId]);
          }
        }
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
      case "set_route_points": {
        const resolver = context.symbolResolver;
        if (!resolver) {
          return rejectAt(
            "EDIT_CONTEXT_REQUIRED",
            "Routing edits require a Symbol Resolver",
          );
        }
        const existingIndex = draft.routes.findIndex(
          (candidate) => candidate.id === edit.routeId,
        );
        const existing = draft.routes[existingIndex];
        if (existing && routeIsProtected(existing)) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Route contains a locked segment: ${edit.routeId}`,
            [],
            [edit.routeId],
          );
        }
        const route = routeFromEdit(edit);
        if (!route.presentation && existing?.presentation) {
          route.presentation = existing.presentation;
        }
        const routeError = validateRoute(draft, route, resolver);
        if (routeError) {
          return rejectAt("EDIT_PRECONDITION", routeError, [], [edit.routeId]);
        }
        const polyline = resolveRouteEditPath(draft, resolver, route)!;
        const normalized = normalizeRouteGeometry(
          polyline.points,
          route.segmentModes,
        );
        route.waypoints = normalized.points.slice(1, -1);
        route.segmentModes = normalized.segmentModes;
        if (existingIndex >= 0) draft.routes[existingIndex] = route;
        else draft.routes.push(route);
        changedObjectIds.add(edit.routeId);
        break;
      }
      case "route_orthogonal": {
        const resolver = context.symbolResolver;
        if (!resolver) {
          return rejectAt(
            "EDIT_CONTEXT_REQUIRED",
            "Orthogonal routing requires a Symbol Resolver",
          );
        }
        const existingIndex = draft.routes.findIndex(
          (candidate) => candidate.id === edit.routeId,
        );
        const existing = draft.routes[existingIndex];
        if (existing && routeIsProtected(existing)) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Route contains a locked segment: ${edit.routeId}`,
            [],
            [edit.routeId],
          );
        }
        const fromConnection = resolveEndpointConnection(
          draft,
          resolver,
          edit.from,
        );
        const toConnection = resolveEndpointConnection(
          draft,
          resolver,
          edit.to,
        );
        if (!fromConnection || !toConnection) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Route ${edit.routeId} has an unresolved endpoint`,
            [],
            [edit.routeId],
          );
        }
        const geometry = buildOrthogonalEscapeRoute(
          fromConnection,
          toConnection,
          edit.escapeLength,
          draft.presentation.grid,
        );
        const route: RouteBranch = {
          id: edit.routeId,
          netId: edit.netId,
          from: structuredClone(edit.from),
          to: structuredClone(edit.to),
          waypoints: geometry.waypoints,
          segmentModes: geometry.segmentModes,
          ...(edit.presentation ? { presentation: edit.presentation } : {}),
        };
        if (!route.presentation && existing?.presentation) {
          route.presentation = existing.presentation;
        }
        const routeError = validateRoute(draft, route, resolver);
        if (routeError) {
          return rejectAt("EDIT_PRECONDITION", routeError);
        }
        if (existingIndex >= 0) draft.routes[existingIndex] = route;
        else draft.routes.push(route);
        changedObjectIds.add(edit.routeId);
        break;
      }
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
        if (
          draft.junctions.some((junction) => junction.id === edit.junctionId)
        ) {
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
          const split = splitRoute(
            draft,
            route,
            { kind: "junction", junctionId: edit.junctionId },
            edit.position,
            edit.split.firstRouteId,
            edit.split.secondRouteId,
            edit.split.segmentIndex,
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
        const split = splitRoute(
          draft,
          route,
          edit.endpoint,
          edit.point,
          edit.firstRouteId,
          edit.secondRouteId,
          edit.segmentIndex,
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
          draft.routes.some(
            (route) =>
              (route.from.kind === "junction" &&
                route.from.junctionId === edit.junctionId) ||
              (route.to.kind === "junction" &&
                route.to.junctionId === edit.junctionId),
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
        const incidentRoutes = draft.routes.filter(
          (route) =>
            (route.from.kind === "junction" &&
              route.from.junctionId === junction.id) ||
            (route.to.kind === "junction" &&
              route.to.junctionId === junction.id),
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
            ((route.from.kind === "junction" &&
              route.from.junctionId === junction.id) ||
              (route.to.kind === "junction" &&
                route.to.junctionId === junction.id)) &&
            routeIsProtected(route),
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
      case "remove_route_geometry": {
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
            `Remove Route annotation ${anchoredAnnotation.id} before deleting Route ${route.id}`,
            [],
            [anchoredAnnotation.id, route.id],
          );
        }
        const ownerNetIds = removeConnectivityEvidenceOwnedBy(
          draft,
          new Set([route.id]),
          changedObjectIds,
        );
        draft.routes.splice(routeIndex, 1);
        changedObjectIds.add(edit.routeId);
        for (const netId of new Set([route.netId, ...ownerNetIds])) {
          deferNetPrune(netId);
        }
        if (ownerNetIds.length > 0) connectivityChanged = true;
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
        const net = draft.nets.find(
          (candidate) => candidate.id === route.netId,
        );
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
          [route.from, route.to].flatMap((endpoint) =>
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
            [candidate.from, candidate.to].flatMap((endpoint) =>
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
          const primaryIndex = [route.from, route.to]
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
              endpointKey(remainingRoute.from),
            );
            const toNetId = netIdByEndpoint.get(endpointKey(remainingRoute.to));
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
          if (draft.nets.some((net) => net.id === edit.newNetId)) {
            return rejectAt(
              "EDIT_PRECONDITION",
              `Net already exists: ${edit.newNetId}`,
            );
          }
          netId = edit.newNetId;
          draft.nets.push({
            id: netId,
            terminals: [],
          });
          changedObjectIds.add(netId);
        }
        addEndpointToNet(draft, netId, edit.from);
        addEndpointToNet(draft, netId, edit.to);
        changedObjectIds.add(netId);
        connectivityChanged = true;
        break;
      }
      case "add_power_rail": {
        const horizontal =
          edit.start.y === edit.end.y && edit.start.x !== edit.end.x;
        const vertical =
          edit.start.x === edit.end.x && edit.start.y !== edit.end.y;
        if (!horizontal && !vertical) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "A power rail must be one non-zero axis-aligned segment",
          );
        }
        const ids = [
          edit.netId,
          edit.routeId,
          edit.startJunctionId,
          edit.endJunctionId,
          edit.labelId,
        ];
        if (new Set(ids).size !== ids.length) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Power rail IDs must be distinct",
          );
        }
        const existingSupplyNet = draft.nets.find(
          (net) => net.id === edit.netId,
        );
        const existingIds = new Set([
          ...draft.instances.map((instance) => instance.id),
          ...draft.nets
            .filter((net) => net.id !== existingSupplyNet?.id)
            .map((net) => net.id),
          ...draft.routes.map((route) => route.id),
          ...draft.junctions.map((junction) => junction.id),
          ...draft.annotations.map((annotation) => annotation.id),
          ...(draft.drafting?.objects.map((object) => object.id) ?? []),
          ...draft.layoutGroups.map((group) => group.id),
          ...draft.constraints.map((constraint) => constraint.id),
          ...draft.noConnects.map((noConnect) => noConnect.id),
        ]);
        const duplicate = ids.find((id) => existingIds.has(id));
        if (duplicate) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Power rail object ID already exists: ${duplicate}`,
            [],
            [duplicate],
          );
        }
        const labelEndpoint = horizontal
          ? edit.start.x < edit.end.x
            ? edit.end
            : edit.start
          : edit.start.y < edit.end.y
            ? edit.start
            : edit.end;
        const labelJunctionId =
          labelEndpoint === edit.end
            ? edit.endJunctionId
            : edit.startJunctionId;
        if (!existingSupplyNet) {
          draft.nets.push({
            id: edit.netId,
            terminals: [],
          });
        }
        draft.junctions.push(
          JunctionSchema.parse({
            id: edit.startJunctionId,
            netId: edit.netId,
            position: edit.start,
            role: "route-anchor",
          }),
          JunctionSchema.parse({
            id: edit.endJunctionId,
            netId: edit.netId,
            position: edit.end,
            role: "route-anchor",
          }),
        );
        draft.routes.push({
          id: edit.routeId,
          netId: edit.netId,
          from: { kind: "junction", junctionId: edit.startJunctionId },
          to: { kind: "junction", junctionId: edit.endJunctionId },
          waypoints: [],
          segmentModes: ["manual"],
          presentation: "power-rail",
        });
        draft.annotations.push(
          AnnotationSchema.parse({
            id: edit.labelId,
            kind: "power-label",
            binding: { kind: "net-name", netId: edit.netId },
            netId: edit.netId,
            anchor: {
              kind: "object",
              objectId: labelJunctionId,
              localOffset: { x: 10, y: 10 },
              fallbackPosition: {
                x: labelEndpoint.x + 10,
                y: labelEndpoint.y + 10,
              },
            },
            alignment: "start",
            rotation: 0,
            locked: false,
          }),
        );
        draft.connectivityEvidence.push(
          ConnectivityEvidenceSchema.parse({
            id: deriveStableId(
              "connectivity-evidence",
              draft.id,
              "power-marker",
              edit.labelId,
              edit.netId,
            ),
            kind: "name-claim",
            netId: edit.netId,
            name: edit.netName,
            scope: edit.scope,
            powerDomain: edit.powerDomain,
            owner: { kind: "power-marker", objectId: edit.labelId },
          }),
        );
        for (const id of ids) changedObjectIds.add(id);
        connectivityChanged = true;
        break;
      }
      case "merge_nets": {
        if (edit.targetNetId === edit.sourceNetId) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "Net merge requires two different Nets",
          );
        }
        const merge = mergeBaseNets(
          draft,
          edit.targetNetId,
          edit.sourceNetId,
          changedObjectIds,
        );
        if (!merge.ok) {
          return rejectAt(merge.code, merge.message, [], merge.netIds);
        }
        connectivityChanged = true;
        break;
      }
      case "upsert_connectivity_evidence": {
        const existingIndex = draft.connectivityEvidence.findIndex(
          (evidence) => evidence.id === edit.evidence.id,
        );
        const collidingObject = [
          ...draft.instances,
          ...draft.nets,
          ...draft.routes,
          ...draft.junctions,
          ...draft.noConnects,
          ...draft.annotations,
          ...draft.layoutGroups,
          ...draft.constraints,
          ...(draft.drafting?.objects ?? []),
        ].find((object) => object.id === edit.evidence.id);
        if (collidingObject) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `Connectivity evidence ID collides with another object: ${edit.evidence.id}`,
          );
        }
        const previous = draft.connectivityEvidence[existingIndex];
        const evidence = ConnectivityEvidenceSchema.parse(edit.evidence);
        if (existingIndex >= 0) {
          draft.connectivityEvidence[existingIndex] = evidence;
        } else {
          draft.connectivityEvidence.push(evidence);
        }
        if (
          evidence.kind === "name-claim" &&
          evidence.owner.kind === "net-label"
        ) {
          const annotationId = evidence.owner.annotationId;
          const annotation = draft.annotations.find(
            (candidate) => candidate.id === annotationId,
          );
          if (annotation?.formatOverride) {
            delete annotation.formatOverride;
            changedObjectIds.add(annotation.id);
          }
        }
        changedObjectIds.add(evidence.id);
        for (const netId of previous
          ? connectivityEvidenceNetIds(previous)
          : []) {
          if (!connectivityEvidenceNetIds(evidence).includes(netId)) {
            deferNetPrune(netId);
          }
        }
        connectivityChanged = true;
        break;
      }
      case "remove_connectivity_evidence": {
        const evidenceIndex = draft.connectivityEvidence.findIndex(
          (evidence) => evidence.id === edit.evidenceId,
        );
        const evidence = draft.connectivityEvidence[evidenceIndex];
        if (!evidence) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Connectivity evidence does not exist: ${edit.evidenceId}`,
          );
        }
        const affectedNetIds = connectivityEvidenceNetIds(evidence);
        draft.connectivityEvidence.splice(evidenceIndex, 1);
        changedObjectIds.add(evidence.id);
        for (const netId of affectedNetIds) {
          deferNetPrune(netId);
        }
        connectivityChanged = true;
        break;
      }
      case "set_mos_bulk_defaults": {
        if (edit.nmosNetId === undefined && edit.pmosNetId === undefined) {
          return rejectAt(
            "EDIT_PRECONDITION",
            "At least one MOS bulk default must be supplied",
          );
        }
        for (const netId of [edit.nmosNetId, edit.pmosNetId]) {
          if (netId && !draft.nets.some((net) => net.id === netId)) {
            return rejectAt("OBJECT_NOT_FOUND", `Net does not exist: ${netId}`);
          }
        }
        const defaults = { ...(draft.mosBulkDefaults ?? {}) };
        if (edit.nmosNetId !== undefined) {
          if (edit.nmosNetId === null) delete defaults.nmosNetId;
          else defaults.nmosNetId = edit.nmosNetId;
        }
        if (edit.pmosNetId !== undefined) {
          if (edit.pmosNetId === null) delete defaults.pmosNetId;
          else defaults.pmosNetId = edit.pmosNetId;
        }
        draft.mosBulkDefaults =
          defaults.nmosNetId || defaults.pmosNetId ? defaults : undefined;
        connectivityChanged = true;
        break;
      }
      case "reconcile_mos_bulk": {
        const selected = edit.instanceIds ? new Set(edit.instanceIds) : null;
        for (const instance of draft.instances) {
          if (selected && !selected.has(instance.id)) continue;
          const kind = mosBulkKind(instance);
          if (!kind) continue;
          const configuredNetId =
            kind === "nmos"
              ? draft.mosBulkDefaults?.nmosNetId
              : draft.mosBulkDefaults?.pmosNetId;
          const configuredNet = configuredNetId
            ? draft.nets.find((net) => net.id === configuredNetId)
            : undefined;
          const connectedNet = draft.nets.find((net) =>
            net.terminals.some(
              (terminal) =>
                terminal.instanceId === instance.id && terminal.pinName === "B",
            ),
          );

          // A visible dashed body connection is user-authored and therefore
          // owns B even when it happens to land on the configured default Net.
          // Repair stale dual ownership by releasing only the policy metadata;
          // the explicit Net membership and Route geometry remain untouched.
          if (hasExplicitMosBulkRoute(draft, instance.id)) {
            if (instance.mosBulkBinding) {
              delete instance.mosBulkBinding;
              changedObjectIds.add(instance.id);
              connectivityChanged = true;
            }
            continue;
          }

          // Imported four-node MOS data already carries a real B terminal.
          // When the three-terminal presentation hides that terminal and it
          // is already on the explicitly configured default, adopt the policy
          // binding instead of leaving an order-sensitive "explicit" orphan.
          if (
            configuredNet &&
            connectedNet?.id === configuredNet.id &&
            implicitBulkPresentation(instance, resolver)
          ) {
            if (
              instance.mosBulkBinding?.origin !== "cell-default" ||
              instance.mosBulkBinding.netId !== configuredNet.id
            ) {
              instance.mosBulkBinding = {
                origin: "cell-default",
                netId: configuredNet.id,
              };
              changedObjectIds.add(instance.id);
            }
            continue;
          }

          // Older imported projects may already contain the failure this
          // invariant prevents: a hidden B-only split Net and the configured
          // default retain the same SPICE source provenance. Provenance is not
          // electrical union, but here it is unambiguous repair evidence.
          if (
            configuredNet &&
            connectedNet &&
            connectedNet.id !== configuredNet.id &&
            implicitBulkPresentation(instance, resolver) &&
            resolveDetachedMosBulkDefault(draft, instance)?.id ===
              configuredNet.id
          ) {
            connectedNet.terminals = connectedNet.terminals.filter(
              (terminal) =>
                terminal.instanceId !== instance.id || terminal.pinName !== "B",
            );
            if (
              !configuredNet.terminals.some(
                (terminal) =>
                  terminal.instanceId === instance.id &&
                  terminal.pinName === "B",
              )
            ) {
              configuredNet.terminals.push({
                instanceId: instance.id,
                pinName: "B",
              });
            }
            instance.mosBulkBinding = {
              origin: "cell-default",
              netId: configuredNet.id,
            };
            changedObjectIds.add(instance.id);
            changedObjectIds.add(connectedNet.id);
            changedObjectIds.add(configuredNet.id);
            deferNetPrune(connectedNet.id);
            connectivityChanged = true;
            continue;
          }

          const resolution = resolveMosBulkConnection(draft, instance);
          if (
            !resolution ||
            resolution.materialized ||
            resolution.status === "no-connect" ||
            resolution.status === "unresolved"
          ) {
            continue;
          }
          let target = resolution.net;
          if (!target || resolution.status !== "cell-default") continue;
          target.terminals.push({ instanceId: instance.id, pinName: "B" });
          instance.mosBulkBinding = {
            origin: "cell-default",
            netId: target.id,
          };
          changedObjectIds.add(instance.id);
          changedObjectIds.add(target.id);
          connectivityChanged = true;
        }
        break;
      }
      case "clear_mos_bulk_default": {
        const instance = draft.instances.find(
          (candidate) => candidate.id === edit.instanceId,
        );
        if (!instance) {
          return rejectAt(
            "OBJECT_NOT_FOUND",
            `Instance does not exist: ${edit.instanceId}`,
          );
        }
        const binding = instance.mosBulkBinding;
        if (!binding) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `MOS ${instance.id} has no default bulk binding to override`,
          );
        }
        if (
          draft.routes.some(
            (route) =>
              isMosBulkRoute(draft, route) &&
              [route.from, route.to].some(
                (endpoint) =>
                  endpoint.kind === "terminal" &&
                  endpoint.instanceId === instance.id &&
                  endpoint.pinName === "B",
              ),
          )
        ) {
          return rejectAt(
            "EDIT_PRECONDITION",
            `MOS ${instance.id} already has visible bulk routing`,
          );
        }
        const net = draft.nets.find(
          (candidate) => candidate.id === binding.netId,
        );
        if (net) {
          net.terminals = net.terminals.filter(
            (terminal) =>
              terminal.instanceId !== instance.id || terminal.pinName !== "B",
          );
          changedObjectIds.add(net.id);
        }
        delete instance.mosBulkBinding;
        changedObjectIds.add(instance.id);
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
          draft.routes.some(
            (route) =>
              endpointKey(route.from) === endpointKey(edit.endpoint) ||
              endpointKey(route.to) === endpointKey(edit.endpoint),
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

  if (
    resolver &&
    transaction.edits.some(
      (edit) =>
        edit.kind === "move_instance" ||
        edit.kind === "rotate_instance" ||
        edit.kind === "mirror_instance",
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

  if (resolver) {
    // Keep geometry incidence separate from the broader transaction diff.
    // Net merges retarget many Routes for bookkeeping, but that must not turn
    // an otherwise local edit into a whole-document geometry repair.
    const physicalContactObjectIds =
      physicalContactObjectIdsForTransaction(transaction);
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
        physicalContactObjectIds,
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
      removeNoConnectForEndpoint(draft, operation.endpoint, changedObjectIds);
      for (const routeId of [route.id, split.first.id, split.second.id]) {
        changedObjectIds.add(routeId);
        changedRouteIds.add(routeId);
      }
      physicalContactObjectIds.add(split.first.id);
      physicalContactObjectIds.add(split.second.id);
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

  const introducedNetContractIssue = validateLogicalNetContract(draft).find(
    (issue) =>
      !originalNetContractIssueKeys.has(logicalNetContractIssueKey(issue)),
  );
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
    for (const route of draft.routes) {
      const routeError = validateRoute(draft, route, resolver);
      const original = originalRouteStates.get(route.id);
      const resolvedPoints =
        resolveRouteEditPath(draft, resolver, route)?.points ?? null;
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

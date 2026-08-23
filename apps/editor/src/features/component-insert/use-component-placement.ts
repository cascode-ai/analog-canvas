import { useState } from "react";

import type {
  ConnectivityIntent,
  ProjectStructureEdit,
  SchematicEdit,
  WireSource,
} from "@icm/edit-engine";
import {
  planEnsureNamedNet,
  createHierarchyInstance,
  createExternalSubcircuitInstance,
  planAttachCellPortMarker,
  planCreateCellPort,
  planPlaceExternalSubcircuitInstance,
  planPlaceCellInstance,
} from "@icm/edit-engine";
import type { SchematicStyleProfile } from "@icm/derived";
import { resolveDocumentLogicalNets } from "@icm/derived";
import {
  createReferenceIndex,
  hierarchyReferencePolicy,
  nextReference,
} from "@icm/devices";
import type {
  CircuitProject,
  Point,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { deriveStableId } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { ComponentInsertRequest } from "./component-insert-request";
import type {
  InsertLaunch,
  InsertPickerLaunch,
  InsertScope,
} from "./insert-launch";
import {
  powerConnectionForSymbol,
  proposePlacementContact,
  proposedStandalonePowerConnection,
  type PlacementContactProposal,
} from "./placement-connectivity";
import { planInitialMosBulkDefault } from "./mos-bulk-defaults";
import { constrainedPowerRailEndpoint, planVddRailEdits } from "./vdd-rail";
import { vddPowerLabelAnnotation } from "./vdd-power-label";
import {
  defaultInstanceDisplayAnnotations,
  missingDefaultInstanceDisplayAnnotations,
} from "../instance-display/default-instance-display";
import {
  initialInstanceNetlist,
  nextInstanceDesignator,
} from "../netlist-export/netlist-authoring";
import {
  defaultRazaviSymbolVariantId,
  razaviManualBulkConnectionEdits,
} from "../../presentation/razavi-presentation";
import type { ScreenFlip } from "../../interaction/shortcut-orientation";
import type { PendingComponentPlacement } from "../../interaction/interaction-state";

type TransactionResult = { ok: boolean; revision: number };

/**
 * A Net Port names a signal, so it starts from the conventional input name
 * rather than a bare ordinal. The first one is plain `Vin`; later ones take
 * the next free ordinal.
 */
function nextFreePortNetName(document: SchematicDocument): string {
  const logicalNets = resolveDocumentLogicalNets(document);
  const occupiedNames = new Set(
    document.nets.flatMap((net) =>
      logicalNets.byBaseNetId.get(net.id)?.name?.trim()
        ? [logicalNets.byBaseNetId.get(net.id)!.name!.trim().toLowerCase()]
        : [],
    ),
  );
  if (!occupiedNames.has("vin")) return "Vin";
  let ordinal = 2;
  while (occupiedNames.has(`vin${ordinal}`)) ordinal += 1;
  return `Vin${ordinal}`;
}

function nextFreeCellTerminalName(document: SchematicDocument): string {
  const occupiedNames = new Set(
    (document.netlist?.terminals ?? []).map((terminal) =>
      terminal.name.trim().toLowerCase(),
    ),
  );
  let ordinal = 1;
  while (occupiedNames.has(`p${ordinal}`)) ordinal += 1;
  return `P${ordinal}`;
}

export interface UseComponentPlacementOptions {
  recentStorageKey: string;
  document: SchematicDocument;
  project: CircuitProject;
  resolver: SymbolResolver;
  styleProfile: SchematicStyleProfile;
  visibleEndpoints: readonly WireSource[];
  transact: (
    edits: SchematicEdit[],
    options?: { preserveInteraction?: boolean },
  ) => TransactionResult;
  transactConnectivity: (
    intent: ConnectivityIntent,
    edits: readonly SchematicEdit[],
    preview?: unknown,
    options?: { preserveInteraction?: boolean },
  ) => TransactionResult | null;
  transactProject: (
    transactionId: string,
    edits: ProjectStructureEdit[],
  ) => boolean;
  selectOnly: (kind: "instance" | "route", ids: readonly string[]) => void;
  cancelAllTransientInteraction: () => void;
  cancelCanvasDrag: () => void;
  clearTransientCanvasState: () => void;
  paintSnapGuides: (guides: []) => void;
  beginVddRailInteraction: (netName: string) => void;
  beginComponentPlacement: (request: PendingComponentPlacement) => void;
  rotateComponentPlacement: (delta: 90 | -90) => void;
  mirrorComponentPlacement: (direction: ScreenFlip) => void;
  componentPlacementRotation: 0 | 90 | 180 | 270;
  componentPlacementMirror: NonNullable<
    SchematicDocument["instances"][number]["placement"]
  >["mirror"];
  completeVddRailPlacement: () => void;
  setComponentPreviewPoint: (point: Point) => void;
  setStatus: (status: string) => void;
  vddRailMode: boolean;
  vddRailNetName: string | null;
  vddRailStart: Point | null;
  pendingSymbolId: string | null;
  pendingComponentPlacement: PendingComponentPlacement | null;
  setVddRailStart: (point: Point) => void;
  setVddRailPreviewPoint: (point: Point) => void;
}

/** Flat owner of component/VDD placement, dialog recents, and its transactions. */
export function useComponentPlacement(options: UseComponentPlacementOptions) {
  const [insertDialogOpen, setInsertDialogOpen] = useState(false);
  const [insertScope, setInsertScope] = useState<InsertScope>("all");
  const [insertInitialSelectionId, setInsertInitialSelectionId] = useState<
    string | null
  >(null);
  const [recentSymbolIds, setRecentSymbolIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(options.recentStorageKey) ?? "[]",
      );
      return Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });

  const placeNewComponent = (
    symbolId: string,
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    if (placementRequest.kind !== "symbol") return;
    const id = nextInstanceDesignator(options.document, symbolId);
    const symbolVariantId = defaultRazaviSymbolVariantId(symbolId);
    const netlist = initialInstanceNetlist(
      options.document,
      symbolId,
      placementRequest.parameters,
      placementRequest.referenceText ?? undefined,
    );
    const instance = {
      id,
      symbolId,
      schematicReference:
        placementRequest.referenceText ?? netlist?.reference ?? id,
      ...(symbolVariantId ? { symbolVariantId } : {}),
      placement: {
        position,
        rotation: options.componentPlacementRotation,
        mirror: options.componentPlacementMirror,
      },
      ...(netlist ? { netlist } : {}),
    };
    const displayAnnotations = defaultInstanceDisplayAnnotations(
      options.document,
      instance,
      options.resolver,
      options.styleProfile,
      {
        showDesignator: placementRequest.showReference,
        showValue: placementRequest.showValue,
      },
    );
    const contact = proposePlacementContact(
      options.document,
      options.resolver,
      instance,
      options.visibleEndpoints,
    );
    const standalonePower: PlacementContactProposal =
      contact.matched || contact.ambiguous
        ? { edits: [], matched: false, ambiguous: false }
        : proposedStandalonePowerConnection(options.document, instance);
    const powerRejection = contact.rejected ?? standalonePower.rejected;
    if (powerRejection) {
      options.setStatus(`Cannot place ${id}: ${powerRejection}`);
      return;
    }
    const powerNetId = standalonePower.powerNetId ?? contact.powerNetId;
    const powerConnection = powerConnectionForSymbol(symbolId);
    const initialBulkDefaultEdits =
      powerConnection && powerNetId
        ? planInitialMosBulkDefault(
            options.document,
            powerConnection.domain,
            powerNetId,
          )
        : [];
    const resolvedPowerSymbol = options.resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    const vddPowerLabel =
      powerConnection?.domain === "vdd" && powerNetId && resolvedPowerSymbol
        ? vddPowerLabelAnnotation({
            instance,
            resolved: resolvedPowerSymbol,
            netId: powerNetId,
            grid: options.document.presentation.grid,
          })
        : null;
    const projectedDocument = structuredClone(options.document);
    projectedDocument.instances.push(instance);
    for (const edit of [...contact.edits, ...standalonePower.edits]) {
      if (edit.kind !== "connect_endpoints" || !edit.newNetId) continue;
      projectedDocument.nets.push({
        id: edit.newNetId,
        scope: "local",
        terminals: [edit.from, edit.to]
          .filter(
            (
              endpoint,
            ): endpoint is Extract<RouteEndpoint, { kind: "terminal" }> =>
              endpoint.kind === "terminal",
          )
          .map(({ instanceId, pinName }) => ({ instanceId, pinName }))
          .filter(
            (terminal, index, terminals) =>
              terminals.findIndex(
                (candidate) =>
                  candidate.instanceId === terminal.instanceId &&
                  candidate.pinName === terminal.pinName,
              ) === index,
          ),
      });
    }
    const placementEdits: SchematicEdit[] = [
      { kind: "add_instance", instance },
      ...contact.edits,
      ...standalonePower.edits,
      ...initialBulkDefaultEdits,
      ...razaviManualBulkConnectionEdits(
        projectedDocument,
        projectedDocument.instances,
      ),
      ...(vddPowerLabel
        ? [
            {
              kind: "upsert_schematic_annotation" as const,
              annotation: vddPowerLabel,
            },
          ]
        : []),
      ...displayAnnotations.map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      })),
    ];
    const committed = Boolean(
      options.transactConnectivity(
        "connect_without_wire",
        placementEdits,
        { contact, standalonePower },
        { preserveInteraction: true },
      )?.ok,
    );
    if (!committed) return;
    options.selectOnly("instance", [id]);
    options.setComponentPreviewPoint(position);
    options.setStatus(
      contact.ambiguous
        ? `Added ${id} (${symbolId}); overlapping pins are ambiguous, wire explicitly · click to place another · Esc exits`
        : contact.matched
          ? `Added ${id} (${symbolId}) and connected its contacted pin · click to place another · Esc exits`
          : `Added ${id} (${symbolId}) · click to place another · Esc exits`,
    );
  };

  const placeRetainedInstance = (instanceId: string, position: Point): void => {
    const instance = options.document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance || instance.placement !== null) {
      options.setStatus("This Placement Tray entry is no longer available");
      options.cancelAllTransientInteraction();
      return;
    }
    const placement = {
      position,
      rotation: options.componentPlacementRotation,
      mirror: options.componentPlacementMirror,
    };
    const displayAnnotations = missingDefaultInstanceDisplayAnnotations(
      options.document,
      { ...instance, placement },
      options.resolver,
      options.styleProfile,
    );
    const result = options.transact([
      { kind: "place_instance", instanceId, placement },
      ...displayAnnotations.map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      })),
    ]);
    if (!result.ok) return;
    options.selectOnly("instance", [instanceId]);
    options.cancelAllTransientInteraction();
    options.setStatus(`Placed ${instanceId} from the Placement Tray`);
  };

  const placeNewCell = (
    symbolId: string,
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    if (
      placementRequest.kind !== "cell" ||
      !placementRequest.childDocumentId ||
      !placementRequest.cellName
    ) {
      return;
    }
    const child = options.project.documents.find(
      (candidate) => candidate.id === placementRequest.childDocumentId,
    );
    if (!child?.netlist) {
      options.setStatus("The selected Cell no longer exists");
      return;
    }
    const id = nextInstanceDesignator(options.document, symbolId);
    const reference =
      placementRequest.referenceText ??
      nextReference(
        createReferenceIndex(options.document),
        hierarchyReferencePolicy,
      );
    if (!reference) {
      options.setStatus("Cannot allocate a hierarchy reference");
      return;
    }
    const instance = createHierarchyInstance(
      id,
      child,
      {
        position,
        rotation: options.componentPlacementRotation,
        mirror: options.componentPlacementMirror,
      },
      reference,
    );
    const annotations = defaultInstanceDisplayAnnotations(
      options.document,
      instance,
      options.resolver,
      options.styleProfile,
      {
        showDesignator: placementRequest.showReference,
        masterName: placementRequest.cellName,
      },
    );
    const committed = options.transactProject(
      "place-cell-instance",
      planPlaceCellInstance(
        options.project,
        options.document.id,
        instance,
        annotations,
      ),
    );
    if (!committed) return;
    options.selectOnly("instance", [id]);
    options.setComponentPreviewPoint(position);
    options.setStatus(
      `Placed ${placementRequest.cellName} as ${id} · click to place another · Esc exits`,
    );
  };

  const placeNewExternalSubcircuit = (
    symbolId: string,
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    if (
      placementRequest.kind !== "external-subcircuit" ||
      !placementRequest.definitionId
    )
      return;
    const definition = options.project.externalSubcircuitDefinitions.find(
      (candidate) => candidate.id === placementRequest.definitionId,
    );
    if (!definition) {
      options.setStatus("The selected external master no longer exists");
      return;
    }
    const id = nextInstanceDesignator(options.document, symbolId);
    const reference =
      placementRequest.referenceText ??
      nextReference(
        createReferenceIndex(options.document),
        hierarchyReferencePolicy,
      );
    if (!reference) {
      options.setStatus("Cannot allocate an external-subcircuit reference");
      return;
    }
    const instance = createExternalSubcircuitInstance(
      id,
      definition,
      {
        position,
        rotation: options.componentPlacementRotation,
        mirror: options.componentPlacementMirror,
      },
      reference,
    );
    const annotations = defaultInstanceDisplayAnnotations(
      options.document,
      instance,
      options.resolver,
      options.styleProfile,
      {
        showDesignator: placementRequest.showReference,
        masterName: definition.name,
      },
    );
    if (
      !options.transactProject(
        "place-external-subcircuit-instance",
        planPlaceExternalSubcircuitInstance(
          options.project,
          options.document.id,
          instance,
          annotations,
        ),
      )
    )
      return;
    options.selectOnly("instance", [id]);
    options.setComponentPreviewPoint(position);
    options.setStatus(
      `Placed ${definition.name} as ${reference} · click to place another · Esc exits`,
    );
  };

  const placeNewCellPort = (
    symbolId: "port" | "port-filled",
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    const id = nextInstanceDesignator(options.document, symbolId);
    if (placementRequest.kind !== "cell-port" || !placementRequest.direction)
      return;
    const instance = {
      id,
      symbolId,
      placement: {
        position,
        rotation: options.componentPlacementRotation,
        mirror: options.componentPlacementMirror,
      },
    };
    const annotations = defaultInstanceDisplayAnnotations(
      options.document,
      instance,
      options.resolver,
      options.styleProfile,
      { formalTerminalId: `terminal-${id.toLowerCase()}` },
    );
    const contact = proposePlacementContact(
      options.document,
      options.resolver,
      instance,
      options.visibleEndpoints,
    );
    if (contact.rejected || contact.ambiguous) {
      options.setStatus(
        contact.rejected ?? "Port overlaps multiple Nets; choose one contact",
      );
      return;
    }
    const connectedNet = contact.netId
      ? options.document.nets.find((net) => net.id === contact.netId)
      : undefined;
    const connectedLogicalNet = connectedNet
      ? resolveDocumentLogicalNets(options.document).byBaseNetId.get(
          connectedNet.id,
        )
      : undefined;
    const terminalOnConnectedNet = connectedLogicalNet
      ? options.document.netlist?.terminals.find((terminal) =>
          connectedLogicalNet.baseNetIds.includes(terminal.netId),
        )
      : undefined;
    // Placement never blocks on naming: an unnamed Cell Pin takes the first
    // free ordinal terminal name and is renamed on the canvas like any other
    // bound display.
    const formalName =
      placementRequest.portName?.trim() ||
      terminalOnConnectedNet?.name ||
      connectedLogicalNet?.name?.trim() ||
      nextFreeCellTerminalName(options.document);
    // Repeating an interface name places another marker for the terminal that
    // already owns it rather than a second terminal, so the same pin can be
    // drawn wherever it is needed on the sheet.
    const existingTerminal = options.document.netlist?.terminals.find(
      (terminal) => terminal.name.toLowerCase() === formalName.toLowerCase(),
    );
    const baseNetId = `net-cell-port-${id.toLowerCase()}`;
    let netId = contact.netId ?? baseNetId;
    let netSuffix = 2;
    while (
      !contact.netId &&
      options.document.nets.some((net) => net.id.toLowerCase() === netId)
    ) {
      netId = `${baseNetId}-${netSuffix}`;
      netSuffix += 1;
    }
    const connectionEdits: SchematicEdit[] = [
      ...contact.edits,
      ...(contact.matched
        ? []
        : [
            {
              kind: "connect_endpoints" as const,
              from: {
                kind: "terminal" as const,
                instanceId: id,
                pinName: "P",
              },
              to: {
                kind: "terminal" as const,
                instanceId: id,
                pinName: "P",
              },
              newNetId: netId,
            },
          ]),
    ];
    const annotation = annotations[0] ? { ...annotations[0] } : undefined;
    const committed = options.transactProject(
      "place-cell-port",
      existingTerminal
        ? planAttachCellPortMarker(options.project, options.document.id, {
            instance,
            connectionEdits,
            terminalId: existingTerminal.id,
            markerNetId: netId,
            ...(annotation ? { annotation } : {}),
          })
        : planCreateCellPort(options.project, options.document.id, {
            instance,
            connectionEdits,
            terminal: {
              id: `terminal-${id.toLowerCase()}`,
              name: formalName,
              netId,
              direction: placementRequest.direction,
              interfaceInstanceIds: [id],
            },
            ...(annotation ? { annotation } : {}),
          }),
    );
    if (!committed) return;
    options.selectOnly("instance", [id]);
    options.setComponentPreviewPoint(position);
    options.setStatus(
      existingTerminal
        ? `Added another marker for Cell port ${formalName} · click to place another · Esc exits`
        : `Added Cell port ${formalName} · click to place another · Esc exits`,
    );
  };

  const placeNewNetPort = (
    symbolId: "port" | "port-filled",
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    if (placementRequest.kind !== "net-port") return;
    const id = nextInstanceDesignator(options.document, symbolId);
    const instance = {
      id,
      symbolId,
      placement: {
        position,
        rotation: options.componentPlacementRotation,
        mirror: options.componentPlacementMirror,
      },
    };
    const contact = proposePlacementContact(
      options.document,
      options.resolver,
      instance,
      options.visibleEndpoints,
    );
    if (contact.rejected || contact.ambiguous) {
      options.setStatus(
        contact.rejected ?? "Port overlaps multiple Nets; choose one contact",
      );
      return;
    }
    const connectedNet = contact.netId
      ? options.document.nets.find((net) => net.id === contact.netId)
      : undefined;
    const name =
      placementRequest.portName?.trim() ||
      (connectedNet
        ? resolveDocumentLogicalNets(options.document)
            .byBaseNetId.get(connectedNet.id)
            ?.name?.trim()
        : undefined) ||
      nextFreePortNetName(options.document);
    const baseNetId = `net-port-${id.toLowerCase()}`;
    let candidateNetId = contact.netId ?? baseNetId;
    let netSuffix = 2;
    while (
      !contact.netId &&
      options.document.nets.some(
        (net) => net.id.toLowerCase() === candidateNetId,
      )
    ) {
      candidateNetId = `${baseNetId}-${netSuffix}`;
      netSuffix += 1;
    }
    // The contact planner can reserve a Net that does not exist yet. Model
    // that pending candidate before asking the name-first planner whether an
    // existing same-name Net should absorb it.
    const namedNetDocument = structuredClone(options.document);
    if (!namedNetDocument.nets.some((net) => net.id === candidateNetId)) {
      namedNetDocument.nets.push({
        id: candidateNetId,
        scope: "local",
        powerDomain: "none",
        terminals: [],
      });
    }
    const namedNetPlan = planEnsureNamedNet(namedNetDocument, {
      candidateNetId,
      name,
      evidenceId: deriveStableId(
        "connectivity-evidence",
        options.document.id,
        "free-port",
        candidateNetId,
        id,
      ),
      owner: { kind: "free-port", instanceId: id },
    });
    if (!namedNetPlan.ok) {
      options.setStatus(namedNetPlan.message);
      return;
    }
    const netId = namedNetPlan.netId;
    const label = defaultInstanceDisplayAnnotations(
      options.document,
      instance,
      options.resolver,
      options.styleProfile,
    )[0];
    if (!label) {
      options.setStatus("Port style has no label placement");
      return;
    }
    const edits: SchematicEdit[] = [
      { kind: "add_instance", instance },
      ...contact.edits,
      ...(contact.matched
        ? []
        : [
            {
              kind: "connect_endpoints" as const,
              from: {
                kind: "terminal" as const,
                instanceId: id,
                pinName: "P",
              },
              to: {
                kind: "terminal" as const,
                instanceId: id,
                pinName: "P",
              },
              newNetId: candidateNetId,
            },
          ]),
      ...namedNetPlan.edits,
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...label,
          kind: "net-label",
          binding: { kind: "net-name", netId },
          netId,
        },
      },
    ];
    const result = options.transact(edits);
    if (!result.ok) return;
    options.selectOnly("instance", [id]);
    options.setComponentPreviewPoint(position);
    options.setStatus(
      `Added Free Net Port ${name} · click to place another · Esc exits`,
    );
  };

  const placeVddRail = (start: Point, end: Point): void => {
    const idsExist = (candidate: string): boolean => {
      const key = candidate.toLowerCase();
      return (
        options.document.instances.some(
          (instance) => instance.id === candidate,
        ) ||
        options.document.routes.some(
          (route) => route.id === `route-${key}-rail`,
        ) ||
        options.document.junctions.some(
          (junction) =>
            junction.id === `junction-${key}-start` ||
            junction.id === `junction-${key}-end`,
        ) ||
        options.document.annotations.some(
          (annotation) => annotation.id === `label-${candidate}`,
        )
      );
    };
    let sequence = 1;
    while (idsExist(`VDD${sequence}`)) sequence += 1;
    const instanceId = `VDD${sequence}`;
    const routeId = `route-${instanceId.toLowerCase()}-rail`;
    const railPlan = planVddRailEdits(options.document, {
      instanceId,
      start,
      end,
      netName: options.vddRailNetName ?? "VDD",
    });
    if (!railPlan.ok) {
      options.setStatus(
        `Cannot add ${options.vddRailNetName ?? "VDD"} rail: ${railPlan.message}`,
      );
      return;
    }
    const result = options.transactConnectivity(
      "draw_wire",
      [...railPlan.edits],
      { start, end, railPlan },
    );
    if (!result?.ok) return;
    options.selectOnly("route", [routeId]);
    options.completeVddRailPlacement();
    options.setStatus(
      `Added ${options.vddRailNetName ?? "VDD"} rail ${instanceId}`,
    );
  };

  const openInsertPicker = ({
    scope = "all",
    initialSelectionId = null,
  }: InsertPickerLaunch): void => {
    const cellOnly = scope === "cells";
    options.cancelAllTransientInteraction();
    setInsertScope(scope);
    setInsertInitialSelectionId(initialSelectionId);
    setInsertDialogOpen(true);
    options.setStatus(
      cellOnly ? "Choose a Cell to place" : "Choose a component to place",
    );
  };

  const beginInsertedComponentPlacement = (
    request: ComponentInsertRequest,
  ): void => {
    const nextRecent = [
      request.symbolId,
      ...recentSymbolIds.filter((symbolId) => symbolId !== request.symbolId),
    ].slice(0, 8);
    setRecentSymbolIds(nextRecent);
    try {
      window.localStorage.setItem(
        options.recentStorageKey,
        JSON.stringify(nextRecent),
      );
    } catch {
      // Recency is convenience-only and must never block placement.
    }
    options.cancelCanvasDrag();
    options.clearTransientCanvasState();
    options.paintSnapGuides([]);
    setInsertDialogOpen(false);
    setInsertScope("all");
    setInsertInitialSelectionId(null);
    if (request.kind === "vdd-rail") {
      options.beginVddRailInteraction(request.netName);
      options.setStatus(
        `Place ${request.netName} Rail: click the first end · Esc cancels`,
      );
      return;
    }
    const pendingRequest: PendingComponentPlacement =
      request.kind === "symbol" &&
      (request.symbolId === "port" || request.symbolId === "port-filled")
        ? request.portRole === "cell-terminal"
          ? {
              kind: "cell-port",
              symbolId: request.symbolId,
              parameters: {},
              initialRotation: request.initialRotation,
              showReference: false,
              referenceText: null,
              showValue: false,
              direction: request.portDirection ?? "passive",
              ...(request.portName ? { portName: request.portName } : {}),
            }
          : {
              kind: "net-port",
              symbolId: request.symbolId,
              parameters: {},
              initialRotation: request.initialRotation,
              showReference: false,
              referenceText: null,
              showValue: false,
              ...(request.portName ? { portName: request.portName } : {}),
            }
        : request;
    options.beginComponentPlacement(pendingRequest);
    options.setStatus(
      `Place ${request.symbolName} on the canvas · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
    );
  };

  const startInsert = (launch: InsertLaunch): void => {
    if (launch.kind === "quick") {
      beginInsertedComponentPlacement(launch.request);
      return;
    }
    openInsertPicker(launch);
  };

  const cancelComponentInsert = (): void => {
    setInsertDialogOpen(false);
    setInsertScope("all");
    setInsertInitialSelectionId(null);
    options.cancelAllTransientInteraction();
    options.setStatus("Component insertion cancelled");
  };

  const closeInsertDialog = (): void => {
    setInsertDialogOpen(false);
    setInsertScope("all");
    setInsertInitialSelectionId(null);
  };

  const rotatePendingComponent = (delta: 90 | -90): void => {
    options.rotateComponentPlacement(delta);
    options.setStatus(`Component rotation ${delta > 0 ? "+90°" : "−90°"}`);
  };

  const mirrorPendingComponent = (direction: ScreenFlip): void => {
    options.mirrorComponentPlacement(direction);
    options.setStatus(
      `Place component mirrored ${direction === "left-right" ? "left/right" : "top/bottom"} · R rotates · Esc cancels`,
    );
  };

  const commitPendingPlacementAt = (point: Point): void => {
    if (options.vddRailMode) {
      if (!options.vddRailStart) {
        options.setVddRailStart(point);
        options.setVddRailPreviewPoint(point);
        options.setStatus(
          `${options.vddRailNetName ?? "VDD"} rail: click the second end (Esc cancels)`,
        );
      } else {
        const end = constrainedPowerRailEndpoint(options.vddRailStart, point);
        if (
          end.x === options.vddRailStart.x &&
          end.y === options.vddRailStart.y
        ) {
          options.setStatus(
            `${options.vddRailNetName ?? "VDD"} rail needs a non-zero length`,
          );
        } else {
          placeVddRail(options.vddRailStart, end);
        }
      }
      return;
    }
    if (!options.pendingSymbolId || !options.pendingComponentPlacement) return;
    if (options.pendingComponentPlacement.kind === "retained-instance") {
      const instanceId = options.pendingComponentPlacement.instanceId;
      if (instanceId) placeRetainedInstance(instanceId, point);
    } else if (options.pendingComponentPlacement.kind === "cell-port") {
      placeNewCellPort(
        options.pendingSymbolId as "port" | "port-filled",
        point,
        options.pendingComponentPlacement,
      );
    } else if (options.pendingComponentPlacement.kind === "net-port") {
      placeNewNetPort(
        options.pendingSymbolId as "port" | "port-filled",
        point,
        options.pendingComponentPlacement,
      );
    } else if (options.pendingComponentPlacement.kind === "cell") {
      placeNewCell(
        options.pendingSymbolId,
        point,
        options.pendingComponentPlacement,
      );
    } else if (
      options.pendingComponentPlacement.kind === "external-subcircuit"
    ) {
      placeNewExternalSubcircuit(
        options.pendingSymbolId,
        point,
        options.pendingComponentPlacement,
      );
    } else {
      placeNewComponent(
        options.pendingSymbolId,
        point,
        options.pendingComponentPlacement,
      );
    }
  };

  const beginRetainedInstancePlacement = (instanceId: string): void => {
    const instance = options.document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance || instance.placement !== null) {
      options.setStatus("This Placement Tray entry is no longer available");
      return;
    }
    options.cancelAllTransientInteraction();
    options.beginComponentPlacement({
      kind: "retained-instance",
      instanceId,
      symbolId: instance.symbolId,
      parameters: {},
      initialRotation: 0,
      showReference: false,
      referenceText: null,
      showValue: false,
    });
    options.setStatus(
      `Place ${instanceId} from the Placement Tray · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
    );
  };

  return {
    beginRetainedInstancePlacement,
    cancelComponentInsert,
    closeInsertDialog,
    commitPendingPlacementAt,
    insertDialogOpen,
    insertInitialSelectionId,
    insertScope,
    mirrorPendingComponent,
    recentSymbolIds,
    rotatePendingComponent,
    startInsert,
  };
}

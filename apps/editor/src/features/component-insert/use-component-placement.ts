import { useState } from "react";

import type {
  ExpectedElectricalEffect,
  RoutingOperationIntent,
  ProjectStructureEdit,
  SchematicEdit,
  WireSource,
} from "@icm/edit-engine";
import {
  createHierarchyInstance,
  createExternalSubcircuitInstance,
  planCreateCellPin,
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
  DraftingObject,
  Point,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { defaultDraftTextDocument, deriveStableId } from "@icm/model";
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
import type { DrawingTool } from "../../interaction/interaction-state";

type TransactionResult = { ok: boolean; revision: number };
import {
  describePlacementNearMiss,
  findPlacementNearMisses,
} from "./placement-near-miss";

function nextCellPinName(document: SchematicDocument): string {
  const occupiedNames = new Set(
    (document.netlist?.terminals ?? []).map((terminal) =>
      terminal.name.trim().toLowerCase(),
    ),
  );
  if (!occupiedNames.has("vin")) return "Vin";
  let ordinal = 2;
  while (occupiedNames.has(`vin${ordinal}`)) ordinal += 1;
  return `Vin${ordinal}`;
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
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
    options?: {
      preserveInteraction?: boolean;
      expectedElectricalEffect?: ExpectedElectricalEffect;
    },
  ) => TransactionResult | null;
  transactProject: (
    transactionId: string,
    edits: ProjectStructureEdit[],
  ) => boolean;
  selectOnly: (
    kind: "instance" | "route" | "drafting",
    ids: readonly string[],
  ) => void;
  cancelAllTransientInteraction: () => void;
  cancelCanvasDrag: () => void;
  clearTransientCanvasState: () => void;
  paintSnapGuides: (guides: []) => void;
  beginVddRailInteraction: (netName: string) => void;
  activateDrawingTool: (tool: DrawingTool) => void;
  beginComponentPlacement: (request: PendingComponentPlacement) => void;
  beginDraftingTextEditing: (
    object: Extract<DraftingObject, { kind: "text" }>,
  ) => void;
  nextId: (prefix: string) => string;
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
      options.transactConnectivity("connect", placementEdits, {
        preserveInteraction: true,
        ...(contact.expectedElectricalEffect
          ? { expectedElectricalEffect: contact.expectedElectricalEffect }
          : {}),
      })?.ok,
    );
    if (!committed) return;
    options.selectOnly("instance", [id]);
    options.setComponentPreviewPoint(position);
    // A block that carries no designator is not announced by one either: its
    // internal id is bookkeeping, and naming it here would put the very "X1"
    // back in front of the person that the drawing deliberately leaves out.
    const named =
      options.resolver.resolve(symbolId)?.definition.labelVisibility ===
      "hidden"
        ? symbolId
        : `${id} (${symbolId})`;
    // Nothing connected, but something was close: a part dropped a square
    // short of a wire looks joined and is not. Say so once, in the line the
    // person is already reading. It reports; it never connects.
    const nearMiss = contact.matched
      ? null
      : describePlacementNearMiss(
          findPlacementNearMisses(
            projectedDocument,
            options.resolver,
            instance,
          ),
          id,
        );
    options.setStatus(
      contact.ambiguous
        ? `Added ${named}; overlapping pins are ambiguous, wire explicitly · click to place another · Esc exits`
        : contact.matched
          ? `Added ${named} and connected its contacted pin · click to place another · Esc exits`
          : nearMiss
            ? `Added ${named} · ${nearMiss} · click to place another · Esc exits`
            : `Added ${named} · click to place another · Esc exits`,
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

  const placeNewCellPin = (
    symbolId: "port" | "port-filled",
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    const id = nextInstanceDesignator(options.document, symbolId);
    if (placementRequest.kind !== "cell-pin" || !placementRequest.direction)
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
    const connectedName = connectedLogicalNet?.name?.trim();
    const formalName =
      placementRequest.portName?.trim() ||
      connectedName ||
      nextCellPinName(options.document);
    const baseNetId = `net-cell-pin-${id.toLowerCase()}`;
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
    const annotations = defaultInstanceDisplayAnnotations(
      options.document,
      instance,
      options.resolver,
      options.styleProfile,
      { formalTerminalId: `terminal-${id.toLowerCase()}` },
    );
    const annotation = annotations[0] ? { ...annotations[0] } : undefined;
    const committed = options.transactProject(
      "place-cell-pin",
      planCreateCellPin(options.project, options.document.id, {
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
      `Added Cell Pin ${formalName} · click to place another · Esc exits`,
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
    const result = options.transactConnectivity("connect", [...railPlan.edits]);
    if (!result?.ok) return;
    options.selectOnly("route", [routeId]);
    options.completeVddRailPlacement();
    options.setStatus(
      `Added ${options.vddRailNetName ?? "VDD"} rail ${instanceId}`,
    );
  };

  const placeDraftingTextAnnotation = (
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    if (placementRequest.kind !== "drafting-text") return;
    // A lone + or − has no centre to write in, so it lands as the canonical
    // empty document — the same shape an emptied polarity label keeps.
    const bare =
      Boolean(placementRequest.polarity) &&
      placementRequest.polarity !== "both";
    const preset = placementRequest.text;
    let id = options.nextId(placementRequest.polarity ? "polarity" : "text");
    while (
      options.document.drafting?.objects.some((object) => object.id === id)
    ) {
      id = options.nextId("polarity");
    }
    const object: Extract<DraftingObject, { kind: "text" }> = {
      id,
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position },
      content: bare
        ? { runs: [{ kind: "line-break" as const }] }
        : preset
          ? { runs: [{ kind: "text" as const, value: preset }] }
          : defaultDraftTextDocument("V_x"),
      alignment: "middle",
      rotation: options.componentPlacementRotation,
      typographyToken: "label",
      ...(placementRequest.polarity
        ? { polarity: placementRequest.polarity }
        : {}),
    };
    if (!options.transact([{ kind: "upsert_drafting_object", object }]).ok) {
      return;
    }
    options.cancelAllTransientInteraction();
    options.selectOnly("drafting", [object.id]);
    if (preset) {
      options.setStatus(`Added ${placementRequest.symbolId}`);
      return;
    }
    if (bare) {
      options.setStatus(`Added ${placementRequest.polarity} polarity mark`);
      return;
    }
    // A pair brackets a name, so it opens for that name straight away.
    options.beginDraftingTextEditing(object);
    options.setStatus(`Added ${placementRequest.polarity} polarity annotation`);
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
    if (request.kind === "drawing-tool") {
      options.activateDrawingTool(request.tool);
      options.setStatus(
        `${request.symbolName}: click the canvas to start · double-click to finish · Esc exits`,
      );
      return;
    }
    if (request.kind === "vdd-rail") {
      options.beginVddRailInteraction(request.netName);
      options.setStatus(
        `Place ${request.netName} Rail: click the first end · Esc cancels`,
      );
      return;
    }
    const pendingRequest: PendingComponentPlacement =
      request.kind === "polarity-annotation"
        ? {
            kind: "drafting-text",
            symbolId: request.symbolId,
            parameters: {},
            initialRotation: request.initialRotation,
            showReference: false,
            referenceText: null,
            showValue: false,
            polarity: request.polarity,
          }
        : request.kind === "drafting-text"
          ? {
              kind: "drafting-text",
              symbolId: request.symbolId,
              parameters: {},
              initialRotation: request.initialRotation,
              showReference: false,
              referenceText: null,
              showValue: false,
              text: request.text,
            }
          : request.kind === "symbol" &&
              (request.symbolId === "port" ||
                request.symbolId === "port-filled")
            ? {
                kind: "cell-pin",
                symbolId: request.symbolId,
                parameters: {},
                initialRotation: request.initialRotation,
                showReference: false,
                referenceText: null,
                showValue: false,
                direction: request.portDirection ?? "passive",
                ...(request.portName ? { portName: request.portName } : {}),
              }
            : request;
    options.beginComponentPlacement(pendingRequest);
    options.setStatus(
      request.kind === "polarity-annotation"
        ? `Place ${request.symbolName} on the canvas · R rotates · Esc cancels`
        : `Place ${request.symbolName} on the canvas · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
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
    if (options.pendingComponentPlacement.kind === "drafting-text") {
      placeDraftingTextAnnotation(point, options.pendingComponentPlacement);
    } else if (options.pendingComponentPlacement.kind === "retained-instance") {
      const instanceId = options.pendingComponentPlacement.instanceId;
      if (instanceId) placeRetainedInstance(instanceId, point);
    } else if (options.pendingComponentPlacement.kind === "cell-pin") {
      placeNewCellPin(
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

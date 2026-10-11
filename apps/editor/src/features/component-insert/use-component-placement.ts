import { useRef, useState } from "react";
import { planComponentPlacement } from "../user-components/component-placement";
import { checkSharedComponentRevision } from "../user-components/component-library-client";

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
  SchematicDocument,
} from "@icm/model";
import { createDraftText, defaultDraftTextDocument } from "@icm/model";
import { hierarchicalSymbolId, type SymbolResolver } from "@icm/symbols";

import type { ComponentInsertRequest } from "./component-insert-request";
import type {
  InsertLaunch,
  InsertPickerLaunch,
  InsertScope,
} from "./insert-launch";
import {
  proposePlacementContact,
  planInsertedInstanceConnections,
} from "./placement-connectivity";
import { planPlacedCellPin } from "./cell-pin-placement";
import {
  constrainedPowerRailEndpoint,
  planVddRailEdits,
  railSupplyPinEdits,
} from "./vdd-rail";
import {
  defaultInstanceDisplayAnnotations,
  missingDefaultInstanceDisplayAnnotations,
} from "../instance-display/default-instance-display";
import {
  createNewInstance,
  nextCellPinName,
  nextInstanceId,
} from "../netlist-export/netlist-authoring";
import { placedInstanceNetlist } from "./placed-instance-netlist";
import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";
import { sharedComponentNetlist } from "../user-components/component-definition-edit";
import type { ScreenFlip } from "../../interaction/shortcut-orientation";
import type { PendingComponentPlacement } from "../../interaction/interaction-state";
import type { DrawingTool } from "../../interaction/interaction-state";

type TransactionResult = { ok: boolean; revision: number };
import {
  describePlacementNearMiss,
  findPlacementNearMisses,
} from "./placement-near-miss";

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
  /** The routing gate transactConnectivity runs, without committing. */
  gateConnectivity: (
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
    options?: { expectedElectricalEffect?: ExpectedElectricalEffect },
  ) => readonly SchematicEdit[] | null;
  /**
   * The placement as one Project transaction with what the Process gives
   * its new parts (a BJT's reviewed subcircuit), or undefined if nothing.
   */
  processFill: (
    edits: readonly SchematicEdit[],
  ) => ProjectStructureEdit[] | undefined;
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
  /** The model the process in hand names for this device, if it takes one. */
  processModelTarget: (symbolId: string) => string | undefined;
  rotateComponentPlacement: (delta: 45 | -45 | 90 | -90) => void;
  mirrorComponentPlacement: (direction: ScreenFlip) => void;
  componentPlacementRotation: NonNullable<
    SchematicDocument["instances"][number]["placement"]
  >["rotation"];
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
  const latest = useRef(options);
  latest.current = options;
  const captureBusy = useRef(false);
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
    const customDefinition = placementRequest.componentDefinition;
    const instance = createNewInstance(
      options.document,
      {
        symbolId,
        symbolVariantId: customDefinition
          ? customDefinition.symbol.defaultVariantId
          : defaultRazaviSymbolVariantId(symbolId),
        placement: {
          position,
          rotation: options.componentPlacementRotation,
          mirror: options.componentPlacementMirror,
        },
        netlist: customDefinition
          ? sharedComponentNetlist(customDefinition)
          : placedInstanceNetlist(
              symbolId,
              placementRequest.parameters,
              options.processModelTarget(symbolId),
            ),
      },
      {
        reference: placementRequest.referenceText ?? undefined,
        project: customDefinition
          ? { componentDefinitions: [customDefinition] }
          : options.project,
      },
    );
    const id = instance.id;
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
    let connectionPlan: ReturnType<typeof planInsertedInstanceConnections>;
    try {
      connectionPlan = planInsertedInstanceConnections(
        options.document,
        options.resolver,
        instance,
        options.visibleEndpoints,
      );
    } catch (error) {
      options.setStatus(error instanceof Error ? error.message : String(error));
      return;
    }
    const { contact, projectedDocument } = connectionPlan;
    const placementEdits: SchematicEdit[] = [
      { kind: "add_instance", instance },
      ...connectionPlan.edits,
      ...displayAnnotations.map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      })),
    ];
    const gated = options.gateConnectivity(
      "connect",
      placementEdits,
      contact.expectedElectricalEffect
        ? { expectedElectricalEffect: contact.expectedElectricalEffect }
        : {},
    );
    if (!gated) return;
    // A part the Process maps to a reviewed subcircuit arrives bound to it,
    // its definition in the same transaction, as the Agent's parts do.
    const filled = options.processFill(gated);
    const committed = filled
      ? options.transactProject("place-component", filled)
      : options.transact([...gated], { preserveInteraction: true }).ok;
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
    const currentSymbolId = hierarchicalSymbolId(child.netlist.name);
    const id = nextInstanceId(options.document, currentSymbolId);
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
        masterName: child.netlist.name,
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
      `Placed ${child.netlist.name} as ${id} · click to place another · Esc exits`,
    );
  };

  const placeNewCapturedComponent = async (
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): Promise<void> => {
    const capture = placementRequest.capture;
    if (!capture || captureBusy.current) return;
    captureBusy.current = true;
    const structureRevision = capture.structureRevision;
    const documentRevision = capture.documentRevision;
    const placement = {
      position,
      rotation: options.componentPlacementRotation,
      mirror: options.componentPlacementMirror,
    };
    try {
      if (capture.library) await checkSharedComponentRevision(capture.library);
      const current = latest.current;
      if (current.pendingComponentPlacement?.capture !== capture) return;
      if (
        capture.projectId !== current.project.id ||
        capture.documentId !== current.document.id ||
        structureRevision !== current.project.structureRevision ||
        documentRevision !== current.document.revision
      )
        throw Error("The target changed. Select the component again.");
      const plan = planComponentPlacement(
        current.project,
        current.document.id,
        capture.payload,
        capture.identity,
        placement,
        {
          ...(placementRequest.referenceText
            ? { reference: placementRequest.referenceText }
            : {}),
          showReference: placementRequest.showReference,
          showValue: placementRequest.showValue,
        },
      );
      let edits = plan.edits;
      if (plan.connection) {
        const effect = plan.connection.contact.expectedElectricalEffect;
        const gated = current.gateConnectivity(
          "connect",
          plan.documentEdits,
          effect ? { expectedElectricalEffect: effect } : {},
        );
        if (!gated) return;
        const filled = current.processFill(gated);
        edits = [
          ...plan.edits.filter((edit) => edit.kind !== "transact_document"),
          ...(filled ?? [
            {
              kind: "transact_document" as const,
              documentId: current.document.id,
              expectedRevision: current.document.revision,
              edits: [...gated],
            },
          ]),
        ];
      }
      if (!current.transactProject("place-public-component", edits)) return;
      capture.structureRevision = structureRevision + 1;
      capture.documentRevision = documentRevision + 1;
      current.selectOnly("instance", [plan.instance.id]);
      current.setComponentPreviewPoint(position);
      const contact = plan.connection?.contact;
      const nearMiss =
        plan.connection && !contact?.matched
          ? describePlacementNearMiss(
              findPlacementNearMisses(
                plan.connection.projectedDocument,
                plan.resolver,
                plan.instance,
              ),
              plan.instance.id,
            )
          : null;
      const connectionStatus = contact?.ambiguous
        ? "; overlapping pins are ambiguous, wire explicitly"
        : contact?.matched
          ? " and connected its contacted pin"
          : nearMiss
            ? ` · ${nearMiss}`
            : "";
      current.setStatus(
        `Placed ${capture.payload.definition.symbol.name}${connectionStatus} · click to place another · Esc exits`,
      );
    } catch (error) {
      latest.current.setStatus(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      captureBusy.current = false;
    }
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
    const id = nextInstanceId(options.document, symbolId);
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
    symbolId: "port" | "port-filled" | "vdd-port",
    position: Point,
    placementRequest: PendingComponentPlacement,
  ): void => {
    const id = nextInstanceId(options.document, symbolId);
    const supply = symbolId === "vdd-port";
    if (
      !supply &&
      (placementRequest.kind !== "cell-pin" || !placementRequest.direction)
    )
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
      supply ? { powerMarker: false } : undefined,
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
    const requestedName =
      placementRequest.kind === "cell-pin"
        ? placementRequest.portName?.trim()
        : undefined;
    const authoredName =
      requestedName ||
      connectedName ||
      (supply
        ? "VDD"
        : nextCellPinName(
            options.document,
            new Set(),
            symbolId === "port-filled" ? "filled" : "hollow",
          ));
    // The Pin Name is exactly what was typed, connected or generated; the
    // label's look never inserts characters into it.
    const formalName = authoredName;
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
    const terminalId = `terminal-${id.toLowerCase()}`;
    const committed = options.transactProject(
      "place-cell-pin",
      planPlacedCellPin(
        options.project,
        options.document.id,
        options.resolver,
        {
          instance,
          connectionEdits,
          terminalId,
          name: formalName,
          netId,
          direction:
            supply || placementRequest.kind !== "cell-pin"
              ? "inout"
              : placementRequest.direction!,
          styleProfile: options.styleProfile,
        },
      ),
    );
    if (!committed) return;
    options.selectOnly("instance", [id]);
    options.setComponentPreviewPoint(position);
    const placedKind = supply
      ? "VDD Power Cell Pin"
      : symbolId === "port-filled"
        ? "Bias Voltage Port"
        : "Cell Pin";
    options.setStatus(
      `Added ${placedKind} ${authoredName} · click to place another · Esc exits`,
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
    const railPlan = planVddRailEdits(
      options.document,
      {
        instanceId,
        start,
        end,
        netName: options.vddRailNetName ?? "VDD",
      },
      options.resolver,
    );
    if (!railPlan.ok) {
      options.setStatus(
        `Cannot add ${options.vddRailNetName ?? "VDD"} rail: ${railPlan.message}`,
      );
      return;
    }
    const result = options.transactConnectivity(
      "connect",
      [
        ...railPlan.edits,
        ...railSupplyPinEdits(options.project, options.document, railPlan),
      ],
      railPlan.expectedElectricalEffect
        ? { expectedElectricalEffect: railPlan.expectedElectricalEffect }
        : {},
    );
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
    const prefix = placementRequest.polarity
      ? "polarity"
      : placementRequest.editAfterPlacement
        ? "note"
        : "text";
    let id = options.nextId(prefix);
    while (
      options.document.drafting?.objects.some((object) => object.id === id)
    ) {
      id = options.nextId(prefix);
    }
    // The semantic-text helper turns the suffix into a true subscript. The
    // authored value is therefore "Vx"; a literal underscore would be drawn.
    const typed = placementRequest.content;
    const object: Extract<DraftingObject, { kind: "text" }> = {
      ...createDraftText({
        id,
        position,
        content: bare
          ? { runs: [{ kind: "line-break" as const }] }
          : typed || preset || defaultDraftTextDocument("Vx"),
        rotation: options.componentPlacementRotation,
        ...(placementRequest.alignment
          ? { alignment: placementRequest.alignment }
          : {}),
      }),
      ...(placementRequest.sizeScale !== undefined &&
      placementRequest.sizeScale !== 1
        ? { styleOverride: { sizeScale: placementRequest.sizeScale } }
        : {}),
      ...(placementRequest.polarity
        ? { polarity: placementRequest.polarity }
        : {}),
    };
    if (!options.transact([{ kind: "upsert_drafting_object", object }]).ok) {
      return;
    }
    options.cancelAllTransientInteraction();
    options.selectOnly("drafting", [object.id]);
    // Typed first, it is already written: it lands as it reads.
    if (typed) {
      options.setStatus(`Added text ${id}`);
      return;
    }
    if (placementRequest.editAfterPlacement) {
      options.beginDraftingTextEditing(object);
      options.setStatus(`Added drafting text ${id}`);
      return;
    }
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
    // Plain Text has no catalog tile to recall in the Insert picker.
    if (!(request.kind === "drafting-text" && request.editAfterPlacement)) {
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
              ...(request.content ? { content: request.content } : {}),
              ...(request.alignment ? { alignment: request.alignment } : {}),
              ...(request.sizeScale !== undefined
                ? { sizeScale: request.sizeScale }
                : {}),
              ...(request.editAfterPlacement
                ? { editAfterPlacement: true }
                : {}),
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
      request.kind === "drafting-text" && request.content
        ? "Place text: click where it goes · R rotates · Esc cancels"
        : request.kind === "drafting-text" && request.editAfterPlacement
          ? "Place text: click to place and edit · R rotates · Esc cancels"
          : request.kind === "polarity-annotation"
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

  const rotatePendingComponent = (delta: 45 | -45 | 90 | -90): void => {
    options.rotateComponentPlacement(delta);
    options.setStatus(
      `Component rotation ${delta > 0 ? `+${delta}°` : `${delta}°`}`,
    );
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
    if (options.pendingComponentPlacement.capture) {
      void placeNewCapturedComponent(point, options.pendingComponentPlacement);
      return;
    }
    if (options.pendingComponentPlacement.kind === "drafting-text") {
      placeDraftingTextAnnotation(point, options.pendingComponentPlacement);
    } else if (options.pendingComponentPlacement.kind === "retained-instance") {
      const instanceId = options.pendingComponentPlacement.instanceId;
      if (instanceId) placeRetainedInstance(instanceId, point);
    } else if (
      options.pendingComponentPlacement.kind === "cell-pin" ||
      options.pendingSymbolId === "vdd-port"
    ) {
      placeNewCellPin(
        options.pendingSymbolId as "port" | "port-filled" | "vdd-port",
        point,
        options.pendingComponentPlacement,
      );
    } else if (options.pendingComponentPlacement.kind === "cell") {
      placeNewCell(point, options.pendingComponentPlacement);
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

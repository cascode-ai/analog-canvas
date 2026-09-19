import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import {
  resolveEndpointConnection,
  type Diagnostic,
  type GlobalNetTraceHop,
  type HierarchyFrame,
  type HierarchyNetTraceHop,
  type ObjectLocator,
  type ProjectConnectivityIndex,
  type SearchResult,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { NetlistDiagnostic } from "@icm/netlist";
import type {
  CircuitProject,
  GridRect,
  Point,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import type { SymbolResolver } from "@icm/symbols";

import {
  fitCameraToBounds,
  fitCameraToVisibleBounds,
  type CameraRectInput,
  type CanvasInsets,
} from "../../canvas/fit-view";
import { referencedDocumentId } from "../../document/editor-session";
import { endpointNetId } from "../wiring/route-interaction-geometry";

type Instance = SchematicDocument["instances"][number];
type SelectionKind = "instance" | "route" | "junction" | "annotation";
type SetViewBox = (
  next: GridRect | CameraRectInput | ((current: GridRect) => CameraRectInput),
  grid?: number,
) => void;

export interface EditorNavigationControllerDependencies {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  connectivityIndex: ProjectConnectivityIndex;
  documentStack: readonly HierarchyFrame[];
  setDocumentStack: Dispatch<SetStateAction<HierarchyFrame[]>>;
  documentViewBoxes: MutableRefObject<Map<string, GridRect>>;
  viewBox: GridRect;
  defaultViewBox: GridRect;
  setViewBox: SetViewBox;
  /**
   * The canvas element's size and how much of it floating panels cover.
   * Absent when the canvas is not mounted, which leaves fit to the element.
   */
  measureCanvasView?: () => {
    viewport: { width: number; height: number };
    insets: CanvasInsets;
  } | null;
  openDocument: (documentId: string) => SchematicDocument | null | undefined;
  resetInteractionState: () => void;
  selectOnly: (kind: SelectionKind, ids: readonly string[]) => void;
  setSelectedEndpoint: (endpoint: WireSource | null) => void;
  setHighlightedNetOrigin: (
    origin: {
      documentId: string;
      netId: string;
      hierarchyPath: readonly HierarchyFrame[];
      endpoint?: RouteEndpoint;
    } | null,
  ) => void;
  highlightedNetOrigin: { netId: string } | null;
  selectedHighlightNetId: string | null;
  selectedHighlightEndpoint: RouteEndpoint | undefined;
  selectedHighlightIsActive: boolean;
  closeSearch: () => void;
  setSelectionOpen: (open: boolean) => void;
  setCellManagerOpen: (open: boolean) => void;
  selectedInstance: Instance | null | undefined;
  setStatus: (status: string) => void;
}

/** Own Cell-stack navigation and focus projection for locators/diagnostics. */
export function createEditorNavigationController({
  project,
  document,
  resolver,
  connectivityIndex,
  documentStack,
  setDocumentStack,
  documentViewBoxes,
  viewBox,
  defaultViewBox,
  setViewBox,
  measureCanvasView,
  openDocument,
  resetInteractionState,
  selectOnly,
  setSelectedEndpoint,
  setHighlightedNetOrigin,
  highlightedNetOrigin,
  selectedHighlightNetId,
  selectedHighlightEndpoint,
  selectedHighlightIsActive,
  closeSearch,
  setSelectionOpen,
  setCellManagerOpen,
  selectedInstance,
  setStatus,
}: EditorNavigationControllerDependencies) {
  const switchDocument = (nextDocumentId: string): void => {
    if (nextDocumentId === document.id) return;
    documentViewBoxes.current.set(document.id, viewBox);
    const nextDocument = openDocument(nextDocumentId);
    if (!nextDocument) {
      setStatus(`Document not found: ${nextDocumentId}`);
      return;
    }
    setViewBox(
      documentViewBoxes.current.get(nextDocument.id) ?? defaultViewBox,
      nextDocument.presentation.grid,
    );
    resetInteractionState();
    setStatus(`Opened Cell ${nextDocument.name}`);
  };

  const selectDocumentFromHierarchy = (nextDocumentId: string): void => {
    if (!project.documents.some((cell) => cell.id === nextDocumentId)) {
      setStatus(`Document not found: ${nextDocumentId}`);
      return;
    }
    // A definition selection carries no occurrence identity, even with one caller.
    setDocumentStack([]);
    switchDocument(nextDocumentId);
  };

  const jumpToCaller = (parentDocumentId: string, instanceId: string): void => {
    const parent = project.documents.find(
      (cell) => cell.id === parentDocumentId,
    );
    if (!parent?.instances.some((instance) => instance.id === instanceId)) {
      setStatus("Caller no longer exists");
      return;
    }
    navigateToLocator(
      {
        documentId: parentDocumentId,
        kind: "instance",
        objectId: instanceId,
        hierarchyPath: parentDocumentId === document.id ? documentStack : [],
      },
      `Opened caller ${parent.name}.${instanceId}`,
    );
    setCellManagerOpen(false);
  };

  const navigateToLocator = (
    locator: ObjectLocator,
    statusMessage: string,
  ): void => {
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === locator.documentId,
    );
    if (!targetDocument) {
      setStatus(`Document not found: ${locator.documentId}`);
      return;
    }
    const pathValid =
      locator.hierarchyPath.at(-1)?.childDocumentId === locator.documentId &&
      locator.hierarchyPath.every((frame, index, path) => {
        const parent = project.documents.find(
          (cell) => cell.id === frame.parentDocumentId,
        );
        const instance = parent?.instances.find(
          (item) => item.id === frame.instanceId,
        );
        return (
          instance &&
          referencedDocumentId(project, instance) === frame.childDocumentId &&
          (index === 0 ||
            path[index - 1]!.childDocumentId === frame.parentDocumentId)
        );
      });
    const hierarchyPath = pathValid ? locator.hierarchyPath : [];
    documentViewBoxes.current.set(document.id, viewBox);
    const opened = openDocument(locator.documentId);
    if (!opened) {
      setStatus(`Document not found: ${locator.documentId}`);
      return;
    }
    setDocumentStack([...hierarchyPath]);
    setViewBox(
      documentViewBoxes.current.get(opened.id) ?? defaultViewBox,
      opened.presentation.grid,
    );
    resetInteractionState();

    const focusPoint = (point: Point) =>
      setViewBox(
        {
          x: point.x - 80,
          y: point.y - 60,
          width: 160,
          height: 120,
        },
        opened.presentation.grid,
      );
    const endpoint =
      locator.kind === "terminal"
        ? locator.endpoint
        : locator.kind === "no-connect"
          ? opened.noConnects.find(
              (noConnect) => noConnect.id === locator.objectId,
            )?.endpoint
          : undefined;
    if (endpoint) {
      const connection = resolveEndpointConnection(opened, resolver, endpoint);
      if (connection) {
        setSelectedEndpoint({
          endpoint,
          netId: endpointNetId(opened, endpoint),
          connection,
          preludeEdits: [],
        });
        focusPoint(connection.contactPoint);
      }
    } else if (locator.kind === "instance") {
      const instance = opened.instances.find(
        (item) => item.id === locator.objectId,
      );
      selectOnly("instance", [locator.objectId]);
      if (instance?.placement) focusPoint(instance.placement.position);
    } else if (locator.kind === "route") {
      const route = opened.routes.find((item) => item.id === locator.objectId);
      selectOnly("route", [locator.objectId]);
      const centerline = route
        ? connectivityIndex.documents
            .get(opened.id)
            ?.routingGeometry.routes.get(route.id)?.centerline
        : undefined;
      if (centerline?.[0]) focusPoint(centerline[0]);
    } else if (locator.kind === "junction") {
      const junction = opened.junctions.find(
        (item) => item.id === locator.objectId,
      );
      selectOnly("junction", [locator.objectId]);
      if (junction) focusPoint(junction.position);
    } else if (locator.kind === "annotation") {
      const annotation = opened.annotations.find(
        (item) => item.id === locator.objectId,
      );
      selectOnly("annotation", [locator.objectId]);
      const position =
        annotation?.anchor.kind === "free"
          ? annotation.anchor.position
          : annotation?.anchor.fallbackPosition;
      if (position) focusPoint(position);
    } else if (locator.kind === "net") {
      // Store the same resolved path that the document stack was set to:
      // diagnostics carry an empty locator path, and a mismatched origin
      // would keep the highlight from ever reading as active (so the first
      // H press would re-highlight instead of clearing it).
      setHighlightedNetOrigin({
        documentId: opened.id,
        netId: locator.objectId,
        hierarchyPath,
      });
      const route = opened.routes.find(
        (item) => item.netId === locator.objectId,
      );
      // Give the highlight a selection like every other locator kind, so the
      // H toggle and the dock's Highlight action stay reachable.
      if (route) selectOnly("route", [route.id]);
      const centerline = route
        ? connectivityIndex.documents
            .get(opened.id)
            ?.routingGeometry.routes.get(route.id)?.centerline
        : undefined;
      if (centerline?.[0]) focusPoint(centerline[0]);
    }
    setSelectionOpen(true);
    setStatus(statusMessage);
  };

  const navigateToNetlistDiagnostic = (diagnostic: NetlistDiagnostic): void => {
    navigateToLocator(diagnostic.primary, `Preflight: ${diagnostic.message}`);
    if (diagnostic.primary.kind !== "document") return;
    fitDocument(diagnostic.primary.documentId);
  };

  const fitDocument = (documentId: string, statusMessage?: string): void => {
    const target = project.documents.find(
      (candidate) => candidate.id === documentId,
    );
    if (!target) return;
    if (statusMessage) {
      navigateToLocator(
        {
          documentId: target.id,
          hierarchyPath: target.id === document.id ? documentStack : [],
          kind: "document",
          objectId: target.id,
        },
        statusMessage,
      );
    }
    const bounds = buildSvgScene(target, resolver).viewBox;
    const grid = target.presentation.grid;
    const measured = measureCanvasView?.() ?? null;
    setViewBox(
      measured
        ? fitCameraToVisibleBounds(
            bounds,
            grid,
            measured.viewport,
            measured.insets,
          )
        : fitCameraToBounds(bounds, grid),
      grid,
    );
  };

  const enterHierarchy = (instanceId: string): void => {
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    const targetId = instance ? referencedDocumentId(project, instance) : null;
    if (!targetId) {
      setStatus(`${instanceId} has no child Cell`);
      return;
    }
    setDocumentStack((current) => [
      ...current,
      {
        parentDocumentId: document.id,
        instanceId,
        childDocumentId: targetId,
      },
    ]);
    switchDocument(targetId);
  };

  const enterSelectedHierarchy = (): void => {
    if (
      selectedInstance &&
      referencedDocumentId(project, selectedInstance) !== null
    ) {
      enterHierarchy(selectedInstance.id);
      return;
    }
    setStatus("Select a hierarchical block before entering a Cell");
  };

  const returnToParentDocument = (): void => {
    const frame = documentStack.at(-1);
    if (!frame) return;
    const parent = project.documents.find(
      (cell) => cell.id === frame.parentDocumentId,
    );
    if (!parent) {
      setDocumentStack([]);
      setStatus("Parent Cell no longer exists");
      return;
    }
    setDocumentStack((current) => current.slice(0, -1));
    switchDocument(frame.parentDocumentId);
    if (parent?.instances.some((instance) => instance.id === frame.instanceId))
      selectOnly("instance", [frame.instanceId]);
  };

  const returnToTopDocument = (): void => {
    setDocumentStack([]);
    switchDocument(project.topDocumentId);
  };

  const selectSearchResult = (result: SearchResult): void => {
    navigateToLocator(
      result.locator,
      `Selected ${result.locator.kind} ${result.locator.objectId}`,
    );
    closeSearch();
  };

  const jumpToProjectDiagnostic = (diagnostic: Diagnostic): void => {
    navigateToLocator(
      diagnostic.primary,
      `${diagnostic.domain.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`,
    );
  };

  const highlightNet = (
    netId: string,
    documentId = document.id,
    endpoint?: RouteEndpoint,
    hierarchyPath: readonly HierarchyFrame[] = documentId === document.id
      ? documentStack
      : [],
  ): void => {
    setHighlightedNetOrigin({
      documentId,
      netId,
      hierarchyPath,
      ...(endpoint ? { endpoint } : {}),
    });
    setStatus(`Highlighted Net ${netId}`);
  };

  const toggleHighlightedNet = (): void => {
    if (!selectedHighlightNetId) {
      // No selection to highlight from — but an active highlight must still
      // be clearable, or a highlight set by a diagnostic/agent with no
      // surviving selection would be stuck on screen.
      if (highlightedNetOrigin !== null) {
        setHighlightedNetOrigin(null);
        setStatus(`Cleared Net highlight ${highlightedNetOrigin.netId}`);
        return;
      }
      setStatus(
        "Select a wire, connected pin, or Net Label before highlighting a Net",
      );
      return;
    }
    if (selectedHighlightIsActive) {
      setHighlightedNetOrigin(null);
      setStatus(`Cleared Net highlight ${selectedHighlightNetId}`);
      return;
    }
    highlightNet(
      selectedHighlightNetId,
      document.id,
      selectedHighlightEndpoint,
    );
  };

  const navigateTraceHop = (
    hop: HierarchyNetTraceHop | GlobalNetTraceHop,
  ): void => {
    navigateToLocator(
      {
        documentId: hop.to.documentId,
        hierarchyPath: hop.to.hierarchyPath,
        kind: "net",
        objectId: hop.to.netId,
      },
      hop.direction === "global"
        ? `Traced global Net ${hop.foldedName} to ${hop.to.netId}`
        : `Traced Net ${hop.to.netId} via ${hop.frame.instanceId}.${hop.frame.parentPinName}`,
    );
  };

  return {
    switchDocument,
    selectDocumentFromHierarchy,
    jumpToCaller,
    navigateToLocator,
    navigateToNetlistDiagnostic,
    fitDocument,
    enterHierarchy,
    enterSelectedHierarchy,
    returnToParentDocument,
    returnToTopDocument,
    selectSearchResult,
    jumpToProjectDiagnostic,
    highlightNet,
    toggleHighlightedNet,
    navigateTraceHop,
  };
}

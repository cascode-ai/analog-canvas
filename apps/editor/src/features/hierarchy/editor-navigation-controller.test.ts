import { buildProjectConnectivityIndex, traceHierarchyNet } from "@icm/derived";
import { hierarchyParameterFixture } from "../../../../../netlists/hierarchy-parameters/fixture";
import {
  createEmptyProject,
  createEmptyDocument,
  createRoutePath,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import {
  fitCameraToVisibleBounds,
  focusCameraOnPoint,
} from "../../canvas/fit-view";
import {
  createEditorNavigationController,
  type EditorNavigationControllerDependencies,
} from "./editor-navigation-controller";

function dependencies(
  selectedHighlightIsActive = false,
): EditorNavigationControllerDependencies {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances.push({ id: "R1", symbolId: "resistor", placement: null });
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  return {
    project,
    document,
    resolver,
    connectivityIndex: buildProjectConnectivityIndex(project, resolver),
    documentStack: [],
    setDocumentStack:
      vi.fn() as unknown as EditorNavigationControllerDependencies["setDocumentStack"],
    documentViewBoxes: { current: new Map() },
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    defaultViewBox: { x: 0, y: 0, width: 100, height: 100 },
    setViewBox: vi.fn(),
    openDocument: (documentId) =>
      project.documents.find((candidate) => candidate.id === documentId),
    resetInteractionState: vi.fn(),
    selectOnly: vi.fn(),
    setSelectedEndpoint: vi.fn(),
    setHighlightedNetOrigin: vi.fn(),
    highlightedNetOrigin: null,
    selectedHighlightNetId: "net-a",
    selectedHighlightEndpoint: undefined,
    selectedHighlightIsActive,
    closeSearch: vi.fn(),
    setSelectionOpen: vi.fn(),
    setCellManagerOpen: vi.fn(),
    selectedInstance: undefined,
    setStatus: vi.fn(),
  };
}

describe("editor navigation controller", () => {
  it("follows a traced parent pin into the correct repeated Cell occurrence and back", () => {
    const input = dependencies();
    const project = hierarchyParameterFixture();
    const parent = project.documents[0]!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const index = buildProjectConnectivityIndex(project, resolver);
    const parentNet = parent.nets.find((net) =>
      net.terminals.some(
        (item) => item.instanceId === "X2" && item.pinName === "IN",
      ),
    )!;
    const trace = traceHierarchyNet(index, parent.id, parentNet.id);
    if (!trace) throw new Error("Expected parent trace");
    const down = trace.hops.find(
      (hop) => hop.direction === "down" && hop.frame.instanceId === "X2",
    )!;
    expect(down).toBeDefined();
    const controller = createEditorNavigationController({
      ...input,
      project,
      document: parent,
      resolver,
      connectivityIndex: index,
      openDocument: (id) => project.documents.find((item) => item.id === id),
    });
    controller.navigateTraceHop(down);
    expect(input.setDocumentStack).toHaveBeenLastCalledWith(
      down.to.hierarchyPath,
    );
    expect(down.to.hierarchyPath.at(-1)?.instanceId).toBe("X2");
    expect(input.setHighlightedNetOrigin).toHaveBeenLastCalledWith(down.to);
    const returnTrace = traceHierarchyNet(
      index,
      down.to.documentId,
      down.to.netId,
      undefined,
      down.to.hierarchyPath,
    );
    if (!returnTrace) throw new Error("Expected child trace");
    const up = returnTrace.hops.find(
      (hop) => hop.direction === "up" && hop.frame.instanceId === "X2",
    )!;
    expect(up).toBeDefined();
    controller.navigateTraceHop(up);
    expect(input.setDocumentStack).toHaveBeenLastCalledWith([]);
    expect(input.setHighlightedNetOrigin).toHaveBeenLastCalledWith(up.to);
  });
  it.each([1])(
    "opens a definition without inventing any of its %i caller paths",
    (count) => {
      const input = dependencies();
      const child = createEmptyDocument("child", "Child");
      input.project.documents.push(child);
      for (let index = 0; index < count; index++)
        input.document.instances.push({
          id: `X${index}`,
          symbolId: "unresolved-block",
          placement: null,
          netlist: {
            parameters: {},
            binding: { kind: "subcircuit", childDocumentId: child.id },
          },
        });
      input.connectivityIndex = buildProjectConnectivityIndex(
        input.project,
        input.resolver,
      );
      createEditorNavigationController(input).selectDocumentFromHierarchy(
        child.id,
      );
      expect(input.setDocumentStack).toHaveBeenCalledWith([]);
      expect(input.setStatus).toHaveBeenCalledWith("Opened Cell Child");
    },
  );

  it("opens and focuses a caller in an unreferenced parent definition", () => {
    const input = dependencies();
    const parent = createEmptyDocument("detached", "Detached");
    parent.instances.push({
      id: "X1",
      symbolId: "unresolved-block",
      placement: { position: { x: 500, y: 300 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: input.document.id },
      },
    });
    input.project.documents.push(parent);
    createEditorNavigationController(input).jumpToCaller(parent.id, "X1");
    expect(input.setDocumentStack).toHaveBeenCalledWith([]);
    expect(input.selectOnly).toHaveBeenCalledWith("instance", ["X1"]);
    expect(input.setViewBox).toHaveBeenLastCalledWith(
      { x: 420, y: 240, width: 160, height: 120 },
      parent.presentation.grid,
    );
    expect(input.setCellManagerOpen).toHaveBeenCalledWith(false);
  });

  it("returns to the actual parent instance and preserves an explicit locator path only while valid", () => {
    const input = dependencies();
    const parent = input.document;
    const child = createEmptyDocument("child", "Child");
    input.project.documents.push(child);
    parent.instances.push({
      id: "X1",
      symbolId: "unresolved-block",
      placement: null,
      reference: "X1",
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });
    const path = [
      {
        parentDocumentId: parent.id,
        instanceId: "X1",
        childDocumentId: child.id,
      },
    ];
    const controller = createEditorNavigationController({
      ...input,
      document: child,
      documentStack: path,
    });
    controller.returnToParentDocument();
    expect(input.selectOnly).toHaveBeenCalledWith("instance", ["X1"]);
    controller.navigateToLocator(
      {
        documentId: child.id,
        hierarchyPath: path,
        kind: "document",
        objectId: child.id,
      },
      "found",
    );
    expect(input.setDocumentStack).toHaveBeenLastCalledWith(path);
    parent.instances = parent.instances.filter(
      (instance) => instance.id !== "X1",
    );
    controller.navigateToLocator(
      {
        documentId: child.id,
        hierarchyPath: path,
        kind: "document",
        objectId: child.id,
      },
      "found",
    );
    expect(input.setDocumentStack).toHaveBeenLastCalledWith([]);
  });
  it("owns search-result focus and closes the search session", () => {
    const input = dependencies();
    const controller = createEditorNavigationController(input);

    controller.selectSearchResult({
      locator: {
        documentId: input.document.id,
        hierarchyPath: [],
        kind: "instance",
        objectId: "R1",
      },
      label: "R1",
      field: "instance-id",
      matchType: "exact",
    });

    expect(input.selectOnly).toHaveBeenCalledWith("instance", ["R1"]);
    expect(input.closeSearch).toHaveBeenCalledOnce();
  });

  it("frames a found part again once the Properties it opens is drawn (#2186)", () => {
    const phone = (dock: number) => ({
      viewport: { width: 390, height: 700 },
      insets: { left: 0, right: dock, top: 0, bottom: 0 },
    });
    const point = { x: 400, y: 300 };
    const result = {
      locator: {
        documentId: "",
        hierarchyPath: [],
        kind: "instance" as const,
        objectId: "R1",
      },
      label: "R1",
      field: "instance-id" as const,
      matchType: "exact" as const,
    };
    const setUp = (selectionOpen: boolean) => {
      const input = dependencies();
      input.document.instances[0]!.placement = {
        position: point,
        rotation: 0,
        mirror: "none",
      };
      result.locator.documentId = input.document.id;
      let measured = phone(selectionOpen ? 280 : 40);
      input.measureCanvasView = () => measured;
      input.selectionOpen = selectionOpen;
      input.onFocusBeforeDock = vi.fn();
      input.setSelectionOpen = vi.fn(() => {
        measured = phone(280);
      });
      createEditorNavigationController(input).selectSearchResult(result);
      return input;
    };
    // Closed: framed beside the collapsed shelf, then again beside the dock.
    const closed = setUp(false);
    const grid = closed.document.presentation.grid;
    const besideDock = focusCameraOnPoint(point, grid, phone(280));
    expect(closed.setSelectionOpen).toHaveBeenCalledWith(true);
    expect(closed.setViewBox).toHaveBeenLastCalledWith(
      focusCameraOnPoint(point, grid, phone(40)),
      grid,
    );
    const frameAgain = vi.mocked(closed.onFocusBeforeDock!).mock.calls[0]![0];
    frameAgain();
    expect(closed.setViewBox).toHaveBeenLastCalledWith(besideDock, grid);

    // Already open: framed beside the dock at once, nothing to do later.
    const open = setUp(true);
    expect(open.setViewBox).toHaveBeenLastCalledWith(besideDock, grid);
    expect(open.onFocusBeforeDock).not.toHaveBeenCalled();
  });

  it("owns Net highlight activation and clearing", () => {
    const activate = dependencies(false);
    createEditorNavigationController(activate).toggleHighlightedNet();
    expect(activate.setHighlightedNetOrigin).toHaveBeenCalledWith({
      documentId: activate.document.id,
      netId: "net-a",
      hierarchyPath: [],
    });

    const clear = dependencies(true);
    createEditorNavigationController(clear).toggleHighlightedNet();
    expect(clear.setHighlightedNetOrigin).toHaveBeenCalledWith(null);
  });

  it("clears an active highlight even when nothing highlightable is selected", () => {
    const stuck = {
      ...dependencies(false),
      selectedHighlightNetId: null,
      highlightedNetOrigin: { netId: "net-x" },
    };
    createEditorNavigationController(stuck).toggleHighlightedNet();
    expect(stuck.setHighlightedNetOrigin).toHaveBeenCalledWith(null);
    expect(stuck.setStatus).toHaveBeenCalledWith("Cleared Net highlight net-x");
  });

  it("net navigation selects the net's route so the highlight stays togglable", () => {
    const input = dependencies(false);
    input.document.nets.push({ id: "net-1", terminals: [] });
    input.document.junctions.push(
      {
        id: "j1",
        netId: "net-1",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "j2",
        netId: "net-1",
        position: { x: 40, y: 0 },
        role: "route-anchor",
      },
    );
    input.document.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-1",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    input.connectivityIndex = buildProjectConnectivityIndex(
      input.project,
      input.resolver,
    );
    createEditorNavigationController(input).navigateToLocator(
      {
        documentId: input.document.id,
        hierarchyPath: [],
        kind: "net",
        objectId: "net-1",
      },
      "Preflight: floating net",
    );
    expect(input.setHighlightedNetOrigin).toHaveBeenCalledWith({
      documentId: input.document.id,
      netId: "net-1",
      hierarchyPath: [],
    });
    expect(input.selectOnly).toHaveBeenCalledWith("route", ["route-1"]);
  });

  it("fits the Cell on show as the F key does, keeping the person's work (#1444)", () => {
    const input = dependencies();
    const other = createEmptyDocument("other", "Other");
    input.project.documents.push(other);
    const controller = createEditorNavigationController(input);

    controller.fitDocument(input.document.id, "Agent fit Cell top");
    // Only the view moves: no navigation, nothing reset or reselected.
    expect(input.setViewBox).toHaveBeenCalledTimes(1);
    expect(input.resetInteractionState).not.toHaveBeenCalled();
    expect(input.setDocumentStack).not.toHaveBeenCalled();
    expect(input.setStatus).toHaveBeenLastCalledWith("Agent fit Cell top");

    // Another Cell is opened first (restoring its view), then fitted.
    controller.fitDocument(other.id, "Agent fit Cell other");
    expect(input.resetInteractionState).toHaveBeenCalled();
    expect(vi.mocked(input.setViewBox).mock.calls.length).toBeGreaterThan(1);
  });
});

describe("entering or leaving a Cell fits the view (#1686)", () => {
  const measured = {
    viewport: { width: 1200, height: 800 },
    insets: { top: 0, right: 320, bottom: 0, left: 0 },
  };

  function hierarchy() {
    const input = dependencies();
    input.measureCanvasView = () => measured;
    const parent = input.document;
    const child = createEmptyDocument("child", "Child");
    child.instances.push({
      id: "R9",
      symbolId: "resistor",
      placement: { position: { x: 900, y: 700 }, rotation: 0, mirror: "none" },
      reference: "R9",
    });
    input.project.documents.push(child);
    parent.instances.push({
      id: "R2",
      symbolId: "resistor",
      placement: { position: { x: 200, y: 100 }, rotation: 0, mirror: "none" },
      reference: "R2",
    });
    parent.instances.push({
      id: "X1",
      symbolId: "unresolved-block",
      placement: null,
      reference: "X1",
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });
    // Both Cells remember an old view that shows none of their drawing.
    input.documentViewBoxes.current.set(parent.id, {
      x: -5000,
      y: -5000,
      width: 100,
      height: 100,
    });
    input.documentViewBoxes.current.set(child.id, {
      x: -5000,
      y: -5000,
      width: 100,
      height: 100,
    });
    const fitted = (cell: typeof child) =>
      fitCameraToVisibleBounds(
        buildSvgScene(cell, input.resolver).viewBox,
        cell.presentation.grid,
        measured.viewport,
        measured.insets,
      );
    const path = [
      {
        parentDocumentId: parent.id,
        instanceId: "X1",
        childDocumentId: child.id,
      },
    ];
    return { input, parent, child, fitted, path };
  }

  it("fits the child Cell after E enters a block", () => {
    const { input, parent, child, fitted } = hierarchy();
    createEditorNavigationController({
      ...input,
      selectedInstance: parent.instances.find((item) => item.id === "X1"),
    }).enterSelectedHierarchy();
    expect(input.setStatus).toHaveBeenCalledWith("Opened Cell Child");
    expect(input.setViewBox).toHaveBeenLastCalledWith(
      fitted(child),
      child.presentation.grid,
    );
  });

  it("fits the parent Cell on return and keeps the block selected", () => {
    const { input, parent, child, fitted, path } = hierarchy();
    createEditorNavigationController({
      ...input,
      document: child,
      documentStack: path,
    }).returnToParentDocument();
    expect(input.setViewBox).toHaveBeenLastCalledWith(
      fitted(parent),
      parent.presentation.grid,
    );
    expect(input.selectOnly).toHaveBeenLastCalledWith("instance", ["X1"]);
  });

  it("fits the top Cell on return to the top", () => {
    const { input, parent, child, fitted, path } = hierarchy();
    createEditorNavigationController({
      ...input,
      document: child,
      documentStack: path,
    }).returnToTopDocument();
    expect(input.setDocumentStack).toHaveBeenLastCalledWith([]);
    expect(input.setViewBox).toHaveBeenLastCalledWith(
      fitted(parent),
      parent.presentation.grid,
    );
  });

  it("fits a Cell opened from the Cell Manager's occurrence tree", () => {
    const { input, child, fitted, path } = hierarchy();
    createEditorNavigationController(input).openCellOccurrence(child.id, path);
    expect(input.setDocumentStack).toHaveBeenLastCalledWith(path);
    expect(input.setStatus).toHaveBeenLastCalledWith("Opened Cell occurrence");
    expect(input.setViewBox).toHaveBeenLastCalledWith(
      fitted(child),
      child.presentation.grid,
    );
  });

  it("completes a return whose Cell cannot be drawn, fitting the default view as F does", () => {
    const { input, parent, child, path } = hierarchy();
    // A symbol the resolver does not know makes the parent's scene throw.
    parent.instances.push({
      id: "U1",
      symbolId: "missing-symbol",
      reference: "U1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    expect(() => buildSvgScene(parent, input.resolver)).toThrow();
    createEditorNavigationController({
      ...input,
      document: child,
      documentStack: path,
    }).returnToParentDocument();
    expect(input.setViewBox).toHaveBeenLastCalledWith(
      fitCameraToVisibleBounds(
        input.defaultViewBox,
        parent.presentation.grid,
        measured.viewport,
        measured.insets,
      ),
      parent.presentation.grid,
    );
    expect(input.selectOnly).toHaveBeenLastCalledWith("instance", ["X1"]);
  });

  it("keeps a remembered view when a Cell is opened by definition", () => {
    const { input, child } = hierarchy();
    createEditorNavigationController(input).selectDocumentFromHierarchy(
      child.id,
    );
    expect(input.setViewBox).toHaveBeenLastCalledWith(
      { x: -5000, y: -5000, width: 100, height: 100 },
      child.presentation.grid,
    );
  });
});

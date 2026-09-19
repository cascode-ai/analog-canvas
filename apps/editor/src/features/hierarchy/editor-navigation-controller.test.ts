import { buildProjectConnectivityIndex, traceHierarchyNet } from "@icm/derived";
import { hierarchyParameterFixture } from "../../../../../netlists/hierarchy-parameters/fixture";
import {
  createEmptyProject,
  createEmptyDocument,
  createRoutePath,
} from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

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
  it.each([1, 2])(
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
});

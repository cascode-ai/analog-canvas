import { buildProjectConnectivityIndex } from "@icm/derived";
import { createEmptyProject, createRoutePath } from "@icm/model";
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
    setInstanceTableOpen: vi.fn(),
    setCellManagerOpen: vi.fn(),
    selectedInstance: undefined,
    setStatus: vi.fn(),
  };
}

describe("editor navigation controller", () => {
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

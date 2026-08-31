import { createRoutePath } from "@icm/model";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { deriveSelectionInspectionModel } from "./selection-inspection-model";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const emptySupplementalSelection = {
  routeIds: [],
  junctionIds: [],
  annotationIds: [],
  draftingIds: [],
};

describe("selection inspection model", () => {
  it("resolves a selected hierarchy instance without owning navigation", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    const child = createEmptyDocument("child", "Child");
    project.documents.push(child);
    document.instances.push({
      id: "X1",
      symbolId: "hierarchical:Child",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "X1",
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });

    const model = deriveSelectionInspectionModel({
      project,
      document,
      resolver,
      selection: { instanceIds: ["X1"], ...emptySupplementalSelection },
      selectedEndpoint: null,
    });

    expect(model.selectedHierarchyCell?.id).toBe("child");
    expect(model.hasHierarchyEnterSelection).toBe(true);
    expect(model.selectionShelfSummary).toBe("X1 · hierarchical:Child");
  });

  it("does not treat drafting rectangles as hierarchy entry targets", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.drafting!.objects.push({
      id: "rectangle-1",
      kind: "rectangle",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 100, y: 100 } },
      center: { x: 100, y: 100 },
      width: 80,
      height: 40,
      rotation: 0,
      lineStyle: "solid",
    });

    const model = deriveSelectionInspectionModel({
      project,
      document,
      resolver,
      selection: {
        instanceIds: [],
        ...emptySupplementalSelection,
        draftingIds: ["rectangle-1"],
      },
      selectedEndpoint: null,
    });

    expect(model.hasHierarchyEnterSelection).toBe(false);
  });

  it("prefers an imported route-bound Net Label over its identifier shape", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.nets.push({
      id: "net-signal",
      terminals: [],
    });
    document.junctions.push(
      {
        id: "j1",
        netId: "net-signal",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "j2",
        netId: "net-signal",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-signal",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.annotations.push({
      id: "imported-label-42",
      kind: "net-label",
      netId: "net-signal",
      anchor: {
        kind: "route",
        routeId: "route-1",
        legId: document.routes[0]!.legs[0]!.id,
        t: 0.5,
        normalOffset: 0,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 50, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const model = deriveSelectionInspectionModel({
      project,
      document,
      resolver,
      selection: {
        instanceIds: [],
        routeIds: ["route-1"],
        junctionIds: [],
        annotationIds: [],
        draftingIds: [],
      },
      selectedEndpoint: null,
    });

    expect(model.selectedRouteNetLabel?.id).toBe("imported-label-42");
    expect(model.selectedHighlightNetId).toBe("net-signal");
    expect(model.hasRotatableSelection).toBe(false);
  });

  it("projects a selected disconnected endpoint and its No Connect marker", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.noConnects.push({
      id: "nc-r1-1",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
    });
    const selectedEndpoint = {
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" } as const,
      netId: null,
      connection: {
        endpoint: {
          kind: "terminal" as const,
          instanceId: "R1",
          pinName: "1",
        },
        contactPoint: { x: -40, y: 0 },
        gridLanding: { x: -40, y: 0 },
        escapePath: [],
        outward: null,
      },
      preludeEdits: [],
    };

    const model = deriveSelectionInspectionModel({
      project,
      document,
      resolver,
      selection: { instanceIds: [], ...emptySupplementalSelection },
      selectedEndpoint,
    });

    expect(model.selectedNoConnect?.id).toBe("nc-r1-1");
    expect(model.selectedEndpointNetId).toBeNull();
    expect(model.hasInspectableSelection).toBe(true);
    expect(model.selectionShelfSummary).toBe("Endpoint");
  });
});

import { expect, it } from "vitest";
import { createEmptyProject, createRoutePath } from "@icm/model";
import { buildProjectConnectivityIndex, deriveCrossings } from "@icm/derived";
import { EditorDocumentController } from "../document/document-controller";
import { createEditorSnapshotDerivedCache } from "./editor-snapshot-derived-cache";

it("restores revision-independent facts and publishes the current history revision", () => {
  const controller = new EditorDocumentController(
    createEmptyProject("restore", "Restore"),
  );
  const cache = createEditorSnapshotDerivedCache();
  const current = () =>
    cache.connectivity(controller.project, controller.resolver);
  const id = controller.document.id;
  const first = current().documents.get(id)!;
  const firstCrossings = cache.crossings(
    controller.document,
    controller.resolver,
  );
  expect(
    controller.transact([
      {
        kind: "add_instance",
        instance: {
          id: "R1",
          symbolId: "resistor",
          placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        },
      },
    ]).ok,
  ).toBe(true);
  const added = current().documents.get(id)!;
  for (const [kind, saved] of [
    ["undo", first],
    ["redo", added],
    ["undo", first],
  ] as const) {
    expect(controller.transact([{ kind }]).ok).toBe(true);
    const projectIndex = current(),
      restored = projectIndex.documents.get(id)!;
    expect(restored.documentRevision).toBe(controller.document.revision);
    expect(restored.routingGeometry.documentRevision).toBe(
      restored.documentRevision,
    );
    expect(restored.spatialIndex.documentRevision).toBe(
      restored.documentRevision,
    );
    expect(restored.spatialIndex.routeSegments).toBe(
      saved.spatialIndex.routeSegments,
    );
    expect(restored.instancesById.has("R1")).toBe(kind === "redo");
    expect(Boolean(projectIndex.objectIndex.resolve(id, "R1"))).toBe(
      kind === "redo",
    );
    if (kind === "undo")
      expect(cache.crossings(controller.document, controller.resolver)).toBe(
        firstCrossings,
      );
  }
  const other = new EditorDocumentController(controller.project);
  expect(
    cache.connectivity(controller.project, other.resolver).documents.get(id)!
      .spatialIndex.routeSegments,
  ).not.toBe(first.spatialIndex.routeSegments);
});

it("reuses derived geometry across tab returns and invalidates real edits and symbol contexts", () => {
  const controller = new EditorDocumentController(
    createEmptyProject("derived-cache", "Derived cache"),
  );
  const cache = createEditorSnapshotDerivedCache();
  const first = cache.connectivity(controller.project, controller.resolver);
  const crossings = cache.crossings(
    controller.document,
    controller.resolver,
    first.documents.get(controller.document.id)!.routingGeometry,
  );
  expect(cache.connectivity(controller.project, controller.resolver)).toBe(
    first,
  );
  expect(cache.crossings(controller.document, controller.resolver)).toBe(
    crossings,
  );
  const result = controller.transact([
    {
      kind: "add_instance",
      instance: {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
    },
  ]);
  expect(result.ok).toBe(true);
  expect(cache.connectivity(controller.project, controller.resolver)).not.toBe(
    first,
  );
  const actual = cache.connectivity(controller.project, controller.resolver);
  const expected = buildProjectConnectivityIndex(
    controller.project,
    controller.resolver,
  );
  expect(actual.objectIndex.resolve(controller.document.id, "R1")).toEqual(
    expected.objectIndex.resolve(controller.document.id, "R1"),
  );
  expect(actual.documents.get(controller.document.id)!.instancesById).toEqual(
    expected.documents.get(controller.document.id)!.instancesById,
  );
  expect(actual.documents.get(controller.document.id)!.routingGuidance).toEqual(
    expected.documents.get(controller.document.id)!.routingGuidance,
  );
  expect(cache.crossings(controller.document, controller.resolver)).toEqual(
    deriveCrossings(controller.document, controller.resolver),
  );
  const other = new EditorDocumentController(controller.project);
  expect(cache.connectivity(controller.project, other.resolver)).not.toBe(
    cache.connectivity(controller.project, controller.resolver),
  );
});

function crossingProject() {
  const project = createEmptyProject("placement", "Placement");
  const document = project.documents[0]!;
  const route = (id: string, x: number, y: number, offset = 0) => {
    document.nets.push({ id, terminals: [] });
    document.junctions.push(
      { id: id + "-start", netId: id, position: { x: offset - x, y: -y } },
      { id: id + "-end", netId: id, position: { x: offset + x, y } },
    );
    return createRoutePath({
      id: id + "-route",
      netId: id,
      start: { kind: "junction", junctionId: id + "-start" },
      end: { kind: "junction", junctionId: id + "-end" },
      bends: [],
      modes: ["manual"],
    });
  };
  document.routes.push(
    route("a", 40, 0),
    route("b", 0, 40),
    route("c", 0, 40, 20),
  );
  return project;
}

function crossingFixture(project = crossingProject()) {
  const controller = new EditorDocumentController(project);
  const cache = createEditorSnapshotDerivedCache();
  const read = () => {
    const index = cache
      .connectivity(controller.project, controller.resolver)
      .documents.get(controller.document.id)!;
    return cache.crossings(
      controller.document,
      controller.resolver,
      index.routingGeometry,
    );
  };
  return { controller, read };
}

it("retains the ordered crossing records when blank placement changes no resolved Route", () => {
  const { controller, read } = crossingFixture();
  const initial = read();
  expect(initial).toHaveLength(2);
  expect(
    controller.transact([
      {
        kind: "add_instance",
        instance: {
          id: "M1",
          symbolId: "nmos",
          placement: {
            position: { x: 200, y: 200 },
            rotation: 0,
            mirror: "none",
          },
        },
      },
    ]).ok,
  ).toBe(true);
  expect(read()).toBe(initial);
});

it("replaces affected crossings and keeps the records of untouched neighbors", () => {
  const { controller, read } = crossingFixture();
  const before = read();
  const edit = controller.transact([
    { kind: "remove_route_geometry", routeId: "c-route" },
  ]);
  expect(edit.ok, JSON.stringify(edit.diagnostics)).toBe(true);
  const after = read();
  expect(after).toEqual(
    deriveCrossings(controller.document, controller.resolver),
  );
  expect(after).toHaveLength(1);
  expect(after[0]).toBe(before[0]);
});

it("keeps the Crossing ownership, overlaps and ordering of the final snapshot", () => {
  const { controller, read } = crossingFixture();
  read();
  const project = structuredClone(controller.project);
  const doc = project.documents[0]!;
  // Reassign c to b without altering the Route's shape. Reversing the other
  // wire creates a collinear overlap whose anchor depends on sweep order.
  doc.routes[2]!.netId = "b";
  for (const j of doc.junctions.filter((j) => j.netId === "c")) j.netId = "b";
  doc.junctions.find((j) => j.id === "a-start")!.position = { x: 20, y: 80 };
  doc.junctions.find((j) => j.id === "a-end")!.position = { x: 20, y: -80 };
  doc.revision++;
  project.structureRevision++;
  controller.commitProjectStructure(project);
  const oracle = deriveCrossings(controller.document, controller.resolver);
  expect(oracle).toContainEqual({
    routeAId: "a-route",
    routeBId: "c-route",
    netAId: "a",
    netBId: "b",
    point: { x: 20, y: 40 },
    kind: "overlap",
  });
  expect(read()).toEqual(oracle);
  expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
  expect(read()).toEqual(
    deriveCrossings(controller.document, controller.resolver),
  );
});

it("preserves the editor's supplied geometry for a junction ID that spells a bus member", () => {
  const project = crossingProject(),
    doc = project.documents[0]!;
  // Separate Routes refer to the scalar and the member. The committed
  // geometry uses its indexed point for both; explicit standalone geometry
  // resolves the scalar independently.
  doc.nets.push({ id: "y", terminals: [] });
  doc.junctions.find((j) => j.id === "b-start")!.id = "J:member:x";
  const bus = doc.junctions.find((j) => j.id === "c-start")!;
  bus.id = "J";
  bus.members = [
    { id: "x", netId: "c" },
    { id: "y", netId: "y" },
  ];
  doc.routes[1]!.start = { kind: "junction", junctionId: "J:member:x" };
  doc.routes[2]!.start = { kind: "junction", junctionId: "J", memberId: "x" };
  const { controller, read } = crossingFixture(project);
  const original = read();
  expect(original).not.toEqual(
    deriveCrossings(controller.document, controller.resolver),
  );
  const placed = controller.transact([
    {
      kind: "add_instance",
      instance: {
        id: "M2",
        symbolId: "nmos",
        placement: {
          position: { x: 300, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
    },
  ]);
  expect(placed.ok, JSON.stringify(placed.diagnostics)).toBe(true);
  expect(read()).toBe(original);
  const change = structuredClone(controller.project);
  change.documents[0]!.junctions.find((j) => j.id === "J")!.position = {
    x: 40,
    y: -40,
  };
  change.documents[0]!.revision++;
  change.structureRevision++;
  controller.commitProjectStructure(change);
  const document = controller.document,
    resolver = controller.resolver;
  const supplied = buildProjectConnectivityIndex(
    controller.project,
    resolver,
  ).documents.get(document.id)!.routingGeometry;
  expect(read()).toEqual(deriveCrossings(document, resolver, supplied));
});

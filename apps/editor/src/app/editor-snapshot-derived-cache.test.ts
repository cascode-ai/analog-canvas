import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
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

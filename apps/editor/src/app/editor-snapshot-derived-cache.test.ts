import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { buildProjectConnectivityIndex, deriveCrossings } from "@icm/derived";
import { EditorDocumentController } from "../document/document-controller";
import { createEditorSnapshotDerivedCache } from "./editor-snapshot-derived-cache";

it("reuses derived geometry across tab returns and invalidates real edits and symbol contexts", () => {
  const controller = new EditorDocumentController(
    createEmptyProject("derived-cache", "Derived cache"),
  );
  const cache = createEditorSnapshotDerivedCache();
  const first = cache.connectivity(controller.project, controller.resolver);
  const crossings = cache.crossings(controller.document, controller.resolver);
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

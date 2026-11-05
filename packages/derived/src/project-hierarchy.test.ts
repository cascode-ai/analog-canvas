import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { expect, it } from "vitest";
import {
  buildProjectHierarchy,
  reconcileHierarchyPath,
} from "./project-hierarchy.js";

function projectFixture() {
  const project = createEmptyProject("hierarchy", "Hierarchy", "top");
  for (const id of ["channel", "amplifier", "pair", "unused"])
    project.documents.push(createEmptyDocument(id, id));
  for (const [parent, reference, child] of [
    ["top", "X1", "channel"],
    ["top", "X2", "channel"],
    ["channel", "XA", "amplifier"],
    ["amplifier", "XP", "pair"],
    ["unused", "XP", "pair"],
  ]) {
    project.documents
      .find((d) => d.id === parent)!
      .instances.push({
        id: reference!,
        reference: reference!,
        symbolId: "unresolved",
        placement: null,
        netlist: {
          parameters: {},
          binding: { kind: "subcircuit", childDocumentId: child! },
        },
      });
  }
  return project;
}

it("finds distinct four-level uses and preserves the hierarchy outside Top", () => {
  const hierarchy = buildProjectHierarchy(projectFixture());
  expect(hierarchy.roots).toEqual(["top", "unused"]);
  const usage = hierarchy.usage("pair", 2);
  expect(usage.total).toBe(3);
  expect(usage.truncated).toBe(true);
  expect(
    usage.occurrences.map(({ rootDocumentId, path }) => [
      rootDocumentId,
      path.map((f) => f.instanceId),
    ]),
  ).toEqual([
    ["top", ["X1", "XA", "XP"]],
    ["top", ["X2", "XA", "XP"]],
  ]);
  expect(hierarchy.usage("unused").total).toBe(0);
  expect(hierarchy.usage("channel").total).toBe(2);
});

it("returns to the nearest surviving occurrence after deleting a call, without choosing another use of the same Cell", () => {
  const project = projectFixture();
  const path =
    buildProjectHierarchy(project).usage("pair").occurrences[1]!.path;
  project.documents.find((document) => document.id === "channel")!.instances =
    [];
  expect(reconcileHierarchyPath(project, "pair", path)).toEqual({
    documentId: "channel",
    path: path.slice(0, 1),
  });
  project.documents[0]!.instances = [];
  expect(reconcileHierarchyPath(project, "pair", path)).toEqual({
    documentId: "top",
    path: [],
  });
});

it("bounds use-location enumeration when repeated definitions multiply paths", () => {
  const project = createEmptyProject("large", "Large", "root");
  for (let index = 1; index <= 22; index++) {
    const parent = project.documents.at(-1)!;
    const child = createEmptyDocument(`c${index}`, `Cell${index}`);
    project.documents.push(child);
    for (const id of ["X1", "X2"])
      parent.instances.push({
        id,
        symbolId: "unresolved",
        placement: null,
        netlist: {
          parameters: {},
          binding: { kind: "subcircuit", childDocumentId: child.id },
        },
      });
  }
  const uses = buildProjectHierarchy(project).usage("c22");
  expect(uses.total).toBe(1_000_000);
  expect(uses.atLeast).toBe(true);
  expect(uses.truncated).toBe(true);
  expect(uses.occurrences).toHaveLength(50);
});

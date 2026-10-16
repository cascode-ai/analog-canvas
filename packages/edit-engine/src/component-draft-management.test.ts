import { expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import {
  componentDraftCatalog,
  planComponentDraftDeletion,
} from "./component-draft-management.js";
import { executeProjectTransaction } from "./project-transaction.js";

it("deletes typed candidates atomically without deleting shared source or applied facts", () => {
  const project = createEmptyProject("drafts", "drafts");
  project.componentAuthoringDrafts = [{ id: "a", text: "broken 中" }];
  const candidate = (definitionId: string) => ({
    definitionId,
    entry: definitionId,
    symbolMode: "automatic" as const,
    artworkText: "",
    portMaps: {},
  });
  project.modelSources = [
    {
      id: "s",
      revision: 2,
      language: "spice",
      entry: "a.spice",
      files: [{ path: "a.spice", text: "* Applied" }],
      dependencies: [],
      draft: {
        baseRevision: 1,
        entry: "a.spice",
        files: [{ path: "a.spice", text: "* Shared 中" }],
        authoring: [candidate("a"), candidate("b")],
      },
    },
  ];
  const catalog = componentDraftCatalog(project);
  expect(catalog.entries).toHaveLength(3);
  const plan = planComponentDraftDeletion(project, [
    { kind: "circuit", sourceId: "s", definitionId: "a" },
    { kind: "component", draftId: "a" },
  ]);
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: 0,
    transactionId: "delete",
    actor: { kind: "agent", id: "test" },
    edits: plan.edits,
  });
  if (!result.ok) throw Error(result.error.message);
  expect(result.project.componentAuthoringDrafts).toEqual([]);
  expect(result.project.modelSources![0]!.draft!.baseRevision).toBe(1);
  expect(result.project.modelSources![0]!.files).toEqual(
    project.modelSources[0]!.files,
  );
  expect(result.project.modelSources![0]!.draft!.files).toEqual(
    project.modelSources[0]!.draft!.files,
  );
  expect(
    result.project.modelSources![0]!.draft!.authoring!.map(
      (x) => x.definitionId,
    ),
  ).toEqual(["b"]);
  expect(catalog.bytes - componentDraftCatalog(result.project).bytes).toBe(
    plan.reclaimBytes,
  );
  expect(() =>
    planComponentDraftDeletion(project, [
      { kind: "component", draftId: "missing" },
    ]),
  ).toThrow(/changed/);
  const stale = structuredClone(project);
  stale.modelSources![0]!.draft!.files[0]!.text = "changed";
  expect(
    executeProjectTransaction(stale, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "stale",
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    }).ok,
  ).toBe(false);
  expect(stale.componentAuthoringDrafts).toHaveLength(1);
});

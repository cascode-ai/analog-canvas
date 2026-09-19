import {
  createProjectSymbolResolver,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createRoutingDemoProject } from "../../demos/routing-demo";
import { EditorDocumentController } from "../../document/document-controller";

import {
  formatProjectCode,
  planProjectCodeCommit,
  validateProjectCode,
} from "./project-code";

describe("Project Code", () => {
  it("round-trips the complete canonical Project", () => {
    const project = createEmptyProject("project", "Project");
    expect(validateProjectCode(formatProjectCode(project), project.id)).toEqual(
      { ok: true, project },
    );
  });

  it("commits authored code once while managing Project and Cell revisions", () => {
    const project = createEmptyProject("project", "Project");
    const source = JSON.parse(formatProjectCode(project));
    source.name = "Edited in code";
    source.documents[0].name = "Edited Cell";
    source.structureRevision = 99;
    source.documents[0].revision = 99;

    const plan = planProjectCodeCommit(
      project,
      JSON.stringify(source),
      project.topDocumentId,
    );
    expect(plan).toMatchObject({
      ok: true,
      changed: true,
      project: {
        name: "Edited in code",
        structureRevision: project.structureRevision + 1,
        documents: [
          {
            name: "Edited Cell",
            revision: project.documents[0]!.revision + 1,
          },
        ],
      },
    });
  });

  it("rejects invalid JSON and invalid source identities before rebinding", () => {
    const project = createEmptyProject("project", "Project");
    expect(validateProjectCode("{", project.id)).toMatchObject({ ok: false });
    expect(
      validateProjectCode(JSON.stringify({ ...project, id: "" }), project.id),
    ).toMatchObject({ ok: false });
  });

  it("pastes all content from another Project while retaining recipient identity", () => {
    const project = createEmptyProject("recipient", "Recipient");
    const replacement = createRoutingDemoProject();
    replacement.structureRevision = 42;
    replacement.documents[0]!.revision = 17;
    expect(
      planProjectCodeCommit(
        project,
        formatProjectCode(replacement),
        project.topDocumentId,
      ),
    ).toEqual({
      ok: true,
      changed: true,
      activeDocumentId: replacement.topDocumentId,
      project: {
        ...withProjectComponentDefinitions(replacement),
        id: project.id,
        structureRevision: 1,
        documents: replacement.documents.map((document) => ({
          ...document,
          revision: 0,
        })),
      },
    });
    expect(replacement.id).toBe("project-routing");
    expect(replacement.documents[0]!.revision).toBe(17);
  });

  it("treats typed revision changes as editor-managed no-ops", () => {
    const project = createEmptyProject("project", "Project");
    const source = JSON.parse(formatProjectCode(project));
    source.structureRevision += 20;
    source.documents[0].revision += 20;
    expect(
      planProjectCodeCommit(
        project,
        JSON.stringify(source),
        project.topDocumentId,
      ),
    ).toMatchObject({ ok: true, changed: false, project });
  });

  it("edits shared component artwork in code without rewriting instances or pin contracts", () => {
    const project = withProjectComponentDefinitions(createRoutingDemoProject());
    const source = JSON.parse(formatProjectCode(project));
    const definition = source.componentDefinitions[0];
    definition.symbol.primitives.push({
      kind: "circle",
      center: { x: 5, y: 5 },
      radius: 3,
    });
    const plan = planProjectCodeCommit(
      project,
      JSON.stringify(source),
      project.topDocumentId,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changed).toBe(true);
    expect(plan.project.documents).toEqual(project.documents);
    expect(plan.project.componentDefinitions).toHaveLength(1);
    expect(plan.project.componentDefinitions![0]!.electrical).toEqual(
      project.componentDefinitions![0]!.electrical,
    );
    const resolver = createProjectSymbolResolver(plan.project, []);
    for (const instance of plan.project.documents[0]!.instances) {
      expect(resolver.resolve(instance.symbolId)!.definition).toEqual(
        definition.symbol,
      );
    }

    // Canvas placement edits an instance, never the shared component artwork.
    const controller = new EditorDocumentController(plan.project);
    const beforeMove = structuredClone(controller.project);
    expect(
      controller.transact([
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 100, y: 200 },
        },
      ]).ok,
    ).toBe(true);
    expect(controller.document.instances[0]!.placement!.position).toEqual({
      x: 100,
      y: 200,
    });
    expect(controller.document.instances.slice(1)).toEqual(
      beforeMove.documents[0]!.instances.slice(1),
    );
    expect(controller.project.componentDefinitions).toEqual(
      beforeMove.componentDefinitions,
    );
  });
});

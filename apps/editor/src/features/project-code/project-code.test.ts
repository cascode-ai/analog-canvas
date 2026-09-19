import { withProjectComponentDefinitions } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createRoutingDemoProject } from "../../demos/routing-demo";

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
});

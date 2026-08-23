import { describe, expect, it } from "vitest";
import { createEmptyDocument, createEmptyProject } from "@icm/model";

import { projectChangeToken } from "./project-session-lifecycle";

describe("projectChangeToken", () => {
  it("changes for edits in the active or a non-active Document", () => {
    const project = createEmptyProject("project", "Project", "top");
    project.documents.push(createEmptyDocument("child", "Child"));
    const baseline = projectChangeToken(project);

    project.documents[1]!.revision += 1;
    expect(projectChangeToken(project)).not.toBe(baseline);
  });

  it("changes for Project structure edits even when Document revisions do not", () => {
    const project = createEmptyProject("project", "Project", "top");
    const baseline = projectChangeToken(project);

    project.structureRevision += 1;
    expect(projectChangeToken(project)).not.toBe(baseline);
  });

  it("does not depend on Document array order", () => {
    const project = createEmptyProject("project", "Project", "top");
    project.documents.push(createEmptyDocument("child", "Child"));
    const baseline = projectChangeToken(project);

    project.documents.reverse();
    expect(projectChangeToken(project)).toBe(baseline);
  });
});

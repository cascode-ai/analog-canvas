import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./index.js";

function hopProject() {
  const project = createEmptyProject("crossing-style", "Crossing style");
  project.documents[0]!.presentation.crossingStyle = "hop";
  return project;
}

describe("Document crossing style persistence", () => {
  it("keeps a Document's wire hops through repeated saves", () => {
    const text = serializeProject(hopProject());
    const reopened = parseProject(text);
    expect(reopened.documents[0]!.presentation.crossingStyle).toBe("hop");
    expect(serializeProject(reopened)).toBe(text);
  });

  it("writes no field for a Document with plain crossings", () => {
    const text = serializeProject(createEmptyProject("plain", "Plain"));
    expect(text).not.toContain("crossingStyle");
  });

  it("refuses wire hops in a file older than schema 78", () => {
    const raw = JSON.parse(serializeProject(hopProject()));
    raw.schemaVersion = 77;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(
      /Wire hops require Project schema 78/u,
    );
  });

  it("refuses a crossing style it does not know", () => {
    const raw = JSON.parse(serializeProject(hopProject()));
    raw.documents[0].presentation.crossingStyle = "bridge";
    expect(() => parseProject(JSON.stringify(raw))).toThrow();
  });
});

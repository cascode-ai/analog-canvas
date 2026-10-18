import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "./index.js";

function serifProject() {
  const project = createEmptyProject("text-face", "Text face");
  project.documents[0]!.presentation.textFace = "serif";
  return project;
}

describe("Document font persistence (#1725)", () => {
  it("keeps a Document's serif face through repeated saves", () => {
    const text = serializeProject(serifProject());
    expect(JSON.parse(text).schemaVersion).toBe(CURRENT_PROJECT_FILE_VERSION);
    const reopened = parseProject(text);
    expect(reopened.documents[0]!.presentation.textFace).toBe("serif");
    expect(serializeProject(reopened)).toBe(text);
  });

  it("writes no field for a Document in the default face", () => {
    const text = serializeProject(createEmptyProject("plain", "Plain"));
    expect(text).not.toContain("textFace");
  });

  it("refuses a Document font in a file older than schema 72", () => {
    const raw = JSON.parse(serializeProject(serifProject()));
    raw.schemaVersion = 71;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(
      /A Document font requires Project schema 72/u,
    );
  });

  it("refuses a face it does not know", () => {
    const raw = JSON.parse(serializeProject(serifProject()));
    raw.documents[0].presentation.textFace = "comic";
    expect(() => parseProject(JSON.stringify(raw))).toThrow();
  });
});

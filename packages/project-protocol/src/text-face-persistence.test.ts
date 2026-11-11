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

  it.each(["sans", "latin-modern"] as const)(
    "keeps a Document's %s face through repeated saves",
    (face) => {
      const project = createEmptyProject("text-face", "Text face");
      project.documents[0]!.presentation.textFace = face;
      const text = serializeProject(project);
      const reopened = parseProject(text);
      expect(reopened.documents[0]!.presentation.textFace).toBe(face);
      expect(serializeProject(reopened)).toBe(text);
    },
  );

  it("refuses a face other than the serif in a file older than schema 79", () => {
    const raw = JSON.parse(serializeProject(serifProject()));
    raw.schemaVersion = 78;
    expect(
      parseProject(JSON.stringify(raw)).documents[0]!.presentation,
    ).toEqual(expect.objectContaining({ textFace: "serif" }));
    raw.documents[0].presentation.textFace = "latin-modern";
    expect(() => parseProject(JSON.stringify(raw))).toThrow(
      /A Document font other than the serif requires Project schema 79/u,
    );
  });

  it("refuses a face it does not know", () => {
    const raw = JSON.parse(serializeProject(serifProject()));
    raw.documents[0].presentation.textFace = "comic";
    expect(() => parseProject(JSON.stringify(raw))).toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  formatProjectOpenDiagnostics,
  projectFileBaseName,
  requestProjectDownload,
  stageProjectFile,
  type ProjectFileServiceSeams,
} from "./project-file-service";

const project = createEmptyProject("project-alpha", 'Alpha/Amp "One"');

function downloadSeams() {
  const anchors: Array<{ href: string; download: string; clicked: boolean }> =
    [];
  const urls = new Set<string>();
  const seams: ProjectFileServiceSeams = {
    createObjectURL: () => {
      const url = `blob:memory-${urls.size + 1}`;
      urls.add(url);
      return url;
    },
    revokeObjectURL: (url) => urls.delete(url),
    setTimeout: (handler) => {
      handler();
      return 0;
    },
    getDocument: () => ({
      createElement: () => {
        const anchor = { href: "", download: "", clicked: false };
        anchors.push(anchor);
        return { ...anchor, click: () => (anchor.clicked = true) };
      },
    }),
  };
  return { seams, anchors, urls };
}

describe("portable Project files", () => {
  it("sanitizes names and requests canonical export bytes", () => {
    expect(projectFileBaseName(project.name)).toBe("Alpha-Amp -One-");
    const { seams, anchors, urls } = downloadSeams();
    expect(requestProjectDownload(project, seams)).toMatchObject({
      status: "download-requested",
      fileName: "Alpha-Amp -One-.icproj.json",
    });
    expect(anchors).toHaveLength(1);
    expect(urls.size).toBe(0);
  });

  it("stages a valid import and reports its schema metadata", async () => {
    const outcome = await stageProjectFile(
      { name: "amp.icproj.json", text: async () => serializeProject(project) },
      () => [],
    );
    expect(outcome).toMatchObject({
      status: "opened",
      fileName: "amp.icproj.json",
      sourceSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      migrated: false,
      topDocumentRevision: 0,
    });
  });

  it("rejects unreadable, invalid, and unsupported-symbol imports", async () => {
    const unreadable = await stageProjectFile(
      { name: "bad.json", text: async () => Promise.reject(new Error("disk")) },
      () => [],
    );
    expect(unreadable).toMatchObject({
      status: "rejected",
      diagnostics: [{ code: "READ_FAILED", message: "disk" }],
    });
    const invalid = await stageProjectFile(
      { name: "bad.json", text: async () => "{" },
      () => [],
    );
    expect(invalid.status).toBe("rejected");
    if (invalid.status === "rejected") {
      expect(formatProjectOpenDiagnostics(invalid.diagnostics)).toContain(
        "INVALID_JSON",
      );
    }
    const unsupported = await stageProjectFile(
      { name: "foreign.json", text: async () => serializeProject(project) },
      () => ["foreign-symbol"],
    );
    expect(unsupported).toMatchObject({
      status: "rejected",
      diagnostics: [{ code: "UNSUPPORTED_SYMBOL" }],
    });
  });
});

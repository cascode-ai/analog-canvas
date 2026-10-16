import { describe, expect, it, vi } from "vitest";
import { EditorDocumentController } from "./document-controller";
import { createProjectSnapshotSerializer } from "./project-snapshot-serializer";

import { createEmptyProject } from "@icm/model";
import {
  serializeProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "@icm/project-protocol";

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
  it("downloads the shared canonical snapshot and retains serialization failure handling", async () => {
    const controller = new EditorDocumentController(project);
    const encode = vi.fn(serializeProject);
    const cache = createProjectSnapshotSerializer(encode);
    const expected = cache.serialize(controller.project);
    const { seams } = downloadSeams();
    let blob: Blob | undefined;
    const read = vi.fn(cache.serialize);
    const outcome = requestProjectDownload(controller.project, {
      ...seams,
      serializeProject: read,
      createObjectURL: (value) => {
        blob = value;
        return "blob:export";
      },
    });
    expect(outcome.status).toBe("download-requested");
    expect(await blob!.text()).toBe(expected);
    expect(read).toHaveBeenCalledWith(controller.project);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(
      requestProjectDownload(controller.project, {
        ...seams,
        serializeProject: () => {
          throw new Error("encoding failed");
        },
      }),
    ).toEqual({ status: "failed", message: "encoding failed" });
  });
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
      sourceSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
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

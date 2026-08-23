import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  formatProjectOpenDiagnostics,
  projectFileBaseName,
  requestProjectDownload,
  saveProjectArtifact,
  stageProjectFile,
  type ProjectFileServiceSeams,
} from "./project-file-service";

const project = createEmptyProject("project-alpha", 'Alpha/Amp "One"');

function memoryPicker(
  options: {
    handleName?: string;
    createWritableError?: Error;
    writeError?: Error;
    closeError?: Error;
    pickerError?: Error;
  } = {},
) {
  const calls: Array<{
    write?: string;
    closed: boolean;
    aborted: boolean;
  }> = [];
  const stream = {
    async write(data: string) {
      if (options.writeError) throw options.writeError;
      const session = calls[calls.length - 1];
      if (session) session.write = data;
    },
    async close() {
      if (options.closeError) throw options.closeError;
      const session = calls[calls.length - 1];
      if (session) session.closed = true;
    },
    async abort() {
      const session = calls[calls.length - 1];
      if (session) session.aborted = true;
    },
  };
  return {
    calls,
    window: {
      showSaveFilePicker: async () => {
        if (options.pickerError) throw options.pickerError;
        return {
          name: options.handleName ?? "picker-name.icproj.json",
          createWritable: async () => {
            if (options.createWritableError) throw options.createWritableError;
            calls.push({ closed: false, aborted: false });
            return stream;
          },
        };
      },
    },
  };
}

function downloadSeams() {
  const anchors: Array<{ href: string; download: string; clicked: boolean }> =
    [];
  const urls: string[] = [];
  const seams: ProjectFileServiceSeams = {
    createObjectURL: () => {
      const url = `blob:memory-${urls.length + 1}`;
      urls.push(url);
      return url;
    },
    revokeObjectURL: (url) => {
      const index = urls.indexOf(url);
      if (index >= 0) urls.splice(index, 1);
    },
    setTimeout: (handler) => {
      handler();
      return 0;
    },
    getDocument: () => ({
      createElement: () => {
        const anchor = { href: "", download: "", clicked: false };
        anchors.push(anchor);
        return {
          get href() {
            return anchor.href;
          },
          set href(value: string) {
            anchor.href = value;
          },
          get download() {
            return anchor.download;
          },
          set download(value: string) {
            anchor.download = value;
          },
          click: () => {
            anchor.clicked = true;
          },
        };
      },
    }),
  };
  return { seams, anchors, urls };
}

describe("projectFileBaseName", () => {
  it("sanitizes reserved characters", () => {
    expect(projectFileBaseName('Alpha/Amp "One"')).toBe("Alpha-Amp -One-");
    expect(projectFileBaseName("   ")).toBe("project");
  });
});

describe("saveProjectArtifact", () => {
  it("reports a confirmed write only after write and close succeed", async () => {
    const picker = memoryPicker();
    const outcome = await saveProjectArtifact(project, {
      getWindow: () => picker.window,
      now: () => "2026-08-14T12:00:00.000Z",
    });
    expect(outcome).toEqual({
      status: "write-confirmed",
      fileName: "picker-name.icproj.json",
      bytes: new TextEncoder().encode(serializeProject(project)).length,
      at: "2026-08-14T12:00:00.000Z",
    });
    expect(picker.calls[0]?.write).toBe(serializeProject(project));
  });

  it("reports picker cancellation without downloading", async () => {
    const picker = memoryPicker({
      pickerError: new DOMException("cancelled", "AbortError"),
    });
    const { seams, anchors } = downloadSeams();
    const outcome = await saveProjectArtifact(project, {
      ...seams,
      getWindow: () => picker.window,
    });
    expect(outcome).toEqual({ status: "picker-cancelled" });
    expect(anchors).toHaveLength(0);
  });

  it("falls back to download when the picker location is denied", async () => {
    const picker = memoryPicker({
      pickerError: new DOMException("denied", "NotAllowedError"),
    });
    const { seams, anchors } = downloadSeams();
    const outcome = await saveProjectArtifact(project, {
      ...seams,
      getWindow: () => picker.window,
    });
    expect(outcome.status).toBe("download-requested");
    expect(anchors[0]?.clicked).toBe(true);
  });

  it("fails distinctly when opening, writing, or closing the stream fails", async () => {
    const openFail = await saveProjectArtifact(project, {
      getWindow: () =>
        memoryPicker({ createWritableError: new Error("no stream") }).window,
    });
    expect(openFail).toEqual({
      status: "write-failed",
      stage: "open",
      message: "no stream",
    });

    const writePicker = memoryPicker({ writeError: new Error("disk full") });
    const writeFail = await saveProjectArtifact(project, {
      getWindow: () => writePicker.window,
    });
    expect(writeFail).toEqual({
      status: "write-failed",
      stage: "write",
      message: "disk full",
    });
    expect(writePicker.calls[0]?.aborted).toBe(true);

    const closePicker = memoryPicker({ closeError: new Error("close lost") });
    const closeFail = await saveProjectArtifact(project, {
      getWindow: () => closePicker.window,
    });
    expect(closeFail).toEqual({
      status: "write-failed",
      stage: "close",
      message: "close lost",
    });
    expect(closePicker.calls[0]?.aborted).toBe(true);
  });

  it("downloads canonically when the picker is unavailable", async () => {
    const { seams, anchors, urls } = downloadSeams();
    const outcome = await saveProjectArtifact(project, {
      ...seams,
      getWindow: () => ({}),
    });
    expect(outcome).toMatchObject({
      status: "download-requested",
      fileName: "Alpha-Amp -One-.icproj.json",
    });
    expect(anchors[0]?.download).toBe("Alpha-Amp -One-.icproj.json");
    expect(anchors[0]?.clicked).toBe(true);
    expect(urls).toHaveLength(0);
  });
});

describe("requestProjectDownload", () => {
  it("requests a canonical Blob download and releases the object URL", () => {
    const { seams, anchors, urls } = downloadSeams();
    const outcome = requestProjectDownload(project, seams);
    expect(outcome).toMatchObject({ status: "download-requested" });
    expect(anchors).toHaveLength(1);
    expect(urls).toHaveLength(0);
  });

  it("fails without a document host", () => {
    const outcome = requestProjectDownload(project, {
      getDocument: () => null,
    });
    expect(outcome).toMatchObject({ status: "failed" });
  });
});

describe("stageProjectFile", () => {
  function fakeFile(name: string, text: string) {
    return {
      name,
      text: async () => text,
    };
  }

  it("stages a valid Project with its top-document revision", async () => {
    const outcome = await stageProjectFile(
      fakeFile("amp.icproj.json", serializeProject(project)),
      () => [],
    );
    expect(outcome).toMatchObject({
      status: "opened",
      fileName: "amp.icproj.json",
      topDocumentRevision: 0,
      sourceSchemaVersion: 22,
      migrated: false,
    });
  });

  it("stages schema 21 as an upgraded schema-22 Project", async () => {
    const previous = JSON.parse(serializeProject(project));
    previous.schemaVersion = 21;
    delete previous.documents[0].connectivityEvidence;
    const previousText = JSON.stringify(previous);
    const outcome = await stageProjectFile(
      fakeFile("amp-v21.icproj.json", previousText),
      () => [],
    );

    expect(outcome).toMatchObject({
      status: "opened",
      fileName: "amp-v21.icproj.json",
      sourceSchemaVersion: 21,
      migrated: true,
      project: { schemaVersion: 22 },
    });
  });

  it("rejects unreadable files with READ_FAILED", async () => {
    const outcome = await stageProjectFile(
      {
        name: "broken.json",
        text: async () => {
          throw new Error("disk error");
        },
      },
      () => [],
    );
    expect(outcome).toMatchObject({
      status: "rejected",
      diagnostics: [{ code: "READ_FAILED", message: "disk error" }],
    });
  });

  it("rejects invalid JSON with the model diagnostics", async () => {
    const outcome = await stageProjectFile(
      fakeFile("bad.json", "not json"),
      () => [],
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.diagnostics[0]?.code).toBe("INVALID_JSON");
    }
  });

  it("rejects future schema versions with code and path", async () => {
    const futureText = JSON.stringify({
      ...JSON.parse(serializeProject(project)),
      schemaVersion: 99,
    });
    const outcome = await stageProjectFile(
      fakeFile("future.icproj.json", futureText),
      () => [],
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.diagnostics[0]?.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
      expect(formatProjectOpenDiagnostics(outcome.diagnostics)).toContain(
        "UNSUPPORTED_SCHEMA_VERSION",
      );
    }
  });

  it("rejects unsupported symbols through the caller callback", async () => {
    const outcome = await stageProjectFile(
      fakeFile("foreign.icproj.json", serializeProject(project)),
      () => ["symbol-x", "symbol-a"],
    );
    expect(outcome).toMatchObject({
      status: "rejected",
      diagnostics: [
        {
          code: "UNSUPPORTED_SYMBOL",
          message:
            "Project uses unsupported non-Razavi symbols: symbol-x, symbol-a",
        },
      ],
    });
  });
});

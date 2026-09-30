import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionClient } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { exportFile, importFile, openGalleryEntry } from "./file-operations.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "analog-file-tools-"));
  directories.push(path);
  return path;
}

describe("MCP file operations", () => {
  it("forwards candidate Cell selection and explicit revision without an extra read", async () => {
    const http = new FakeAgentHttp();
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const files = vi
      .spyOn(http, "files")
      .mockResolvedValue({ ok: true } as never);
    const before = http.circuitCalls.length;
    await importFile(client, {
      action: "import-cell",
      candidateId: "c",
      sourceDocumentId: "s",
      targetDocumentId: "main",
      mode: "append",
      expectedStructureRevision: 0,
      expectedRevision: 0,
    });
    expect(files).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        operation: "import-cell",
        sourceDocumentId: "s",
        targetDocumentId: "main",
        mode: "append",
        expectedStructureRevision: 0,
      }),
    );
    expect(http.circuitCalls).toHaveLength(before);
    await importFile(client, {
      action: "inspect",
      candidateId: "c",
      documentId: "s",
    });
    expect(files).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ operation: "inspect", documentId: "s" }),
    );
  });
  it.each([
    { artifact: "project" as const },
    {
      artifact: "simulation-plot" as const,
      simulation: { runId: "run-1", analysisIndex: 2, format: "svg" as const },
    },
  ])(
    "writes a verified $artifact export to the explicit local path",
    async (selection) => {
      const bytes = Buffer.from("project-data", "utf8");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const http = new FakeAgentHttp({
        files: (request) => {
          expect(request).toMatchObject({
            operation: "download",
            ...selection,
          });
          return {
            apiVersion: "3.0",
            requestId: request.requestId,
            operation: "download",
            ok: true,
            artifact: {
              name: "project.icm.json",
              mediaType: "application/json",
              encoding: "base64",
              data: bytes.toString("base64"),
              byteLength: bytes.byteLength,
              sha256: hash,
            },
          };
        },
      });
      const client = new AgentSessionClient({ http });
      await client.connect("session-1.code");
      const directory = await tempDirectory();
      const outputPath = join(directory, "nested", "project.icm.json");
      const report = await exportFile(client, {
        ...selection,
        outputPath,
      });
      expect(await readFile(outputPath, "utf8")).toBe("project-data");
      expect(report).toMatchObject({ ok: true, outputPath, sha256: hash });
    },
  );

  it("stages local files through the existing browser approval workflow", async () => {
    const http = new FakeAgentHttp({
      files: (request) => ({
        apiVersion: "3.0",
        requestId: request.requestId,
        operation: "stage",
        ok: true,
        candidate: {
          candidateId: "candidate-1",
          kind: "project",
          expiresAt: "2026-08-14T12:00:00.000Z",
          projectName: "Imported",
          documentCount: 1,
          instanceCount: 2,
          diagnostics: [],
        },
      }),
    });
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const directory = await tempDirectory();
    const path = join(directory, "source.icm.json");
    await writeFile(path, "{}", "utf8");
    const response = await importFile(client, {
      action: "stage-project",
      path,
    });
    expect(response).toMatchObject({ ok: true, operation: "stage" });
    expect(http.fileCalls[0]).toMatchObject({
      operation: "stage",
      kind: "project",
    });
  });

  it("opens a staged candidate with the existing connector", async () => {
    const http = new FakeAgentHttp({
      files: (request) => ({
        apiVersion: "3.0",
        requestId: request.requestId,
        operation: "open",
        ok: true,
      }),
    });
    vi.spyOn(http, "status").mockResolvedValue({
      ok: true,
      sessionId: "session-1",
      projectId: "imported-project",
      documentIds: ["imported-document"],
      authorization: "active",
      editor: "attached",
      observedAt: 1000,
      expiresAt: 999999,
    });
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const result = await importFile(client, {
      action: "open",
      candidateId: "candidate-1",
    });
    expect(result).toMatchObject({
      ok: true,
      operation: "open",
    });
    expect(http.fileCalls).toEqual([
      expect.objectContaining({
        operation: "open",
        candidateId: "candidate-1",
      }),
    ]);
    expect((await client.status()).documentIds).toEqual(["imported-document"]);
    expect(http.claims).toHaveLength(1);
  });

  it("opens a Gallery entry as a working copy in one call, with no local file", async () => {
    const projectCode = '{"schemaVersion":1,"name":"Telescopic"}';
    let open = false;
    const http = new FakeAgentHttp({
      projects: (request) =>
        request.operation === "read-gallery-entry"
          ? {
              apiVersion: "3.0",
              requestId: request.requestId,
              operation: "read-gallery-entry",
              ok: true,
              entry: {
                id: "296p9s5vn2",
                name: "Telescopic op amp",
                author: "",
                description: "",
                createdAt: "",
                schemaVersion: 1,
                tags: [],
              },
              projectCode,
              netlist: null,
            }
          : {
              apiVersion: "3.0",
              requestId: request.requestId,
              operation: "workspace",
              ok: true,
              result: {
                action: "list",
                activeWorkspaceId: "tab-1",
                projects: ["tab-1", ...(open ? ["tab-2"] : [])].map(
                  (workspaceId) => ({
                    workspaceId,
                    projectId: workspaceId,
                    name: "Project",
                    cloudProjectId: null,
                    dirty: false,
                    structureRevision: 0,
                    cells: [],
                  }),
                ),
              },
            },
      files: (request) => {
        if (request.operation === "open") open = true;
        return request.operation === "stage"
          ? {
              apiVersion: "3.0",
              requestId: request.requestId,
              operation: "stage",
              ok: true,
              candidate: {
                candidateId: "candidate-1",
                kind: "project",
                expiresAt: "2026-09-30T00:00:00.000Z",
                projectName: "Telescopic op amp",
                documentCount: 1,
                instanceCount: 8,
                documents: [],
                diagnostics: [],
              },
            }
          : {
              apiVersion: "3.0",
              requestId: request.requestId,
              operation: "open",
              ok: true,
            };
      },
    });
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    expect(await openGalleryEntry(client, "296p9s5vn2", true)).toEqual({
      ok: true,
      galleryEntryId: "296p9s5vn2",
      name: "Telescopic op amp",
      workspaceId: "tab-2",
      activeWorkspaceId: "tab-1",
      background: true,
    });
    // The Project Code went from the Gallery read to the stage in memory.
    const [stage, opened] = http.fileCalls;
    expect(stage).toMatchObject({ operation: "stage", kind: "project" });
    if (stage?.operation !== "stage") throw new Error("not staged");
    expect(Buffer.from(stage.files[0]!.data, "base64").toString("utf8")).toBe(
      projectCode,
    );
    expect(stage.files[0]!.sha256).toBe(
      createHash("sha256").update(projectCode).digest("hex"),
    );
    expect(opened).toMatchObject({
      operation: "open",
      candidateId: "candidate-1",
      background: true,
    });
    expect(http.projectCalls[0]).toMatchObject({
      operation: "read-gallery-entry",
      netlistFormat: null,
    });
  });
});

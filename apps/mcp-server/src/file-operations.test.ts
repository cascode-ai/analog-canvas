import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSessionClient } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { exportFile, importFile } from "./file-operations.js";

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
            apiVersion: "2.0",
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
        apiVersion: "2.0",
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
});

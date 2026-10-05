import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { callTool, type ToolSessionState } from "../../../mcp-server/src/tools";
import { liveAgentEditor } from "./live-agent-editor.test-support";

const otaLibraryPath = fileURLToPath(
  new URL(
    "../../../../netlists/native-ota-library/legacy-source.icproj.json",
    import.meta.url,
  ),
);

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

/** The MCP server's file tools, on a session with the live editor. */
async function connected() {
  const editor = liveAgentEditor();
  const session: ToolSessionState = { client: editor.client };
  const tool = async (name: string, args: unknown) => {
    const result = await callTool(name, args, session);
    expect(result.content[0]?.type).toBe("text");
    return JSON.parse(result.content[0]!.text!);
  };
  expect(await tool("connect", { claimCode: "session-1.code" })).toMatchObject({
    ok: true,
  });
  return { ...editor, tool };
}

describe("MCP file tools on the live editor", () => {
  it("imports a staged Cell with its explicit revisions, without an extra read", async () => {
    const { tool, controller, http } = await connected();
    // A file with a Cell `amp` the editor can append to its own `main`.
    const source = createEmptyProject("source", "Source", "amp");
    source.documents[0]!.instances.push({
      id: "r",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    const path = join(await tempDirectory(), "source.icproj.json");
    await writeFile(path, serializeProject(source), "utf8");
    const staged = await tool("import_file", { action: "stage-project", path });
    expect(staged).toMatchObject({ ok: true, operation: "stage" });
    const candidateId = staged.candidate.candidateId;
    // A staged Cell reads back as its Document Code.
    const inspected = await tool("import_file", {
      action: "inspect",
      candidateId,
      documentId: "amp",
    });
    expect(inspected).toMatchObject({ ok: true, operation: "inspect" });
    expect(JSON.parse(inspected.documentCode)).toMatchObject({
      id: "amp",
      instances: [{ reference: "R1" }],
    });
    const reads = http.circuitCalls.length;
    const imported = await tool("import_file", {
      action: "import-cell",
      candidateId,
      sourceDocumentId: "amp",
      targetDocumentId: "main",
      mode: "append",
      expectedStructureRevision: controller.project.structureRevision,
      expectedRevision: controller.document.revision,
    });
    expect(imported).toMatchObject({
      ok: true,
      operation: "import-cell",
      targetDocumentId: "main",
      structureRevision: controller.project.structureRevision,
      revision: controller.document.revision,
    });
    // The revisions came with the call: no read went ahead of it.
    expect(http.circuitCalls).toHaveLength(reads);
    expect(http.fileCalls.at(-1)).toMatchObject({
      operation: "import-cell",
      sourceDocumentId: "amp",
      targetDocumentId: "main",
      mode: "append",
      expectedStructureRevision: 0,
    });
    expect(controller.document.instances).toMatchObject([
      { reference: "R1", symbolId: "resistor" },
    ]);
  });

  it("writes the editor's verified Project export to the explicit local path, and nothing for a retired plot", async () => {
    const { tool, client, controller } = await connected();
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 100, y: 100 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const directory = await tempDirectory();
    const outputPath = join(directory, "nested", "project.icproj.json");
    const report = await tool("export_file", {
      artifact: "project",
      outputPath,
    });
    const bytes = await readFile(outputPath);
    expect(bytes.toString("utf8")).toBe(serializeProject(controller.project));
    expect(report).toMatchObject({
      ok: true,
      artifact: "project",
      outputPath,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    // The editor retired built-in simulation plots; no file is written.
    const plotPath = join(directory, "nested", "plot.svg");
    expect(
      await tool("export_file", {
        artifact: "simulation-plot",
        simulation: { runId: "run-1", analysisIndex: 2, format: "svg" },
        outputPath: plotPath,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_PLOT_RETIRED" },
    });
    await expect(access(plotPath)).rejects.toThrow();
  });

  it("stages a local Project file for the person's approval, leaving the live Project alone", async () => {
    const { tool, controller, http } = await connected();
    const source = parseProject(await readFile(otaLibraryPath, "utf8"));
    const directory = await tempDirectory();
    const path = join(directory, "source.icproj.json");
    await writeFile(path, serializeProject(source), "utf8");
    const before = structuredClone(controller.project);
    const staged = await tool("import_file", {
      action: "stage-project",
      path,
    });
    expect(staged).toMatchObject({
      ok: true,
      operation: "stage",
      candidate: {
        kind: "project",
        projectName: source.name,
        documentCount: source.documents.length,
        instanceCount: source.documents.reduce(
          (total, item) => total + item.instances.length,
          0,
        ),
      },
    });
    expect(http.fileCalls[0]).toMatchObject({
      operation: "stage",
      kind: "project",
    });
    expect(
      await tool("import_file", {
        action: "request-approval",
        candidateId: staged.candidate.candidateId,
      }),
    ).toMatchObject({
      ok: true,
      operation: "request-approval",
      approval: "pending-human",
      candidate: { candidateId: staged.candidate.candidateId },
    });
    // Only the person's approval in the editor may change the Project.
    expect(controller.project).toEqual(before);
  });
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { chromium } from "@playwright/test";
import { createEmptyProject } from "../packages/model/dist/index.js";
import {
  parseProject,
  serializeProject,
} from "../packages/project-protocol/dist/index.js";
import { SimulationOutputDataSchema } from "../packages/simulation-service/dist/contract.js";
import { SimulationResultSchema } from "../packages/spice-run/dist/index.js";
import { materializeSimulationRunEvidence } from "./lib/simulation-run-evidence.mjs";

const baseUrl = new URL(
  process.argv[2] ?? "https://analog-canvas-preview.tokenzhang.com",
);
const acceptanceToken = process.env.ICM_PREVIEW_ACCEPTANCE_TOKEN;
assert(acceptanceToken, "ICM_PREVIEW_ACCEPTANCE_TOKEN is required");
const outputDirectory = resolve(
  process.env.ICM_ACCEPTANCE_OUTPUT_DIR ??
    "test-results/preview-cross-project-simulation",
);
const referenceText = await readFile(
  new URL(
    "../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json",
    import.meta.url,
  ),
  "utf8",
);
const referenceProject = parseProject(referenceText);
const dut = referenceProject.documents.find(
  (document) => document.id === "document-ota-5t",
);
const testbench = referenceProject.documents.find(
  (document) => document.id === "document-ota-5t-testbench",
);
const referenceSetup = referenceProject.simulationSetups.find(
  (setup) => setup.id === "simulation-setup-ota-op-ac",
);
assert(
  dut && testbench && referenceSetup,
  "OTA acceptance fixture is incomplete",
);

const sourceProject = structuredClone(referenceProject);
sourceProject.id = "preview-cross-project-dut-source";
sourceProject.name = "Preview Cross-Project OTA DUT";
sourceProject.topDocumentId = dut.id;
sourceProject.documents = [structuredClone(dut)];
sourceProject.simulationSetups = [];
const sourceProjectText = serializeProject(sourceProject);

const destinationProject = createEmptyProject(
  "preview-cross-project-destination",
  "Preview Cross-Project Simulation",
  "acceptance-main",
);
const destinationProjectText = serializeProject(destinationProject);
const importedTestbenchId = "acceptance-cross-project-tb";
const importedSetupId = "acceptance-cross-project-op";
const privateDirectory = await mkdtemp(
  join(tmpdir(), "analog-canvas-cross-project-"),
);
await mkdir(outputDirectory, { recursive: true });

let browser;
let context;
let mcp;
let sourceCloudProjectId;
let paired = false;
let sequence = 0;
const pending = new Map();
const report = {
  schemaVersion: 1,
  target: baseUrl.origin,
  fixture: "cross-project-sky130-ota-op",
  commitSha: process.env.GITHUB_SHA ?? null,
  startedAt: new Date().toISOString(),
};

function rpc(method, params) {
  return new Promise((resolveReply, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}`));
    }, 150_000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout);
        resolveReply(value);
      },
      reject(error) {
        clearTimeout(timeout);
        reject(error);
      },
    });
    mcp.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}

async function tool(name, args = {}, allowProblem = false) {
  for (let attempt = 0; ; attempt += 1) {
    const reply = await rpc("tools/call", { name, arguments: args });
    const text = reply.content?.find((item) => item.type === "text")?.text;
    assert.equal(typeof text, "string", `${name} returned no text result`);
    const value = JSON.parse(text);
    if (reply.isError && value.error?.code === "RATE_LIMITED" && attempt < 12) {
      await new Promise((resolveWait) =>
        setTimeout(
          resolveWait,
          Math.max(value.error.retryAfterMs ?? 5_000, 1_000),
        ),
      );
      continue;
    }
    if (reply.isError && !allowProblem) {
      throw new Error(`${name} failed: ${text}`);
    }
    return value;
  }
}

async function startMcp() {
  mcp = spawn(process.execPath, [resolve("apps/mcp-server/dist/main.js")], {
    cwd: resolve("."),
    env: {
      ...process.env,
      ANALOG_CANVAS_API_URL: baseUrl.origin,
      ANALOG_CANVAS_MCP_CONNECTOR: join(privateDirectory, "connector.json"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = [];
  mcp.stderr.on("data", (chunk) => stderr.push(String(chunk).slice(-2_000)));
  mcp.once("exit", (code, signal) => {
    const error = new Error(
      `MCP exited ${code ?? signal ?? "unknown"}: ${stderr.join("").slice(-4_000)}`,
    );
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  createInterface({ input: mcp.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    reply.error
      ? request.reject(new Error(JSON.stringify(reply.error)))
      : request.resolve(reply.result);
  });
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "preview-cross-project-acceptance", version: "1" },
  });
  mcp.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
}

async function startAndRead(prepared) {
  const started = await tool("simulation", {
    request: {
      operation: "start",
      preparedId: prepared.id,
      digest: prepared.digest,
    },
  });
  assert.equal(started.ok, true);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const reading = await tool("simulation", {
      request: { operation: "read", runId: started.run.id },
    });
    assert.equal(reading.ok, true);
    if (!["running", "cancelling"].includes(reading.run.state))
      return reading.run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  }
  throw new Error(`Run ${started.run.id} did not reach a terminal state`);
}

async function exportArtifact(artifact) {
  assert(artifact, "Expected simulation artifact is missing");
  const saved = await tool("simulation_files", {
    request: { action: "artifact", artifactId: artifact.id },
    outputPath: join(outputDirectory, artifact.name),
  });
  assert.notEqual(saved.ok, false, `Could not export ${artifact.name}`);
  return {
    name: artifact.name,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
  };
}

async function cloudRequest(path, options = {}) {
  const response = await context.request.fetch(
    new URL(path, baseUrl).toString(),
    {
      ...options,
      headers: {
        Origin: baseUrl.origin,
        ...(options.headers ?? {}),
      },
    },
  );
  return response;
}

try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1_440, height: 1_000 },
  });
  await context.addCookies([
    {
      name: "icm_preview_acceptance",
      value: acceptanceToken,
      url: baseUrl.origin,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    },
  ]);

  const prior = await cloudRequest("/api/projects");
  assert.equal(
    prior.status(),
    200,
    "Preview acceptance Project shelf is unavailable",
  );
  for (const project of (await prior.json()).projects ?? []) {
    if (project.name !== sourceProject.name) continue;
    const removed = await cloudRequest(
      `/api/projects/${encodeURIComponent(project.id)}`,
      {
        method: "DELETE",
      },
    );
    assert.equal(
      removed.ok(),
      true,
      "Could not clear an earlier acceptance source",
    );
  }
  const seeded = await cloudRequest("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: { name: sourceProject.name, projectText: sourceProjectText },
  });
  assert.equal(
    seeded.status(),
    201,
    `Could not seed source Project (${seeded.status()})`,
  );
  sourceCloudProjectId = (await seeded.json()).project.id;

  const page = await context.newPage();
  await page.goto(new URL("/editor", baseUrl).toString());
  await page.getByTestId("project-file").setInputFiles({
    name: "cross-project-destination.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(destinationProjectText),
  });
  await page
    .locator("summary")
    .filter({ hasText: /^Agent$/ })
    .click();
  await page
    .getByRole("button", { name: "Connect Agent", exact: true })
    .click();
  await page.getByTestId("agent-preset-full").click();
  const claimElement = page.getByTestId("agent-claim-code");
  await claimElement.waitFor({ state: "attached", timeout: 30_000 });
  const claimCode = await claimElement.textContent();
  assert(claimCode, "Preview returned no Agent claim code");

  await startMcp();
  const connection = await tool("connect", { claimCode });
  assert.equal(connection.ok, true);
  paired = true;
  await page
    .getByTestId("agent-status")
    .filter({ hasText: "Connected" })
    .waitFor({ state: "visible", timeout: 30_000 });

  const projects = await tool("project_cells", { action: "list-projects" });
  assert.equal(projects.ok, true);
  assert(
    projects.projects.some((project) => project.id === sourceCloudProjectId),
    "Agent could not discover the seeded source Project",
  );
  const cells = await tool("project_cells", {
    action: "list-cells",
    cloudProjectId: sourceCloudProjectId,
  });
  assert.equal(cells.ok, true);
  assert.deepEqual(
    cells.cells[0].formalPorts.map((port) => port.name),
    ["vss", "ibias", "vdd", "vinn", "vinp", "vout"],
  );
  const imported = await tool("project_cells", {
    action: "import-cell",
    cloudProjectId: sourceCloudProjectId,
    sourceDocumentId: dut.id,
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.status, "imported");

  const importedTestbench = structuredClone(testbench);
  importedTestbench.id = importedTestbenchId;
  importedTestbench.name = "Cross-Project OTA Testbench";
  importedTestbench.netlist.name = "cross_project_ota_tb";
  const dutInstance = importedTestbench.instances.find(
    (instance) => instance.id === "XDUT",
  );
  assert.equal(dutInstance?.netlist?.binding?.kind, "subcircuit");
  dutInstance.netlist.binding.childDocumentId = imported.rootDocumentId;

  const opSetup = structuredClone(referenceSetup);
  opSetup.id = importedSetupId;
  opSetup.name = "Cross-Project OTA OP";
  opSetup.input.rootDocumentId = importedTestbenchId;
  opSetup.input.analyses = [{ kind: "op" }];
  delete opSetup.input.deviceOperatingPoints;
  opSetup.input.outputs = opSetup.input.outputs.map((output) => {
    const mapped = structuredClone(output);
    if (mapped.expression.documentId === testbench.id) {
      mapped.expression.documentId = importedTestbenchId;
    } else if (mapped.expression.documentId === dut.id) {
      mapped.expression.documentId = imported.rootDocumentId;
    }
    return mapped;
  });

  const authored = await tool("advanced_transact", {
    structureEdits: [
      { kind: "add_document", document: importedTestbench },
      { kind: "upsert_simulation_setup", setup: opSetup },
    ],
  });
  assert.equal(authored.ok, true);
  const preparedReply = await tool("simulation", {
    request: {
      operation: "prepare",
      source: {
        kind: "project-setup",
        setupId: importedSetupId,
        expectedStructureRevision: authored.projectStructure.toRevision,
      },
    },
  });
  assert.equal(preparedReply.ok, true);
  const finished = await startAndRead(preparedReply.prepared);
  assert.equal(finished.state, "finished");

  const exports = [];
  const fullRun = await materializeSimulationRunEvidence(
    finished,
    async (artifact) => {
      exports.push(await exportArtifact(artifact));
      const value = JSON.parse(
        await readFile(join(outputDirectory, artifact.name), "utf8"),
      );
      return artifact.name === "result.json"
        ? SimulationResultSchema.parse(value)
        : SimulationOutputDataSchema.parse(value);
    },
  );
  assert.equal(fullRun.result?.outcome.status, "completed");
  const op = fullRun.outputData?.analyses.find(
    (analysis) => analysis.analysis === "op",
  );
  const vout = op?.outputs.find((output) => output.id === "probe-vout")
    ?.values[0];
  assert(Number.isFinite(vout), "Imported OTA returned no finite OP output");
  assert(
    vout > 0.5 && vout < 1.2,
    `Imported OTA OP output is implausible: ${vout}`,
  );

  for (const artifact of [
    preparedReply.prepared.artifacts.find(
      (item) => item.name === "prepared.cir",
    ),
    ...finished.artifacts.filter((item) =>
      [
        "out.raw",
        "result.json",
        "outputs.json",
        "op.csv",
        "outputs-op.csv",
      ].includes(item.name),
    ),
  ]) {
    if (!artifact || exports.some((item) => item.name === artifact.name))
      continue;
    exports.push(await exportArtifact(artifact));
  }

  report.status = "passed";
  report.completedAt = new Date().toISOString();
  report.sourceProject = {
    cloudProjectId: sourceCloudProjectId,
    sourceDocumentId: dut.id,
  };
  report.import = {
    status: imported.status,
    rootDocumentId: imported.rootDocumentId,
    importedDocumentIds: imported.importedDocumentIds,
    testbenchDocumentId: importedTestbenchId,
  };
  report.simulation = {
    setupId: importedSetupId,
    preparedId: preparedReply.prepared.id,
    runId: finished.id,
    inputRevision: preparedReply.prepared.inputRevision,
    environment: fullRun.result.metadata.environment,
    vout,
  };
  report.exports = exports;
  await writeFile(
    join(outputDirectory, "acceptance-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await tool("disconnect");
  paired = false;
  console.log(`Preview cross-Project OTA OP passed: vout=${vout}`);
} catch (error) {
  report.status = "failed";
  report.completedAt = new Date().toISOString();
  report.error =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  await writeFile(
    join(outputDirectory, "acceptance-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  throw error;
} finally {
  if (paired) await tool("disconnect", {}, true).catch(() => {});
  if (mcp) {
    mcp.stdin.end();
    mcp.kill();
  }
  if (sourceCloudProjectId && context) {
    await cloudRequest(
      `/api/projects/${encodeURIComponent(sourceCloudProjectId)}`,
      {
        method: "DELETE",
      },
    ).catch(() => {});
  }
  await browser?.close();
  await rm(privateDirectory, { recursive: true, force: true });
}

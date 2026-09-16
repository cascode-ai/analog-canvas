import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { previewBrowserLaunchOptions } from "./lib/preview-browser.mjs";
import { createEmptyProject } from "../packages/model/dist/index.js";
import {
  parseProject,
  serializeProject,
} from "../packages/project-protocol/dist/index.js";
import {
  SimulationResultSchema,
  verifySimulationEnvironmentMetadata,
} from "../packages/spice-run/dist/index.js";
import { nativeImportedTestbench } from "./lib/native-cross-project-fixture.mjs";
import {
  nativeRunnerOptions,
  expectedNativeEnvironments,
  collectNativeRunEvidence,
} from "./lib/native-example-runner.mjs";
import { verifyPreviewCandidate } from "./lib/preview-candidate.mjs";
import { downloadPublishedMcp } from "./lib/published-mcp.mjs";

// Same explicit candidate/bundle/environment arguments as the native batch runner.
// No default hostname: this command creates a temporary Cloud Project.
// The delivery workflow explicitly targets shared Preview. Keep the separate
// migration runner's conservative origin restrictions for custom candidates.
const sharedPreview =
  process.argv.length === 3 &&
  process.argv[2].replace(/\/$/, "") ===
    "https://analog-canvas-preview.tokenzhang.com";
let publishedDirectory;
let published;
let options;
if (sharedPreview) {
  publishedDirectory = await mkdtemp(join(tmpdir(), "icm-cross-published-"));
  published = await downloadPublishedMcp(process.argv[2], publishedDirectory);
  options = {
    url: process.argv[2],
    bundle: published.executable,
    bundleSha256: createHash("sha256")
      .update(await readFile(published.executable))
      .digest("hex"),
    environments: [resolve("config/vacask-preview-environment.json")],
  };
} else options = nativeRunnerOptions(process.argv.slice(2));
assert(
  !options.selected,
  "Cross-Project acceptance uses its fixed OTA fixture",
);
const baseUrl = new URL(options.url);
const bundleBytes = await readFile(options.bundle);
assert.equal(
  createHash("sha256").update(bundleBytes).digest("hex"),
  options.bundleSha256,
  "MCP bundle differs from the supplied expected digest",
);
const environments = expectedNativeEnvironments(
  await Promise.all(
    options.environments.map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  ),
);
for (const environment of environments.values())
  assert(
    await verifySimulationEnvironmentMetadata(environment),
    "Expected runtime metadata is inconsistent",
  );
const acceptanceToken = process.env.ICM_PREVIEW_ACCEPTANCE_TOKEN;
assert(acceptanceToken, "ICM_PREVIEW_ACCEPTANCE_TOKEN is required");
const outputRoot = resolve(
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
const referenceSetup = referenceProject.simulationFolders.find(
  (folder) => folder.id === "simulation-setup-ota-op-ac",
);
assert(
  dut && testbench && referenceSetup,
  "OTA acceptance fixture is incomplete",
);

const sourceProject = structuredClone(referenceProject);
sourceProject.id = "preview-cross-project-dut-source";
sourceProject.name = `Native Cross-Project OTA DUT ${randomUUID()}`;
sourceProject.topDocumentId = dut.id;
sourceProject.documents = [structuredClone(dut)];
sourceProject.simulationFolders = [];
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
await mkdir(outputRoot, { recursive: true });
const outputDirectory = await mkdtemp(join(outputRoot, "candidate-"));

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
  mcp: { sha256: options.bundleSha256 },
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
  mcp = spawn(process.execPath, [options.bundle], {
    cwd: privateDirectory,
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
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(outputDirectory, artifact.name)))
      .digest("hex"),
    artifact.sha256,
    `Corrupt artifact ${artifact.name}`,
  );
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
  report.candidate = await verifyPreviewCandidate(baseUrl);
  browser = await chromium.launch(previewBrowserLaunchOptions());
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

  // Never delete another run's Project by display name. Own only the ID returned
  // by this creation; retain it in the report immediately for manual recovery.
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
  assert.equal(typeof sourceCloudProjectId, "string");
  report.sourceProject = {
    cloudProjectId: sourceCloudProjectId,
    sourceDocumentId: dut.id,
  };

  const page = await context.newPage();
  await page.goto(new URL("/editor", baseUrl).toString());
  await page.getByTestId("project-file").setInputFiles({
    name: "cross-project-destination.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(destinationProjectText),
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const claimElement = page.getByTestId("agent-copy-text");
  await claimElement.waitFor({ state: "attached", timeout: 30_000 });
  const { claimCode } = JSON.parse(
    (await claimElement.inputValue()).match(/^Claim: (.+)$/mu)?.[1] ?? "{}",
  );
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

  const { testbench: importedTestbench, folder: opSetup } =
    nativeImportedTestbench(
      referenceProject,
      imported.rootDocumentId,
      importedTestbenchId,
      importedSetupId,
    );

  const authored = await tool("advanced_transact", {
    structureEdits: [
      { kind: "add_document", document: importedTestbench },
      { kind: "upsert_simulation_folder", folder: opSetup },
    ],
  });
  assert.equal(authored.ok, true);
  const preparedReply = await tool("simulation", {
    request: {
      operation: "prepare",
      source: {
        kind: "project-folder",
        folderId: importedSetupId,
        expectedStructureRevision: authored.projectStructure.toRevision,
      },
    },
  });
  assert.equal(preparedReply.ok, true);
  const preparedArtifact = preparedReply.prepared.artifacts.find(
    (a) => a.name === "prepared.json",
  );
  await exportArtifact(preparedArtifact);
  const compiled = JSON.parse(
    await readFile(join(outputDirectory, "prepared.json"), "utf8"),
  );
  assert.equal(compiled.language, "vacask");
  const expectedEnvironment = environments.get(compiled.environment.profileId);
  assert(
    expectedEnvironment,
    "Supply the independently accepted environment for this Profile",
  );
  const finished = await startAndRead(preparedReply.prepared);
  assert.equal(finished.state, "finished");

  const evidence = await collectNativeRunEvidence({
    tool,
    run: finished,
    directory: join(outputDirectory, "run"),
    compiled,
    expectedEnvironment,
  });
  const result = SimulationResultSchema.parse(
    JSON.parse(
      await readFile(join(outputDirectory, "run/result.json"), "utf8"),
    ),
  );
  const op = result.data?.analyses.find(
    (analysis) => analysis.analysis === "op",
  );
  const value = op?.probes.find((probe) => probe.name === "vout")?.value;
  const vout = Array.isArray(value) ? value[0] : value;
  assert(Number.isFinite(vout), "Imported OTA returned no finite OP output");
  assert(
    vout > 0 && vout < 1.8,
    `Imported OTA OP output is implausible: ${vout}`,
  );

  for (const required of ["raw/bias.raw", "op-0.csv"])
    assert(
      evidence.artifacts.some((a) => a.name === required),
      `Missing ${required}`,
    );
  await exportArtifact(
    preparedReply.prepared.artifacts.find((a) => a.name === "prepared.cir"),
  );

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
    folderId: importedSetupId,
    preparedId: preparedReply.prepared.id,
    runId: finished.id,
    inputRevision: preparedReply.prepared.inputRevision,
    environment: result.metadata.environment,
    vout,
  };
  report.evidence = evidence;
  await tool("disconnect");
  paired = false;
} catch (error) {
  report.status = "failed";
  report.completedAt = new Date().toISOString();
  report.error =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  throw error;
} finally {
  const cleanupErrors = [];
  const cleanup = async (name, operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(`${name}: ${error.message}`);
    }
  };
  if (paired) await cleanup("disconnect", () => tool("disconnect"));
  if (mcp) {
    mcp.stdin.end();
    mcp.kill();
  }
  if (sourceCloudProjectId && context) {
    await cleanup("source Project deletion", async () => {
      const removed = await cloudRequest(
        `/api/projects/${encodeURIComponent(sourceCloudProjectId)}`,
        {
          method: "DELETE",
        },
      );
      assert(removed.ok(), `HTTP ${removed.status()}`);
    });
  }
  await cleanup("browser", () => browser?.close());
  await cleanup("connector scratch", () =>
    rm(privateDirectory, { recursive: true, force: true }),
  );
  if (publishedDirectory)
    await cleanup("published MCP scratch", () =>
      rm(publishedDirectory, { recursive: true, force: true }),
    );
  if (published) report.publishedMcp = published.receipt;
  report.cleanupErrors = cleanupErrors;
  if (cleanupErrors.length) report.status = "failed";
  report.completedAt = new Date().toISOString();
  await writeFile(
    join(outputDirectory, "acceptance-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (!report.error) assert(!cleanupErrors.length, cleanupErrors.join("\n"));
}
console.log(`Native cross-Project acceptance passed: ${outputDirectory}`);

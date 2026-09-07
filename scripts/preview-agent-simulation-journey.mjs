import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { chromium } from "@playwright/test";
import { compileStructuredSimulation } from "../packages/netlist/dist/index.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { SimulationOutputDataSchema } from "../packages/simulation-service/dist/contract.js";
import { SimulationResultSchema } from "../packages/spice-run/dist/index.js";
import { materializeSimulationRunEvidence } from "./lib/simulation-run-evidence.mjs";
import {
  validateHostedSky130NoiseResult,
  validateHostedSky130Result,
} from "./preview-simulation-smoke.mjs";

const baseUrl = new URL(
  process.argv[2] ?? "https://analog-canvas-preview.tokenzhang.com",
);
const outputDirectory = resolve(
  process.env.ICM_ACCEPTANCE_OUTPUT_DIR ??
    "test-results/preview-agent-simulation",
);
const projectText = await readFile(
  new URL(
    "../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json",
    import.meta.url,
  ),
  "utf8",
);
const project = parseProject(projectText);
const setup = project.simulationSetups[0];
assert(setup, "The acceptance Project has no saved setup");
assert.equal(setup.input.kind, "structured");
const qualifiedSetup = structuredClone(setup);
const noiseOutput = qualifiedSetup.input.outputs.find(
  (output) => output.id === "probe-vout",
);
assert.equal(noiseOutput?.expression.kind, "voltage");
const { kind: _noiseExpressionKind, ...noisePositive } = noiseOutput.expression;
qualifiedSetup.input.analyses.push({
  kind: "noise",
  output: { positive: noisePositive },
  inputSourceInstanceId: "VINP",
  sweep: "dec",
  points: 20,
  startHz: 1,
  stopHz: 1e9,
});
qualifiedSetup.input.deviceOperatingPoints = [
  {
    id: "acceptance-op-m1",
    documentId: "document-ota-5t",
    instanceId: "M1",
    occurrence: ["XDUT"],
  },
  {
    id: "acceptance-op-m3",
    documentId: "document-ota-5t",
    instanceId: "M3",
    occurrence: ["XDUT"],
  },
];
const compiled = await compileStructuredSimulation(project, qualifiedSetup);
assert(compiled.ok, "The acceptance Project no longer compiles");

await mkdir(outputDirectory, { recursive: true });
const privateDirectory = await mkdtemp(join(tmpdir(), "analog-canvas-mcp-"));
const report = {
  schemaVersion: 1,
  target: baseUrl.origin,
  fixture: "sky130-ota-5t",
  startedAt: new Date().toISOString(),
};

let browser;
let mcp;
let paired = false;
let sequence = 0;
const pending = new Map();

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
  for (let attempt = 0; ; attempt++) {
    const reply = await rpc("tools/call", { name, arguments: args });
    const text = reply.content?.find((item) => item.type === "text")?.text;
    assert.equal(typeof text, "string", `${name} returned no text result`);
    const value = JSON.parse(text);
    if (reply.isError && value.error?.code === "RATE_LIMITED" && attempt < 12) {
      const retryAfterMs = Math.max(value.error.retryAfterMs ?? 5_000, 1_000);
      await new Promise((resolveWait) => setTimeout(resolveWait, retryAfterMs));
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
    if (pending.size) {
      const error = new Error(
        `MCP exited ${code ?? signal ?? "unknown"}: ${stderr.join("").slice(-4_000)}`,
      );
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    }
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
    if (reply.error) request.reject(new Error(JSON.stringify(reply.error)));
    else request.resolve(reply.result);
  });
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "preview-simulation-acceptance", version: "1" },
  });
  mcp.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
}

async function stopMcp() {
  if (!mcp) return;
  const child = mcp;
  mcp = undefined;
  child.stdin.end();
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolveExit();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function exportArtifact(artifact, name) {
  assert(artifact, `Missing ${name} artifact`);
  const saved = await tool("simulation_files", {
    request: { action: "artifact", artifactId: artifact.id },
    outputPath: join(outputDirectory, name),
  });
  assert.notEqual(saved.ok, false, `Could not export ${name}`);
  return {
    name,
    sha256: artifact.sha256,
    byteLength: artifact.byteLength,
  };
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
  for (let attempt = 0; attempt < 180; attempt++) {
    const reading = await tool("simulation", {
      request: { operation: "read", runId: started.run.id },
    });
    assert.equal(reading.ok, true);
    if (!["running", "cancelling"].includes(reading.run.state))
      return reading.run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  }
  throw new Error(`Run ${started.run.id} did not reach a terminal state.`);
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 1_000 },
  });
  const page = await context.newPage();
  await page.goto(new URL("/editor", baseUrl).toString());
  await page.getByTestId("project-file").setInputFiles({
    name: "sky130-ota-5t.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(projectText),
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
  assert(claimCode, "The preview returned no Agent claim code");

  await startMcp();
  const connection = await tool("connect", { claimCode });
  assert.equal(connection.ok, true);
  assert.equal(connection.mode, "claimed");
  paired = true;
  // Claiming and attaching the browser are distinct relay events. The MCP
  // receipt may arrive first, so wait on the product's own connected state
  // instead of racing the first circuit request or hiding it behind a sleep.
  await page
    .getByTestId("agent-status")
    .filter({ hasText: "Connected" })
    .waitFor({ state: "visible", timeout: 30_000 });

  const [contextReport, inspected, capabilityReply] = await Promise.all([
    tool("get_context"),
    tool("inspect", { target: { kind: "document" }, detail: "full" }),
    tool("simulation", { request: { operation: "capabilities" } }),
  ]);
  const discoveredSetup = inspected.project?.simulationSetups?.find(
    (candidate) => candidate.id === setup.id,
  );
  assert.deepEqual(
    discoveredSetup,
    setup,
    "Agent inspection did not expose the complete authored Simulation setup",
  );
  const sourceReport = await tool("inspect", {
    documentId: discoveredSetup.input.rootDocumentId,
    target: { kind: "object", id: "VINP" },
  });
  assert.equal(
    sourceReport.parameters?.waveform,
    "pulse",
    "Agent inspection did not expose the transient source intent",
  );
  assert.equal(capabilityReply.ok, true);
  assert.deepEqual(
    capabilityReply.capabilities.analyses,
    ["op", "dc", "ac", "tran", "noise"],
    "The deployed Profile does not advertise all five qualified analyses",
  );

  // A bad model is a recoverable run result, not an MCP-session failure. Fix
  // the same graphless workspace and prove a second run can complete before
  // the full Project-owned structured journey continues.
  const rawWorkspace = await tool("simulation_files", {
    request: { action: "create" },
  });
  assert.equal(rawWorkspace.ok, true);
  const workspaceId = rawWorkspace.workspace.id;
  const badRaw = await tool("simulation_files", {
    request: {
      action: "update",
      workspaceId,
      expectedRevision: 0,
      entry: "main.cir",
      writes: [
        {
          path: "main.cir",
          text: [
            "Missing model recovery acceptance",
            "V1 out 0 DC 1",
            "D1 out 0 acceptance_model_missing",
            ".control",
            "set filetype=ascii",
            "op",
            "write out.raw v(out)",
            ".endc",
            ".end",
          ].join("\n"),
        },
      ],
    },
  });
  assert.equal(badRaw.ok, true);
  const badPrepared = await tool("simulation", {
    request: {
      operation: "prepare",
      source: {
        kind: "workspace",
        workspaceId,
        expectedRevision: badRaw.workspace.revision,
        environment: { profileId: capabilityReply.capabilities.profiles[0].id },
      },
    },
  });
  assert.equal(badPrepared.ok, true);
  const badRun = await startAndRead(badPrepared.prepared);
  assert.equal(badRun.state, "finished");
  assert.equal(badRun.result?.outcome.status, "failed");

  const fixedRaw = await tool("simulation_files", {
    request: {
      action: "update",
      workspaceId,
      expectedRevision: badRaw.workspace.revision,
      entry: "main.cir",
      writes: [
        {
          path: "main.cir",
          text: [
            "Recovered divider",
            "V1 in 0 DC 1",
            "R1 in out 1k",
            "R2 out 0 1k",
            ".control",
            "set filetype=ascii",
            "op",
            "write out.raw v(out)",
            ".endc",
            ".end",
          ].join("\n"),
        },
      ],
    },
  });
  assert.equal(fixedRaw.ok, true);
  const fixedPrepared = await tool("simulation", {
    request: {
      operation: "prepare",
      source: {
        kind: "workspace",
        workspaceId,
        expectedRevision: fixedRaw.workspace.revision,
        environment: { profileId: capabilityReply.capabilities.profiles[0].id },
      },
    },
  });
  assert.equal(fixedPrepared.ok, true);
  const fixedRun = await startAndRead(fixedPrepared.prepared);
  assert.equal(fixedRun.state, "finished");
  assert.equal(fixedRun.result?.outcome.status, "completed");

  const invalidSetup = structuredClone(qualifiedSetup);
  assert.equal(
    invalidSetup.input.kind,
    "structured",
    "The acceptance setup must use structured simulation input",
  );
  const firstOutput = invalidSetup.input.outputs[0];
  assert(firstOutput, "The acceptance setup has no authored output");
  assert(
    ["voltage", "current"].includes(firstOutput.expression.kind),
    "The first acceptance output cannot be anchored to a circuit terminal",
  );
  firstOutput.expression.anchor = {
    kind: "terminal",
    instanceId: "missing-acceptance-instance",
    pinName: "out",
  };
  const invalidEdit = await tool("advanced_transact", {
    structureEdits: [{ kind: "upsert_simulation_setup", setup: invalidSetup }],
  });
  assert.equal(invalidEdit.ok, true);
  const refused = await tool(
    "simulation",
    {
      request: {
        operation: "prepare",
        source: {
          kind: "project-setup",
          setupId: setup.id,
          expectedStructureRevision: invalidEdit.projectStructure.toRevision,
        },
      },
    },
    true,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.error.recovery, "fix-input");

  const setupWithoutDeviceOperatingPoints = structuredClone(qualifiedSetup);
  delete setupWithoutDeviceOperatingPoints.input.deviceOperatingPoints;
  const restored = await tool("advanced_transact", {
    structureEdits: [
      {
        kind: "upsert_simulation_setup",
        setup: setupWithoutDeviceOperatingPoints,
      },
    ],
  });
  assert.equal(restored.ok, true);
  let configuredRevision = restored.projectStructure.toRevision;
  for (const selection of qualifiedSetup.input.deviceOperatingPoints) {
    const configured = await tool("simulation_device_operating_point", {
      action: "upsert",
      setupId: setup.id,
      deviceOperatingPointId: selection.id,
      targetDocumentId: selection.documentId,
      instanceId: selection.instanceId,
      occurrence: selection.occurrence,
    });
    assert.equal(configured.ok, true);
    configuredRevision = configured.projectStructure.toRevision;
  }
  const prepared = await tool("simulation", {
    request: {
      operation: "prepare",
      source: {
        kind: "project-setup",
        setupId: setup.id,
        expectedStructureRevision: configuredRevision,
      },
    },
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.prepared.vectors, compiled.vectors);
  assert.deepEqual(
    prepared.prepared.deviceOperatingPoints,
    compiled.deviceOperatingPoints,
  );
  const finished = await startAndRead(prepared.prepared);
  assert.equal(finished.state, "finished");
  const exports = [];
  const exportedArtifactNames = new Set();
  const fullRun = await materializeSimulationRunEvidence(
    finished,
    async (artifact) => {
      exports.push(await exportArtifact(artifact, artifact.name));
      exportedArtifactNames.add(artifact.name);
      const value = JSON.parse(
        await readFile(join(outputDirectory, artifact.name), "utf8"),
      );
      return artifact.name === "result.json"
        ? SimulationResultSchema.parse(value)
        : SimulationOutputDataSchema.parse(value);
    },
  );
  assert.equal(fullRun.result?.outcome.status, "completed");
  const accepted = validateHostedSky130Result(
    fullRun.result,
    "operator-host",
    prepared.prepared.inputRevision,
    prepared.prepared.vectors,
  );
  const acceptedNoise = validateHostedSky130NoiseResult(
    fullRun.result,
    "operator-host",
    prepared.prepared.inputRevision,
  );
  assert(
    fullRun.outputData?.analyses.length,
    "The completed OTA run returned no evaluated named outputs",
  );
  assert(
    fullRun.outputData.measurements?.length,
    "The completed OTA run returned no automatic measurements",
  );
  const mosOperatingPoints = fullRun.outputData.deviceOperatingPoints;
  assert.equal(
    mosOperatingPoints?.length,
    2,
    "The completed OTA run returned no selected MOS operating-point details",
  );
  const mosValue = (deviceId, parameter) => {
    const value = mosOperatingPoints
      .find((device) => device.instanceId === deviceId)
      ?.values.find((candidate) => candidate.parameter === parameter);
    assert.equal(
      value?.status,
      "available",
      `${deviceId}.${parameter} is unavailable`,
    );
    assert(
      Number.isFinite(value.value),
      `${deviceId}.${parameter} is not finite`,
    );
    return value.value;
  };
  assert(mosValue("M1", "vgs") > 0, "NMOS VGS polarity is incorrect");
  assert(mosValue("M1", "id") > 0, "NMOS drain-entering ID is incorrect");
  assert(mosValue("M3", "vgs") < 0, "PMOS VGS polarity is incorrect");
  assert(mosValue("M3", "id") < 0, "PMOS drain-entering ID is incorrect");
  assert(
    Math.abs(mosValue("M1", "vbs")) < 1e-9,
    "NMOS cell-default Bulk did not resolve to its source supply",
  );
  assert(
    Math.abs(mosValue("M3", "vbs")) < 1e-9,
    "PMOS cell-default Bulk did not resolve to its source supply",
  );

  const resultArtifacts = finished.artifacts
    .filter(
      (artifact) =>
        artifact.name === "out.raw" ||
        artifact.name === "result.json" ||
        artifact.name.endsWith(".csv"),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const artifact of resultArtifacts) {
    if (exportedArtifactNames.has(artifact.name)) continue;
    exports.push(await exportArtifact(artifact, artifact.name));
  }
  exports.push(
    await exportArtifact(
      prepared.prepared.artifacts.find(
        (artifact) => artifact.name === "prepared.cir",
      ),
      "prepared.cir",
    ),
  );

  report.status = "passed";
  report.completedAt = new Date().toISOString();
  report.connection = { mode: connection.mode };
  report.discovery = {
    projectId: contextReport.projectId,
    documentId: contextReport.documentId,
    structureRevision: inspected.project?.structureRevision,
    setup: {
      id: discoveredSetup.id,
      name: discoveredSetup.name,
      rootDocumentId: discoveredSetup.input.rootDocumentId,
      analyses: qualifiedSetup.input.analyses,
      outputs: qualifiedSetup.input.outputs.map((output) => ({
        id: output.id,
        label: output.label,
        expressionKind: output.expression.kind,
      })),
      deviceOperatingPoints: qualifiedSetup.input.deviceOperatingPoints,
    },
    source: {
      id: sourceReport.id,
      reference: sourceReport.reference,
      parameters: sourceReport.parameters,
    },
    capabilities: {
      inputs: capabilityReply.capabilities.inputs,
      analyses: capabilityReply.capabilities.analyses,
      parsedAnalyses: capabilityReply.capabilities.parsedAnalyses,
      profiles: capabilityReply.capabilities.profiles,
      maxTimeoutMs: capabilityReply.capabilities.maxTimeoutMs,
      maxInputBytes: capabilityReply.capabilities.maxInputBytes,
      maxOutputBytes: capabilityReply.capabilities.maxOutputBytes,
      cancel: capabilityReply.capabilities.cancel,
    },
  };
  report.recoverableError = {
    code: refused.error.code,
    stage: refused.error.stage,
    recovery: refused.error.recovery,
    diagnostics: refused.error.diagnostics,
  };
  report.modelRecovery = {
    failedOutcome: badRun.result?.outcome.status,
    correctedOutcome: fixedRun.result?.outcome.status,
    workspaceId,
  };
  report.prepared = {
    id: prepared.prepared.id,
    digest: prepared.prepared.digest,
    inputRevision: prepared.prepared.inputRevision,
    mode: prepared.prepared.mode,
    environment: prepared.prepared.environment,
    vectors: prepared.prepared.vectors,
    warnings: prepared.prepared.warnings,
    artifacts: prepared.prepared.artifacts,
  };
  report.run = {
    state: fullRun.state,
    outcome: fullRun.result.outcome.status,
    profileId: fullRun.result.metadata.environment.profileId,
    environmentFingerprint: accepted.environmentFingerprint,
    inputRevision: prepared.prepared.inputRevision,
    preparedId: prepared.prepared.id,
    runId: finished.id,
    analyses: fullRun.result.data?.analyses.map((analysis) => ({
      kind: analysis.analysis,
      plotName: analysis.plotName,
      points:
        analysis.analysis === "op"
          ? 1
          : analysis.analysis === "dc"
            ? analysis.sweep.values.length
            : analysis.analysis === "ac"
              ? analysis.frequencyHz.length
              : analysis.analysis === "noise"
                ? analysis.frequencyHz.length
                : analysis.timeSeconds.length,
      outputs:
        analysis.analysis === "noise"
          ? ["noise-output-density", "noise-input-density"]
          : analysis.probes.map((probe) => probe.name),
    })),
    namedOutputs: fullRun.outputData.analyses.map((analysis) => ({
      kind: analysis.analysis,
      outputs: analysis.outputs.map((output) => output.label),
    })),
    measurementCount: fullRun.outputData.measurements?.length ?? 0,
    deviceOperatingPoints: mosOperatingPoints,
    integratedNoise: {
      output: acceptedNoise.integratedOutputNoise,
      input: acceptedNoise.integratedInputNoise,
    },
  };
  report.exports = exports;
  await tool("disconnect");
  paired = false;
  console.log(
    `Preview Agent/MCP OTA journey passed (${accepted.environmentFingerprint})`,
  );
} catch (error) {
  report.status = "failed";
  report.completedAt = new Date().toISOString();
  report.error = error instanceof Error ? error.message : String(error);
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    await pages[0]
      ?.screenshot({ path: join(outputDirectory, "failure.png") })
      .catch(() => {});
  }
  process.exitCode = 1;
  console.error(report.error);
} finally {
  if (paired && mcp) await tool("disconnect").catch(() => {});
  await stopMcp();
  if (browser) await browser.close();
  await writeFile(
    join(outputDirectory, "receipt.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await rm(privateDirectory, { recursive: true, force: true });
}

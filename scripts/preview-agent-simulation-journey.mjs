import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { chromium } from "@playwright/test";
import { compileStructuredSimulation } from "../packages/netlist/dist/index.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { validateHostedSky130Result } from "./preview-simulation-smoke.mjs";

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
assert(project.simulation, "The acceptance Project has no saved setup");
const compiled = await compileStructuredSimulation(project, project.simulation);
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
  const reply = await rpc("tools/call", { name, arguments: args });
  const text = reply.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string", `${name} returned no text result`);
  const value = JSON.parse(text);
  if (reply.isError && !allowProblem) {
    throw new Error(`${name} failed: ${text}`);
  }
  return value;
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

  const invalidSetup = structuredClone(project.simulation);
  invalidSetup.input.probes[0].anchor = {
    kind: "terminal",
    instanceId: "missing-acceptance-instance",
    pinName: "out",
  };
  const invalidEdit = await tool("advanced_transact", {
    structureEdits: [{ kind: "set_simulation_setup", setup: invalidSetup }],
  });
  assert.equal(invalidEdit.ok, true);
  const refused = await tool(
    "simulation",
    {
      request: {
        operation: "prepare",
        source: {
          kind: "project-setup",
          expectedStructureRevision: invalidEdit.projectStructure.toRevision,
        },
      },
    },
    true,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.error.recovery, "fix-input");

  const restored = await tool("advanced_transact", {
    structureEdits: [
      { kind: "set_simulation_setup", setup: project.simulation },
    ],
  });
  assert.equal(restored.ok, true);
  const prepared = await tool("simulation", {
    request: {
      operation: "prepare",
      source: {
        kind: "project-setup",
        expectedStructureRevision: restored.projectStructure.toRevision,
      },
    },
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.prepared.vectors, compiled.vectors);
  const started = await tool("simulation", {
    request: {
      operation: "start",
      preparedId: prepared.prepared.id,
      digest: prepared.prepared.digest,
    },
  });
  assert.equal(started.ok, true);

  let finished;
  for (let attempt = 0; attempt < 180; attempt++) {
    finished = await tool("simulation", {
      request: { operation: "read", runId: started.run.id },
    });
    assert.equal(finished.ok, true);
    if (!["running", "cancelling"].includes(finished.run.state)) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  assert(finished, "The run returned no final state");
  assert.equal(finished.run.state, "finished");
  assert.equal(finished.run.result?.outcome.status, "completed");
  const accepted = validateHostedSky130Result(
    finished.run.result,
    "operator-host",
    prepared.prepared.inputRevision,
    prepared.prepared.vectors,
  );

  const exports = [];
  for (const name of ["out.raw", "result.json", "ac-1.csv"]) {
    exports.push(
      await exportArtifact(
        finished.run.artifacts.find((artifact) => artifact.name === name),
        name,
      ),
    );
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
  report.recoverableError = refused.error.code;
  report.run = {
    state: finished.run.state,
    outcome: finished.run.result.outcome.status,
    profileId: finished.run.result.metadata.environment.profileId,
    environmentFingerprint: accepted.environmentFingerprint,
    inputRevision: prepared.prepared.inputRevision,
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

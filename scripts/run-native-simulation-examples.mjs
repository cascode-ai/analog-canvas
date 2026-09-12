import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";

const root = resolve(process.argv[2] ?? "output/native-simulation-examples");
const selected = process.argv[3];
const base = "https://analog-canvas-preview.tokenzhang.com";
const manifest = JSON.parse(
  await readFile(join(root, "manifest.json"), "utf8"),
);
const distribution = await (
  await fetch(base + "/api/agent/mcp-manifest.json")
).json();
assert.equal(
  distribution.version,
  "0.7.0",
  "Requalify the runner when the published MCP version changes.",
);
const sourceBuild = process.env.ICM_EXAMPLE_MCP_SOURCE !== "0";
const executable = resolve(
  sourceBuild
    ? "apps/mcp-server/dist/main.js"
    : "output/mcp-published-0.7.0/package/bin/analog-canvas-mcp.mjs",
);
const executableBytes = await readFile(executable);
if (sourceBuild)
  assert(
    !executableBytes.includes(Buffer.from("//#region")),
    "Recompile apps/mcp-server with a fresh tsBuildInfoFile; this entry is a packaged bundle, not current source.",
  );
if (!sourceBuild) {
  const tarball = await readFile(
    resolve("output/mcp-published-0.7.0/analog-canvas-mcp-server-0.7.0.tgz"),
  );
  assert.equal(
    createHash("sha256").update(tarball).digest("hex"),
    distribution.distribution.sha256,
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const summary = [];
for (const project of manifest.projects.filter(
  (p) => !selected || p.slug === selected,
)) {
  const dir = join(root, "results", project.slug);
  await mkdir(dir, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "native-examples-mcp-"));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  let child,
    paired = false,
    seq = 0;
  const pending = new Map();
  function rpc(method, params = {}) {
    const id = ++seq;
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("MCP timeout: " + method));
      }, 150000);
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolveReply(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
  async function tool(name, args = {}) {
    for (let attempt = 0; ; attempt++) {
      const reply = await rpc("tools/call", { name, arguments: args });
      const value = JSON.parse(
        reply.content.find((c) => c.type === "text").text,
      );
      if (value.error?.code === "RATE_LIMITED" && attempt < 10) {
        await sleep(Math.max(value.error.retryAfterMs ?? 5000, 1000));
        continue;
      }
      assert(
        !reply.isError && value.ok !== false,
        JSON.stringify({ tool: name, response: value }),
      );
      return value;
    }
  }
  const report = {
    project: project.slug,
    startedAt: new Date().toISOString(),
    mcpVersion: distribution.version,
    mcpExecutableSha256: createHash("sha256")
      .update(executableBytes)
      .digest("hex"),
    mcpBuild: sourceBuild ? "current-source" : "published",
    mcpSourceCommit: sourceBuild
      ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
      : undefined,
    mcpSha256: sourceBuild ? undefined : distribution.distribution.sha256,
    runs: [],
  };
  try {
    await page.goto(base + "/editor");
    await page.getByTestId("project-file").setInputFiles(project.file);
    await page
      .locator("summary")
      .filter({ hasText: /^Agent$/ })
      .click();
    await page
      .getByRole("button", { name: "Connect Agent", exact: true })
      .click();
    await page.getByTestId("agent-preset-full").click();
    await page
      .getByTestId("agent-claim-code")
      .waitFor({ state: "attached", timeout: 30000 });
    const claimCode = await page.getByTestId("agent-claim-code").textContent();
    child = spawn(process.execPath, [executable], {
      env: {
        ...process.env,
        ANALOG_CANVAS_API_URL: base,
        ANALOG_CANVAS_MCP_CONNECTOR: join(temporary, "connector.json"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const r = JSON.parse(line);
        const p = pending.get(r.id);
        if (p) {
          pending.delete(r.id);
          r.error
            ? p.reject(Error(JSON.stringify(r.error)))
            : p.resolve(r.result);
        }
      } catch {}
    });
    child.stderr.on("data", () => {});
    child.on("exit", (code) => {
      for (const p of pending.values()) p.reject(Error("MCP exited " + code));
      pending.clear();
    });
    const initialized = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "native-example-acceptance", version: "1" },
    });
    assert.equal(initialized.serverInfo.version, "0.7.0");
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    await tool("connect", { claimCode });
    paired = true;
    await rpc("resources/read", {
      uri: "analog-canvas://reference/quickstart",
    });
    await page
      .getByTestId("agent-status")
      .filter({ hasText: "Connected" })
      .waitFor({ state: "visible", timeout: 30000 });
    report.context = await tool("get_context");
    report.capabilities = (
      await tool("simulation", { request: { operation: "capabilities" } })
    ).capabilities;
    console.log(project.slug, "connected; native files verified");
    for (const folder of project.folders) {
      const listed = await tool("simulation_files", {
        request: {
          action: "read",
          owner: { kind: "project-folder", folderId: folder.id },
          path: "experiment.json",
        },
      });
      assert.equal(JSON.parse(listed.text).version, 2);
    }
    const config = await tool("simulation_files", {
      request: {
        action: "read",
        owner: { kind: "project-folder", folderId: project.folders[0].id },
        path: "experiment.json",
      },
    });
    const prepared = await tool("simulation", {
      request: {
        operation: "prepare-batch",
        expectedStructureRevision: config.revision,
        items: project.folders.map((f) => ({ id: f.id, folderId: f.id })),
      },
    });
    await tool("simulation", {
      requestId: randomUUID(),
      request: { operation: "start-batch", batchId: prepared.batch.id },
    });
    let batch;
    for (let i = 0; i < 400; i++) {
      batch = (
        await tool("simulation", {
          request: { operation: "read-batch", batchId: prepared.batch.id },
        })
      ).batch;
      if (!["running", "cancelling", "prepared"].includes(batch.state)) break;
      await sleep(2000);
    }
    report.batch = batch;
    assert.deepEqual(
      batch.items.map((i) => i.id).sort(),
      project.folders.map((f) => f.id).sort(),
      "Batch must cover exactly the selected experiments",
    );
    for (const item of batch.items) {
      const runDir = join(dir, item.id);
      await mkdir(runDir, { recursive: true });
      if (!item.runId) {
        report.runs.push({
          folderId: item.id,
          state: item.state,
          error: item.error,
        });
        continue;
      }
      const run = (
        await tool("simulation", {
          request: { operation: "read", runId: item.runId },
        })
      ).run;
      await writeFile(join(runDir, "run.json"), JSON.stringify(run, null, 2));
      const artifacts = [];
      for (const artifact of run.artifacts ?? []) {
        // Immutable service artifacts, no arbitrary host paths from simulator output.
        const path = join(runDir, basename(artifact.name));
        await tool("simulation_files", {
          request: { action: "artifact", artifactId: artifact.id },
          outputPath: path,
        });
        assert.equal(
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
          artifact.sha256,
        );
        artifacts.push({ name: artifact.name, sha256: artifact.sha256 });
      }
      const analyses =
        run.outputData?.analyses ?? run.result?.data?.analyses ?? [];
      for (let index = 0; index < analyses.length; index++) {
        if (analyses[index].analysis === "op") continue;
        try {
          await tool("export_file", {
            artifact: "simulation-plot",
            simulation: { runId: run.id, analysisIndex: index, format: "svg" },
            outputPath: join(runDir, `plot-${index}.svg`),
          });
          const plot = join(runDir, `plot-${index}.svg`);
          if ((await readFile(plot)).subarray(0, 2).toString() === "PK") {
            await rename(plot, join(runDir, `plot-${index}.zip`));
          }
        } catch (e) {
          report.exportWarnings ??= [];
          report.exportWarnings.push({ folder: item.id, message: e.message });
        }
      }
      report.runs.push({
        folderId: item.id,
        runId: run.id,
        state: run.state,
        outcome: run.result?.outcome,
        artifacts,
      });
      console.log(
        project.slug,
        item.id,
        run.state,
        run.result?.outcome?.status,
      );
    }
    await tool("export_file", {
      artifact: "project",
      outputPath: join(dir, "mcp-export.icproj.json"),
    });
    report.status = report.runs.every((r) => r.outcome?.status === "completed")
      ? "passed"
      : "failed";
    await page.screenshot({ path: join(dir, "editor.png"), fullPage: true });
  } catch (e) {
    report.status = "failed";
    report.error = e.message;
    console.error(project.slug, e.message);
    await page.screenshot({ path: join(dir, "failure.png") }).catch(() => {});
  } finally {
    report.browserErrors = browserErrors;
    report.completedAt = new Date().toISOString();
    if (paired) await tool("disconnect").catch(() => {});
    if (child) {
      child.stdin.end();
      await sleep(1000);
      if (child.exitCode === null) child.kill();
    }
    await context.close();
    await rm(temporary, { recursive: true, force: true });
    await writeFile(join(dir, "receipt.json"), JSON.stringify(report, null, 2));
    summary.push({
      project: project.slug,
      status: report.status,
      error: report.error,
    });
  }
}
await browser.close();
console.log(JSON.stringify(summary, null, 2));
if (summary.some((s) => s.status !== "passed")) process.exitCode = 1;

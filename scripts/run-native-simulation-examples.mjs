import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { compileSourceSimulation } from "../packages/netlist/dist/index.js";
import { verifySimulationEnvironmentMetadata } from "../packages/spice-run/dist/index.js";
import { verifyPreviewCandidate } from "./lib/preview-candidate.mjs";
import {
  nativeRunnerOptions,
  expectedNativeEnvironments,
  assertNativeCapabilities,
  collectNativeRunEvidence,
} from "./lib/native-example-runner.mjs";

export async function runNativeExamples(argv = process.argv.slice(2)) {
  const options = nativeRunnerOptions(argv),
    root = options.root,
    base = options.url;
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  const executable = options.bundle,
    executableBytes = await readFile(executable);
  assert.equal(
    createHash("sha256").update(executableBytes).digest("hex"),
    options.bundleSha256,
    "MCP bundle differs from the supplied expected digest",
  );
  // Produced by package-mcp.mjs (one bundled entry), not an unverified dist/main.js.
  const distribution = JSON.parse(
    await readFile(join(dirname(executable), "..", "package.json"), "utf8"),
  );
  assert.equal(
    distribution.bin?.["analog-canvas-mcp"],
    "bin/analog-canvas-mcp.mjs",
    "Use the packaged MCP bundle",
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
  const projects = [];
  for (const entry of manifest.projects.filter(
    (p) => !options.selected || p.slug === options.selected,
  )) {
    assert(/^[a-zA-Z0-9_-]+$/u.test(entry.slug), "Unsafe Project slug");
    const p = parseProject(await readFile(entry.file, "utf8"));
    assert.deepEqual(
      entry.folders.map((f) => f.id).sort(),
      p.simulationFolders.map((f) => f.id).sort(),
      "Manifest must cover the saved Project's complete experiment set",
    );
    const folders = p.simulationFolders.map((f) => {
      assert(/^[a-zA-Z0-9_-]+$/u.test(f.id), "Unsafe folder id");
      const compiled = compileSourceSimulation(p, f);
      assert(compiled.ok, JSON.stringify(compiled));
      const profileId = compiled.config.environment.profileId;
      assert(
        environments.has(profileId),
        `Expected runtime metadata missing: ${profileId}`,
      );
      return {
        id: f.id,
        configPath: f.input.configPath,
        compiled,
        profileId,
        dependencies: f.input.dependencies,
      };
    });
    assert(folders.length, "Project has no experiments");
    projects.push({ ...entry, folders });
  }
  assert(
    projects.length,
    "No matching Projects; empty selection is not acceptance",
  );
  assert.equal(
    new Set(projects.map((p) => p.slug)).size,
    projects.length,
    "Duplicate Project slug",
  );
  // No remote IO or browser until all local input/runtime expectations pass.
  await mkdir(join(root, "results"));
  const candidate = await verifyPreviewCandidate(base);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await chromium.launch({ headless: true });
  const summary = [];
  try {
    for (const project of projects) {
      const dir = join(root, "results", project.slug);
      await mkdir(dir);
      const temporary = await mkdtemp(join(tmpdir(), "native-examples-mcp-"));
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const browserErrors = [];
      page.on("pageerror", (e) => browserErrors.push(e.message));
      let child,
        paired = false,
        activeBatch,
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
        scope: "native-gui-mcp-batch-not-isolation-or-model-qualification",
        candidate,
        baseUrl: base,
        mcpVersion: distribution.version,
        mcpExecutableSha256: createHash("sha256")
          .update(executableBytes)
          .digest("hex"),
        mcpBuild: "explicit-packaged-bundle",
        runs: [],
      };
      try {
        await page.goto(base + "/editor");
        await page.getByTestId("project-file").setInputFiles(project.file);
        await page.getByRole("button", { name: "Agent", exact: true }).click();
        await page
          .getByTestId("agent-copy-text")
          .waitFor({ state: "attached", timeout: 30000 });
        const { claimCode } = JSON.parse(
          (await page.getByTestId("agent-copy-text").inputValue()).match(
            /^Claim: (.+)$/mu,
          )?.[1] ?? "{}",
        );
        child = spawn(process.execPath, [executable], {
          env: {
            ...process.env,
            ANALOG_CANVAS_API_URL: base,
            ANALOG_CANVAS_MCP_CONNECTOR: join(temporary, "connector.json"),
          },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        const failPending = (error) => {
          for (const p of pending.values()) p.reject(error);
          pending.clear();
        };
        createInterface({ input: child.stdout }).on("line", (line) => {
          if (!line.trim()) return;
          try {
            const r = JSON.parse(line);
            const p = pending.get(r.id);
            if (p) {
              pending.delete(r.id);
              r.error
                ? p.reject(Error(JSON.stringify(r.error)))
                : p.resolve(r.result);
            }
          } catch (error) {
            failPending(error);
          }
        });
        let stderr = "";
        child.stderr.on("data", (data) => {
          stderr = (stderr + data.toString()).slice(-4096);
        });
        child.on("error", failPending);
        child.stdin.on("error", failPending);
        child.on("exit", (code) => {
          for (const p of pending.values())
            p.reject(Error("MCP exited " + code + ": " + stderr));
          pending.clear();
        });
        const initialized = await rpc("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "native-example-acceptance", version: "1" },
        });
        assert.equal(initialized.serverInfo.version, distribution.version);
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n",
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
        assertNativeCapabilities(report.capabilities, project.folders);
        console.log(project.slug, "connected; native capabilities verified");
        for (const folder of project.folders) {
          const listed = await tool("simulation_files", {
            request: {
              action: "read",
              owner: { kind: "project-folder", folderId: folder.id },
              path: folder.configPath,
            },
          });
          assert.equal(JSON.parse(listed.text).version, 2);
          assert.equal(
            JSON.parse(listed.text).environment.profileId,
            folder.profileId,
          );
        }
        const config = await tool("simulation_files", {
          request: {
            action: "read",
            owner: { kind: "project-folder", folderId: project.folders[0].id },
            path: project.folders[0].configPath,
          },
        });
        const prepared = await tool("simulation", {
          request: {
            operation: "prepare-batch",
            expectedStructureRevision: config.revision,
            items: project.folders.map((f) => ({ id: f.id, folderId: f.id })),
          },
        });
        activeBatch = prepared.batch.id;
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
          if (!["running", "cancelling", "prepared"].includes(batch.state))
            break;
          await sleep(2000);
        }
        report.batch = batch;
        assert(
          ["finished", "failed", "cancelled"].includes(batch.state),
          "Batch did not complete before the polling deadline",
        );
        activeBatch = undefined;
        assert.deepEqual(
          batch.items.map((i) => i.id).sort(),
          project.folders.map((f) => f.id).sort(),
          "Batch must cover exactly the selected experiments",
        );
        for (const item of batch.items) {
          try {
            assert(
              item.runId,
              `Experiment did not run: ${JSON.stringify(item.error)}`,
            );
            const run = (
              await tool("simulation", {
                request: { operation: "read", runId: item.runId },
              })
            ).run;
            const folder = project.folders.find((f) => f.id === item.id);
            const evidence = await collectNativeRunEvidence({
              tool,
              run,
              directory: join(dir, item.id),
              compiled: folder.compiled,
              expectedEnvironment: environments.get(folder.profileId),
            });
            report.runs.push({ folderId: item.id, ...evidence });
            console.log(project.slug, item.id, evidence.outcome.status);
          } catch (error) {
            report.runs.push({
              folderId: item.id,
              runId: item.runId,
              state: item.state,
              error: error.message,
            });
          }
        }
        await tool("export_file", {
          artifact: "project",
          outputPath: join(dir, "mcp-export.icproj.json"),
        });
        report.status =
          batch.state === "finished" &&
          report.runs.length === project.folders.length &&
          report.runs.every(
            (r) => !r.error && r.outcome?.status === "completed",
          )
            ? "passed"
            : "failed";
        await page.screenshot({
          path: join(dir, "editor.png"),
          fullPage: true,
        });
      } catch (e) {
        report.status = "failed";
        report.error = e.message;
        console.error(project.slug, e.message);
        await page
          .screenshot({ path: join(dir, "failure.png") })
          .catch(() => {});
      } finally {
        report.browserErrors = browserErrors;
        if (browserErrors.length) report.status = "failed";
        if (activeBatch && paired) {
          try {
            await tool("simulation", {
              request: { operation: "cancel-batch", batchId: activeBatch },
            });
          } catch (e) {
            report.cancellationError = e.message;
            report.status = "failed";
          }
        }
        report.completedAt = new Date().toISOString();
        const cleanupError = (error) => {
          report.cleanupErrors ??= [];
          report.cleanupErrors.push(error.message);
          report.status = "failed";
        };
        if (paired) await tool("disconnect").catch(cleanupError);
        if (child) {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit").catch(() => {});
            const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
            child.stdin.end();
            try {
              await exited;
            } finally {
              clearTimeout(deadline);
            }
          }
        }
        await context.close().catch(cleanupError);
        await rm(temporary, { recursive: true, force: true }).catch(
          cleanupError,
        );
        await writeFile(
          join(dir, "receipt.json"),
          JSON.stringify(report, null, 2),
          { flag: "wx" },
        );
        summary.push({
          project: project.slug,
          status: report.status,
          error: report.error,
        });
      }
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const summary = await runNativeExamples();
  if (summary.some((s) => s.status !== "passed")) process.exitCode = 1;
}

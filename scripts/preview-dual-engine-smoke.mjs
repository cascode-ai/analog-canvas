import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { chromium } from "@playwright/test";

// Real browser relay + source-built stdio MCP + managed Preview transport.
// No page routing, fake executor, direct gateway run or numerical comparison
// between engines. Each divider independently has the analytic answer 0.5 V.
const origin = new URL(
  process.argv[2] ?? "https://analog-canvas-preview.tokenzhang.com",
).origin;
assert.equal(
  origin,
  "https://analog-canvas-preview.tokenzhang.com",
  "Preview-only smoke",
);
const output = resolve("test-results/preview-dual-engine");
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "icm-dual-mcp-"));
const entry = resolve("apps/mcp-server/dist/main.js");
const receipt = {
  origin,
  startedAt: new Date().toISOString(),
  mcp: {
    kind: "source-built",
    sha256: createHash("sha256")
      .update(await readFile(entry))
      .digest("hex"),
  },
  runs: [],
};
const browser = await chromium.launch({ headless: true });
let child;
const pending = new Map();
let sequence = 0;
function rpc(method, params) {
  return new Promise((resolveReply, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP timeout: ${method}`));
    }, 45000);
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
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
  });
}
async function tool(name, request, allowFailure = false) {
  const reply = await rpc("tools/call", { name, arguments: request });
  const value = JSON.parse(reply.content.find((c) => c.type === "text").text);
  if (!allowFailure) assert.equal(value.ok, true, JSON.stringify(value));
  return value;
}
try {
  const page = await browser.newPage();
  const managedRequests = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/simulation/runs" &&
      request.method() === "POST"
    )
      managedRequests.push(request.url());
  });
  await page.goto(origin + "/editor");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const claimInput = page.getByTestId("agent-copy-text");
  await claimInput.waitFor({ timeout: 45000 });
  let claim;
  for (let i = 0; i < 45; i++) {
    const match = /^Claim: (.+)$/mu.exec(await claimInput.inputValue());
    if (match) {
      claim = JSON.parse(match[1]);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert(claim, "Missing public Agent claim");
  child = spawn(process.execPath, [entry], {
    cwd: scratch,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ANALOG_CANVAS_API_URL: origin,
      ANALOG_CANVAS_MCP_CONNECTOR: join(scratch, "connector.json"),
    },
  });
  child.stderr.on("data", () => {});
  child.on("error", (error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  });
  child.on("exit", () => {
    for (const p of pending.values()) p.reject(new Error("MCP exited"));
    pending.clear();
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const reply = JSON.parse(line);
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    if (reply.error) p.reject(new Error(JSON.stringify(reply.error)));
    else p.resolve(reply.result);
  });
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "preview-dual-engine-smoke", version: "1" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  await tool("connect", claim);
  const discovery = await tool("simulation", {
    request: { operation: "capabilities" },
  });
  const cases = [
    {
      engine: "ngspice",
      profileId: "sky130-core-continuous-ngspice46-v1",
      path: "divider.cir",
      probe: "v(mid)",
      text: "Divider\nV1 input 0 1\nR1 input mid 1k\nR2 mid 0 1k\n.control\nset filetype=ascii\nop\nwrite out.raw all\n.endc\n.end\n",
    },
    {
      engine: "vacask",
      profileId: "vacask-sky130-candidate",
      path: "divider.sim",
      probe: "mid",
      text: 'Divider\nground 0\nload "resistor.osdi"\nmodel resistance resistor\nmodel voltage vsource\nV1 (input 0) voltage dc=1\nR1 (input mid) resistance r=1k\nR2 (mid 0) resistance r=1k\ncontrol\nabort always\noptions rawfile="ascii"\nsave default\nanalysis divider_op op\nendc\n',
    },
  ];
  for (const sample of cases) {
    assert(
      discovery.capabilities.profiles.some((p) => p.id === sample.profileId),
      `Missing ${sample.profileId}`,
    );
    const created = await tool("simulation_files", {
      request: { action: "create" },
    });
    const workspaceId = created.workspace.id;
    const owner = { kind: "session-workspace", workspaceId };
    const config = {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: sample.profileId },
      }),
    };
    const update = async (revision, text) =>
      tool("simulation_files", {
        request: {
          action: "update",
          owner,
          expectedRevision: revision,
          entry: sample.path,
          writes: [{ path: sample.path, text }, config],
        },
      });
    const prepare = async (revision, allowFailure = false) =>
      tool(
        "simulation",
        {
          request: {
            operation: "prepare",
            source: {
              kind: "workspace",
              workspaceId,
              expectedRevision: revision,
            },
          },
        },
        allowFailure,
      );
    await update(
      0,
      sample.text.replace(
        "\n",
        "\n" +
          (sample.engine === "vacask"
            ? 'include "missing.inc"\n'
            : '.include "missing.inc"\n'),
      ),
    );
    assert.equal(
      (await prepare(1, true)).ok,
      false,
      "Missing include must fail without ending the session",
    );
    await update(1, sample.text);
    const { prepared } = await prepare(2);
    const start = {
      request: {
        operation: "start",
        preparedId: prepared.id,
        digest: prepared.digest,
      },
      requestId: `dual-${sample.engine}`,
    };
    const { run: started } = await tool("simulation", start);
    assert.equal(
      (await tool("simulation", start)).run.id,
      started.id,
      "idempotent start",
    );
    let finished;
    for (let i = 0; i < 90; i++) {
      const { run } = await tool("simulation", {
        request: { operation: "read", runId: started.id },
      });
      if (run.state === "finished") {
        finished = run;
        break;
      }
      assert(
        !["lost", "cancelled", "expired"].includes(run.state),
        JSON.stringify(run),
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(finished, `${sample.engine} did not finish`);
    const result = finished.result;
    assert.equal(result.outcome.status, "completed", JSON.stringify(result));
    assert.equal(result.metadata.environment.simulator.name, sample.engine);
    assert.equal(result.metadata.environment.profileId, sample.profileId);
    const value = result.data.analyses
      .find((a) => a.analysis === "op")
      .probes.find((p) => p.name === sample.probe)?.value;
    assert.equal(typeof value, "number");
    assert(Math.abs(value - 0.5) < 1e-8, `${sample.engine}: ${value}`);
    const csv = finished.artifacts.find((a) => /^op-\d+\.csv$/.test(a.name));
    assert(csv);
    const saved = await tool("simulation_files", {
      request: { action: "artifact", artifactId: csv.id },
      outputPath: join(output, `${sample.engine}.csv`),
    });
    assert(saved.ok);
    assert(
      (await readFile(join(output, `${sample.engine}.csv`), "utf8")).includes(
        "0.5",
      ),
    );
    await writeFile(
      join(output, `${sample.engine}-run.json`),
      JSON.stringify(finished, null, 2),
    );
    receipt.runs.push({
      engine: sample.engine,
      runId: finished.id,
      profileId: sample.profileId,
      value,
      environment: result.metadata.environment,
    });
  }
  assert.equal(
    managedRequests.length,
    2,
    "Both real runs must use the managed queue, not a direct executor bypass",
  );
  receipt.managedStarts = managedRequests.length;
  receipt.passed = true;
  await tool("disconnect", {});
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  receipt.finishedAt = new Date().toISOString();
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  if (child) {
    child.stdin.end();
    child.kill();
  }
  for (const p of pending.values()) p.reject(new Error("Smoke cleanup"));
  pending.clear();
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

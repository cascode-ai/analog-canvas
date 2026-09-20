import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createSimulationFolder } from "@icm/model";
import { collectNativeRunEvidence } from "../../../scripts/lib/native-example-runner.mjs";
import {
  agentNativeSource,
  agentNativeProfile,
  createAgentNativeExecutor,
} from "./native-simulation-executor.mjs";

// Opt-in: real stdio MCP + local Worker/DO + browser service + native process.
// No mocked Agent messages. Explicit Vite mode uses the real development HTTP
// transport; default real mode intercepts only the simulation seam. Neither
// mode uses a public endpoint, cloud account or operator deployment.
test("public MCP connects to the real local relay and executes native source", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.ICM_E2E_VACASK_REAL !== "1",
    "Requires explicit native executable/module paths and built MCP dependencies.",
  );
  test.setTimeout(120000);
  const bundle = process.env.ICM_E2E_MCP_BUNDLE;
  if (bundle) {
    expect(
      process.env.ICM_E2E_MCP_BUNDLE_SHA256,
      "A packaged MCP test requires its expected digest",
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(
      createHash("sha256")
        .update(await readFile(bundle))
        .digest("hex"),
    ).toBe(process.env.ICM_E2E_MCP_BUNDLE_SHA256);
    await test.info().attach("mcp-package-identity", {
      body: Buffer.from(
        JSON.stringify({
          entry: resolve(bundle),
          sha256: process.env.ICM_E2E_MCP_BUNDLE_SHA256,
        }),
      ),
      contentType: "application/json",
    });
  }
  const root = await mkdtemp(join(tmpdir(), "icm-native-mcp-"));
  let executor:
    Awaited<ReturnType<typeof createAgentNativeExecutor>> | undefined;
  let child: ReturnType<typeof startMcp> | undefined;
  let executions = 0;
  try {
    const direct = process.env.ICM_E2E_NATIVE_TRANSPORT === "vite";
    let expectedEnvironment;
    if (direct) {
      if (!process.env.ICM_SIMULATION_URL)
        throw new Error(
          "Vite transport requires ICM_SIMULATION_URL; no intercepted fallback.",
        );
      const health = await fetch(`${process.env.ICM_SIMULATION_URL}/health`);
      expect(health.status).toBe(200);
      expectedEnvironment = (await health.json()).environment;
      expect(expectedEnvironment?.simulator.name).toBe("vacask");
      expect(expectedEnvironment?.profileId).toBe(agentNativeProfile);
      page.on("request", (request) => {
        if (new URL(request.url()).pathname !== "/api/simulate") return;
        if (request.postDataJSON().operation === undefined) executions++;
      });
    } else {
      executor = await createAgentNativeExecutor();
      const activeExecutor = executor;
      expectedEnvironment = activeExecutor.environment;
      await page.route("**/api/simulate", async (route) => {
        const input = route.request().postDataJSON();
        if (input.operation === "capabilities")
          return route.fulfill({ json: activeExecutor.capabilities });
        executions++;
        return route.fulfill({ json: await activeExecutor.execute(input) });
      });
    }
    await page.goto("/editor");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const message = page.getByTestId("agent-copy-text");
    await expect(message).toHaveValue(/Claim: /, { timeout: 45000 });
    const claim = /^Claim: (.+)$/mu.exec(await message.inputValue());
    expect(claim).not.toBeNull();
    child = startMcp(baseURL!, join(root, "connector.json"));
    await child.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "native-journey", version: "1" },
    });
    child.notify("notifications/initialized");
    const connected = await child.tool("connect", JSON.parse(claim![1]!));
    expect(connected.ok, JSON.stringify(connected)).toBe(true);
    const help = await child.tool("simulation", {
      request: { operation: "authoring-help", name: "embed" },
    });
    expect(help.ok, JSON.stringify(help)).toBe(true);
    expect(JSON.stringify(help)).toContain("report_measurement");
    expect(executions).toBe(0);

    const created = await child.tool("simulation_files", {
      request: { action: "create" },
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const workspace = created.workspace;
    const owner = { kind: "session-workspace", workspaceId: workspace.id };
    const setup = createSimulationFolder({
      id: "native",
      name: "Native MCP",
      profileId: agentNativeProfile,
    });
    const edit = async (expectedRevision: number, text: string) =>
      child!.tool("simulation_files", {
        request: {
          action: "update",
          owner,
          expectedRevision,
          entry: "main.sim",
          writes: [
            { path: "main.sim", text },
            ...setup.input.files.filter(
              (file) => file.path === setup.input.configPath,
            ),
          ],
        },
      });
    const prepare = async (expectedRevision: number) =>
      child!.tool("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "workspace",
            workspaceId: workspace.id,
            expectedRevision,
          },
        },
      });
    expect(
      (await edit(0, `${agentNativeSource}\ninclude "missing.sim"\n`)).ok,
    ).toBe(true);
    const bad = await prepare(1);
    expect(bad.ok, JSON.stringify(bad)).toBe(false);
    expect(JSON.stringify(bad)).toContain("SIMULATION_FILE_MISSING");
    expect(executions).toBe(0);
    expect((await edit(1, agentNativeSource)).ok).toBe(true);
    const prepared = await prepare(2);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    const request = {
      operation: "start",
      preparedId: prepared.prepared.id,
      digest: prepared.prepared.digest,
    };
    const started = await child.tool("simulation", {
      request,
      requestId: "native-mcp-start",
    });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    const repeated = await child.tool("simulation", {
      request,
      requestId: "native-mcp-start",
    });
    expect(repeated.run.id).toBe(started.run.id);
    let finished: any;
    await expect
      .poll(
        async () => {
          const read = await child!.tool("simulation", {
            request: { operation: "read", runId: started.run.id },
          });
          expect(read.ok, JSON.stringify(read)).toBe(true);
          finished = read.run;
          return finished.state;
        },
        { timeout: 25000 },
      )
      .toBe("finished");
    expect(executions).toBe(1);
    expect(
      finished.result.outcome.status,
      JSON.stringify(finished.result.diagnostics),
    ).toBe("completed");
    expect(finished.result.metadata.environment.simulator).toMatchObject({
      name: "vacask",
      version: "0.3.4",
    });
    const opIndex = finished.result.data.analyses.findIndex(
      (a: { analysis: string }) => a.analysis === "op",
    );
    expect(finished.result.data.analyses[opIndex].probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "mid", value: 0.5 }),
      ]),
    );
    const csv = finished.artifacts.find(
      (a: { name: string }) => a.name === `op-${opIndex}.csv`,
    );
    const outputPath = join(root, "op.csv");
    const exported = await child.tool("simulation_files", {
      request: { action: "artifact", artifactId: csv.id },
      outputPath,
    });
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    expect(await readFile(outputPath, "utf8")).toContain("0.5");
    const evidence = await collectNativeRunEvidence({
      tool: async (name: string, args: unknown) => {
        const reply = await child!.tool(name, args);
        expect(reply.ok, JSON.stringify(reply)).toBe(true);
        return reply;
      },
      run: finished,
      directory: join(root, "downloaded-evidence"),
      compiled: { files: [{ path: "main.sim", text: agentNativeSource }] },
      expectedEnvironment,
    });
    expect(evidence.datasets.map((dataset) => dataset.analysis).sort()).toEqual(
      ["ac", "op"],
    );
    expect(evidence.artifacts.map((a: { name: string }) => a.name)).toEqual(
      expect.arrayContaining([
        "result.json",
        "executed/main.sim",
        "raw/agent_ac.raw",
      ]),
    );
    await test.info().attach("public-mcp-native-download-receipt", {
      body: Buffer.from(
        JSON.stringify(
          { transport: direct ? "vite" : "intercepted-native", ...evidence },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
    await test.info().attach("public-mcp-native-run", {
      body: Buffer.from(JSON.stringify(finished, null, 2)),
      contentType: "application/json",
    });
    // A new MCP process resumes this browser-approved connector, not a new claim.
    await child.close();
    child = startMcp(baseURL!, join(root, "connector.json"));
    await child.request("initialize", { protocolVersion: "2025-03-26" });
    child.notify("notifications/initialized");
    const resumed = await child.tool("connect", {});
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);
    const reread = await child.tool("simulation", {
      request: { operation: "read", runId: started.run.id },
    });
    expect(reread.run.id).toBe(started.run.id);
    expect(executions).toBe(1);
  } finally {
    try {
      await child?.close();
    } finally {
      try {
        await executor?.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});

test("large native results persist, download to MCP workspace and remain readable offline", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.ICM_E2E_VACASK_REAL !== "1",
    "Requires an explicit real native runtime",
  );
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), "icm-large-mcp-"));
  const executor = await createAgentNativeExecutor({ largeTransient: true });
  let child: ReturnType<typeof startMcp> | undefined;
  let executions = 0;
  try {
    await page.route("**/api/simulate", async (route) => {
      const input = route.request().postDataJSON();
      if (input.operation === "capabilities")
        return route.fulfill({ json: executor.capabilities });
      executions++;
      return route.fulfill({ json: await executor.execute(input) });
    });
    await page.goto("/editor");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const message = page.getByTestId("agent-copy-text");
    await expect(message).toHaveValue(/Claim: /, { timeout: 45000 });
    const claim = JSON.parse(
      /^Claim: (.+)$/mu.exec(await message.inputValue())![1]!,
    );
    const connect = async (args: unknown) => {
      child = startMcp(baseURL!, join(root, "connector.json"));
      await child.request("initialize", { protocolVersion: "2025-03-26" });
      child.notify("notifications/initialized");
      expect((await child.tool("connect", args)).ok).toBe(true);
    };
    await connect(claim);
    const created = await child!.tool("simulation_files", {
      request: { action: "create" },
    });
    expect(created.ok).toBe(true);
    const folder = createSimulationFolder({
      id: "large",
      name: "Large native",
      profileId: agentNativeProfile,
    });
    const source = agentNativeSource.replace(
      "endc",
      "analysis large tran stop=0.15 step=1u maxstep=1u\nendc",
    );
    const updated = await child!.tool("simulation_files", {
      request: {
        action: "update",
        owner: { kind: "session-workspace", workspaceId: created.workspace.id },
        expectedRevision: 0,
        entry: "main.sim",
        writes: [
          { path: "main.sim", text: source },
          ...folder.input.files.filter(
            (file) => file.path === folder.input.configPath,
          ),
        ],
      },
    });
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    const prepared = await child!.tool("simulation", {
      request: {
        operation: "prepare",
        source: {
          kind: "workspace",
          workspaceId: created.workspace.id,
          expectedRevision: 1,
        },
      },
    });
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    const started = await child!.tool("simulation", {
      request: {
        operation: "start",
        preparedId: prepared.prepared.id,
        digest: prepared.prepared.digest,
      },
    });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    let catalog: any;
    await expect
      .poll(
        async () => {
          const result = await child!.tool("simulation", {
            request: { operation: "catalog", runId: started.run.id },
          });
          catalog = result.catalog;
          return {
            execution: catalog?.execution,
            collection: catalog?.collection,
          };
        },
        { timeout: 60000 },
      )
      .toEqual({ execution: "completed", collection: "complete" });
    expect(catalog.collection).toBe("complete");
    const raw = catalog.files.find(
      (file: any) => file.name === "raw/large.raw",
    );
    expect(raw.byteLength).toBeGreaterThan(8 * 1024 * 1024);
    const resultFile = catalog.files.find(
      (file: any) => file.role === "result",
    );
    const syncRequest = {
      request: {
        action: "sync",
        runId: started.run.id,
        fileIds: [raw.fileId, resultFile.fileId],
      },
    };
    const downloaded = await child!.tool("simulation_files", syncRequest);
    expect(downloaded.ok, JSON.stringify(downloaded)).toBe(true);
    const path = downloaded.files[0].outputPath;
    const bytes = await readFile(path);
    expect(bytes.byteLength).toBe(raw.byteLength);
    // Download integrity is a transport requirement, not a build provenance hash.
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(raw.sha256);
    const localResult = JSON.parse(
      await readFile(downloaded.files[1].outputPath, "utf8"),
    );
    const transient = localResult.data.analyses.find(
      (analysis: any) => analysis.analysis === "tran",
    );
    const voltage = transient.probes.find(
      (probe: any) => probe.name === "mid",
    ).value;
    expect(voltage.length).toBeGreaterThanOrEqual(150000);
    expect(
      voltage.every((sample: number) => Math.abs(sample - 0.5) < 1e-9),
    ).toBe(true);
    await page.reload();
    await expect
      .poll(
        async () => {
          const result = await child!.tool("simulation", {
            request: { operation: "history" },
          });
          return result.runs?.some(
            (run: any) =>
              run.runId === started.run.id && run.storage === "persistent",
          );
        },
        { timeout: 45000 },
      )
      .toBe(true);
    await child!.close();
    await connect({});
    const reused = await child!.tool("simulation_files", syncRequest);
    expect(reused.ok, JSON.stringify(reused)).toBe(true);
    expect(reused.basePath).toBe(downloaded.basePath);
    expect(reused.files[0]).toMatchObject({ outputPath: path, reused: true });
    expect(reused.files.every((file: any) => file.reused)).toBe(true);
    await page.close();
    const offline = await child!.tool("simulation_files", {
      request: { action: "workspace" },
    });
    expect(offline.basePath).toBe(downloaded.basePath);
    expect(await readFile(path)).toEqual(bytes);
    expect(executions).toBe(1);
    await test.info().attach("large-native-local-receipt", {
      body: Buffer.from(
        JSON.stringify({
          rawBytes: bytes.byteLength,
          runId: started.run.id,
          reused: true,
          executions,
        }),
      ),
      contentType: "application/json",
    });
  } finally {
    await child?.close();
    await executor.close();
    await rm(root, { recursive: true, force: true });
  }
});

function startMcp(baseUrl: string, connectorPath: string) {
  const processHandle = spawn(
    process.execPath,
    [resolve(process.env.ICM_E2E_MCP_BUNDLE ?? "apps/mcp-server/dist/main.js")],
    {
      // The distributable must resolve itself without the repository as cwd.
      cwd: dirname(connectorPath),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ANALOG_CANVAS_API_URL: baseUrl,
        ANALOG_CANVAS_MCP_CONNECTOR: connectorPath,
      },
    },
  );
  let id = 0,
    buffer = "",
    stderr = "";
  const pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  processHandle.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(-4096);
  });
  const fail = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  processHandle.on("error", fail);
  processHandle.on("exit", (code) =>
    fail(new Error(`MCP exited ${code}: ${stderr}`)),
  );
  processHandle.stdout.on("data", (data) => {
    buffer += data.toString();
    for (let end; (end = buffer.indexOf("\n")) >= 0;) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const reply = JSON.parse(line);
        const item = pending.get(reply.id);
        if (!item) continue;
        pending.delete(reply.id);
        clearTimeout(item.timer);
        if (reply.error) item.reject(new Error(JSON.stringify(reply.error)));
        else item.resolve(reply.result);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
  const request = (method: string, params: unknown): Promise<any> =>
    new Promise((resolveRequest, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`MCP ${method} timed out: ${stderr}`));
      }, 40000);
      pending.set(requestId, { resolve: resolveRequest, reject, timer });
      processHandle.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
      );
    });
  return {
    request,
    notify(method: string) {
      processHandle.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method })}\n`,
      );
    },
    async tool(name: string, args: unknown) {
      const result = await request("tools/call", { name, arguments: args });
      // Ordinary errors are returned data, allowing same-session repair checks.
      return JSON.parse(result.content[0].text);
    },
    async close() {
      if (processHandle.exitCode !== null || processHandle.signalCode !== null)
        return;
      const exit = once(processHandle, "exit");
      const deadline = setTimeout(() => processHandle.kill("SIGKILL"), 5000);
      processHandle.stdin.end();
      try {
        await exit;
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}

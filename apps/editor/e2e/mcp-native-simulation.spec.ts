import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createSimulationFolder } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import { profile } from "./simulation-e2e-fixtures.js";
import { collectNativeRunEvidence } from "../../../scripts/lib/native-example-runner.mjs";
import { validatePinnedEnvironment } from "../../../scripts/lib/preview-simulation-validation-core.mjs";
import {
  agentNativeSource,
  agentNativeProfile,
  createAgentNativeExecutor,
} from "./native-simulation-executor.mjs";

// Opt-in: real stdio MCP + local Worker/DO + browser service + native process.
// No mocked Agent messages. Only the simulation executor boundary is isolated;
// the model-source journey may opt into a qualified HTTPS executor below.
test("packaged MCP applies native models and round-trips their mapped source through a real Editor", async ({
  page,
  baseURL,
}) => {
  const bundle = process.env.ICM_E2E_MCP_BUNDLE;
  test.skip(!bundle, "Requires an explicitly selected packaged MCP candidate");
  test.setTimeout(120_000);
  expect(
    createHash("sha256")
      .update(await readFile(bundle!))
      .digest("hex"),
  ).toBe(process.env.ICM_E2E_MCP_BUNDLE_SHA256);
  const root = await mkdtemp(join(tmpdir(), "icm-model-mcp-"));
  const executorOrigin = process.env.ICM_E2E_MODEL_NGSPICE_ORIGIN;
  if (executorOrigin) expect(new URL(executorOrigin).protocol).toBe("https:");
  let child: ReturnType<typeof startMcp> | undefined;
  try {
    // Default CI covers authoring. Opt-in additionally forwards the simulator
    // boundary to a qualified real executor; Editor, relay and MCP remain real.
    await page.route("**/api/simulate", async (route) => {
      if (executorOrigin) {
        const reply = await fetch(new URL("/api/simulate", executorOrigin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: route.request().postData(),
          signal: AbortSignal.timeout(60_000),
        });
        await route.fulfill({
          status: reply.status,
          contentType: "application/json",
          body: await reply.text(),
        });
        return;
      }
      expect(route.request().postDataJSON().operation).toBe("capabilities");
      await route.fulfill({
        json: {
          configured: true,
          rawfileCollection: "declared-single-ascii",
          maxOutputBytes: 1048576,
          inputs: ["source", "raw"],
          analyses: ["op", "ac", "tran", "noise"],
          parsedAnalyses: ["op", "ac", "tran", "noise"],
          profiles: [
            {
              id: profile.id,
              engine: "ngspice",
              corners: ["tt"],
              dependencies: [
                { id: profile.models.id, sha256: profile.models.contentSha256 },
              ],
            },
          ],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
    });
    await page.goto("/editor");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const message = page.getByTestId("agent-copy-text");
    await expect(message).toHaveValue(/Claim: /, { timeout: 45_000 });
    const claim = JSON.parse(
      /^Claim: (.+)$/mu.exec(await message.inputValue())![1]!,
    );
    child = startMcp(baseURL!, join(root, "connector.json"));
    await child.request("initialize", { protocolVersion: "2025-03-26" });
    child.notify("notifications/initialized");
    const connected = await child.tool("connect", claim);
    expect(connected.ok).toBe(true);
    expect(connected.compatibility).toMatchObject({
      status: "compatible",
      unsupportedEditKinds: [],
    });
    const code = await child.tool("project_code", { action: "read" });
    const project = parseProject(code.projectCode);
    const folder = createSimulationFolder({
      id: "models",
      name: "Models",
      engine: "ngspice",
      profileId: profile.id,
      documentId: project.topDocumentId,
    });
    folder.input.circuitBindings[0]!.emission = "top-level";
    const source = {
      id: "owned-model",
      language: "spice",
      entry: "amp.spice",
      revision: 0,
      dependencies: [],
      files: [
        {
          path: "amp.spice",
          text: ".subckt owned_amp A B\nR1 A B 1k\n.ends owned_amp\n",
        },
      ],
    };
    const applied = await child.tool("advanced_transact", {
      structureEdits: [
        {
          kind: "apply_model_source",
          source,
          definitions: [{ definitionId: "amp", entry: "owned_amp" }],
        },
        { kind: "upsert_simulation_folder", folder },
        {
          kind: "transact_document",
          documentId: project.topDocumentId,
          expectedRevision: project.documents[0]!.revision,
          edits: [
            {
              kind: "add_instance",
              instance: {
                id: "X1",
                reference: "X1",
                symbolId: externalSubcircuitSymbolId("amp"),
                placement: {
                  position: { x: 200, y: 200 },
                  rotation: 0,
                  mirror: "none",
                },
                netlist: {
                  binding: { kind: "external-subcircuit", definitionId: "amp" },
                  parameters: {},
                },
              },
            },
            ...["A", "B"].map((pinName) => ({
              kind: "add_no_connect",
              noConnect: {
                id: `nc-${pinName}`,
                endpoint: { kind: "terminal", instanceId: "X1", pinName },
              },
            })),
          ],
        },
      ],
    });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    const owner = { kind: "project-folder", folderId: folder.id };
    const path = folder.input.circuitBindings[0]!.path;
    const read = () =>
      child!.tool("simulation_source", {
        operation: "read",
        owner,
        path,
        detail: "mapped",
      });
    const first = await read();
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.modelSources).toEqual([
      expect.objectContaining({
        sourceId: source.id,
        revision: 1,
        path: "amp.spice",
      }),
    ]);
    const updated = await child.tool("simulation_edit", {
      operation: "update",
      owner,
      expectedRevision: first.revision,
      circuitEdits: [
        {
          path,
          textDigest: first.textDigest,
          text: first.text.replace("R1 A B 1k", "R1 A B 2k"),
        },
      ],
    });
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    const second = await read();
    expect(second.ok, JSON.stringify(second)).toBe(true);
    expect(second.text).toContain("R1 A B 2k");
    expect(second.modelSources[0]).toMatchObject({
      sourceId: source.id,
      revision: 2,
    });
    const saved = await child.tool("advanced_transact", {
      structureEdits: [
        {
          kind: "save_model_source_draft",
          sourceId: source.id,
          expectedRevision: 2,
          entry: "amp.spice",
          files: [{ path: "amp.spice", text: ".subckt unfinished" }],
          dependencies: [],
        },
      ],
    });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const withDraft = await read();
    expect(withDraft.ok, JSON.stringify(withDraft)).toBe(true);
    expect(withDraft.text).toContain("R1 A B 2k");
    const after = parseProject(
      (await child.tool("project_code", { action: "read" })).projectCode,
    );
    expect(after.modelSources![0]!.files[0]!.text).toContain("R1 A B 2k");
    expect(after.modelSources![0]!.draft!.files[0]!.text).toBe(
      ".subckt unfinished",
    );
    if (executorOrigin) {
      const call = /^X\S+\s+(\S+)\s+(\S+)\s+owned_amp(?:\s|$)/mu.exec(
        withDraft.text,
      );
      expect(call, withDraft.text).not.toBeNull();
      const stimulus = [
        "Owned model OP AC",
        '.include "circuit.spice"',
        `VINPUT ${call![1]} 0 dc 1 ac 1`,
        `VRETURN ${call![2]} 0 dc 0`,
        ".control",
        "set filetype=ascii",
        "set appendwrite",
        "op",
        "write out.raw i(vinput)",
        "ac dec 2 10 1000",
        "write out.raw i(vinput)",
        ".endc",
        ".end",
        "",
      ].join("\n");
      const written = await child.tool("simulation_files", {
        request: {
          action: "update",
          owner,
          expectedRevision: withDraft.revision,
          writes: [{ path: folder.input.entry, text: stimulus }],
        },
      });
      expect(written.ok, JSON.stringify(written)).toBe(true);
      const current = parseProject(
        (await child.tool("project_code", { action: "read" })).projectCode,
      );
      const prepared = await child.tool("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: folder.id,
            expectedStructureRevision: current.structureRevision,
          },
        },
      });
      expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      const started = await child.tool("simulation", {
        request: {
          operation: "start",
          preparedId: prepared.prepared.id,
          digest: prepared.prepared.digest,
        },
      });
      expect(started.ok, JSON.stringify(started)).toBe(true);
      let finished: any;
      await expect
        .poll(
          async () => {
            const reply = await child!.tool("simulation", {
              request: { operation: "read", runId: started.run.id },
            });
            expect(reply.ok, JSON.stringify(reply)).toBe(true);
            finished = reply.run;
            return finished.state;
          },
          { timeout: 30_000 },
        )
        .toBe("finished");
      expect(
        finished.result.outcome.status,
        JSON.stringify(finished.result.diagnostics),
      ).toBe("completed");
      validatePinnedEnvironment(
        finished.result.metadata.environment,
        "operator-host",
      );
      // Run reads are sample-free receipts; verify samples from their files.
      const catalog = await child.tool("simulation", {
        request: { operation: "catalog", runId: started.run.id },
      });
      expect(catalog.ok, JSON.stringify(catalog)).toBe(true);
      const downloaded: Record<string, string> = {};
      for (const name of [
        "result.json",
        "model-sources.json",
        "source-map.json",
      ]) {
        const artifact = catalog.catalog.files.find(
          (a: any) => a.name === name,
        );
        expect(artifact, name).toBeDefined();
        const outputPath = join(root, name);
        const reply = await child.tool("simulation_files", {
          request: { action: "artifact", artifactId: artifact.id },
          outputPath,
        });
        expect(reply.ok, JSON.stringify(reply)).toBe(true);
        const bytes = await readFile(outputPath);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          artifact.sha256,
        );
        downloaded[name] = bytes.toString("utf8");
        await test
          .info()
          .attach(name, { body: bytes, contentType: "application/json" });
      }
      expect(JSON.parse(downloaded["model-sources.json"]!)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: source.id,
            revision: 2,
            files: after.modelSources![0]!.files,
          }),
        ]),
      );
      expect(downloaded["source-map.json"]).toContain('"model-source"');
      const result = JSON.parse(downloaded["result.json"]!);
      const op = result.data.analyses.find((a: any) => a.analysis === "op");
      expect(
        op.probes.find((p: any) => p.name === "i(vinput)").value,
      ).toBeCloseTo(-0.0005, 10);
      expect(result.data.analyses.some((a: any) => a.analysis === "ac")).toBe(
        true,
      );
    }
    await test.info().attach("model-source-package", {
      body: Buffer.from(
        JSON.stringify({
          bundle: resolve(bundle!),
          sha256: process.env.ICM_E2E_MCP_BUNDLE_SHA256,
        }),
      ),
      contentType: "application/json",
    });
  } finally {
    await child?.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
            detail: "full",
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

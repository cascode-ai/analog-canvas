import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";

const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const { version: mcpVersion } = JSON.parse(
  await readFile(resolve("config/agent-mcp-distribution.json"), "utf8"),
);
const releaseRoot = resolve(
  `output/release/interactive-circuit-maker-v${version}`,
);
// Also verify the independently downloaded immutable release, not just a build.
const packagedExecutable = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      releaseRoot,
      JSON.parse(await readFile(resolve(releaseRoot, "release.json"), "utf8"))
        .mcp,
    );
const children = [];
const temporary = await mkdtemp(join(tmpdir(), "analog-mcp-smoke-"));
// The installed process gets neither a checkout nor workspace node_modules.
const executable = join(temporary, "analog-canvas-mcp.mjs");
await copyFile(packagedExecutable, executable);
const cliCwd = join(temporary, "unrelated-startup");
await mkdir(cliCwd);
const connectorPath = join(temporary, "connector.json");
const exportPath = join(temporary, "exported-project.json");
const importPath = join(temporary, "import-project.json");
await writeFile(importPath, "{}", "utf8");

const sessionId = "release-session";
const connectorToken = "release-connector-token";
let revision = 5;
let resumeCount = 0;
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8");
const projectBytes = Buffer.from('{"release":true}\n', "utf8");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const tableBytes = Buffer.from("time [s],v(out) [V]\n0,1\n1,2\n");
const tableArtifact = {
  id: "release-table",
  fileId: "release-table",
  name: "tran.csv",
  role: "table",
  mediaType: "text/csv",
  byteLength: tableBytes.byteLength,
  sha256: sha256(tableBytes),
};
const resultCatalog = {
  schemaVersion: 1,
  runId: "spec-run",
  preparedId: "spec-prepared",
  inputRevision: "spec-input",
  execution: "completed",
  collection: "complete",
  files: [tableArtifact],
  datasets: [
    {
      id: "tran-0",
      analysisIndex: 0,
      analysis: "tran",
      plotName: "Transient",
      pointCount: 2,
      axis: { name: "time", unit: "s" },
      signals: [{ name: "v(out)", unit: "V", quantity: "voltage" }],
      representations: [
        {
          artifactId: tableArtifact.id,
          fileId: tableArtifact.fileId,
          selector: "",
        },
      ],
    },
  ],
};
let tableDownloads = 0;

function credential(agentToken) {
  return {
    ok: true,
    sessionId,
    agentToken,
    tokenExpiresAt: Date.now() + 60 * 60_000,
    connectorToken,
    connectorExpiresAt: Date.now() + 24 * 60 * 60_000,
    scopes: [
      "circuit.snapshot",
      "circuit.render",
      "circuit.edit.geometry",
      "project.download",
      "project.import",
      "simulation.run",
    ],
    projectId: "release-project",
    documentIds: ["main"],
  };
}

function snapshot() {
  return {
    snapshotVersion: "3.0",
    electricalTopologyHash: "a".repeat(64),
    byteLength: 512,
    project: {
      id: "release-project",
      name: "Release Smoke",
      structureRevision: 0,
      simulationFolders: [],
      topDocumentId: "main",
      documents: [
        {
          id: "main",
          name: "Main",
          instanceCount: 0,
          netCount: 0,
          references: [],
        },
      ],
    },
    document: {
      id: "main",
      name: "Main",
      revision,
      sourceStatus: "in-sync",
      bounds: null,
      presentation: {
        styleProfileId: "razavi-textbook-v1",
        grid: 20,
        compactness: "normal",
      },
      // Schema 57 permits a formal terminal owned by a Power Label rather
      // than a placed Port instance. Keep this in the packaged smoke: 0.15.4
      // passed older fixtures but rejected this live Snapshot shape.
      cellInterface: {
        name: "Main",
        terminals: [
          {
            id: "release-vdd-terminal",
            name: "VDD",
            netId: "release-net",
            direction: "passive",
            interfaceInstanceIds: [],
            interfaceAnnotationId: "release-vdd-label",
          },
        ],
      },
      instances: [],
      nets: [
        {
          id: "release-net",
          name: null,
          scope: "local",
          powerDomain: "none",
          terminals: [],
          routeIds: ["release-route"],
          junctionIds: ["release-junction-start", "release-junction-end"],
        },
      ],
      routes: [
        {
          id: "release-route",
          netId: "release-net",
          start: { kind: "junction", junctionId: "release-junction-start" },
          legs: [
            {
              id: "release-route-leg",
              to: {
                kind: "endpoint",
                endpoint: {
                  kind: "junction",
                  junctionId: "release-junction-end",
                },
              },
              mode: "manual",
            },
          ],
          styleOverride: {
            color: "#123456",
            arrow: "end",
            lineStyle: "dashed",
          },
          polyline: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
      ],
      junctions: [
        {
          id: "release-junction-start",
          netId: "release-net",
          position: { x: 0, y: 0 },
          role: "route-anchor",
        },
        {
          id: "release-junction-end",
          netId: "release-net",
          position: { x: 100, y: 0 },
          role: "route-anchor",
        },
      ],
      noConnects: [],
      // Keep a schema-54 binding in every response, including connector resume.
      // Older packaged readers reject this field before ordinary tools can run.
      annotations: [
        {
          id: "release-vdd-label",
          kind: "power-label",
          binding: {
            kind: "cell-terminal-name",
            terminalId: "release-vdd-terminal",
          },
          netId: "release-net",
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          rotation: 0,
          alignment: "start",
          locked: false,
        },
        {
          id: "release-parameter-label",
          kind: "instance-value",
          binding: {
            kind: "instance-value",
            instanceId: "release-transformer",
            parameter: "k",
          },
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          rotation: 0,
          alignment: "start",
          locked: false,
          visible: false,
        },
        {
          id: "release-case-label",
          kind: "net-label",
          netId: "release-net",
          content: {
            runs: [
              {
                kind: "span",
                style: "uppercase",
                children: [{ kind: "text", value: "v" }],
              },
              {
                kind: "span",
                style: "lowercase",
                children: [{ kind: "text", value: "DD" }],
              },
            ],
          },
          anchor: { kind: "free", position: { x: 40, y: 0 } },
          rotation: 0,
          alignment: "start",
          locked: false,
        },
      ],
      drafting: {
        objects: [
          {
            object: {
              id: "release-arrow",
              kind: "arrow",
              locked: false,
              zIndex: 0,
              anchor: { kind: "free", position: { x: 0, y: 0 } },
              from: { kind: "free", position: { x: 0, y: 0 } },
              to: { kind: "free", position: { x: 100, y: 0 } },
              styleOverride: { arrowStart: "dot", arrowEnd: "open-arrow" },
            },
            resolvedGeometry: {
              kind: "arrow",
              from: { x: 0, y: 0 },
              to: { x: 100, y: 0 },
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
              vertices: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
              curveControls: [null],
              center: { x: 50, y: 0 },
              bounds: { x: 0, y: 0, width: 100, height: 0 },
              diagnostics: [],
            },
            diagnostics: [],
          },
        ],
      },
      layoutGroups: [],
      constraints: [],
      diagnostics: [],
    },
  };
}

function json(response, status = 200) {
  return { status, body: JSON.stringify(response) };
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const relay = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let result;
  if (
    url.pathname === `/api/agent/sessions/${sessionId}/artifacts/release-table`
  ) {
    tableDownloads++;
    const offset = Number(
      request.headers.range?.match(/^bytes=(\d+)-$/u)?.[1] ?? 0,
    );
    response.writeHead(offset ? 206 : 200, {
      "content-type": "text/csv",
      "content-length": tableBytes.byteLength - offset,
      ...(offset
        ? {
            "content-range": `bytes ${offset}-${tableBytes.byteLength - 1}/${tableBytes.byteLength}`,
          }
        : {}),
    });
    response.end(tableBytes.subarray(offset));
    return;
  } else if (url.pathname === "/api/agent/claims") {
    result = json(credential("claim-bearer"));
  } else if (url.pathname === "/api/agent/connectors/resume") {
    const body = await requestBody(request);
    if (
      body.sessionId !== sessionId ||
      body.connectorToken !== connectorToken
    ) {
      result = json(
        { error: { code: "CONNECTOR_INVALID", message: "invalid" } },
        401,
      );
    } else {
      resumeCount += 1;
      result = json(credential(`resume-bearer-${resumeCount}`));
    }
  } else if (url.pathname.endsWith("/status")) {
    result = json({
      ok: true,
      sessionId,
      projectId: "release-project",
      documentIds: ["main"],
      authorization: "active",
      editor: "attached",
      observedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
  } else if (url.pathname.endsWith("/simulation")) {
    const body = await requestBody(request);
    result =
      body.operation === "catalog"
        ? json({
            apiVersion: "3.0",
            requestId: body.requestId,
            operation: "catalog",
            ok: true,
            catalog: resultCatalog,
          })
        : body.operation === "capabilities"
          ? json({
              apiVersion: "3.0",
              requestId: body.requestId,
              operation: "capabilities",
              ok: true,
              capabilities: {
                configured: true,
                inputs: ["source"],
                analyses: ["op", "ac"],
                parsedAnalyses: ["op", "ac"],
                rawfileCollection: "native-multi-ascii",
                profiles: [
                  {
                    id: "native-release-fixture",
                    engine: "vacask",
                    corners: ["tt"],
                    dependencies: [
                      { id: "fixture-models", sha256: "c".repeat(64) },
                    ],
                    modelSymbols: [
                      {
                        dependencyId: "fixture-models",
                        sha256: "c".repeat(64),
                        section: "tt",
                        masters: [
                          {
                            name: "fixture_nfet",
                            primitives: [
                              { path: ["core"], module: "sp_bsim4v8" },
                            ],
                          },
                        ],
                      },
                    ],
                    modelLibrary: {
                      dependencyId: "fixture-models",
                      defaultSection: "tt",
                      defaultScale: 1e-6,
                    },
                  },
                ],
                maxInputBytes: 2097152,
                maxTimeoutMs: 120000,
                cancel: true,
              },
            })
          : json({
              apiVersion: "3.0",
              requestId: body.requestId,
              operation: "read",
              ok: true,
              run: {
                id: "spec-run",
                preparedId: "spec-prepared",
                inputRevision: "spec-input",
                state: "finished",
                artifacts: [],
                outputData: {
                  schemaVersion: 1,
                  analyses: [],
                  diagnostics: [],
                  specs: {
                    schemaVersion: 1,
                    runId: "spec-run",
                    preparedId: "spec-prepared",
                    inputDigest: "a".repeat(64),
                    results: [
                      {
                        id: "run.cir:2:1",
                        name: "peak",
                        group: "Bias checks",
                        occurrence: 1,
                        source: {
                          path: "run.cir",
                          line: 2,
                          text: "* @spec peak <= 1.8 unit=V",
                        },
                        unit: "V",
                        expected: { kind: "limit", operator: "<=", value: 1.8 },
                        value: 1.7,
                        judgment: "pass",
                        reason: "satisfied",
                        detail: "Meets the authored specification.",
                        logLine: 5,
                      },
                    ],
                  },
                },
              },
            });
  } else if (url.pathname.endsWith("/circuit")) {
    const body = await requestBody(request);
    if (body.operation === "capabilities") {
      result = json({
        apiVersion: "3.0",
        requestId: body.requestId,
        operation: "capabilities",
        ok: true,
        capabilities: {
          apiVersions: ["3.0"],
          snapshotVersions: ["3.0"],
          operations: ["capabilities", "snapshot", "transact", "render"],
          editKinds: ["add_instance"],
          permissions: {
            snapshot: true,
            render: true,
            sourceSpans: false,
            edit: { geometry: true, connectivity: true, presentation: true },
          },
          limits: {
            maxSnapshotBytes: 4_000_000,
            maxTransactionEdits: 64,
            maxRenderBytes: 1_000_000,
            maxRequestBytes: 256_000,
            changeHistoryEntries: 32,
          },
        },
      });
    } else if (body.operation === "snapshot") {
      result = json({
        apiVersion: "3.0",
        requestId: body.requestId,
        operation: "snapshot",
        ok: true,
        revision,
        snapshot: snapshot(),
        diagnostics: [],
      });
    } else if (body.operation === "transact") {
      const fromRevision = revision;
      if (!body.dryRun) revision += 1;
      result = json({
        apiVersion: "3.0",
        requestId: body.requestId,
        operation: "transact",
        ok: true,
        applied: !body.dryRun,
        revision,
        proposedRevision: body.dryRun ? revision + 1 : revision,
        diff: {
          documentId: "main",
          fromRevision,
          toRevision: revision,
          editKinds: ["add_instance"],
          changedObjectIds: body.dryRun ? [] : ["release-instance"],
        },
        diagnostics: [],
      });
    } else {
      result = json({
        apiVersion: "3.0",
        requestId: body.requestId,
        operation: "render",
        ok: true,
        revision,
        artifact: {
          mediaType: "image/svg+xml",
          encoding: "base64",
          data: svg.toString("base64"),
          sha256: sha256(svg),
          byteLength: svg.byteLength,
          mode: body.mode,
        },
        diagnostics: [],
      });
    }
  } else if (url.pathname.endsWith("/files")) {
    const body = await requestBody(request);
    if (
      body.operation === "simulation-input" &&
      body.input.action === "download"
    ) {
      result = json({
        apiVersion: "3.0",
        requestId: body.requestId,
        operation: "simulation-input",
        ok: true,
        result: {
          ok: true,
          artifact: tableArtifact,
          download: {
            path: `/api/agent/sessions/${sessionId}/artifacts/release-table`,
          },
        },
      });
    } else if (body.operation === "download") {
      result = json({
        apiVersion: "3.0",
        requestId: body.requestId,
        operation: "download",
        ok: true,
        artifact: {
          name: "release-project.json",
          mediaType: "application/json",
          encoding: "base64",
          data: projectBytes.toString("base64"),
          byteLength: projectBytes.byteLength,
          sha256: sha256(projectBytes),
        },
      });
    } else {
      result = json({
        apiVersion: "3.0",
        requestId: body.requestId,
        operation: "stage",
        ok: true,
        candidate: {
          candidateId: "release-candidate",
          kind: "project",
          expiresAt: "2026-08-15T00:00:00.000Z",
          projectName: "Imported",
          documentCount: 1,
          instanceCount: 0,
          diagnostics: [],
        },
      });
    }
  } else if (request.method === "DELETE") {
    result = json({ ok: true });
  } else {
    result = json({ error: { code: "NOT_FOUND", message: url.pathname } }, 404);
  }
  response.writeHead(result.status, { "content-type": "application/json" });
  response.end(result.body);
});
relay.listen(0, "127.0.0.1");
await once(relay, "listening");
const address = relay.address();
if (typeof address === "string" || address === null)
  throw new Error("No relay port");
const apiBaseUrl = `http://127.0.0.1:${address.port}`;

async function httpCommand(command, input = {}) {
  const child = spawn(process.execPath, [executable, "--http", command], {
    cwd: cliCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ANALOG_CANVAS_API_URL: apiBaseUrl,
      ANALOG_CANVAS_MCP_CONNECTOR: connectorPath,
      LOCALAPPDATA: join(temporary, "data"),
      XDG_DATA_HOME: join(temporary, "data"),
      ANALOG_CANVAS_TASK_DIR: join(temporary, "task"),
    },
    timeout: 30_000,
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.resume();
  const closed = once(child, "close");
  child.stdin.end(JSON.stringify(input));
  const [code] = await closed;
  assert.equal(code, 0, "Direct HTTP command failed");
  assert.ok(
    !output.includes(connectorToken),
    "HTTP output leaked the connector",
  );
  return JSON.parse(output);
}

function startMcp() {
  const child = spawn(process.execPath, [executable], {
    cwd: temporary,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ANALOG_CANVAS_API_URL: apiBaseUrl,
      ANALOG_CANVAS_MCP_CONNECTOR: connectorPath,
      LOCALAPPDATA: join(temporary, "data"),
      XDG_DATA_HOME: join(temporary, "data"),
      ANALOG_CANVAS_TASK_DIR: join(temporary, "task"),
    },
  });
  children.push(child);
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          message.error
            ? waiter.reject(message.error)
            : waiter.resolve(message.result);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolveRequest, reject) => {
      pending.set(id, { resolve: resolveRequest, reject });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`,
      );
    });
  };
  const tool = async (name, args = {}) => {
    const result = await request("tools/call", { name, arguments: args });
    if (result.isError)
      throw new Error(result.content[0]?.text ?? `${name} failed`);
    return JSON.parse(result.content[0].text);
  };
  return {
    child,
    request,
    tool,
    close: async () => {
      child.stdin.end();
      await once(child, "exit");
      if (pending.size) throw new Error("MCP exited with pending requests");
    },
  };
}

try {
  const first = startMcp();
  const initialized = await first.request("initialize", {
    protocolVersion: "2025-03-26",
  });
  assert.equal(
    initialized.serverInfo.version,
    mcpVersion,
    "MCP runtime must match the declared distribution version",
  );
  const localStatus = await first.tool("connection_status", { refresh: false });
  assert.deepEqual(localStatus.runtime, { version: mcpVersion, apiBaseUrl });
  const listed = await first.request("tools/list");
  if (
    !JSON.stringify(
      listed.tools.find((tool) => tool.name === "apply_actions"),
    ).includes("showParameters")
  )
    throw new Error(
      "Packaged MCP is missing independent parameter display controls",
    );
  if (
    listed.tools.length !== 36 ||
    ![
      "project_cells",
      "gallery_circuits",
      "project_code",
      "netlist_code",
      "simulation",
      "simulation_folder",
      "simulation_output",
      "simulation_measurement",
      "simulation_device_operating_point",
      "simulation_files",
      "describe_tool",
      "simulation_source",
      "simulation_edit",
      "simulation_data",
      "simulation_plot",
      "simulation_results",
      "simulation_run",
      "simulation_batch",
      "circuit_place",
      "circuit_wire",
      "circuit_transform",
      "circuit_selection",
      "circuit_text",
      "circuit_properties",
    ].every((name) => listed.tools.some((tool) => tool.name === name))
  )
    throw new Error("Packaged MCP tool surface mismatch");
  const formats = await first.tool("describe_tool", {
    tool: "simulation_plot",
    field: "/request/formats",
  });
  assert.equal(formats.contractVersion, mcpVersion);
  assert.deepEqual(formats.variants[0].schema.items.enum, [
    "png",
    "svg",
    "pdf",
  ]);
  const edits = await first.tool("describe_tool", {
    editKind: "set_cell_symbol_presentation",
  });
  assert.equal(edits.inputSchema["x-transaction"].form, "structureEdits");
  await first.tool("connect", { claimCode: `${sessionId}.claim` });
  const patches = await first.tool("describe_tool", {
    tool: "simulation_edit",
    field: "/request/patches",
  });
  assert.equal(patches.variants[0].required, false);
  const plot = await first.tool("simulation_plot", {
    request: {
      action: "prepare-plot",
      runId: "spec-run",
      name: "release-plot",
      formats: ["png", "svg"],
      panels: [
        { analysisIndex: 0, signals: [{ signal: "v(out)" }], xRange: [0, 1] },
      ],
    },
  });
  assert.equal(plot.imageStatus, "not-generated");
  assert.equal(plot.dataStatus, "complete");
  assert(plot.directory.startsWith(join(temporary, "task", ".analog-canvas")));
  const base = await first.tool("simulation_data", {
    request: { action: "workspace" },
  });
  const sync = await first.tool("simulation_data", {
    request: { action: "sync", runId: "spec-run" },
  });
  assert.equal(sync.transfer.reused, 1);
  assert.equal(tableDownloads, 1);
  const nativeCapabilities = await first.tool("simulation_run", {
    request: { operation: "capabilities" },
  });
  assert.equal(
    nativeCapabilities.ok,
    true,
    `Packaged MCP rejected native Profile capabilities: ${JSON.stringify(nativeCapabilities)}`,
  );
  assert.equal(
    nativeCapabilities.capabilities.profiles[0].modelLibrary.defaultScale,
    1e-6,
  );
  assert.equal(
    nativeCapabilities.capabilities.profiles[0].modelSymbols[0].masters[0]
      .primitives[0].module,
    "sp_bsim4v8",
  );
  const simulation = await first.tool("simulation_run", {
    request: { operation: "read", runId: "spec-run" },
  });
  assert.equal(
    simulation.ok,
    true,
    "Packaged MCP rejected the current Simulation response",
  );
  assert.equal(simulation.run.outputData.specs.results[0].judgment, "pass");
  assert.equal(simulation.run.outputData.specs.results[0].value, 1.7);
  assert.equal(simulation.run.outputData.specs.results[0].group, "Bias checks");
  assert.deepEqual(simulation.run.outputData.analyses, []);
  const resources = await first.request("resources/list");
  assert(
    resources.resources.some(
      (r) => r.uri === "analog-canvas://reference/simulation-specs",
    ),
    "Packaged MCP is missing the Spec reference",
  );
  assert(
    listed.tools
      .find((t) => t.name === "export_file")
      .description.includes("SIMULATION_PLOT_RETIRED"),
    "Packaged MCP still advertises a retired renderer",
  );
  const invalidSimulation = await first.request("tools/call", {
    name: "simulation",
    arguments: { request: { operation: "prepare" } },
  });
  if (!invalidSimulation.isError)
    throw new Error(
      "Packaged simulation tool did not validate its shared input contract",
    );
  // The next ordinary call must still work after a recoverable tool failure.
  await first.tool("get_context");
  await first.tool("advanced_transact", {
    edits: [
      {
        kind: "upsert_schematic_annotation",
        annotation: snapshot().document.annotations[0],
      },
      {
        kind: "upsert_drafting_object",
        object: snapshot().document.drafting.objects[0].object,
      },
      {
        kind: "set_route_style_override",
        routeId: "release-route",
        styleOverride: {
          color: "#123456",
          arrow: "end",
          lineStyle: "dotted",
        },
      },
    ],
  });
  await first.tool("circuit_place", {
    actions: [
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 200, y: 200 },
      },
    ],
  });
  await first.tool("verify");
  await first.tool("render");
  await first.tool("export_file", {
    artifact: "project",
    outputPath: exportPath,
  });
  await first.tool("import_file", {
    action: "stage-project",
    path: importPath,
  });
  await first.close();

  // Browser activity can renew the server deadline without updating this file.
  // Only the server may decide that a stored connector is no longer resumable.
  const savedConnector = JSON.parse(await readFile(connectorPath, "utf8"));
  savedConnector.connectorExpiresAt = Date.now() - 60_000;
  await writeFile(connectorPath, JSON.stringify(savedConnector), "utf8");

  const restarted = startMcp();
  await restarted.request("initialize", { protocolVersion: "2025-03-26" });
  const resumed = await restarted.tool("connect");
  if (resumed.mode !== "resumed" || resumeCount !== 1) {
    throw new Error("Packaged MCP did not resume the saved connector");
  }
  const observed = await httpCommand("connection_status");
  assert.equal(JSON.parse(observed.content[0].text).state, "attached");
  const raw = await httpCommand("circuit", {
    apiVersion: "3.0",
    requestId: "http-smoke-exact-id",
    operation: "snapshot",
    documentId: "main",
  });
  assert.equal(raw.requestId, "http-smoke-exact-id");
  assert.equal(raw.ok, true);
  assert.equal(resumeCount, 3, "HTTP invocations must reuse the MCP connector");
  const context = await httpCommand("get_context");
  assert.equal(context.isError, undefined, JSON.stringify(context));
  assert.equal(JSON.parse(context.content[0].text).documentId, "main");
  assert.equal(
    resumeCount,
    4,
    "A fresh get_context must resume without another claim",
  );
  const cliSync = JSON.parse(
    (
      await httpCommand("simulation_data", {
        request: { action: "sync", runId: "spec-run" },
      })
    ).content[0].text,
  );
  assert.equal(cliSync.basePath, base.basePath);
  assert.equal(cliSync.transfer.reused, 1);
  assert.equal(
    tableDownloads,
    1,
    "Fresh CLI must reuse the installed MCP's data despite a different cwd",
  );
  await restarted.tool("disconnect");
  await restarted.close();
  if ((await readFile(connectorPath).catch(() => null)) !== null) {
    throw new Error("Packaged MCP disconnect did not remove the connector");
  }
  if ((await readFile(exportPath, "utf8")) !== projectBytes.toString("utf8")) {
    throw new Error("Packaged MCP export did not preserve file bytes");
  }
  // No connector or network is needed to edit and execute the local plot copy.
  await writeFile(
    plot.scriptPath,
    (await readFile(plot.scriptPath, "utf8")) +
      "\n# Local user customization\n",
  );
  const offlineBase = JSON.parse(
    (
      await httpCommand("simulation_data", {
        request: { action: "workspace" },
        basePath: base.basePath,
      })
    ).content[0].text,
  );
  assert.equal(offlineBase.basePath, base.basePath);
  const python = process.env.ANALOG_CANVAS_SMOKE_PYTHON;
  if (python) {
    execFileSync(python, plot.execution.check.args, {
      cwd: cliCwd,
      stdio: "pipe",
    });
    execFileSync(python, plot.execution.args, { cwd: cliCwd, stdio: "pipe" });
    assert.equal(
      (await readFile(join(plot.directory, "figure.png")))
        .subarray(0, 8)
        .toString("hex"),
      "89504e470d0a1a0a",
    );
    assert(
      (await readFile(join(plot.directory, "figure.svg"), "utf8")).includes(
        "<svg",
      ),
    );
    process.stdout.write(
      "Installed-package offline PNG/SVG execution passed.\n",
    );
  } else
    process.stdout.write(
      "Plot files prepared; image execution not tested (set ANALOG_CANVAS_SMOKE_PYTHON).\n",
    );
  process.stdout.write("Packaged MCP release smoke passed.\n");
} finally {
  // A compatibility rejection must fail promptly, including when testing an
  // old downloaded executable; never leave its stdio process holding the relay.
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  relay.close();
  await once(relay, "close");
  await rm(temporary, { recursive: true, force: true });
}

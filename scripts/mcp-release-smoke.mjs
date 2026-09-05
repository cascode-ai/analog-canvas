import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const releaseRoot = resolve(
  `output/release/interactive-circuit-maker-v${version}`,
);
const metadata = JSON.parse(
  await readFile(resolve(releaseRoot, "release.json"), "utf8"),
);
const executable = resolve(releaseRoot, metadata.mcp);
const temporary = await mkdtemp(join(tmpdir(), "analog-mcp-smoke-"));
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
    ],
    projectId: "release-project",
    documentIds: ["main"],
  };
}

function snapshot() {
  return {
    snapshotVersion: "2.0",
    electricalTopologyHash: "a".repeat(64),
    byteLength: 512,
    project: {
      id: "release-project",
      name: "Release Smoke",
      structureRevision: 0,
      simulation: null,
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
      cellInterface: null,
      instances: [],
      nets: [],
      routes: [],
      junctions: [],
      noConnects: [],
      annotations: [],
      drafting: { objects: [] },
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
  if (url.pathname === "/api/agent/claims") {
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
  } else if (url.pathname.endsWith("/circuit")) {
    const body = await requestBody(request);
    if (body.operation === "capabilities") {
      result = json({
        apiVersion: "2.0",
        requestId: body.requestId,
        operation: "capabilities",
        ok: true,
        capabilities: {
          apiVersions: ["2.0"],
          snapshotVersions: ["2.0"],
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
        apiVersion: "2.0",
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
        apiVersion: "2.0",
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
        apiVersion: "2.0",
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
    if (body.operation === "download") {
      result = json({
        apiVersion: "2.0",
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
        apiVersion: "2.0",
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

function startMcp() {
  const child = spawn(process.execPath, [executable], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ANALOG_CANVAS_API_URL: apiBaseUrl,
      ANALOG_CANVAS_MCP_CONNECTOR: connectorPath,
    },
  });
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
  await first.request("initialize", { protocolVersion: "2025-03-26" });
  const listed = await first.request("tools/list");
  if (
    listed.tools.length !== 14 ||
    !["simulation", "simulation_files"].every((name) =>
      listed.tools.some((tool) => tool.name === name),
    )
  )
    throw new Error("Packaged MCP tool surface mismatch");
  await first.tool("connect", { claimCode: `${sessionId}.claim` });
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
  await first.tool("apply_actions", {
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

  const restarted = startMcp();
  await restarted.request("initialize", { protocolVersion: "2025-03-26" });
  const resumed = await restarted.tool("connect");
  if (resumed.mode !== "resumed" || resumeCount !== 1) {
    throw new Error("Packaged MCP did not resume the saved connector");
  }
  await restarted.tool("disconnect");
  await restarted.close();
  if ((await readFile(connectorPath).catch(() => null)) !== null) {
    throw new Error("Packaged MCP disconnect did not remove the connector");
  }
  if ((await readFile(exportPath, "utf8")) !== projectBytes.toString("utf8")) {
    throw new Error("Packaged MCP export did not preserve file bytes");
  }
  process.stdout.write("Packaged MCP release smoke passed.\n");
} finally {
  relay.close();
  await once(relay, "close");
  await rm(temporary, { recursive: true, force: true });
}

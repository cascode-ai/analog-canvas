// The packaged MCP release, checked as users get it: one file copied away
// from any checkout and node_modules. It must start, report the declared
// version, and offer exactly the tools, contracts and resources the
// workspace build does, through MCP and through its one-shot command line.
//
// It talks to no editor: what the tools do is tested on source, and a
// release candidate is paired with Production before it is published.
//
//   node scripts/mcp-release-smoke.mjs [packaged-executable]
//
// after `pnpm build` and `node scripts/package-mcp.mjs`, then
// `node scripts/package-release.mjs` when no executable is given.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const { version: mcpVersion } = JSON.parse(
  await readFile(resolve("config/agent-mcp-distribution.json"), "utf8"),
);
const releaseRoot = resolve(`output/release/analog-canvas-v${version}`);
// Also verify an independently downloaded release, not just a build.
const packagedExecutable = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      releaseRoot,
      JSON.parse(await readFile(resolve(releaseRoot, "release.json"), "utf8"))
        .mcp,
    );
const workspaceExecutable = resolve("apps/mcp-server/dist/main.js");

const temporary = await mkdtemp(join(tmpdir(), "analog-mcp-smoke-"));
const executable = join(temporary, "analog-canvas-mcp.mjs");
await copyFile(packagedExecutable, executable);
const env = {
  ...process.env,
  // Nothing here needs the network; an address nothing answers on keeps
  // a stray request from reaching a real site.
  ANALOG_CANVAS_API_URL: "http://127.0.0.1:9",
  ANALOG_CANVAS_MCP_CONNECTOR: join(temporary, "connector.json"),
  LOCALAPPDATA: join(temporary, "data"),
  XDG_DATA_HOME: join(temporary, "data"),
  ANALOG_CANVAS_TASK_DIR: join(temporary, "task"),
};

/** Start one MCP over stdio and read what it offers. */
async function offered(file, cwd) {
  const child = spawn(process.execPath, [file], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const timer = setTimeout(() => child.kill(), 60_000);
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (
      let newline = buffer.indexOf("\n");
      newline >= 0;
      newline = buffer.indexOf("\n")
    ) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
  });
  const exited = once(child, "exit");
  const request = (method, params) =>
    new Promise((resolveRequest, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolveRequest, reject });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`,
      );
    });
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-03-26",
    });
    const { tools } = await request("tools/list");
    const { resources } = await request("resources/list");
    const contents = [];
    for (const { uri } of resources)
      contents.push(...(await request("resources/read", { uri })).contents);
    return {
      version: initialized.serverInfo.version,
      tools,
      resources,
      contents,
    };
  } finally {
    child.stdin.end();
    await exited;
    clearTimeout(timer);
  }
}

/** The one-shot command line an Agent without MCP support runs. */
async function connectionStatus() {
  const child = spawn(
    process.execPath,
    [executable, "--http", "connection_status"],
    {
      cwd: temporary,
      env,
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 60_000,
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  const closed = once(child, "close");
  child.stdin.end(JSON.stringify({ refresh: false }));
  const [code] = await closed;
  assert.equal(code, 0, `connection_status failed: ${output}`);
  return JSON.parse(JSON.parse(output).content[0].text);
}

try {
  const packaged = await offered(executable, temporary);
  assert.equal(
    packaged.version,
    mcpVersion,
    "The packaged MCP must report the declared distribution version",
  );
  const workspace = await offered(workspaceExecutable, resolve("."));
  assert.deepEqual(
    packaged.tools,
    workspace.tools,
    "The packaged MCP must offer the workspace build's tools and contracts",
  );
  assert.deepEqual(
    packaged.resources,
    workspace.resources,
    "The packaged MCP must list the workspace build's resources",
  );
  assert.deepEqual(
    packaged.contents,
    workspace.contents,
    "The packaged MCP must carry the workspace build's resource contents",
  );
  const status = await connectionStatus();
  assert.equal(status.state, "unpaired");
  assert.equal(
    status.runtime.version,
    mcpVersion,
    "The packaged command line must report the declared version",
  );
  process.stdout.write(
    `Packaged MCP ${mcpVersion} starts on its own and offers ${packaged.tools.length} tools and ${packaged.resources.length} resources, as the workspace build does.\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

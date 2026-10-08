#!/usr/bin/env node
import { McpStdioServer } from "./protocol.js";
import { assembleServer } from "./server.js";
import { createInterface } from "node:readline";
import {
  httpCommandFailureMessage,
  httpCommandReadsStdin,
  runHttpBatch,
  runHttpCommand,
} from "./http-cli.js";
import { installMcp } from "./install.js";
import {
  createOperationSession,
  type OperationSession,
} from "./operation-session.js";
import {
  openLocalMode,
  parseLocalArguments,
  releaseOnExit,
  type LocalArguments,
  type LocalMode,
} from "./local-mode.js";
import { z } from "zod";

// zod declares itself free of side effects, so the release bundle dropped its
// English messages and most input errors read only "Invalid input" (#1525).
z.config(z.locales.en());

if (process.argv[2] === "--install") {
  try {
    process.stdout.write(
      `${JSON.stringify(await installMcp(process.argv.slice(3)), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `MCP installation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
} else if (process.argv[2] === "--local") {
  await runLocal(process.argv.slice(3));
} else if (process.argv[2] === "--http") {
  await runHttp(
    () => createOperationSession(undefined, { shortLived: true }),
    process.argv[3] ?? "connection_status",
  );
} else {
  await serve(assembleServer());
}

/** `--http batch`, or one `--http <command>` with its arguments on stdin. */
async function runHttp(
  toolSession: () => OperationSession,
  command: string,
): Promise<void> {
  if (command === "batch") {
    try {
      const failed = await runHttpBatch(
        { toolSession: toolSession() },
        createInterface({ input: process.stdin, crlfDelay: Infinity }),
        (line) => process.stdout.write(`${line}\n`),
      );
      if (failed) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${httpCommandFailureMessage(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }
  try {
    let input = "";
    if (httpCommandReadsStdin(command)) {
      process.stdin.setEncoding("utf8");
      for await (const chunk of process.stdin) {
        input += chunk;
        if (Buffer.byteLength(input) > 32_000_000)
          throw new Error("Input too large");
      }
    }
    const result = await runHttpCommand(
      { toolSession: toolSession() },
      command,
      input,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (
      typeof result === "object" &&
      result !== null &&
      (("isError" in result && result.isError) ||
        ("ok" in result && result.ok === false))
    )
      process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${httpCommandFailureMessage(error)}\n`);
    process.exitCode = 1;
  }
}

async function serve({
  handler,
  serverInfo,
}: ReturnType<typeof assembleServer>): Promise<void> {
  const server = new McpStdioServer(handler, {
    serverInfo,
    log: (message) => {
      process.stderr.write(`[analog-canvas-mcp] ${message}\n`);
    },
  });
  await server.run();
}

/**
 * `--local <dir> …` (#1498): the stdio server, or one `--http` command, on
 * a workspace's Project file, whose lock this process holds until it ends.
 */
async function runLocal(args: readonly string[]): Promise<void> {
  const failed = (error: unknown) => {
    process.stderr.write(
      `Local workspace: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  };
  let options: LocalArguments;
  let mode: LocalMode;
  try {
    options = parseLocalArguments(args);
    mode = await openLocalMode(options);
  } catch (error) {
    failed(error);
    return;
  }
  const undo = releaseOnExit(mode);
  try {
    if (options.http) await runHttp(() => mode.session, options.http);
    else await serve(assembleServer(undefined, mode.session));
  } finally {
    await mode.close().catch(failed);
    undo();
  }
}

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
import { createOperationSession } from "./operation-session.js";
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
} else {
  if (process.argv[2] === "--http" && process.argv[3] === "batch") {
    try {
      const failed = await runHttpBatch(
        {
          toolSession: createOperationSession(undefined, { shortLived: true }),
        },
        createInterface({ input: process.stdin, crlfDelay: Infinity }),
        (line) => process.stdout.write(`${line}\n`),
      );
      if (failed) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${httpCommandFailureMessage(error)}\n`);
      process.exitCode = 1;
    }
  } else if (process.argv[2] === "--http") {
    try {
      const command = process.argv[3] ?? "connection_status";
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
        {
          toolSession: createOperationSession(undefined, { shortLived: true }),
        },
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
  } else {
    const { handler, serverInfo } = assembleServer();
    const server = new McpStdioServer(handler, {
      serverInfo,
      log: (message) => {
        process.stderr.write(`[analog-canvas-mcp] ${message}\n`);
      },
    });
    await server.run();
  }
}

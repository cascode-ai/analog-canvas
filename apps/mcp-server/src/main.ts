#!/usr/bin/env node
import { McpStdioServer } from "./protocol.js";
import { assembleServer } from "./server.js";
import { runHttpCommand } from "./http-cli.js";
import { installMcp } from "./install.js";
import { createOperationSession } from "./operation-session.js";

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
  if (process.argv[2] === "--http") {
    try {
      let input = "";
      process.stdin.setEncoding("utf8");
      for await (const chunk of process.stdin) {
        input += chunk;
        if (Buffer.byteLength(input) > 32_000_000)
          throw new Error("Input too large");
      }
      const result = await runHttpCommand(
        { toolSession: createOperationSession() },
        process.argv[3] ?? "connection_status",
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
    } catch {
      process.stderr.write(
        "HTTP client command failed. Check the command, published schema, and connection status.\n",
      );
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

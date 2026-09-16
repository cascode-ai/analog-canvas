import { spawn } from "node:child_process";

/** Real MCP handshake, never an HTTP fallback. No Claim, connector, or relay needed. */
export function probeInstalledMcp(
  command: string,
  executable: string,
  version: string,
) {
  return new Promise<{ version: string; toolCount: number }>(
    (resolve, reject) => {
      const child = spawn(command, [executable], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        // An unreachable origin proves that local readiness is not remote pairing.
        env: { ...process.env, ANALOG_CANVAS_API_URL: "http://127.0.0.1:1" },
      });
      let buffer = "",
        bytes = 0,
        success: { version: string; toolCount: number } | undefined;
      let failure: Error | undefined;
      const timer = setTimeout(
        () => finish(Error("MCP initialize/tools/list timed out")),
        10000,
      );
      function finish(error?: Error) {
        if (error && !failure) failure = error;
        child.stdin.end();
        if (error) child.kill();
      }
      function send(message: unknown) {
        child.stdin.write(JSON.stringify(message) + "\n");
      }
      child.stderr.resume();
      child.stdin.on("error", (error) => finish(error));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("spawn", () =>
        send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "analog-canvas-installer", version: "1" },
          },
        }),
      );
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 4_000_000) {
          finish(Error("MCP startup response too large"));
          return;
        }
        buffer += chunk;
        while (buffer.includes("\n")) {
          const at = buffer.indexOf("\n");
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          try {
            const message = JSON.parse(line);
            if (message.error)
              throw Error("MCP startup returned a protocol error");
            if (message.id === 1) {
              if (
                message.result?.serverInfo?.name !== "analog-canvas" ||
                message.result?.serverInfo?.version !== version
              )
                throw Error(
                  `MCP runtime identity does not match installed version ${version}`,
                );
              send({ jsonrpc: "2.0", method: "notifications/initialized" });
              send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
            } else if (message.id === 2) {
              const names = message.result?.tools?.map(
                (tool: { name: string }) => tool.name,
              );
              if (
                !Array.isArray(names) ||
                ![
                  "connect",
                  "connection_status",
                  "get_context",
                  "simulation",
                ].every((n) => names.includes(n))
              )
                throw Error("MCP tools are incomplete");
              success = { version, toolCount: names.length };
              finish();
            }
          } catch (error) {
            finish(
              error instanceof Error
                ? error
                : Error("Invalid MCP startup response"),
            );
          }
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (code !== 0 || !success)
          reject(Error("MCP exited before local readiness"));
        else resolve(success);
      });
    },
  );
}

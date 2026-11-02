import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";

export function startMcp(baseUrl: string, connectorPath: string) {
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

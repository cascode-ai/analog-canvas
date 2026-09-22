import { describe, expect, it, vi } from "vitest";
import { assembleServer } from "./server.js";
import { runHttpCommand } from "./http-cli.js";
import { executeOperation, operationDefinitions } from "./operations.js";

describe("HTTP executable adapter", () => {
  it("keeps one operation inventory and the same structured failures for both adapters", async () => {
    const server = assembleServer({
      apiBaseUrl: "https://relay.test",
      connectorPath: "unused.json",
    });
    expect(server.handler.listTools().map((t) => t.name)).toEqual(
      operationDefinitions().map((t) => t.name),
    );
    for (const [name, args] of [
      [
        "describe_tool",
        {
          tool: "simulation_edit",
          operations: ["update"],
          field: "/request/patches",
        },
      ],
      [
        "simulation_plot",
        {
          request: {
            action: "prepare-plot",
            runId: "run",
            name: "test",
            panels: [
              {
                analysisIndex: 0,
                signals: [{ signal: "v(out)" }],
                xRange: [1, 2, 3],
              },
            ],
          },
        },
      ],
      ["circuit_wire", { actions: [{ kind: "connect" }] }],
      ["missing-tool", {}],
    ] as const) {
      const plain = await executeOperation(name, args, server.toolSession);
      const mcp = await server.handler.callTool(name, args);
      const cli = await runHttpCommand(server, name, JSON.stringify(args));
      expect(cli).toEqual(mcp);
      expect(JSON.parse(mcp.content[0]!.text!)).toEqual(plain);
    }
  });
  it("executes shared operations without calling the MCP handler", async () => {
    const server = assembleServer({
      apiBaseUrl: "https://relay.test",
      connectorPath: "unused.json",
    });
    const mcpCall = vi.spyOn(server.handler, "callTool");
    const call = vi
      .spyOn(server.toolSession.client, "connect")
      .mockRejectedValue(new Error("sentinel"));
    await runHttpCommand(server, "connect", '{"claimCode":"one-time"}');
    expect(call).toHaveBeenCalledWith("one-time");
    expect(mcpCall).not.toHaveBeenCalled();
    expect(await runHttpCommand(server, "list-tools", "")).toEqual(
      server.handler.listTools(),
    );
    expect(
      await runHttpCommand(
        server,
        "resource",
        "analog-canvas://reference/quickstart",
      ),
    ).toEqual(
      server.handler.readResource("analog-canvas://reference/quickstart"),
    );
  });
  it("passes canonical requests unchanged to the shared client", async () => {
    const server = assembleServer({
      apiBaseUrl: "https://relay.test",
      connectorPath: "unused.json",
    });
    const request = vi
      .spyOn(server.toolSession.client, "request")
      .mockRejectedValue(new Error("test sentinel"));
    const input = {
      apiVersion: "3.0",
      operation: "snapshot",
      documentId: "main",
      requestId: "stable-id",
    };
    await expect(
      runHttpCommand(server, "circuit", JSON.stringify(input)),
    ).rejects.toThrow("test sentinel");
    expect(request).toHaveBeenCalledWith(input);
  });
});

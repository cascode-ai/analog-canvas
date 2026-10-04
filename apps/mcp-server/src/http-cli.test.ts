import { describe, expect, it, vi } from "vitest";
import { assembleServer } from "./server.js";
import {
  httpCommandFailureMessage,
  httpCommandReadsStdin,
  runHttpBatch,
  runHttpCommand,
} from "./http-cli.js";
import { executeOperation, operationDefinitions } from "./operations.js";

describe("HTTP executable adapter", () => {
  it("does not wait for stdin on argument-less discovery", () => {
    expect(httpCommandReadsStdin("list-tools")).toBe(false);
    expect(httpCommandReadsStdin("resource")).toBe(true);
    expect(httpCommandReadsStdin("circuit_place")).toBe(true);
  });
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
  it("prints what went wrong, masking anything shaped like a credential", async () => {
    const server = assembleServer({
      apiBaseUrl: "https://relay.test",
      connectorPath: "unused.json",
    });
    const failure = async (command: string, input: string) => {
      try {
        await runHttpCommand(server, command, input);
      } catch (error) {
        return httpCommandFailureMessage(error);
      }
      throw new Error("The command did not fail");
    };
    // `vdd` is no symbol; the ID is `vdd-port`.
    expect(
      await failure(
        "resource",
        "analog-canvas://catalog/builtins?symbols=nmos,vdd",
      ),
    ).toBe(
      'HTTP client command failed: Unknown symbol ID "vdd"; inspect the full catalog to discover symbols (-32602)',
    );
    expect(await failure("circuit_place", "{ not json")).toMatch(
      /^HTTP client command failed: .*JSON/u,
    );
    const secret = "3f2a9c1e-7b4d-4e8f-9a0b-1c2d3e4f5a6b";
    expect(
      httpCommandFailureMessage(
        Object.assign(
          new Error(`Rejected Bearer ${secret} for session ${secret}`),
          { code: "UNAUTHORIZED" },
        ),
      ),
    ).toBe(
      "HTTP client command failed: Rejected Bearer [redacted] for session [redacted] (UNAUTHORIZED)",
    );
    expect(httpCommandFailureMessage("thrown text")).toBe(
      "HTTP client command failed. Check the command, published schema, and connection status.",
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

describe("--http batch (#1227)", () => {
  async function* lines(...values: string[]) {
    for (const value of values) yield value;
  }
  it("answers each JSON line in order on one session, and counts failures", async () => {
    const server = assembleServer({
      apiBaseUrl: "https://relay.test",
      connectorPath: "unused.json",
    });
    const written: unknown[] = [];
    const failed = await runHttpBatch(
      server,
      lines(
        JSON.stringify({
          tool: "describe_tool",
          args: { tool: "circuit_place" },
        }),
        "",
        "not json",
        JSON.stringify({ tool: "batch" }),
        JSON.stringify({
          tool: "describe_tool",
          args: { tool: "missing-tool" },
        }),
      ),
      (line) => written.push(JSON.parse(line)),
    );
    expect(written).toHaveLength(4);
    expect(written[0]).not.toMatchObject({ ok: false });
    expect(written[1]).toMatchObject({
      ok: false,
      error: { code: "INVALID_BATCH_LINE" },
    });
    expect(written[2]).toMatchObject({
      ok: false,
      error: { code: "INVALID_BATCH_LINE" },
    });
    // A tool's own failure keeps its usual shape.
    expect(written[3]).toMatchObject({ isError: true });
    expect(failed).toBe(3);
    expect(httpCommandReadsStdin("batch")).toBe(false);
  });
});

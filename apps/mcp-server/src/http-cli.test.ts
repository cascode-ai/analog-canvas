import { describe, expect, it, vi } from "vitest";
import { assembleServer } from "./server.js";
import { runHttpCommand } from "./http-cli.js";

describe("HTTP executable adapter", () => {
  it("uses the exact same tool and resource handlers without starting MCP", async () => {
    const server = assembleServer({
      apiBaseUrl: "https://relay.test",
      connectorPath: "unused.json",
    });
    const call = vi
      .spyOn(server.handler, "callTool")
      .mockResolvedValue({ content: [] });
    await runHttpCommand(server, "connect", '{"claimCode":"one-time"}');
    expect(call).toHaveBeenCalledWith("connect", { claimCode: "one-time" });
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

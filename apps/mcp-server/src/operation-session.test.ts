import { describe, expect, it } from "vitest";
import { resolveConfig } from "./operation-session.js";

describe("MCP runtime configuration", () => {
  it("leases the default per-origin connector, never an explicit path (#1522)", () => {
    const shared = resolveConfig({});
    expect(shared.connectorLease).toBe(true);
    const chosen = resolveConfig({
      ANALOG_CANVAS_MCP_CONNECTOR: "/private/worker-1.json",
    });
    expect(chosen).toMatchObject({
      connectorPath: "/private/worker-1.json",
      connectorLease: false,
    });
  });
});

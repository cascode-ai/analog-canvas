import { describe, expect, it, vi } from "vitest";
import { AgentSessionClient } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { compareExpectedNetlist } from "./netlist-comparison.js";

describe("optional expected-netlist verification", () => {
  it("uses one existing read-only export, hides detail by default and never stages", async () => {
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    const actual = ".subckt a I O\nR1 I O 1u\n.ends a";
    const read = vi.spyOn(client, "projectResource").mockResolvedValue({
      apiVersion: "3.0",
      requestId: "verify",
      operation: "read-netlist",
      ok: true,
      structureRevision: 5,
      netlist: {
        format: "spice",
        status: "ready",
        text: actual,
        diagnostics: [],
      },
    });
    expect(
      await compareExpectedNetlist(client, "cell-id", {
        text: actual.replace("1u", "1000n"),
      }),
    ).toMatchObject({ status: "equal", structureRevision: 5 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toMatchObject({
      operation: "read-netlist",
      rootDocumentId: "cell-id",
    });
    const changed = await compareExpectedNetlist(
      client,
      "cell-id",
      { text: actual.replace("1u", "1.001u") },
      true,
    );
    expect(changed).toMatchObject({
      status: "different",
      counts: { parameter: 1, connection: 0 },
      differences: [
        expect.objectContaining({
          kind: "parameter",
          actual: "1u",
          expected: "1.001u",
        }),
      ],
    });
    const bad = await compareExpectedNetlist(client, "cell-id", {
      text: ".subckt nope A B\n.invalid opaque\n.ends nope",
    });
    expect(bad.status).toBe("inconclusive");
  });
});

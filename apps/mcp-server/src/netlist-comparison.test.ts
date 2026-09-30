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
      cells: [],
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

  it("says first whether the wiring matches, and skips the checks asked to be skipped", async () => {
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    // A redraw with the reviewed SKY130 target, in its own port order.
    vi.spyOn(client, "projectResource").mockResolvedValue({
      apiVersion: "3.0",
      requestId: "verify",
      operation: "read-netlist",
      ok: true,
      structureRevision: 9,
      cells: [],
      netlist: {
        format: "spice",
        status: "ready",
        text: ".subckt pair OUT IN VSS\nXM1 OUT IN VSS VSS sky130_fd_pr__nfet_01v8 l=0.15 w=1\n.ends pair",
        diagnostics: [],
      },
    });
    // The Gallery's netlist binds the same transistor to the model by name.
    const text =
      ".subckt pair IN OUT VSS\nM1 OUT IN VSS VSS sky130_fd_pr__nfet_01v8 l=150n w=1u\n.ends pair";
    const result = await compareExpectedNetlist(client, "cell-id", { text });
    expect(Object.keys(result).slice(0, 3)).toEqual([
      "summary",
      "status",
      "topology",
    ]);
    expect(result).toMatchObject({
      summary: "topology equal; 1 port-order, 1 binding-style differences",
      status: "different",
      topology: "equal",
      counts: { "port-order": 1, binding: 1, device: 0, connection: 0 },
    });
    expect(
      await compareExpectedNetlist(client, "cell-id", {
        text,
        compare: { portOrder: false, bindings: false },
      }),
    ).toMatchObject({ summary: "equal", status: "equal" });
  });
});

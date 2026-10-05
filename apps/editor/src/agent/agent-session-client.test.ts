import { describe, expect, it, vi } from "vitest";
import { AgentSessionError } from "../../../../packages/agent-client/src/errors";
import { liveAgentEditor, personEdits } from "./live-agent-editor.test-support";

const place = (symbol: string, reference: string, x: number) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y: 100 },
});

describe("the Agent client against the live editor", () => {
  it("claims a code, caches capabilities, bootstraps once, and reports online", async () => {
    const { client, http, controller } = liveAgentEditor();
    const report = await client.connect("session-1.claim-code");
    expect(http.claims).toEqual(["session-1.claim-code"]);
    expect(report.mode).toBe("claimed");
    expect(report.projectId).toBe(controller.project.id);
    expect(report.context?.revision).toBe(controller.document.revision);
    expect(report.context?.byteLength).toBeGreaterThan(0);
    expect(report.context?.diagnosticsLoaded).toBe(false);
    expect(report.timing).toMatchObject({
      credentialMs: expect.any(Number),
      capabilitiesMs: expect.any(Number),
      bootstrapSnapshotMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(client.connection.snapshot.state).toBe("online");
    expect(http.circuitCalls.map((call) => call.request.operation)).toEqual([
      "capabilities",
      "snapshot",
    ]);
    expect(http.circuitCalls[1]?.request).toMatchObject({
      operation: "snapshot",
      projection: "bootstrap",
    });
    expect(client.cachedSnapshot("main")).toBeNull();
    // A second capabilities call reuses the cache without another request.
    const calls = http.circuitCalls.length;
    await client.capabilities();
    expect(http.circuitCalls.length).toBe(calls);
  });

  it("surfaces STATE_CHANGED with the objects a person changed, instead of overwriting", async () => {
    const { client, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    expect(
      (
        await client.applyActions([
          place("resistor", "R1", 100),
          place("resistor", "R2", 300),
        ])
      ).ok,
    ).toBe(true);
    // The Agent reads the Document, then a person moves R2.
    await client.snapshot();
    const r2 = controller.document.instances.find(
      (item) => item.reference === "R2",
    )!;
    personEdits(controller, [
      {
        kind: "move_instance",
        instanceId: r2.id,
        position: { x: 500, y: 300 },
      },
    ]);
    const report = await client.advancedTransact([
      {
        kind: "set_instance_reference",
        instanceId: r2.id,
        reference: "R7",
      },
    ]);
    expect(report).toMatchObject({
      ok: false,
      stage: "commit",
      code: "STATE_CHANGED",
      revision: controller.document.revision,
    });
    expect(report.changedObjectIds).toContain(r2.id);
    expect(r2.reference).toBe("R2");
    expect(client.summary("main")?.revision).toBe(controller.document.revision);
  });

  it("retains a canonical request ID and payload through network recovery", async () => {
    const { client, http } = liveAgentEditor();
    await client.connect("session-1.code");
    const circuit = vi.spyOn(http, "circuit");
    circuit.mockRejectedValueOnce(
      new AgentSessionError("NETWORK_FAILURE", "lost response", "network"),
    );
    const request = {
      apiVersion: "3.0",
      operation: "snapshot",
      documentId: "main",
      requestId: "caller-owned-id",
    };
    expect(await client.request(request)).toMatchObject({ ok: true });
    expect(circuit).toHaveBeenCalledTimes(2);
    expect(circuit.mock.calls.map((call) => call[2])).toEqual([
      request,
      request,
    ]);
    await expect(
      client.request({ ...request, secret: "invalid" }),
    ).rejects.toThrow("Invalid Agent Circuit request");
  });
});

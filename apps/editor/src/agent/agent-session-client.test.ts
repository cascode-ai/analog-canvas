import { describe, expect, it, vi } from "vitest";
import { AgentSessionError } from "../../../../packages/agent-client/src/errors";
import { liveAgentEditor } from "./live-agent-editor.test-support";

describe("the Agent client against the live editor", () => {
  it("claims a code, caches capabilities, bootstraps once, and reports online", async () => {
    const { client, http, controller } = liveAgentEditor();
    const report = await client.connect("session-1.claim-code");
    expect(http.claims).toEqual(["session-1.claim-code"]);
    expect(report.mode).toBe("claimed");
    expect(report.projectId).toBe(controller.project.id);
    expect(report.documentIds).toEqual(
      controller.project.documents.map((item) => item.id),
    );
    expect(report.context?.documentId).toBe(controller.document.id);
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
    expect(client.connection.snapshot.state).toBe("online");
    await expect(
      client.request({ ...request, secret: "invalid" }),
    ).rejects.toThrow("Invalid Agent Circuit request");
  });
});

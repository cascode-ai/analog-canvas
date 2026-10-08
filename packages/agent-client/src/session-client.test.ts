import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentHttp } from "./test-support/fake-relay.js";
import { AgentSessionClient } from "./session-client.js";
import { ConnectorStore } from "./connector-store.js";

// What the client does with the editor is tested against the real editor,
// in apps/editor/src/agent/agent-session-client*.test.ts. These never reach
// an editor.
describe("agent session client", () => {
  it("does not delete another origin's connector from an explicit shared path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-origin-"));
    try {
      const store = new ConnectorStore(join(directory, "connector.json"));
      const saved = {
        version: 1 as const,
        apiBaseUrl: "https://other.test",
        sessionId: "other",
        connectorToken: "private",
        connectorExpiresAt: 1,
        storedAt: 0,
      };
      await store.save(saved);
      const client = new AgentSessionClient({
        http: new FakeAgentHttp(),
        connectorStore: store,
      });
      await expect(client.connect()).rejects.toThrow();
      expect(await store.load()).toEqual(saved);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires a claim code when nothing valid is stored", async () => {
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    await expect(client.connect()).rejects.toMatchObject({
      code: "CLAIM_REQUIRED",
    });
  });

  it("says which running process keeps the saved connector it may not share (#1522)", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-lease-"));
    const holder = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 60000)",
    ]);
    try {
      await once(holder, "spawn");
      const store = new ConnectorStore(join(directory, "connector.json"), {
        lease: true,
      });
      await writeFile(store.leasePath, JSON.stringify({ pid: holder.pid }));
      const client = new AgentSessionClient({
        http: new FakeAgentHttp(),
        connectorStore: store,
      });
      await expect(client.connect()).rejects.toMatchObject({
        code: "CLAIM_REQUIRED",
        message: expect.stringContaining(`pid ${holder.pid}`),
      });
    } finally {
      holder.kill();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

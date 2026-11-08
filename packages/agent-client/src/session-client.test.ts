import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentHttp } from "./test-support/fake-relay.js";
import { AgentSessionClient } from "./session-client.js";
import { ConnectorStore } from "./connector-store.js";
import { transportFailure } from "./errors.js";

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

  it.each([
    ["keeps the connector its successor saved", true],
    ["removes its own replaced connector", false],
  ])("after a takeover %s", async (_name, successorSaves) => {
    const directory = await mkdtemp(join(tmpdir(), "analog-takeover-"));
    try {
      const path = join(directory, "connector.json");
      const credential = (connectorToken: string) => ({
        version: 1 as const,
        apiBaseUrl: "https://relay.test",
        sessionId: "session-1",
        connectorToken,
        connectorExpiresAt: Number.MAX_SAFE_INTEGER,
        storedAt: 0,
      });
      await new ConnectorStore(path).save(credential("connector-one"));
      const http = new FakeAgentHttp({
        resume: (sessionId, connectorToken) => ({
          sessionId,
          agentToken: "bearer-one",
          tokenExpiresAt: Number.MAX_SAFE_INTEGER,
          connectorToken,
          connectorExpiresAt: Number.MAX_SAFE_INTEGER,
          scopes: ["circuit.snapshot"],
          projectId: "project-1",
          documentIds: ["main"],
        }),
        // Another chat redeemed this session's Claim (sharing this file).
        circuit: async () => {
          if (successorSaves)
            await new ConnectorStore(path).save(credential("connector-two"));
          throw transportFailure(
            "SESSION_TAKEN_OVER",
            "Another Agent connection took over",
            409,
          );
        },
      });
      const client = new AgentSessionClient({
        http,
        connectorStore: new ConnectorStore(path),
      });
      await expect(client.capabilities()).rejects.toMatchObject({
        code: "SESSION_TAKEN_OVER",
        category: "unrecoverable-credential",
      });
      expect((await client.status()).state).toBe("revoked");
      expect(await new ConnectorStore(path).load()).toEqual(
        successorSaves ? credential("connector-two") : null,
      );
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

  it("asks for a Claim when the live holder's file has no connector", async () => {
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
        message: expect.stringContaining("no valid saved connector"),
      });
      expect(
        JSON.parse(await readFile(store.leasePath, "utf8")) as unknown,
      ).toEqual({ pid: holder.pid });
    } finally {
      holder.kill();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

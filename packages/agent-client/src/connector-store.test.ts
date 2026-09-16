import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectorStore,
  defaultConnectorFilePath,
  type StoredConnectorCredential,
} from "./connector-store.js";

const directories: string[] = [];
const credential: StoredConnectorCredential = {
  version: 1,
  apiBaseUrl: "https://relay.test",
  sessionId: "session-1",
  connectorToken: "persistent-connector",
  connectorExpiresAt: 456,
  storedAt: 123,
};

async function tempStore(): Promise<ConnectorStore> {
  const directory = await mkdtemp(join(tmpdir(), "analog-connector-"));
  directories.push(directory);
  return new ConnectorStore(join(directory, "connector.json"));
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("connector store", () => {
  it("persists only the connector credential", async () => {
    const store = await tempStore();
    await store.save(credential);
    expect(await store.load()).toEqual(credential);
    const raw = await readFile(store.path, "utf8");
    expect(raw).toContain("persistent-connector");
    expect(raw).not.toContain("agentToken");
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("ignores malformed and wrong-version records", async () => {
    const store = await tempStore();
    await writeFile(store.path, "not-json", "utf8");
    expect(await store.load()).toBeNull();
    await writeFile(store.path, JSON.stringify({ ...credential, version: 2 }));
    expect(await store.load()).toBeNull();
  });

  it("uses a user-level default path and supports an override", () => {
    const production = defaultConnectorFilePath("/home/person", {});
    expect(production).toContain(join(".analog-canvas", "connectors"));
    expect(
      defaultConnectorFilePath(
        "/home/person",
        {},
        "https://analog-canvas-preview.tokenzhang.com",
      ),
    ).not.toBe(production);
    expect(
      defaultConnectorFilePath(
        "/home/person",
        {},
        "https://analog-canvas.tokenzhang.com/",
      ),
    ).toBe(production);
    expect(
      defaultConnectorFilePath("/home/person", {
        ANALOG_CANVAS_MCP_CONNECTOR: "/private/connector.json",
      }),
    ).toBe("/private/connector.json");
  });
});

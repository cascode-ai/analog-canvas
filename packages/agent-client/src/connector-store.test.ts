import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** Another MCP process, as the lease sees one: a running process's pid. */
async function runningProcess(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
  children.push(child);
  await once(child, "spawn");
  return child.pid!;
}

/** A process that held the lease and then ended. */
async function exitedProcess(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  await once(child, "exit");
  return child.pid!;
}

async function leasedStore(
  holder?: number,
  saved?: StoredConnectorCredential,
): Promise<ConnectorStore> {
  const plain = await tempStore();
  if (saved) await plain.save(saved);
  const store = new ConnectorStore(plain.path, { lease: true });
  if (holder !== undefined)
    await writeFile(store.leasePath, JSON.stringify({ pid: holder }));
  return store;
}

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

describe("connector lease (#1522)", () => {
  const other = { ...credential, sessionId: "session-2", connectorToken: "b" };
  const readJson = async (path: string) =>
    JSON.parse(await readFile(path, "utf8")) as unknown;

  it("lets the first process hold the file and write it whole", async () => {
    const store = await leasedStore();
    expect(await store.load()).toBeNull();
    await store.save(credential);
    expect(await readJson(store.path)).toEqual(credential);
    expect(await readJson(store.leasePath)).toEqual({ pid: process.pid });
    // No half-written file is left beside it.
    const directory = join(store.path, "..");
    expect((await readdir(directory)).sort()).toEqual([
      "connector.json",
      "connector.json.lease",
    ]);
    store.releaseSync();
    expect(await readdir(directory)).toEqual(["connector.json"]);
  });

  it("keeps a second running process off the held file: it neither resumes nor overwrites it", async () => {
    const holder = await runningProcess();
    const store = await leasedStore(holder, credential);
    expect(await store.load()).toBeNull();
    expect(store.heldBy).toBe(holder);
    // Its own pairing lives with it and stays out of the file.
    await store.save(other);
    expect(await store.load()).toEqual(other);
    expect(await readJson(store.path)).toEqual(credential);
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(await readJson(store.path)).toEqual(credential);
    // Giving back a lease it never held leaves the holder's in place.
    store.releaseSync();
    expect(await readJson(store.leasePath)).toEqual({ pid: holder });
  });

  it("lets a restarted client resume the connection its exited holder saved", async () => {
    const store = await leasedStore(await exitedProcess(), credential);
    expect(await store.load()).toEqual(credential);
    expect(store.heldBy).toBeNull();
    expect(await readJson(store.leasePath)).toEqual({ pid: process.pid });
    await store.save(other);
    expect(await readJson(store.path)).toEqual(other);
  });

  it("follows its own pairing, not one another process writes to the file", async () => {
    const store = await leasedStore();
    await store.save(credential);
    await writeFile(store.path, JSON.stringify(other));
    expect(await store.load()).toEqual(credential);
  });

  it("stops writing the file once another process has taken the lease", async () => {
    const store = await leasedStore();
    await store.save(credential);
    const holder = await runningProcess();
    await writeFile(store.leasePath, JSON.stringify({ pid: holder }));
    await store.save(other);
    expect(await store.load()).toEqual(other);
    expect(await readJson(store.path)).toEqual(credential);
  });
});

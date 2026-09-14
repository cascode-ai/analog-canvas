import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVacaskService } from "./entrypoint.mjs";

const services = [],
  children = [];
let root, config;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "icm-native-start-"));
  const startupPath = join(root, "startup.toml");
  await writeFile(startupPath, "# controlled\n");
  config = {
    runtime: {
      executor: "local-host",
      profileId: "native-start-proof",
      binary: resolve(process.env.VACASK_BIN ?? "plan/missing-vacask"),
      modules: resolve(process.env.VACASK_MODULES ?? "plan/missing-modules"),
      startupPath,
      runRoot: join(root, "jobs"),
    },
    capabilities: {
      configured: true,
      rawfileCollection: "native-multi-ascii",
      maxInputFiles: 8,
      inputs: ["source"],
      analyses: ["op", "tran"],
      parsedAnalyses: ["op", "tran"],
      profiles: [{ id: "native-start-proof", corners: [] }],
      maxTimeoutMs: 15000,
      maxInputBytes: 65536,
      maxOutputBytes: 131072,
      cancel: true,
    },
    limits: {
      maxInputBytes: 65536,
      maxInputFiles: 8,
      maxOutputBytes: 131072,
      maxLogBytes: 65536,
      maxRawFiles: 8,
      maxEntries: 128,
    },
    listen: { host: "127.0.0.1", port: 0 },
  };
});
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      await ended;
    }
  await rm(root, { recursive: true, force: true });
});
const base = (service) => `http://127.0.0.1:${service.server.address().port}`;
const native = () => !!process.env.VACASK_BIN && !!process.env.VACASK_MODULES;
async function start(value = config) {
  const service = await startVacaskService(value);
  services.push(service);
  return service;
}
async function startCli() {
  const path = join(root, "runtime.json");
  await writeFile(path, JSON.stringify(config));
  const child = spawn(
    process.execPath,
    ["containers/vacask/entrypoint.mjs", path],
    {
      cwd: resolve("."),
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  let output = "",
    errors = "";
  child.stdout.on("data", (bytes) => {
    output += bytes;
  });
  child.stderr.on("data", (bytes) => {
    errors += bytes;
  });
  await vi.waitFor(
    () => expect(output, errors).toContain('"vacask-listening"'),
    { timeout: 5000 },
  );
  const address = JSON.parse(output.trim().split("\n")[0]);
  const url = `http://127.0.0.1:${address.port}`;
  await vi.waitFor(async () =>
    expect((await fetch(url + "/health")).status).toBe(200),
  );
  return { child, address, url };
}
const input = (analysis = "analysis bias op") => {
  const text = `Native startup proof\nmodel v vsource\nV1 (out 0) v dc=1\ncontrol\noptions rawfile="ascii"\n${analysis}\nendc\n`;
  return {
    language: "vacask",
    mode: "raw",
    netlist: "",
    testbench: text,
    preparedDeck: text,
    inputRevision: "startup-test",
    environment: { profileId: "native-start-proof" },
    files: [{ path: "run.sim", text }],
    dependencies: [],
    entryPath: "run.sim",
    collection: { kind: "native-multi-ascii" },
  };
};
describe("native service startup and recovery", () => {
  it("refuses implicit public local bindings and invalid limits before starting", async () => {
    await expect(
      start({ ...config, listen: { host: "0.0.0.0", port: 0 } }),
    ).rejects.toThrow("loopback");
    await expect(
      start({ ...config, limits: { ...config.limits, maxInputBytes: 0 } }),
    ).rejects.toThrow("resource limits");
  });
  it("keeps failed runtime health available without becoming configured", async () => {
    const service = await start({
      ...config,
      runtime: { ...config.runtime, binary: join(root, "absent") },
    });
    await expect(service.ready).rejects.toThrow();
    expect((await fetch(base(service) + "/health")).status).toBe(503);
    const reply = await fetch(base(service) + "/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "capabilities" }),
    });
    expect(await reply.json()).toMatchObject({ configured: false });
  });
  it.skipIf(!native())(
    "starts, runs, stops and restarts on the same clean run root",
    async () => {
      const service = await start();
      await service.ready;
      await vi.waitFor(async () =>
        expect((await fetch(base(service) + "/health")).status).toBe(200),
      );
      const reply = await fetch(base(service) + "/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input()),
      });
      const result = await reply.json();
      expect(result.outcome.status).toBe("completed");
      expect(
        result.data.analyses[0].probes.find((p) => p.name === "out").value,
      ).toBe(1);
      await service.stop();
      await service.stop();
      expect(await readdir(config.runtime.runRoot)).toEqual([]);
      const restarted = await start();
      await restarted.ready;
      await vi.waitFor(async () =>
        expect((await fetch(base(restarted) + "/health")).status).toBe(200),
      );
    },
  );
  it.skipIf(!native())(
    "shutdown reaps an active tokenless job even after the HTTP client leaves",
    async () => {
      const service = await start();
      await service.ready;
      await vi.waitFor(async () =>
        expect((await fetch(base(service) + "/health")).status).toBe(200),
      );
      const abort = new AbortController();
      const pending = fetch(base(service) + "/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          input("analysis long tran step=1e-12 stop=100 maxstep=1e-12 write=0"),
        ),
        signal: abort.signal,
      })
        .then((r) => r.text())
        .catch(() => null);
      await vi.waitFor(async () =>
        expect(
          (await (await fetch(base(service) + "/health")).json()).activity
            .phase,
        ).toBe("running"),
      );
      abort.abort();
      await service.stop();
      await pending;
      expect(await readdir(config.runtime.runRoot)).toEqual([]);
    },
  );
  it.skipIf(!native())(
    "the built CLI consumes explicit config and announces its actual loopback port",
    async () => {
      const { address } = await startCli();
      expect(address.address).toBe("127.0.0.1");
      expect(address.port).toBeGreaterThan(0);
    },
  );
  it.skipIf(!native() || process.platform === "win32")(
    "SIGTERM awaits a running job's cleanup after the client disconnects",
    async () => {
      const { child, url } = await startCli();
      const abort = new AbortController();
      const pending = fetch(url + "/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          input("analysis long tran step=1e-12 stop=100 maxstep=1e-12 write=0"),
        ),
        signal: abort.signal,
      })
        .then((r) => r.text())
        .catch(() => null);
      await vi.waitFor(async () =>
        expect(
          (await (await fetch(url + "/health")).json()).activity.phase,
        ).toBe("running"),
      );
      abort.abort();
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await vi.waitFor(() => expect(child.exitCode).toBe(0), { timeout: 5000 });
      expect(await exited).toEqual([0, null]);
      await pending;
      expect(await readdir(config.runtime.runRoot)).toEqual([]);
    },
  );
});

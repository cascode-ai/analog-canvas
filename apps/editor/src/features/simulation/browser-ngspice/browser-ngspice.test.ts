import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ExecutionInput } from "@icm/simulation-service";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";
import {
  BROWSER_NGSPICE_PROFILE as profile,
  measureBrowserNgspice,
  type BrowserNgspiceAssets,
} from "./browser-ngspice-environment";
import { createBrowserNgspiceExecutor } from "./browser-ngspice-executor";
import type { NgspiceWorker } from "./browser-ngspice-runner";
import type { BrowserNgspiceWorkerReply } from "./browser-ngspice-protocol";
import { ngspiceWorkerHost } from "./ngspice-worker-host";

const here = new URL("./", import.meta.url);
const repository = new URL("../../../../../../", import.meta.url);

const bytes = async (url: URL) => new Uint8Array(await readFile(url));
const spiceFiles = async (directory: URL) =>
  Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith(".spice"))
      .map(async (name) => ({
        name,
        bytes: await bytes(new URL(name, directory)),
      })),
  );

/** The bytes the editor build serves, read from this checkout. */
async function vendored(): Promise<Omit<BrowserNgspiceAssets, "version">> {
  return {
    wasm: await bytes(new URL("vendor/ngspice.wasm", here)),
    models: await spiceFiles(new URL("sky130-continuous/", here)),
    cells: await spiceFiles(new URL("containers/ngspice/cells/", repository)),
    startup: await readFile(
      new URL("containers/ngspice/hosted.spiceinit", repository),
      "utf8",
    ),
  };
}

/** The simulator's Worker, run in this process with the vendored bytes. */
function inProcessWorker(): NgspiceWorker {
  const handle = ngspiceWorkerHost({
    load: async () => ({
      ...(await vendored()),
      spinit: await readFile(new URL("vendor/spinit", here), "utf8"),
    }),
  });
  const worker: NgspiceWorker = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      void handle(message, (reply) =>
        queueMicrotask(() => worker.onmessage?.({ data: reply } as never)),
      );
    },
    terminate() {},
  };
  return worker;
}

/** The measured environment of the vendored bytes. */
const pinned = vendored().then((assets) =>
  measureBrowserNgspice({ ...assets, version: "ngspice-46" }),
);

/** A Worker that starts every run and never finishes it. */
function stalledWorker(log: string[]): () => NgspiceWorker {
  return () => {
    const worker: NgspiceWorker = {
      onmessage: null,
      onerror: null,
      postMessage({ id }) {
        log.push("run");
        void pinned.then((measured) => {
          if (!measured.ok) throw new Error(measured.message);
          worker.onmessage?.({
            data: {
              id,
              kind: "started",
              environment: measured.environment,
            } satisfies BrowserNgspiceWorkerReply,
          } as never);
        });
      },
      terminate() {
        log.push("terminate");
      },
    };
    return worker;
  };
}

const rcDeck = `* RC step
V1 in 0 PULSE(0 1 0 1n 1n 1m 2m)
R1 in out 1k
C1 out 0 1u
.control
tran 10u 2m
meas tran v_at_1m find v(out) at=1m
write out.raw v(out)
.endc
.end
`;
const rawInput = (deck: string): ExecutionInput => ({
  mode: "raw",
  netlist: "",
  testbench: deck,
  files: [{ path: "run.cir", text: deck }],
  dependencies: [],
  entryPath: "run.cir",
  inputRevision: "browser-ngspice-test",
  environment: { profileId: profile.id },
  collection: { rawfile: "out.raw" },
});

describe("the in-browser SKY130 simulator", () => {
  it("is the build and model subtree the Profile's browser section pins", async () => {
    const measured = await pinned;
    if (!measured.ok) throw new Error(measured.message);
    expect(measured.environment).toMatchObject({
      executor: "browser-wasm",
      reproducibility: "pinned",
      profileId: profile.id,
      platform: profile.browser.platform,
      simulator: {
        version: profile.simulator.version,
        binarySha256: profile.browser.simulator.binarySha256,
      },
      models: {
        id: profile.models.id,
        contentSha256: profile.browser.models.contentSha256,
      },
      startupSha256: profile.startup.contentSha256,
    });
    // Mounted where the hosted image has them, so decks resolve the same paths.
    expect(measured.libraries.map((file) => file.path)).toContain(
      profile.models.library.runtimePath,
    );
    expect(measured.libraries.map((file) => file.path)).toContain(
      profile.cellLibraries[0]!.library.runtimePath,
    );
  });

  it("refuses models that are not the pinned bytes", async () => {
    const assets = await vendored();
    const models = assets.models.map((file, index) =>
      index === 0
        ? { ...file, bytes: new Uint8Array([...file.bytes, 0x0a]) }
        : file,
    );
    const measured = await measureBrowserNgspice({
      ...assets,
      models,
      version: "ngspice-46",
    });
    expect(measured.ok).toBe(false);
    expect(!measured.ok && measured.message).toContain("model subtree");
  });

  it("runs a deck through the Worker route and reports where it ran", async () => {
    const executor = createBrowserNgspiceExecutor(inProcessWorker);
    const capabilities = await executor.capabilities(profile.id);
    expect(capabilities.configured).toBe(true);
    // The whole rawfile comes back: no output limit is advertised.
    expect(capabilities.maxOutputBytes).toBeUndefined();
    const output = await executor.execute(
      rawInput(rcDeck),
      crypto.randomUUID(),
    );
    expect(output.result.outcome).toEqual({ status: "completed" });
    expect(output.result.metadata.environment).toMatchObject({
      executor: "browser-wasm",
      reproducibility: "pinned",
    });
    // A browser run names no hosted target.
    expect(output.result.execution).toBeUndefined();
    expect(output.result.log).toMatch(/v_at_1m\s+=\s+6\.3212\de-01/u);
    expect(output.rawfile).toMatch(/^Title: \* rc step$/mu);
    expect(output.result.data).toBeDefined();
  });

  it("refuses a run whose browser environment is not the pinned build", async () => {
    const measured = await pinned;
    if (!measured.ok) throw new Error(measured.message);
    const { fingerprint: _fingerprint, ...facts } = measured.environment;
    const other = await createSimulationEnvironmentMetadata({
      ...facts,
      simulator: { ...facts.simulator, binarySha256: "0".repeat(64) },
    });
    const worker: NgspiceWorker = {
      onmessage: null,
      onerror: null,
      postMessage({ id }) {
        const reply = (data: BrowserNgspiceWorkerReply) =>
          queueMicrotask(() => worker.onmessage?.({ data } as never));
        reply({ id, kind: "started", environment: other });
        reply({
          id,
          kind: "finished",
          output: {
            stdout: "",
            stderr: "",
            truncated: false,
            exitCode: 0,
            signal: null,
            durationMs: 1,
            rawfileRequested: true,
            rawfile: null,
            rawfileName: null,
            rawfileFormat: null,
          },
        });
      },
      terminate() {},
    };
    await expect(
      createBrowserNgspiceExecutor(() => worker).execute(
        rawInput(rcDeck),
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({
      problem: {
        code: "simulator-protocol-invalid",
        message: "Simulation result does not match the selected Profile",
      },
    });
  });

  it("stops a run at its deadline and on cancel by terminating the Worker", async () => {
    const log: string[] = [];
    const executor = createBrowserNgspiceExecutor(stalledWorker(log));
    const timedOut = await executor.execute(
      rawInput(rcDeck),
      crypto.randomUUID(),
      50,
    );
    expect(timedOut.result.outcome).toEqual({
      status: "timed-out",
      timeoutMs: 50,
    });
    const token = crypto.randomUUID();
    const running = executor.execute(rawInput(rcDeck), token);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await executor.cancel(token, profile.id);
    expect((await running).cancelled).toBe(true);
    expect(log).toEqual(["run", "terminate", "run", "terminate"]);
  });
});

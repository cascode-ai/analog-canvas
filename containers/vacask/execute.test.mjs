import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeVacaskRuntime } from "./runtime.mjs";
import { executeVacask } from "./execute.mjs";
import { SimulationRunSupervisor } from "../ngspice/run-supervisor.mjs";
import { createVacaskHttpServer } from "./http-server.mjs";
import {
  EXECUTION_RECEIPT_HEADER,
  readExecutionReceipt,
} from "@icm/simulation-service";

describe.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
  "real native executor responses",
  () => {
    let root, runtime;
    const supervisor = new SimulationRunSupervisor({ defaultTimeoutMs: 15000 });
    const limits = {
      maxInputBytes: 65536,
      maxInputFiles: 8,
      maxOutputBytes: 131072,
      maxLogBytes: 65536,
      maxRawFiles: 16,
      maxEntries: 256,
    };
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "icm-native-execute-"));
      const startupPath = join(root, "startup.toml");
      await writeFile(startupPath, "# controlled\n");
      runtime = await initializeVacaskRuntime({
        executor: "local-host",
        profileId: "native-response-proof",
        binary: resolve(process.env.VACASK_BIN),
        modules: resolve(process.env.VACASK_MODULES),
        runRoot: root,
        startupPath,
      });
    });
    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });
    function input(control = "analysis bias op", source = "") {
      const text = `Native response evidence\nmodel v vsource\nV1 (out 0) v dc=1 ${source}\ncontrol\noptions rawfile="ascii"\n${control}\nendc\n`;
      return {
        language: "vacask",
        mode: "raw",
        netlist: "",
        testbench: text,
        preparedDeck: text,
        inputRevision: "actual-native",
        environment: { profileId: runtime.environment.profileId },
        files: [{ path: "run.sim", text }],
        dependencies: [],
        entryPath: "run.sim",
        collection: { kind: "native-multi-ascii" },
      };
    }
    async function run(value) {
      const reply = await executeVacask(value, runtime, limits, supervisor);
      expect(await readdir(root)).toEqual(["startup.toml"]);
      expect(supervisor.snapshot().state).toBe("idle");
      return reply;
    }
    it("returns complete earlier records and failed outcome for a zero-exit later error", async () => {
      const reply = await run(input("analysis bias op\nanalysis bad nonsense"));
      expect(reply.ok).toBe(true);
      expect(reply.output.result.outcome.status).toBe("failed");
      expect(
        reply.output.result.data.analyses[0].probes.find(
          (p) => p.name === "out",
        ).value,
      ).toBe(1);
      expect(
        reply.output.result.diagnostics.some(
          (d) =>
            d.severity === "error" &&
            d.text.includes("Analysis type 'nonsense' not found."),
        ),
      ).toBe(true);
      expect(reply.output.result.metadata.environment).toEqual(
        runtime.environment,
      );
    });
    it("returns source errors without breaking the next successful run", async () => {
      const failed = await run(input("not valid syntax ?"));
      expect(failed.ok).toBe(true);
      expect(failed.output.result.outcome.status).toBe("failed");
      expect(failed.output.result.data).toBeUndefined();
      expect(failed.output.result.log).toContain("Parser syntax error");
      const next = await run(input());
      expect(next.output.result.outcome.status).toBe("completed");
      expect(next.output.result.data.analyses).toHaveLength(1);
    });
    it("does not certify numbers after the simulator ignored a submitted parameter", async () => {
      const reply = await run(
        input('options unknownparam="warn"\nanalysis bias op', "wrong=1"),
      );
      expect(
        reply.output.result.outcome.status,
        JSON.stringify(reply.output.result),
      ).toBe("completed-with-dropped-input");
      expect(reply.output.result.data).toBeUndefined();
      expect(reply.output.rawfiles).toHaveLength(1);
    });
    it("permits native programs intentionally requesting no captured numbers", async () => {
      const reply = await run(input("analysis bias op write=0"));
      expect(reply.output.result.outcome.status).toBe("completed");
      expect(reply.output.result.data).toBeUndefined();
    });
    it("returns a complete real transient over HTTP beyond the legacy response budget", async () => {
      const value = input(
        "save default\nanalysis signal tran stop=0.15 step=1u maxstep=1u",
      );
      const largeLimits = { ...limits, maxOutputBytes: 64 * 1024 * 1024 };
      const server = createVacaskHttpServer({
        runtimeReady: Promise.resolve(runtime),
        limits: largeLimits,
        supervisor,
        capabilities: {
          configured: true,
          rawfileCollection: "native-multi-ascii",
          inputs: ["source"],
          analyses: ["tran"],
          parsedAnalyses: ["tran"],
          profiles: [{ id: runtime.environment.profileId, corners: [] }],
          maxTimeoutMs: 15000,
          maxInputFiles: largeLimits.maxInputFiles,
          maxInputBytes: largeLimits.maxInputBytes,
          maxOutputBytes: largeLimits.maxOutputBytes,
          cancel: true,
        },
      });
      let output;
      try {
        await server.initialized;
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/run`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-analog-execution-transfer": "receipt-v1",
            },
            body: JSON.stringify({
              ...value,
              runToken: "22222222-2222-2222-2222-222222222222",
            }),
          },
        );
        expect(response.status).toBe(200);
        const receipt = readExecutionReceipt(
          response.headers.get(EXECUTION_RECEIPT_HEADER),
        );
        const text = await response.text();
        expect(receipt.byteLength).toBe(Buffer.byteLength(text));
        expect(receipt.byteLength).toBeGreaterThan(8 * 1024 * 1024);
        output = JSON.parse(text);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      expect(output.outcome.status, output.log).toBe("completed");
      expect(output.collectionStatus).toBe("complete");
      const rawBytes = output.rawfiles.reduce(
        (sum, file) => sum + Buffer.byteLength(file.text),
        0,
      );
      expect(rawBytes).toBeGreaterThan(8 * 1024 * 1024);
      const plot = output.data.analyses.find(
        (item) => item.analysis === "tran",
      );
      const voltage = plot.probes.find((probe) => probe.name === "out").value;
      expect(voltage.length).toBeGreaterThanOrEqual(150000);
      expect(voltage.every((sample) => Math.abs(sample - 1) < 1e-9)).toBe(true);
      expect(await readdir(root)).toEqual(["startup.toml"]);
      expect(supervisor.snapshot().state).toBe("idle");
    }, 60000);
    it("cancels before launch without inventing execution evidence", async () => {
      const value = {
        ...input(),
        runToken: "11111111-1111-1111-1111-111111111111",
      };
      const pending = run(value);
      expect(supervisor.cancel(value.runToken)).toBe(true);
      const reply = await pending;
      expect(reply.output.cancelled).toBe(true);
      expect(reply.output.executedFiles).toEqual([]);
      expect(reply.output.rawfiles).toEqual([]);
    });
    it("returns a repairable admission problem without executing an incompatible input", async () => {
      const reply = await run({ ...input(), language: "ngspice" });
      expect(reply).toMatchObject({
        ok: false,
        error: { code: "native-input-required", recovery: "fix-input" },
      });
      const unbound = await run({ ...input(), inputRevision: undefined });
      expect(unbound).toMatchObject({
        ok: false,
        error: {
          code: "prepared-input-identity-missing",
          recovery: "reprepare",
        },
      });
    });
  },
);

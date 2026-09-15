import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { nativeSky130OtaFixture } from "../../packages/simulation-service/test-support/sky130-ota.js";
import { SimulationService } from "../../packages/simulation-service/src/service.js";
import { SimulationFiles } from "../../packages/simulation-service/src/files.js";
import { createHostedExecutor } from "../../packages/simulation-service/src/hosted-executor.js";
import { CapabilitiesSchema } from "../../packages/simulation-service/src/contract.js";
import { initializeVacaskRuntime } from "./runtime.mjs";
import { createVacaskHttpServer } from "./http-server.mjs";
import { createLocalSimulationHandler } from "../../apps/local-host/src/index.js";
import { nativeSimulationDevices } from "../../packages/netlist/src/simulation-native-devices.js";
import { nativeAcquisitionEdit } from "../../packages/netlist/src/simulation-native-save-edit.js";

function unwrap(reply, key) {
  if (!reply.ok || !(key in reply)) throw Error(JSON.stringify(reply));
  return reply[key];
}

// This is a real local HTTP/process/model/result journey. It does not stand in
// for the browser, public MCP transport, cloud isolation or numerical qualification.
it.skipIf(
  !process.env.VACASK_BIN ||
    !process.env.VACASK_MODULES ||
    !process.env.ICM_VACASK_CONVERTED_TT,
)(
  "executes the shipped SKY130 OTA through public Prepare/Start and maps real OP/DC/AC/TRAN/Noise artifacts",
  async () => {
    const { project, folder, profile, library, acquisitions } =
      nativeSky130OtaFixture(true);
    const devices = nativeSimulationDevices(project, folder.input);
    const sensed = ["nmos", "pmos"].map((polarity) => {
      const device = devices.find((d) => d.polarity === polarity);
      expect(device, polarity).toBeDefined();
      return device;
    });
    const entry = folder.input.files.find((f) => f.path === folder.input.entry);
    const edit = nativeAcquisitionEdit(
      entry.text,
      entry.text.indexOf("analysis "),
      sensed.flatMap((d) => d.currentSenses.map((s) => s.save)),
      true,
    );
    if (!edit.ok) throw Error(JSON.stringify(edit));
    entry.text = edit.text;
    const before = structuredClone(project);
    expect(
      folder.input.files.some((file) => /options\s+scale=/u.test(file.text)),
    ).toBe(false);
    const root = await mkdtemp(join(tmpdir(), "icm-sky130-public-"));
    let server;
    try {
      const startupPath = join(root, "vacaskrc.toml");
      await writeFile(
        startupPath,
        "# Controlled local SKY130 public journey\n",
      );
      const runtime = await initializeVacaskRuntime({
        executor: "local-host",
        profileId: profile.id,
        binary: resolve(process.env.VACASK_BIN),
        modules: resolve(process.env.VACASK_MODULES),
        startupPath,
        runRoot: root,
        ...(process.env.ICM_VACASK_LIBRARY_PATH
          ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
          : {}),
        dependencies: [
          {
            id: library.dependencyId,
            sha256: library.sha256,
            runtimePath: resolve(process.env.ICM_VACASK_CONVERTED_TT),
          },
        ],
      });
      const caps = CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["op", "dc", "ac", "tran", "noise"],
        parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
        profiles: [profile],
        maxTimeoutMs: 30000,
        maxInputBytes: 1048576,
        maxInputFiles: 24,
        // Native transient capture is ~3 MB with all default/model/current
        // vectors. Exercise bounded paging without truncating this fixture.
        maxOutputBytes: 8 * 1048576,
        cancel: true,
      });
      server = createVacaskHttpServer({
        runtimeReady: runtime,
        capabilities: caps,
        limits: {
          maxInputBytes: caps.maxInputBytes,
          maxInputFiles: caps.maxInputFiles,
          maxOutputBytes: caps.maxOutputBytes,
          maxLogBytes: 65536,
          maxRawFiles: 16,
          maxEntries: 4096,
        },
      });
      await new Promise((done) => server.listen(0, "127.0.0.1", done));
      const base = `http://127.0.0.1:${server.address().port}`;
      await vi.waitFor(
        async () => expect((await fetch(`${base}/health`)).status).toBe(200),
        { timeout: 15000 },
      );
      const files = new SimulationFiles();
      const local = createLocalSimulationHandler(base);
      const executor = createHostedExecutor((path, options) =>
        local(new Request(new URL(path, "http://editor.local"), options)),
      );
      const service = new SimulationService(files, executor, () => project);
      const prepared = unwrap(
        await service.handle(
          {
            operation: "prepare",
            source: {
              kind: "project-folder",
              folderId: folder.id,
              expectedStructureRevision: project.structureRevision,
            },
          },
          "prepare-ota",
        ),
        "prepared",
      );
      const run = unwrap(
        await service.handle(
          {
            operation: "start",
            preparedId: prepared.id,
            digest: prepared.digest,
          },
          "run-ota",
        ),
        "run",
      );
      let finished;
      await vi.waitFor(
        async () => {
          finished = unwrap(
            await service.handle(
              { operation: "read", runId: run.id },
              "read-ota",
            ),
            "run",
          );
          expect(finished.state).toBe("finished");
        },
        { timeout: 40000, interval: 100 },
      );
      expect(finished.error, JSON.stringify(finished)).toBeUndefined();
      expect(finished.inputStatus).toBe("unchanged");
      const artifact = async (name) => {
        const ref = finished.artifacts.find((a) => a.name === name);
        expect(ref, name).toBeDefined();
        let text = "";
        let offset = 0;
        for (;;) {
          const page = await files.handle({
            action: "artifact",
            artifactId: ref.id,
            offset,
            maxChars: 4096,
          });
          text += unwrap(page, "text");
          if (page.nextOffset === null) return text;
          expect(page.nextOffset).toBeGreaterThan(offset);
          offset = page.nextOffset;
        }
      };
      // Run receipts may omit large data. Read the canonical, paged artifact
      // through the same File Resource used by clients, not an inline shortcut.
      const result = JSON.parse(await artifact("result.json"));
      // Optional local evidence for cross-simulator numerical investigation.
      // These exact public artifacts are observations, never a passing golden.
      if (process.env.ICM_VACASK_EVIDENCE_DIR) {
        const parent = resolve(process.env.ICM_VACASK_EVIDENCE_DIR);
        await mkdir(parent, { recursive: true });
        const evidence = await mkdtemp(join(parent, "ota-public-"));
        for (const name of ["result.json", "outputs.json", "evidence.json"])
          if (finished.artifacts.some((a) => a.name === name))
            await writeFile(join(evidence, name), await artifact(name));
        await writeFile(
          join(evidence, "prepared.json"),
          JSON.stringify(prepared),
        );
        await writeFile(
          join(evidence, "input.sim"),
          await artifact(`executed/${folder.input.entry}`),
        );
        await writeFile(
          join(evidence, "circuit.sim"),
          await artifact("executed/circuit.spice"),
        );
      }
      expect(
        finished.result.outcome.status,
        JSON.stringify(finished.result),
      ).toBe("completed");
      const op = result.data.analyses.find((a) => a.analysis === "op");
      const ac = result.data.analyses.find((a) => a.analysis === "ac");
      expect(result.data.analyses.map((a) => a.analysis).sort()).toEqual(
        ["op", "dc", "ac", "tran", "noise"].sort(),
      );
      expect(op).toBeDefined();
      expect(ac).toBeDefined();
      const reference = JSON.parse(
        await readFile(
          new URL(
            "../../fixtures/simulation-acceptance/hosted-sky130-core-continuous-v1.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      // These four OP points meet the original hosted tolerances. This does
      // not generalize to the old DC, AC or transient/noise baselines.
      for (const [legacy, native] of [
        ["v(vout)", "vout"],
        ["v(ibias)", "ibias"],
        ["v(xdut.tail)", "XDUT:tail"],
        ["v(xdut.nleft)", "XDUT:nleft"],
      ]) {
        const expected = reference.expectedProbes[legacy];
        const measured = op.probes.find((p) => p.name === native)?.value;
        expect(Number.isFinite(measured), native).toBe(true);
        expect(Math.abs(measured - expected.value), native).toBeLessThanOrEqual(
          expected.absoluteTolerance,
        );
      }
      for (const device of sensed) {
        const pins = device.currentSenses.map((s) => {
          const probe = op.probes.find((p) => p.name === s.vector);
          expect(probe, s.vector).toBeDefined();
          expect(Number.isFinite(probe.value)).toBe(true);
          if (s.pinName.toLowerCase() === "d")
            expect(
              probe.value * (device.polarity === "pmos" ? -1 : 1),
            ).toBeGreaterThan(0);
          return probe.value;
        });
        expect(pins).toHaveLength(4);
        expect(pins.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 10);
        const traces = device.currentSenses.map((s) =>
          ac.probes.find((p) => p.name === s.vector),
        );
        for (let i = 0; i < ac.frequencyHz.length; i++) {
          expect(traces.reduce((sum, p) => sum + p.real[i], 0)).toBeCloseTo(
            0,
            10,
          );
          expect(traces.reduce((sum, p) => sum + p.imag[i], 0)).toBeCloseTo(
            0,
            10,
          );
        }
      }
      for (const acquisition of acquisitions) {
        const probe = op.probes.find((p) => p.name === acquisition.vector);
        expect(probe, acquisition.vector).toBeDefined();
        expect(Number.isFinite(probe.value)).toBe(true);
      }
      const voltage = op.probes.find((p) => p.name === "vout");
      expect(voltage.value).toBeGreaterThan(0);
      expect(voltage.value).toBeLessThan(1.8);
      expect(ac.frequencyHz[0]).toBe(1);
      expect(ac.frequencyHz.at(-1)).toBeCloseTo(1e9, 3);
      expect(ac.frequencyHz).toHaveLength(91);
      const output = ac.probes.find((p) => p.name === "vout");
      expect(output.real).toHaveLength(ac.frequencyHz.length);
      expect(output.imag).toHaveLength(ac.frequencyHz.length);
      const dc = result.data.analyses.find((a) => a.analysis === "dc");
      expect(dc.sweep.values).toHaveLength(9);
      dc.sweep.values.forEach((value, i) =>
        expect(value).toBeCloseTo(0.88 + 0.005 * i, 12),
      );
      const dcOutput = dc.probes.find((p) => p.name === "vout").value;
      expect(dcOutput[0]).toBeLessThan(voltage.value);
      expect(dcOutput.at(-1)).toBeGreaterThan(voltage.value);
      const tran = result.data.analyses.find((a) => a.analysis === "tran");
      expect(tran.timeSeconds[0]).toBe(0);
      expect(tran.timeSeconds.at(-1)).toBeCloseTo(4e-6, 14);
      expect(tran.timeSeconds.length).toBeGreaterThan(200);
      tran.timeSeconds
        .slice(1)
        .forEach((t, i) => expect(t).toBeGreaterThan(tran.timeSeconds[i]));
      const transientOutput = tran.probes.find((p) => p.name === "vout").value;
      expect(transientOutput[0]).toBeCloseTo(voltage.value, 6);
      expect(Math.max(...transientOutput)).toBeGreaterThan(voltage.value + 0.1);
      const noise = result.data.analyses.find((a) => a.analysis === "noise");
      expect(noise.frequencyHz).toHaveLength(181);
      expect(noise.frequencyHz[0]).toBe(1);
      expect(noise.frequencyHz.at(-1)).toBeCloseTo(1e9, 3);
      expect(noise.units.outputDensity).toBe("V/sqrt(Hz)");
      expect(noise.units.inputDensity).toBe("V/sqrt(Hz)");
      for (const density of [
        noise.outputNoiseDensity,
        noise.inputNoiseDensity,
      ]) {
        expect(density).toHaveLength(noise.frequencyHz.length);
        expect(density.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
      }
      // Input referral uses the very same linearized transfer as AC, not PSD
      // mistaken for amplitude density or an unrelated output-current unit.
      expect(
        noise.outputNoiseDensity[0] / noise.inputNoiseDensity[0],
      ).toBeCloseTo(Math.hypot(output.real[0], output.imag[0]), 5);
      for (const analysis of [dc, tran])
        for (const probe of analysis.probes)
          expect(probe.value.every(Number.isFinite)).toBe(true);
      const outputs = JSON.parse(await artifact("outputs.json"));
      for (const device of sensed) {
        for (const sense of device.currentSenses) {
          const signal = prepared.signalTargets[sense.vector][0];
          expect(signal.documentId).toBe(device.documentId);
          expect(signal.occurrence).toEqual(device.occurrence);
          expect(signal.terminal).toEqual({
            instanceId: device.instanceId,
            pinName: sense.pinName.toUpperCase(),
          });
          const label = prepared.signalNames[sense.vector];
          expect(label).toContain(
            `${device.instanceId}.${signal.terminal.pinName}`,
          );
          const displayed = outputs.analyses
            .find((a) => a.analysis === "op")
            .outputs.find((o) => o.id === `native:${sense.vector}`);
          expect(displayed.label).toBe(`${label} — ${sense.vector}`);
          expect(displayed.unit).toBe("A");
        }
      }
      expect(outputs.deviceOperatingPoints).toHaveLength(1);
      const mapped = outputs.deviceOperatingPoints.find(
        (d) => d.instanceId === "M1",
      );
      expect(mapped).toMatchObject({
        documentId: "document-ota-5t",
        occurrence: ["XDUT"],
        reference: "XDUT:XM1:msky130_fd_pr__nfet_01v8",
        polarity: "nmos",
      });
      expect(mapped.values).toHaveLength(9);
      expect(mapped.values.every((v) => v.status === "available")).toBe(true);
      expect(await artifact("op-0.csv")).toContain("vout");
      expect(await artifact("raw/bias.raw")).toContain(
        "XDUT:XM1:msky130_fd_pr__nfet_01v8.gm",
      );
      expect(await artifact("executed/circuit.spice")).toContain("XDUT");
      expect(await artifact(`executed/${folder.input.entry}`)).toContain(
        "options scale=0.000001",
      );
      expect(await readdir(root)).toEqual(["vacaskrc.toml"]);
      expect(project).toEqual(before);
    } catch (error) {
      // Failed evidence is kept locally for diagnosis; never registered or used
      // as a passing golden. A successful run cleans only its own temp directory.
      await writeFile(join(root, "failure.txt"), String(error));
      throw Error(`${root}: ${error}`, { cause: error });
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
      }
      if (!(await readdir(root)).includes("failure.txt"))
        await rm(root, { recursive: true });
    }
  },
  120000,
);

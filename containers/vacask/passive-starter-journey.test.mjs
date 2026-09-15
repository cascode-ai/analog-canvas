import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { parseProject } from "../../packages/project-protocol/src/index.js";
import { compileSourceSimulation } from "../../packages/netlist/src/simulation-source-compile.js";
import {
  vacaskMeasurementPythonSource,
  vacaskPlotPythonSource,
} from "../../packages/netlist/src/vacask-postprocess.js";
import { SimulationService } from "../../packages/simulation-service/src/service.js";
import { SimulationFiles } from "../../packages/simulation-service/src/files.js";
import { CapabilitiesSchema } from "../../packages/simulation-service/src/contract.js";
import { initializeVacaskRuntime } from "./runtime.mjs";
import { executeVacask } from "./execute.mjs";
import { SimulationRunSupervisor } from "../ngspice/run-supervisor.mjs";

// Analytical series RLC, output across C. Integrate the unit-step response
// over the unchanged 100 ns source ramp; do not approximate it as an ideal step.
function rlcReference(resistance) {
  const L = 0.01,
    C = 1e-7,
    a = resistance / (2 * L),
    w2 = 1 / (L * C);
  let step, integral;
  if (Math.abs(w2 - a * a) < w2 * 1e-8) {
    // The saved critical R has nine significant digits. Use the continuous
    // critical limit to avoid subtracting nearly equal roots (~5e-11 relative).
    step = (t) => 1 - Math.exp(-a * t) * (1 + a * t);
    integral = (t) => t - (2 - (2 + a * t) * Math.exp(-a * t)) / a;
  } else if (a * a < w2) {
    const b = Math.sqrt(w2 - a * a);
    step = (t) =>
      1 - Math.exp(-a * t) * (Math.cos(b * t) + (a / b) * Math.sin(b * t));
    integral = (t) => {
      const c = Math.cos(b * t),
        s = Math.sin(b * t),
        e = Math.exp(-a * t);
      return (
        t -
        (e * (-a * c + b * s) + a) / w2 -
        ((a / b) * (e * (-a * s - b * c) + b)) / w2
      );
    };
  } else {
    const d = Math.sqrt(a * a - w2),
      p = -a + d,
      q = -a - d;
    const cp = q / (p - q),
      cq = -p / (p - q);
    step = (t) => 1 + cp * Math.exp(p * t) + cq * Math.exp(q * t);
    integral = (t) =>
      t + (cp * Math.expm1(p * t)) / p + (cq * Math.expm1(q * t)) / q;
  }
  const positive = (f, t) => (t > 0 ? f(t) : 0);
  return (time) => {
    const t = time - 100e-6,
      rise = 100e-9;
    return {
      voltage: (positive(integral, t) - positive(integral, t - rise)) / rise,
      current: (C * (positive(step, t) - positive(step, t - rise))) / rise,
    };
  };
}

function assertRlcResult(data, measurements, resistance) {
  const ac = data.analyses.find((a) => a.analysis === "ac" && a.postprocessor);
  const tran = data.analyses.find((a) => a.analysis === "tran");
  expect(ac.frequencyHz).toHaveLength(401);
  expect(ac.frequencyHz[0]).toBe(100);
  expect(ac.frequencyHz.at(-1)).toBeCloseTo(1e6, 5);
  const gain = ac.probes.find((p) => p.name === "Gain");
  let maxAc = 0;
  for (const [index, frequency] of ac.frequencyHz.entries()) {
    const w = 2 * Math.PI * frequency,
      re = 1 - w * w * 0.01 * 1e-7,
      im = w * resistance * 1e-7;
    maxAc = Math.max(
      maxAc,
      Math.abs(gain.real[index] - re / (re * re + im * im)),
      Math.abs(gain.imag[index] + im / (re * re + im * im)),
    );
  }
  expect(maxAc).toBeLessThan(1e-7);
  const output = tran.probes.find((p) => p.name === "out");
  const current = tran.probes.find((p) => p.name === "L1:flow(br)");
  expect(current).toBeDefined();
  expect(tran.timeSeconds.at(-1)).toBe(1e-3);
  const reference = rlcReference(resistance);
  let maxVoltage = 0,
    maxCurrent = 0;
  for (const [index, time] of tran.timeSeconds.entries()) {
    const exact = reference(time);
    maxVoltage = Math.max(
      maxVoltage,
      Math.abs(output.value[index] - exact.voltage),
    );
    maxCurrent = Math.max(
      maxCurrent,
      Math.abs(current.value[index] - exact.current),
    );
  }
  console.info(
    "RLC-analytical-errors",
    JSON.stringify({ resistance, maxAc, maxVoltage, maxCurrent }),
  );
  expect(maxVoltage).toBeLessThan(1e-5);
  expect(maxCurrent).toBeLessThan(1e-7);
  const measured = (name) => measurements.find((m) => m.name === name).value;
  expect(measured("peak_output")).toBe(Math.max(...output.value));
  expect(measured("final_value")).toBe(output.value.at(-1));
  expect(
    Math.abs(
      measured("peak_gain_db") -
        Math.max(
          ...gain.real.map(
            (v, i) => 20 * Math.log10(Math.hypot(v, gain.imag[i])),
          ),
        ),
    ),
  ).toBeLessThan(1e-10);
}

const projects = await Promise.all(
  ["rc", "rlc"].map(async (kind) => ({
    kind,
    project: parseProject(
      await readFile(
        new URL(
          `../../apps/editor/src/examples/simulation-${kind}.icproj.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  })),
);
const resistanceFor = (id) =>
  ({ "rlc-1": 200, "rlc-2": 632.455532, "rlc-3": 1000 })[id];
const reference = (kind, name) =>
  readFile(
    new URL(
      `../../netlists/native-${kind === "rc" ? "rc-filters" : "rlc-filter"}/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

it.each(projects)(
  "ships $kind experiments as native source with editable shared report helpers",
  async ({ kind, project }) => {
    const before = structuredClone(project);
    expect(project.simulationFolders).toHaveLength(kind === "rc" ? 4 : 3);
    for (const folder of project.simulationFolders) {
      const source = (path) =>
        folder.input.files.find((file) => file.path === path).text;
      const template = (
        await reference(
          kind,
          kind === "rlc"
            ? "rlc.sim"
            : folder.id.endsWith("-ac")
              ? "ac.sim"
              : "step.sim",
        )
      )
        .replaceAll("\r\n", "\n")
        .replace(
          'alter instance("R1") r=200',
          `alter instance("R1") r=${resistanceFor(folder.id)}`,
        );
      expect(source(folder.input.entry)).toBe(
        folder.name + "\n" + template.slice(template.indexOf("\n") + 1),
      );
      expect(source("report.py")).toBe(
        (
          await readFile(
            new URL(
              "../../scripts/lib/native-passive-report.py",
              import.meta.url,
            ),
            "utf8",
          )
        ).replaceAll("\r\n", "\n"),
      );
      expect(source("icm_reports.py")).toBe(
        vacaskMeasurementPythonSource() + "\n" + vacaskPlotPythonSource(),
      );
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      expect(compiled.config.environment.profileId).toBe("vacask-passives-v1");
      expect(
        compiled.files.find((f) => f.path === "circuit.spice").text,
      ).toContain('load "capacitor.osdi"');
    }
    expect(project).toEqual(before);
  },
);

// Real local, observed native Profile, not pinned/cloud/model qualification.
it
  .skipIf(
    !process.env.VACASK_BIN ||
      !process.env.VACASK_MODULES ||
      !process.env.ICM_PYTHON ||
      !process.env.ICM_PYTHON_LIBRARIES,
  )
  .each(projects)(
  "runs bundled $kind AC and step through Prepare/Run/Read, measurements and CSV",
  async ({ kind, project }) => {
    const before = structuredClone(project);
    const root = await mkdtemp(join(tmpdir(), `icm-${kind}-starters-`));
    try {
      const startupPath = join(root, "startup.toml");
      await writeFile(
        startupPath,
        `[Binaries]\npython = ${JSON.stringify(process.env.ICM_PYTHON)}\n`,
      );
      const runtime = await initializeVacaskRuntime({
        executor: "local-host",
        profileId: "vacask-passives-v1",
        binary: resolve(process.env.VACASK_BIN),
        modules: resolve(process.env.VACASK_MODULES),
        startupPath,
        runRoot: root,
        python: {
          binary: resolve(process.env.ICM_PYTHON),
          libraries: process.env.ICM_PYTHON_LIBRARIES.split(delimiter),
        },
        ...(process.env.ICM_VACASK_LIBRARY_PATH
          ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
          : {}),
      });
      const limits = {
        maxInputBytes: 65536,
        maxInputFiles: 12,
        maxOutputBytes: 1048576,
        maxLogBytes: 65536,
        maxRawFiles: 16,
        maxEntries: 256,
      };
      const capabilities = CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["ac", "tran"],
        parsedAnalyses: ["ac", "tran"],
        profiles: [{ id: "vacask-passives-v1", corners: [] }],
        maxTimeoutMs: 15000,
        maxInputBytes: limits.maxInputBytes,
        maxInputFiles: limits.maxInputFiles,
        maxOutputBytes: limits.maxOutputBytes,
        cancel: false,
      });
      const supervisor = new SimulationRunSupervisor();
      const files = new SimulationFiles();
      const service = new SimulationService(
        files,
        {
          capabilities: async () => capabilities,
          execute: async (input) => {
            const reply = await executeVacask(
              input,
              runtime,
              limits,
              supervisor,
            );
            if (!reply.ok) throw Error(JSON.stringify(reply));
            return reply.output;
          },
          cancel: async () => {},
        },
        () => project,
      );
      for (const folder of project.simulationFolders) {
        const prepared = await service.handle(
          {
            operation: "prepare",
            source: {
              kind: "project-folder",
              folderId: folder.id,
              expectedStructureRevision: project.structureRevision,
            },
          },
          `prepare-${folder.id}`,
        );
        expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
        const started = await service.handle(
          {
            operation: "start",
            preparedId: prepared.prepared.id,
            digest: prepared.prepared.digest,
          },
          `start-${folder.id}`,
        );
        expect(started.ok, JSON.stringify(started)).toBe(true);
        let run;
        await vi.waitFor(
          async () => {
            const reply = await service.handle(
              { operation: "read", runId: started.run.id },
              `read-${folder.id}`,
            );
            expect(reply.ok, JSON.stringify(reply)).toBe(true);
            run = reply.run;
            expect(run.state).toBe("finished");
          },
          { timeout: 20000 },
        );
        expect(
          run.result.outcome.status,
          JSON.stringify({ id: folder.id, result: run.result }),
        ).toBe("completed");
        // Large waveforms intentionally leave Read as a bounded receipt. Fetch
        // complete arrays through the same paged File API used by GUI/MCP.
        const artifactText = async (name) => {
          const ref = run.artifacts.find((a) => a.name === name);
          expect(ref, name).toBeDefined();
          let offset = 0,
            text = "";
          do {
            const part = await files.handle({
              action: "artifact",
              artifactId: ref.id,
              offset,
              maxChars: 65536,
            });
            expect(part.ok, name).toBe(true);
            text += part.text;
            offset = part.nextOffset;
          } while (offset !== null);
          return text;
        };
        const measurements = JSON.parse(
          await artifactText("native-measurements.json"),
        );
        const result = JSON.parse(await artifactText("result.json"));
        console.info(
          "Passive-native-evidence",
          JSON.stringify({
            folderId: folder.id,
            metadata: result.metadata,
            measurements,
            analyses: result.data.analyses.map((a) => ({
              analysis: a.analysis,
              points: a.frequencyHz?.length ?? a.timeSeconds?.length,
              postprocessor: !!a.postprocessor,
            })),
          }),
        );
        expect(
          measurements.every((m) => m.status === "available"),
          JSON.stringify(measurements),
        ).toBe(true);
        const high = folder.id.includes("-hp-");
        if (kind === "rlc") {
          assertRlcResult(result.data, measurements, resistanceFor(folder.id));
        } else if (folder.id.endsWith("-ac")) {
          const transfer = result.data.analyses.find((a) => a.postprocessor);
          expect(transfer.analysis).toBe("ac");
          expect(transfer.frequencyHz[0]).toBe(10);
          expect(transfer.frequencyHz.at(-1)).toBeCloseTo(1e6, 5);
          const gain = transfer.probes.find((p) => p.name === "Gain");
          expect(gain.real).toHaveLength(401);
          for (let index = 0; index < transfer.frequencyHz.length; index++) {
            const w = 2 * Math.PI * transfer.frequencyHz[index] * 1e-4;
            const real = high ? (w * w) / (1 + w * w) : 1 / (1 + w * w);
            const imag = (high ? w : -w) / (1 + w * w);
            expect(Math.abs(gain.real[index] - real)).toBeLessThan(1e-7);
            expect(Math.abs(gain.imag[index] - imag)).toBeLessThan(1e-7);
          }
          // The authored measurement interpolates the sampled dB trace, like the
          // original recipe. Its grid error is not a solver/model tolerance.
          expect(
            Math.abs(
              measurements.find((m) => m.name === "gain_at_fc").value +
                10 * Math.log10(2),
            ),
          ).toBeLessThan(0.002);
        } else {
          const rampEnd = 100.1e-6,
            tau = 1e-4,
            rise = 100e-9;
          const highAt = (time) =>
            (tau / rise) *
            -Math.expm1(-rise / tau) *
            Math.exp(-(time - rampEnd) / tau);
          for (const [name, time] of [
            ["at_one_tau", 200.05e-6],
            ["final_value", 1e-3],
          ]) {
            const expected = high ? highAt(time) : 1 - highAt(time);
            // Linear interpolation at a requested instant on a <=1 us grid;
            // the bound covers that sampling error for this analytical RC.
            expect(
              Math.abs(
                measurements.find((m) => m.name === name).value - expected,
              ),
            ).toBeLessThan(1e-5);
          }
        }
        const csv = run.artifacts.find(
          (a) => a.name === "native-measurements.csv",
        );
        expect(csv).toBeDefined();
        const downloaded = await files.handle({
          action: "artifact",
          artifactId: csv.id,
          maxChars: 65536,
        });
        expect(downloaded.ok).toBe(true);
        expect(downloaded.text).toContain(
          kind === "rlc"
            ? "peak_output"
            : folder.id.endsWith("-ac")
              ? "gain_at_fc"
              : "at_one_tau",
        );
      }
      expect(project).toEqual(before);
      expect(supervisor.snapshot().state).toBe("idle");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);

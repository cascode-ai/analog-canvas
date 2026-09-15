import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
} from "../../packages/model/src/index.js";
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

// Real native process + authored stdlib-only Python + public service/File API.
// This does not certify a Python environment, hostile-code sandbox or cloud run.
it.skipIf(
  !process.env.VACASK_BIN ||
    !process.env.VACASK_MODULES ||
    !process.env.ICM_PYTHON,
)(
  "publishes actual postprocessor measurements, recovers per expression, and preserves artifacts",
  async () => {
    const project = createEmptyProject(
      "measurement-project",
      "Measurements",
      "main",
    );
    const folder = createSimulationFolder({
      id: "measured",
      name: "Measured",
      profileId: "measure-proof",
    });
    const entry = folder.input.files.find((f) => f.path === folder.input.entry);
    entry.text = `Native measurements
model v vsource
V1 (out 0) v dc=2.5 mag=2
control
options rawfile="ascii"
save v(out)
analysis bias op
analysis frequency ac from=10 to=100 mode="lin" points=3
postprocess(${JSON.stringify(process.env.ICM_PYTHON)}, "reports.py")
endc
embed "reports.py" <<<REPORT
${vacaskMeasurementPythonSource()}
${vacaskPlotPythonSource()}
# Read this run's real one-point native OP artifact, not a test's expected value.
from pathlib import Path
lines = Path("bias.raw").read_text().splitlines()
start = lines.index("Variables:") + 1
end = lines.index("Values:")
names = [line.split()[1] for line in lines[start:end]]
numbers = " ".join(lines[end+1:]).split()[1:len(names)+1]
bias = dict(zip(names, map(float, numbers)))
report_measurement("voltage", lambda: bias["out"], "V")
report_measurement("invalid", lambda: 1/0, "1")
report_measurement("nonfinite", lambda: float("nan"), "V")
report_measurement("vector", lambda: [bias["out"]], "V")
report_measurement("gain", lambda: bias["out"]/2, "1")
report_measurement("voltage", lambda: bias["out"]*2, "V")
# Test-only native ASCII reader/writer; the helper supplies metadata, not math.
# Read real solver arrays, then compute a complex expression in authored Python.
lines = Path("frequency.raw").read_text().splitlines()
start = lines.index("Variables:") + 1
end = lines.index("Values:")
names = [line.split()[1] for line in lines[start:end]]
tokens = " ".join(lines[end+1:]).split()
rows = []
for at in range(0, len(tokens), len(names)+1):
    values = [complex(*map(float, item.split(","))) for item in tokens[at+1:at+len(names)+1]]
    point = dict(zip(names, values))
    rows.append((point["frequency"], point["out"]/(1+1j)))
header = ["Title: Authored complex expression", "Date: Current run", "Plotname: Derived transfer",
          "Flags: complex", "No. Variables: 2", "No. Points: " + str(len(rows)),
          "Variables:", "0 frequency notype", "1 Gain notype", "Values:"]
for index, (frequency, gain) in enumerate(rows):
    header.extend([f"{index} {frequency.real:.17e},0", f" {gain.real:.17e},{gain.imag:.17e}"])
Path("derived.raw").write_text(chr(10).join(header) + chr(10))
report_plot("derived.raw", "ac", axis="frequency",
            probes=[{"name": "Gain", "quantity": "transfer", "unit": "1"}])
>>>REPORT
`;
    project.simulationFolders = [folder];
    const before = structuredClone(project);
    const root = await mkdtemp(join(tmpdir(), "icm-native-measurements-"));
    try {
      const startupPath = join(root, "startup.toml");
      await writeFile(startupPath, "# controlled native measurement proof\n");
      const runtime = await initializeVacaskRuntime({
        executor: "local-host",
        profileId: "measure-proof",
        binary: resolve(process.env.VACASK_BIN),
        modules: resolve(process.env.VACASK_MODULES),
        startupPath,
        runRoot: root,
        ...(process.env.ICM_VACASK_LIBRARY_PATH
          ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
          : {}),
      });
      const limits = {
        maxInputBytes: 65536,
        maxInputFiles: 8,
        maxOutputBytes: 131072,
        maxLogBytes: 65536,
        maxRawFiles: 16,
        maxEntries: 256,
      };
      const caps = CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["op", "ac"],
        parsedAnalyses: ["op", "ac"],
        profiles: [{ id: "measure-proof", corners: [] }],
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
          capabilities: async () => caps,
          execute: async (input) => {
            const r = await executeVacask(input, runtime, limits, supervisor);
            if (!r.ok) throw Error(JSON.stringify(r));
            return r.output;
          },
          cancel: async () => {},
        },
        () => project,
      );
      const prepared = await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: folder.id,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "prepare",
      );
      expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      const started = await service.handle(
        {
          operation: "start",
          preparedId: prepared.prepared.id,
          digest: prepared.prepared.digest,
        },
        "start",
      );
      expect(started.ok, JSON.stringify(started)).toBe(true);
      let finished;
      await vi.waitFor(
        async () => {
          const read = await service.handle(
            { operation: "read", runId: started.run.id },
            "read",
          );
          finished = read.run;
          expect(finished.state).toBe("finished");
        },
        { timeout: 20000 },
      );
      expect(
        finished.result.outcome.status,
        JSON.stringify({
          diagnostics: finished.result.diagnostics,
          log: finished.result.log,
        }),
      ).toBe("completed");
      expect(finished.outputData.nativeMeasurements).toMatchObject([
        {
          name: "voltage",
          occurrence: 1,
          value: 2.5,
          unit: "V",
          origin: "postprocessor",
        },
        { name: "invalid", status: "unavailable", detail: "division by zero" },
        {
          name: "nonfinite",
          status: "unavailable",
          detail: "Measurement is not finite",
        },
        {
          name: "vector",
          status: "unavailable",
          detail: "Measurement must be a real numeric scalar",
        },
        { name: "gain", value: 1.25 },
        { name: "voltage", occurrence: 2, value: 5 },
      ]);
      const derivedIndex = finished.result.data.analyses.findIndex(
        (a) => a.postprocessor,
      );
      expect(derivedIndex).toBeGreaterThan(-1);
      const derived = finished.result.data.analyses[derivedIndex];
      const native = finished.result.data.analyses.find(
        (a) => a.analysis === "ac" && !a.postprocessor,
      );
      expect(derived.frequencyHz).toEqual(native.frequencyHz);
      expect(derived.probes).toEqual([
        {
          name: "Gain",
          quantity: "transfer",
          unit: "1",
          real: native.frequencyHz.map(() => 1),
          imag: native.frequencyHz.map(() => -1),
        },
      ]);
      expect(finished.outputData.analyses[derivedIndex]).toMatchObject({
        postprocessor: derived.postprocessor,
        outputs: [
          { label: "Gain", unit: "1", semantics: { valueKind: "complex" } },
        ],
      });
      const derivedCsvRef = finished.artifacts.find(
        (a) => a.name === `ac-${derivedIndex}.csv`,
      );
      expect(derivedCsvRef).toBeDefined();
      const derivedCsv = await files.handle({
        action: "artifact",
        artifactId: derivedCsvRef.id,
        maxChars: 65536,
      });
      expect(derivedCsv.ok).toBe(true);
      expect(derivedCsv.text).toContain("Gain");
      expect(derivedCsv.text).toContain("1,-1");
      const ref = finished.artifacts.find(
        (a) => a.name === "native-measurements.json",
      );
      expect(ref).toBeDefined();
      const artifact = await files.handle({
        action: "artifact",
        artifactId: ref.id,
        offset: 0,
        maxChars: 65536,
      });
      expect(artifact.ok).toBe(true);
      expect(JSON.parse(artifact.text)).toEqual(
        finished.outputData.nativeMeasurements,
      );
      const csvRef = finished.artifacts.find(
        (a) => a.name === "native-measurements.csv",
      );
      expect(csvRef).toBeDefined();
      const csv = await files.handle({
        action: "artifact",
        artifactId: csvRef.id,
        offset: 0,
        maxChars: 65536,
      });
      expect(csv.text).toContain(
        '"voltage","1","available","2.5","V","postprocessor"',
      );
      expect(csv.text).toContain(
        '"invalid","0","unavailable","","1","postprocessor"',
      );
      expect(project).toEqual(before);
      expect(supervisor.snapshot().state).toBe("idle");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);

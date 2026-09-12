import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { compileSourceSimulation } from "../packages/netlist/dist/index.js";

const root = resolve(process.argv[2] ?? "output/native-simulation-examples");
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await read(join(root, "manifest.json"));
const runs = new Map();
const checks = [];
function check(name, actual, expected, tolerance) {
  checks.push({
    name,
    actual,
    expected,
    tolerance,
    passed: Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  });
}
for (const project of manifest.projects) {
  const currentProject = parseProject(await readFile(project.file, "utf8"));
  const receipt = await read(
    join(root, "results", project.slug, "receipt.json"),
  );
  assert.equal(receipt.status, "passed", `${project.slug}: incomplete MCP run`);
  for (const folder of project.folders) {
    const dir = join(root, "results", project.slug, folder.id);
    const runReceipt = await read(join(dir, "run.json"));
    assert.equal(
      receipt.runs.find((r) => r.folderId === folder.id)?.runId,
      runReceipt.id,
      `${folder.id}: result must belong to this batch`,
    );
    assert(runReceipt.artifacts.some((a) => a.name === "result.json"));
    for (const artifact of runReceipt.artifacts) {
      const bytes = await readFile(join(dir, artifact.name));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        artifact.sha256,
        `${folder.id}: stale or corrupt ${artifact.name}`,
      );
    }
    const compiled = compileSourceSimulation(
      currentProject,
      currentProject.simulationFolders.find((f) => f.id === folder.id),
    );
    assert(compiled.ok, `${folder.id}: current Project does not compile`);
    for (const file of compiled.files)
      assert.equal(
        await readFile(join(dir, file.path), "utf8"),
        file.text,
        `${folder.id}/${file.path}: delivered Project must match the simulated electrical input`,
      );
    const result = await read(join(dir, "result.json"));
    assert.equal(result.outcome.status, "completed", folder.id);
    const analyses = result.data?.analyses ?? [];
    assert(analyses.length > 0, `${folder.id}: no captured results`);
    const measurements = await read(
      join(dir, "native-measurements.json"),
    ).catch(() => []);
    assert(
      measurements.every((m) => m.status === "available"),
      `${folder.id}: failed native measurement`,
    );
    for (const a of analyses)
      for (const p of a.probes ?? []) {
        for (const values of [p.value, p.real, p.imag]) {
          if (values !== undefined)
            assert(
              (Array.isArray(values) ? values : [values]).every(
                Number.isFinite,
              ),
              `${folder.id}: nonfinite ${p.name}`,
            );
        }
      }
    // The Results exporter returns a ZIP when a record has multiple plot groups.
    for (let i = 0; i < analyses.length; i++) {
      const plot = join(dir, `plot-${i}.svg`);
      const bytes = await readFile(plot).catch(() => null);
      if (bytes?.subarray(0, 2).toString() === "PK")
        await rename(plot, join(dir, `plot-${i}.zip`));
    }
    runs.set(folder.id, {
      project: project.slug,
      name: folder.name,
      result,
      analyses,
      measurements,
    });
  }
}
const meas = (id, name, occurrence = 1) =>
  runs
    .get(id)
    .measurements.find((m) => m.name === name && m.occurrence === occurrence)
    ?.value;
const analysis = (id, kind) =>
  runs.get(id).analyses.find((a) => a.analysis === kind);
const probe = (a, name) => {
  const p = a.probes.find((p) => p.name === name);
  assert(p, `missing ${name}`);
  return p;
};
const scalar = (p) => (Array.isArray(p.value) ? p.value[0] : p.value);
for (const [id, run] of runs) {
  if (id === "ota-noise" || id.endsWith("-op")) continue;
  const pair = id.startsWith("ota-")
    ? ["v(vinp)", "v(vout)"]
    : ["v(in)", "v(out)"];
  for (const a of run.analyses) for (const name of pair) probe(a, name);
}
for (const kind of ["lp", "hp"])
  check(
    `RC ${kind} cutoff dB`,
    meas(`rc-${kind}-ac`, "gain_at_fc"),
    -10 * Math.log10(2),
    0.005,
  );
check(
  "RC LP one time constant",
  meas("rc-lp-tran", "at_one_tau"),
  1 - Math.exp(-1),
  0.001,
);
check(
  "RC HP one time constant",
  meas("rc-hp-tran", "at_one_tau"),
  Math.exp(-1),
  0.001,
);
const zeta = (200 / 2) * Math.sqrt(100e-9 / 10e-3);
check(
  "RLC underdamped peak",
  meas("rlc-1", "peak_output"),
  1 + Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)),
  0.002,
);
check(
  "RLC resonance dB",
  meas("rlc-1", "peak_gain_db"),
  20 * Math.log10(1 / (2 * zeta * Math.sqrt(1 - zeta * zeta))),
  0.01,
);
for (const id of ["rlc-2", "rlc-3"])
  check(`${id} monotonic step peak`, meas(id, "peak_output"), 1, 0.001);

const cs = analysis("cs-op", "op");
const csOut = scalar(probe(cs, "v(out)"));
const csCurrent = -scalar(probe(cs, "i(vdd)"));
check("Common-source load line", csOut + csCurrent * 10000, 1.8, 1e-5);
const csGm = scalar(cs.probes.find((p) => p.name.endsWith("[gm]")));
const csGds = scalar(cs.probes.find((p) => p.name.endsWith("[gds]")));
const gainEstimate = csGm / (1 / 10000 + csGds);
check(
  "Common-source AC versus gm/(1/R+gds)",
  meas("cs-ac", "gain_db_1khz"),
  20 * Math.log10(gainEstimate),
  0.05,
);
check(
  "Common-source small signal p-p",
  meas("cs-tran", "output_pp", 1),
  0.02 * gainEstimate,
  0.02 * gainEstimate * 0.05,
);
const csAc = analysis("cs-ac", "ac");
const csVout = probe(csAc, "v(out)");
assert(csVout.real[0] < 0, "common source must invert");
const csDistortion = runs.get("cs-tran").analyses.map((a) => {
  const t = a.timeSeconds,
    y = probe(a, "v(out)").value;
  const n = 2048,
    samples = [];
  let k = 0;
  for (let j = 0; j < n; j++) {
    const at = 200e-6 + (j * 200e-6) / n;
    while (k + 1 < t.length - 1 && t[k + 1] < at) k++;
    const f = (at - t[k]) / (t[k + 1] - t[k]);
    samples.push(y[k] + f * (y[k + 1] - y[k]));
  }
  const harmonics = Array.from({ length: 5 }, (_, i) => {
    let re = 0,
      im = 0;
    for (let j = 0; j < n; j++) {
      const phase = (2 * Math.PI * (i + 1) * 2 * j) / n;
      re += samples[j] * Math.cos(phase);
      im += samples[j] * Math.sin(phase);
    }
    return (2 * Math.hypot(re, im)) / n;
  });
  return {
    minV: Math.min(...samples),
    maxV: Math.max(...samples),
    harmonicsV: harmonics,
    thd2to5: Math.hypot(...harmonics.slice(1)) / harmonics[0],
  };
});
assert(
  csDistortion[1].thd2to5 > csDistortion[0].thd2to5,
  "large signal should show greater distortion",
);

const otaOp = analysis("ota-op", "op");
const otaOut = scalar(probe(otaOp, "v(vout)"));
check("OTA nominal output bias", otaOut, 0.75898, 0.005);
const otaAC = [];
for (const corner of ["tt", "ff", "ss"]) {
  assert(meas(`ota-ac-${corner}`, "dc_gain_db") > 20);
  assert(meas(`ota-ac-${corner}`, "unity_gain_hz") > 0);
  const a = analysis(`ota-ac-${corner}`, "ac"),
    unity = meas(`ota-ac-${corner}`, "unity_gain_hz");
  const phase = probe(a, "phase_deg").real;
  const i = a.frequencyHz.findIndex((f) => f >= unity);
  assert(i > 0);
  const fraction =
    Math.log(unity / a.frequencyHz[i - 1]) /
    Math.log(a.frequencyHz[i] / a.frequencyHz[i - 1]);
  otaAC.push({
    corner,
    gainDb: meas(`ota-ac-${corner}`, "dc_gain_db"),
    unityHz: unity,
    nominalPhaseMarginDeg:
      180 + phase[i - 1] + fraction * (phase[i] - phase[i - 1]),
  });
}
check(
  "OTA unity follower low frequency",
  meas("ota-closed", "closed_gain_db"),
  20 * Math.log10(120.1227 / (1 + 120.1227)),
  0.04,
);
check(
  "OTA closed-loop step target",
  meas("ota-closed", "output_at_2us"),
  0.91,
  0.003,
);
const noise = runs.get("ota-noise").analyses;
const noiseRecord = noise.find((a) => a.analysis === "noise");
assert(
  noiseRecord?.rawPlotOrdinals.length === 2,
  "capture noise spectrum and integrated noise",
);
for (const density of [
  noiseRecord.inputNoiseDensity,
  noiseRecord.outputNoiseDensity,
])
  assert(density.every((v) => Number.isFinite(v) && v > 0));
assert(
  noiseRecord.integratedInputNoise > 0 && noiseRecord.integratedOutputNoise > 0,
);

const summary = {
  environment: runs.get("ota-op").result.metadata.environment,
  checks,
  commonSource: {
    outputV: csOut,
    supplyA: csCurrent,
    gm: csGm,
    gds: csGds,
    gainEstimate,
    smallSignalPP: meas("cs-tran", "output_pp", 1),
    largeSignalPP: meas("cs-tran", "output_pp", 2),
    distortion: csDistortion,
  },
  ota: {
    ac: otaAC,
    outputV: otaOut,
    supplyA: -scalar(probe(otaOp, "i(vdd)")),
    deviceValues: otaOp.probes.filter((p) => p.name.includes("[")),
    noise: {
      integratedInputV: noiseRecord.integratedInputNoise,
      integratedOutputV: noiseRecord.integratedOutputNoise,
      minFrequencyHz: noiseRecord.frequencyHz[0],
      maxFrequencyHz: noiseRecord.frequencyHz.at(-1),
      inputAt1Hz: noiseRecord.inputNoiseDensity[0],
      outputAt1Hz: noiseRecord.outputNoiseDensity[0],
    },
  },
  measurements: Object.fromEntries(
    [...runs].map(([id, r]) => [id, r.measurements]),
  ),
};
await writeFile(
  join(root, "acceptance.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      checks,
      commonSource: summary.commonSource,
      ota: { outputV: summary.ota.outputV, supplyA: summary.ota.supplyA },
    },
    null,
    2,
  ),
);
assert(
  checks.every((c) => c.passed),
  "Electrical acceptance failed; inspect acceptance.json",
);

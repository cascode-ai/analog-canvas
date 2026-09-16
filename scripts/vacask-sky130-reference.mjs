import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { parseNgspiceRawfile } from "../packages/spice-run/dist/rawfile.js";
import {
  referenceModelTreeSha256,
  upgradeReferenceModelVersions,
  sha256,
  otaReferenceDeck,
} from "./lib/vacask-sky130-reference.mjs";

// Offline independent reference only, not a fallback runtime. The original
// simulator/models and historical baseline JSON are never overwritten.
const { values } = parseArgs({
  options: {
    binary: { type: "string" },
    models: { type: "string" },
    output: { type: "string", default: "output/vacask-qualification" },
    "noise-points": { type: "string", default: "20" },
    "noise-details": { type: "boolean", default: false },
  },
});
if (!values.binary || !values.models)
  throw Error(
    "Use --binary <original pinned ngspice 46> --models <original /opt/sky130 tree> [--output <parent>] [--noise-points <points-per-decade>] [--noise-details]",
  );
const binary = resolve(values.binary),
  modelRoot = resolve(values.models);
const models = join(modelRoot, "continuous");
const noiseSampling = {
  noisePointsPerDecade: Number(values["noise-points"]),
  noiseSourceDetails: values["noise-details"],
};
// Check before expensive model hashing/copying or simulator execution.
otaReferenceDeck({
  circuit: "",
  testbench: "",
  corner: "tt",
  ...noiseSampling,
});
const profile = JSON.parse(
  readFileSync(
    new URL(
      "../containers/ngspice/hosted-sky130-profile.json",
      import.meta.url,
    ),
  ),
);
if (sha256(readFileSync(binary)) !== profile.simulator.binarySha256)
  throw Error("Reference binary differs from frozen ngspice 46");
if (referenceModelTreeSha256(modelRoot) !== profile.models.contentSha256)
  throw Error("Reference models differ from the frozen original tree");
const parent = resolve(values.output);
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, "bsim483-reference-"));
const upgraded = join(output, "models");
mkdirSync(upgraded);
const report = {
  scope:
    "Offline BSIM4 4.8.3 reference acquisition, not VACASK acceptance or a hosted Profile",
  sourceProfileId: profile.id,
  binarySha256: profile.simulator.binarySha256,
  originalModelTreeSha256: profile.models.contentSha256,
  originalContinuousTreeSha256: referenceModelTreeSha256(models),
  modelVersion: "4.8.3",
  noiseSampling,
  files: {},
  cases: [],
};
for (const file of readdirSync(models)) {
  const bytes = readFileSync(join(models, file));
  const result = file.endsWith(".spice")
    ? upgradeReferenceModelVersions(bytes.toString("utf8"))
    : { text: bytes, counts: {} };
  writeFileSync(join(upgraded, file), result.text);
  report.files[file] = {
    originalSha256: sha256(bytes),
    upgradedSha256: sha256(result.text),
    sourceVersions: result.counts,
  };
}
report.upgradedModelTreeSha256 = referenceModelTreeSha256(upgraded);
const circuit = readFileSync(
  "fixtures/simulation-acceptance/ota-5t.spi",
  "utf8",
);
const tb = readFileSync(
  "fixtures/simulation-acceptance/ota-5t-hosted.testbench.spice",
  "utf8",
).split(".control")[0];
console.log(`Evidence: ${output}`);
for (const corner of profile.models.library.sections) {
  const cwd = join(output, corner);
  mkdirSync(cwd);
  const deck = otaReferenceDeck({
    circuit,
    testbench: tb,
    corner,
    ...noiseSampling,
  });
  writeFileSync(join(cwd, "run.cir"), deck);
  const run = spawnSync(binary, ["-n", "-b", "run.cir"], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...Object.fromEntries(
        ["PATH", "SystemRoot", "WINDIR", "LD_LIBRARY_PATH"]
          .filter((k) => process.env[k])
          .map((k) => [k, process.env[k]]),
      ),
      HOME: cwd,
      USERPROFILE: cwd,
      LC_ALL: "C",
      OMP_NUM_THREADS: "1",
    },
  });
  writeFileSync(join(cwd, "stdout.log"), run.stdout ?? "");
  writeFileSync(join(cwd, "stderr.log"), run.stderr ?? "");
  const evidence = {
    corner,
    sourceSha256: sha256(deck),
    exitCode: run.status,
    files: {},
    passed: false,
  };
  report.cases.push(evidence);
  try {
    if (run.error || run.status !== 0)
      throw Error(run.error?.message ?? "Reference process failed");
    for (const [name, count] of [
      ["op", 1],
      ["dc", 9],
      ["ac", 91],
      ["tran", null],
      ["noise", noiseSampling.noisePointsPerDecade * 9 + 1],
      ["integrated", 1],
    ]) {
      const bytes = readFileSync(join(cwd, name + ".raw"));
      const parsed = parseNgspiceRawfile(bytes.toString("utf8"));
      if (!parsed.ok || parsed.plots.length !== 1)
        throw Error(`Invalid reference raw output: ${name}`);
      const plot = parsed.plots[0];
      if (count !== null && plot.pointCount !== count)
        throw Error(`Wrong reference point count: ${name}`);
      evidence.files[name + ".raw"] = {
        sha256: sha256(bytes),
        pointCount: plot.pointCount,
        variables: plot.vectors.map((v) => v.variable.name),
      };
    }
    evidence.passed = true;
  } catch (e) {
    evidence.error = String(e);
  }
  writeFileSync(
    join(output, "reference.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
}
if (report.cases.some((c) => !c.passed)) process.exitCode = 1;

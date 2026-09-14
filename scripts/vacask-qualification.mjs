import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseVacaskRawfile } from "../packages/spice-run/dist/vacask-rawfile.js";

// Local, trusted analytical fixtures only. This is not the hosted executor,
// a foundry qualification, or an alternate product run/receipt protocol.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    binary: { type: "string" },
    modules: { type: "string" },
    compiler: { type: "string" },
    output: {
      type: "string",
      default: join(root, "output/vacask-qualification"),
    },
  },
});
if (!values.binary || !values.modules)
  throw new Error(
    "Usage: node scripts/vacask-qualification.mjs --binary <vacask> --modules <module-directory> [--compiler <openvaf-r>] [--output <directory>]",
  );
const binary = resolve(values.binary);
const moduleDirectory = resolve(values.modules);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const outputRoot = resolve(values.output);
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(join(outputRoot, "run-"));
// Explicit configuration prevents system/user/startup TOML from changing a run.
const startup =
  "# Analog Canvas controlled VACASK qualification configuration\n";
const startupPath = join(output, "vacaskrc.toml");
writeFileSync(startupPath, startup);
const environment = {
  ...Object.fromEntries(
    ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LD_LIBRARY_PATH"].flatMap(
      (key) => (process.env[key] ? [[key, process.env[key]]] : []),
    ),
  ),
  HOME: output,
  USERPROFILE: output,
  LC_ALL: "C",
  SIM_MODULE_PATH: moduleDirectory,
  OMP_NUM_THREADS: "1",
  OPENBLAS_NUM_THREADS: "1",
};
const run = (args, cwd) =>
  spawnSync(binary, ["--tomlfile", startupPath, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
const identity = run(["-h"], output);
if (identity.error || identity.status !== 0)
  throw new Error(
    `VACASK identity probe failed: ${identity.error?.message ?? identity.stderr}`,
  );
const report = {
  scope: "local analytical qualification only; not a hosted SKY130 Profile",
  platform: `${process.platform}/${process.arch}`,
  startupSha256: digest(startup),
  binary: {
    sha256: digest(readFileSync(binary)),
    banner: identity.stdout + identity.stderr,
  },
  modules: Object.fromEntries(
    ["resistor.osdi", "capacitor.osdi"].map((name) => [
      name,
      digest(readFileSync(join(moduleDirectory, name))),
    ]),
  ),
  customModel: values.compiler ? "requested" : "not-requested",
  cases: [],
};

function vector(plot, name, imaginary = false) {
  const entry = plot.vectors.find((item) => item.variable.name === name);
  if (!entry) throw new Error(`Missing native vector: ${name}`);
  const result = imaginary ? entry.imag : entry.real;
  if (!result) throw new Error(`Missing imaginary values: ${name}`);
  return result;
}

function compare(label, actual, expected, absolute, relative) {
  if (actual.length === 0 || actual.length !== expected.length)
    throw new Error(`${label}: missing or unequal arrays`);
  let maxToleranceRatio = 0;
  for (let index = 0; index < actual.length; index++) {
    if (!Number.isFinite(actual[index]) || !Number.isFinite(expected[index]))
      throw new Error(`${label}: non-finite value`);
    maxToleranceRatio = Math.max(
      maxToleranceRatio,
      Math.abs(actual[index] - expected[index]) /
        (absolute + relative * Math.abs(expected[index])),
    );
  }
  if (maxToleranceRatio > 1)
    throw new Error(
      `${label}: analytical tolerance exceeded (${maxToleranceRatio})`,
    );
  return {
    label,
    absolute,
    relative,
    points: actual.length,
    maxToleranceRatio,
  };
}

const cases = [
  {
    directory: "vacask-divider",
    entry: "divider.sim",
    files: ["divider_op.raw", "divider_dc.raw"],
    check: ([op, dc]) => [
      compare("divider OP voltage (V)", vector(op, "output"), [2], 1e-9, 1e-6),
      compare(
        "supply current into positive terminal (A)",
        vector(op, "V1:flow(br)"),
        [-0.001],
        1e-12,
        1e-6,
      ),
      compare(
        "DC axis (V)",
        vector(dc, "supply"),
        [0, 0.5, 1, 1.5, 2, 2.5, 3],
        1e-12,
        1e-9,
      ),
      compare(
        "divider DC voltage (V)",
        vector(dc, "output"),
        vector(dc, "supply").map((v) => (v * 2) / 3),
        1e-9,
        1e-6,
      ),
    ],
  },
  {
    directory: "vacask-rc",
    entry: "rc.sim",
    files: ["rc_ac.raw", "rc_tran.raw"],
    check: ([ac, tran]) => {
      const omegaTau = vector(ac, "frequency").map(
        (f) => 2 * Math.PI * f * 0.001,
      );
      const time = vector(tran, "time");
      if (
        time.length < 3 ||
        time[0] !== 0 ||
        Math.abs(time.at(-1) - 0.006) > 1e-10 ||
        time.some((t, index) => index > 0 && t <= time[index - 1])
      )
        throw new Error("Incomplete or non-monotonic native transient axis");
      const expected = time.map((t) => {
        const u = t - 0.001;
        if (u <= 0) return 0;
        if (u < 1e-6) return (u + 0.001 * Math.expm1(-u / 0.001)) / 1e-6;
        return 1 + 1000 * Math.expm1(-0.001) * Math.exp(-(u - 1e-6) / 0.001);
      });
      return [
        compare(
          "RC AC real",
          vector(ac, "output"),
          omegaTau.map((x) => 1 / (1 + x * x)),
          1e-9,
          1e-6,
        ),
        compare(
          "RC AC imaginary",
          vector(ac, "output", true),
          omegaTau.map((x) => -x / (1 + x * x)),
          1e-9,
          1e-6,
        ),
        compare(
          "RC finite-rise response (V)",
          vector(tran, "output"),
          expected,
          2e-4,
          1e-4,
        ),
      ];
    },
  },
  {
    directory: "vacask-resistor-noise",
    entry: "noise.sim",
    files: ["resistor_noise.raw"],
    check: ([noise]) => [
      compare(
        "resistor PSD (V^2/Hz)",
        vector(noise, "onoise"),
        vector(noise, "frequency").map(() => 4 * 1.380649e-23 * 300 * 1000),
        1e-25,
        1e-5,
      ),
      compare(
        "input/output power gain",
        vector(noise, "gain"),
        vector(noise, "frequency").map(() => 1),
        1e-9,
        1e-6,
      ),
    ],
  },
];

if (values.compiler)
  cases.push({
    directory: "vacask-custom-model",
    entry: "custom.sim",
    files: ["custom_op.raw"],
    modelSource: "icm_conductance.va",
    check: ([op]) => [
      compare(
        "custom conductance current (A)",
        vector(op, "V1:flow(br)"),
        [-0.005],
        1e-12,
        1e-6,
      ),
      compare(
        "custom conductance voltage (V)",
        vector(op, "input"),
        [2.5],
        1e-9,
        1e-6,
      ),
    ],
  });

for (const fixture of cases) {
  const cwd = join(output, fixture.directory);
  mkdirSync(cwd);
  const source = readFileSync(
    join(root, "netlists", fixture.directory, fixture.entry),
  );
  writeFileSync(join(cwd, fixture.entry), source);
  const entry = {
    name: fixture.directory,
    sourceSha256: digest(source),
    durationMs: 0,
    exitCode: null,
    files: {},
    passed: false,
  };
  try {
    if (fixture.modelSource) {
      const compiler = resolve(values.compiler);
      const model = readFileSync(
        join(root, "netlists", fixture.directory, fixture.modelSource),
      );
      writeFileSync(join(cwd, fixture.modelSource), model);
      const compilerIdentity = spawnSync(compiler, ["--version"], {
        cwd,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
      });
      if (compilerIdentity.error || compilerIdentity.status !== 0)
        throw new Error(
          `Compiler identity probe failed: ${compilerIdentity.error?.message ?? compilerIdentity.stderr}`,
        );
      const args = [
        fixture.modelSource,
        "--target_cpu",
        "generic",
        "-o",
        "icm_conductance.osdi",
      ];
      const started = performance.now();
      const compilation = spawnSync(compiler, args, {
        cwd,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      entry.compilation = {
        compilerSha256: digest(readFileSync(compiler)),
        version: compilerIdentity.stdout,
        modelSourceSha256: digest(model),
        args,
        durationMs: performance.now() - started,
        exitCode: compilation.status,
      };
      writeFileSync(
        join(cwd, "compiler.log"),
        (compilation.stdout ?? "") + (compilation.stderr ?? ""),
      );
      // The Windows compiler can report a missing linker and still exit 0.
      // Fresh-directory artifact presence and successful runtime loading are
      // both required; neither process status nor an old output is evidence.
      if (
        compilation.error ||
        compilation.status !== 0 ||
        !existsSync(join(cwd, "icm_conductance.osdi"))
      )
        throw new Error(
          `Model compilation failed: ${compilation.error?.message ?? compilation.stderr}`,
        );
      entry.compilation.osdiSha256 = digest(
        readFileSync(join(cwd, "icm_conductance.osdi")),
      );
    }
    const started = performance.now();
    const result = run(["-se", "-sp", "-qp", fixture.entry], cwd);
    entry.durationMs = performance.now() - started;
    entry.exitCode = result.status;
    writeFileSync(join(cwd, "stdout.log"), result.stdout ?? "");
    writeFileSync(join(cwd, "stderr.log"), result.stderr ?? "");
    if (result.error || result.status !== 0)
      throw new Error(
        result.error?.message ?? result.stderr ?? "VACASK failed",
      );
    const plots = fixture.files.map((name) => {
      const path = join(cwd, name);
      if (!existsSync(path))
        throw new Error(`Missing expected output: ${name}`);
      const bytes = readFileSync(path);
      entry.files[name] = digest(bytes);
      const parsed = parseVacaskRawfile(bytes.toString("utf8"));
      if (!parsed.ok) throw new Error(`${name}: ${parsed.error.message}`);
      if (parsed.plots.length !== 1)
        throw new Error(`${name}: expected one analysis`);
      return parsed.plots[0];
    });
    entry.checks = fixture.check(plots);
    entry.passed = true;
  } catch (error) {
    entry.error = error.message;
  }
  report.cases.push(entry);
}
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.table(
  report.cases.map(({ name, passed, durationMs, error }) => ({
    name,
    passed,
    durationMs: Math.round(durationMs),
    error,
  })),
);
console.log(`Evidence: ${output}`);
if (report.cases.some((entry) => !entry.passed)) process.exitCode = 1;

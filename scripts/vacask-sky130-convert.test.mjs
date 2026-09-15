import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inspectNativeModelLibrarySymbols } from "@icm/netlist";
import { parseVacaskRawfile } from "../packages/spice-run/src/vacask-rawfile.js";

const upstream = resolve(
  process.env.ICM_VACASK_CONVERTER_SOURCE ?? "plan/upstream/VACASK",
);
const models = resolve(
  process.env.ICM_SKY130_MODEL_SOURCE ?? "plan/upstream/sky130",
);
const python = process.env.ICM_PYTHON ?? "python";
const pythonAvailable =
  spawnSync(python, ["--version"], { windowsHide: true }).status === 0;
const available =
  existsSync(join(upstream, "python/ng2vclib/converter.py")) &&
  existsSync(join(models, "combined_models/sky130.lib.spice")) &&
  pythonAvailable;
const output = available
  ? mkdtempSync(join(tmpdir(), "icm-native-model-test-"))
  : undefined;
afterAll(() => {
  if (
    output &&
    dirname(output) === resolve(tmpdir()) &&
    basename(output).startsWith("icm-native-model-test-")
  )
    rmSync(output, { recursive: true });
});
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function convert(corners, modelSource = models) {
  return spawnSync(
    python,
    [
      "scripts/vacask-sky130-convert.py",
      "--upstream",
      upstream,
      "--models",
      modelSource,
      "--output",
      output,
      "--corners",
      ...corners,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 60000 },
  );
}
function converted(corners) {
  const result = convert(corners);
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const directory = result.stdout.trim().split(/\r?\n/u)[0];
  const report = JSON.parse(readFileSync(join(directory, "conversion.json")));
  expect(report.status).toBe("converted-not-qualified");
  return { directory, report };
}

describe.skipIf(!pythonAvailable)("source model binning semantics", () => {
  it("retains edge tolerance, last-declared priority and explicit W/NF selection", () => {
    const inputs = [
      { l: "0.5", w: "3", nf: "2" },
      { l: "0.5", w: "3", nf: "2", wnflag: "0" },
      { l: "0.5", w: "3", nf: "2", wnflag: "1" },
      { l: "0.5005", w: "3" },
      { l: "0.5011", w: "3" },
      { l: "0.4989", w: "3" },
      { l: "0.1", w: "3" },
      { l: "0.75", w: "2" },
      { l: "0.75", w: "2.0011" },
    ];
    const run = spawnSync(
      python,
      [
        "-c",
        `
import json, sys
from scripts.lib.vacask_model_binning import source_bin_guards
boundaries = [(5e-7,1e-6,2e-6,4e-6),(2.5e-7,5e-7,2e-6,4e-6),
              (5e-7,1e-6,1e-6,2e-6),(2.5e-7,5e-7,1e-6,2e-6)]
print(json.dumps([source_bin_guards(v,boundaries) for v in json.loads(sys.stdin.read())]))
`,
      ],
      { input: JSON.stringify(inputs), encoding: "utf8", windowsHide: true },
    );
    expect(run.status, run.stderr).toBe(0);
    const guards = JSON.parse(run.stdout);
    // Native scalar comparison/boolean/ternary syntax here is also valid JS.
    // Evaluate only our emitted guards, never circuit/user input.
    const selected = guards.map(
      (cases) =>
        cases.find(([, guard]) =>
          new Function("$scale", "abs", `return ${guard}`)(1e-6, Math.abs),
        )?.[0] ?? null,
    );
    expect(selected).toEqual([1, 1, 3, 1, 0, 1, null, 2, 0]);
  });
});

const arithmeticInputs = [
  "361*nf/w+1489",
  "nf/w",
  "1/(nf/w)",
  "nf/-w",
  "nf/w/w",
  '"models/a/b"',
  "2",
  "nf*1.0/w",
];
function convertedArithmetic() {
  const run = spawnSync(
    python,
    [
      "-c",
      `
import json, sys
from scripts.lib.vacask_source_arithmetic import real_source_division
print(json.dumps([[real_source_division(v),real_source_division(real_source_division(v))]
                  for v in json.loads(sys.stdin.read())]))
`,
    ],
    {
      input: JSON.stringify(arithmeticInputs),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}
describe.skipIf(!pythonAvailable)("source real division", () => {
  it("promotes before division, preserving nesting, signs, strings and repeated formatting", () => {
    const converted = convertedArithmetic();
    expect(converted.map(([value]) => value)).toEqual([
      "361*nf*1.0/w+1489",
      "nf*1.0/w",
      "1*1.0/(nf*1.0/w)",
      "nf*1.0/-w",
      "nf*1.0/w*1.0/w",
      '"models/a/b"',
      "2",
      "nf*1.0/w",
    ]);
    for (const [first, repeated] of converted) expect(repeated).toBe(first);
  });
  it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
    "evaluates integer-authored model operands as source real arithmetic in actual VACASK",
    () => {
      const expressions = convertedArithmetic()
        .slice(0, 5)
        .map(([value]) => value);
      const expected = [
        (361 * 2) / 3 + 1489,
        2 / 3,
        1 / (2 / 3),
        -2 / 3,
        2 / 3 / 3,
      ];
      const cwd = mkdtempSync(join(tmpdir(), "icm-source-arithmetic-"));
      try {
        writeFileSync(
          join(cwd, "vacaskrc.toml"),
          "# controlled test startup\n",
        );
        writeFileSync(
          join(cwd, "run.sim"),
          `Source arithmetic test
ground 0
load "resistor.osdi"
model resistance resistor
model voltage vsource
parameters nf=2 w=3
${expressions.map((e, i) => `V${i} (n${i} 0) voltage dc=1\nR${i} (n${i} 0) resistance r=(abs(${e})+1)`).join("\n")}
control
 abort always
 options rawfile="ascii" strictsave=2
 save ${expressions.map((_, i) => `i('V${i}')`).join(" ")}
 analysis math op
endc
`,
        );
        const run = spawnSync(
          process.env.VACASK_BIN,
          ["--tomlfile", join(cwd, "vacaskrc.toml"), "-sp", "run.sim"],
          {
            cwd,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            env: {
              ...process.env,
              SIM_MODULE_PATH: process.env.VACASK_MODULES,
              ...(process.env.ICM_VACASK_LIBRARY_PATH
                ? { LD_LIBRARY_PATH: process.env.ICM_VACASK_LIBRARY_PATH }
                : {}),
              HOME: cwd,
              USERPROFILE: cwd,
              OMP_NUM_THREADS: "1",
            },
          },
        );
        expect(run.error).toBeUndefined();
        expect(run.status, run.stdout + run.stderr).toBe(0);
        const parsed = parseVacaskRawfile(
          readFileSync(join(cwd, "math.raw"), "utf8"),
        );
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw Error(parsed.error.message);
        for (const [i, value] of expected.entries()) {
          const actual = parsed.plots[0].vectors.find(
            (v) => v.variable.name === `V${i}:flow(br)`,
          )?.real[0];
          expect(actual).toBeDefined();
          expect(Math.abs(actual - -1 / (Math.abs(value) + 1))).toBeLessThan(
            1e-14,
          );
        }
      } finally {
        rmSync(cwd, { recursive: true });
      }
    },
    20000,
  );
});

// Requires the two clean, pinned source checkouts. This is an offline conversion
// integration test, not simulator/model qualification. No downloads in unit CI.
describe.skipIf(!available)("pinned native SKY130 conversion", () => {
  it("lowers all five corners without modifying foundry source or dropping model evidence", () => {
    const { directory, report } = converted(["tt", "ff", "ss", "fs", "sf"]);
    expect(Object.keys(report.corners)).toEqual(["tt", "ff", "ss", "fs", "sf"]);
    for (const [corner, evidence] of Object.entries(report.corners)) {
      expect(evidence.nativeSha256).toBe(
        hash(join(directory, `${corner}.sim`)),
      );
      for (const [path, digest] of Object.entries(evidence.sources))
        expect(digest).toBe(hash(join(models, "combined_models", path)));
      const text = readFileSync(join(directory, `${corner}.sim`), "utf8");
      for (const name of [
        "nfet_01v8",
        "pfet_01v8",
        "nfet_01v8_lvt",
        "pfet_01v8_lvt",
        "res_high_po",
        "cap_mim_m3_1",
        "pnp_05v5_w0p68l0p68",
      ])
        expect(text).toContain(`subckt sky130_fd_pr__${name}(`);
      expect(text).toContain('version="4.5"');
      expect(text).toContain("(w)*$scale");
      expect(text).not.toContain("(w)*$scale/(nf)");
      expect(report.binning).toEqual({
        source: "ngspice-46",
        defaultWnflag: 0,
        edgeToleranceM: 1e-9,
        priority: "last-declared",
      });
      expect(report.binningRecipeSha256).toBe(
        hash("scripts/lib/vacask_model_binning.py"),
      );
      expect(report.arithmeticRecipeSha256).toBe(
        hash("scripts/lib/vacask_source_arithmetic.py"),
      );
      expect(text).toContain("swx_nrds=361*nf*1.0/w+1489");
      expect(text).toContain("model nshort_model__0 sp_bsim4v8");
      expect(text).toContain("rbody (rb r1) rbody_model");
      expect(text).toContain("dw=(-sw_activecd-nfom_dw*1.0/2) tnom=30");
      expect(text).toContain("$mfactor=(0.5)*$mfactor");
      expect(text).toContain("model defmod_c sp_capacitor");
      expect(text).toContain('load "spice/bsim4v8.osdi"');
      expect(text).not.toContain("lang=ngspice");
      const names = [
        "nfet_01v8",
        "pfet_01v8",
        "nfet_01v8_lvt",
        "pfet_01v8_lvt",
      ].map((name) => `sky130_fd_pr__${name}`);
      const inspected = inspectNativeModelLibrarySymbols(
        {
          kind: "source",
          entry: "inspect.sim",
          configPath: "experiment.json",
          circuitBindings: [],
          dependencies: [],
          files: [
            {
              path: "inspect.sim",
              text: 'Conversion inspection\ninclude "models.inc"\n',
            },
            { path: "models.inc", text },
          ],
        },
        names,
      );
      expect(inspected.diagnostics).toEqual([]);
      if (corner === "tt") {
        const saved = JSON.parse(
          readFileSync("netlists/vacask-sky130/model-symbols-tt.json", "utf8"),
        );
        expect(saved.library.sha256).toBe(evidence.nativeSha256);
        expect(saved.library.masters).toEqual(inspected.masters);
      }
      for (const name of names) {
        expect(
          inspected.masters.find((m) => m.name === name)?.primitives,
        ).toEqual([{ path: [`m${name}`], module: "sp_bsim4v8" }]);
        expect(text).toContain(
          `m${name}__icm_invalid_bin (d g s b) icm_bin_not_found`,
        );
        expect(text).not.toContain(`m${name} (d g s b) icm_bin_not_found`);
      }
    }
  }, 60000);

  it("produces deterministic native bytes in fresh directories", () => {
    const first = converted(["tt"]);
    const second = converted(["tt"]);
    expect(first.directory).not.toBe(second.directory);
    expect(first.report.corners.tt).toEqual(second.report.corners.tt);
  }, 30000);

  it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
    "retains real N/P output paths across valid bins and rejects the independent invalid-bin guard",
    () => {
      // A model artifact produced on another OS can be exercised without
      // re-reading its entire checkout through a mounted filesystem. Its exact
      // bytes must still match the converter-checked fixture, never a substitute.
      let directory;
      if (process.env.ICM_VACASK_CONVERTED_TT) {
        const model = resolve(process.env.ICM_VACASK_CONVERTED_TT);
        const saved = JSON.parse(
          readFileSync("netlists/vacask-sky130/model-symbols-tt.json", "utf8"),
        );
        expect(hash(model)).toBe(saved.library.sha256);
        directory = mkdtempSync(join(output, "runtime-"));
        copyFileSync(model, join(directory, "tt.sim"));
      } else {
        ({ directory } = converted(["tt"]));
      }
      for (const length of [0.5, 2, 0.001]) {
        const cwd = join(directory, `length-${length}`);
        mkdirSync(cwd);
        writeFileSync(
          join(cwd, "vacaskrc.toml"),
          "# Controlled test startup\n",
        );
        writeFileSync(
          join(cwd, "run.sim"),
          `Native SKY130 conditional identity, not qualification
ground 0
include "../tt.sim"
model voltage vsource
VG (g 0) voltage dc=0.9
VD (d 0) voltage dc=1.8
XN (d g 0 0) sky130_fd_pr__nfet_01v8 w=10 l=${length}
XP (0 g d d) sky130_fd_pr__pfet_01v8 w=10 l=${length}
control
 abort always
 options scale=1e-6 rawfile="ascii" strictsave=2
 save p('XN:msky130_fd_pr__nfet_01v8',gm) p('XP:msky130_fd_pr__pfet_01v8',gm)
 analysis bias op
 print instance("XN:msky130_fd_pr__nfet_01v8", "XP:msky130_fd_pr__pfet_01v8")
endc
`,
        );
        const run = spawnSync(
          process.env.VACASK_BIN,
          ["--tomlfile", join(cwd, "vacaskrc.toml"), "run.sim"],
          {
            cwd,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            env: {
              ...process.env,
              SIM_MODULE_PATH: process.env.VACASK_MODULES,
              ...(process.env.ICM_VACASK_LIBRARY_PATH
                ? { LD_LIBRARY_PATH: process.env.ICM_VACASK_LIBRARY_PATH }
                : {}),
              HOME: cwd,
              USERPROFILE: cwd,
              OMP_NUM_THREADS: "1",
            },
          },
        );
        expect(run.error).toBeUndefined();
        const log = run.stdout + run.stderr;
        if (length === 0.001) {
          expect(run.status, log).not.toBe(0);
          expect(log).toContain("icm_bin_not_found");
          expect(existsSync(join(cwd, "bias.raw"))).toBe(false);
        } else {
          expect(run.status, log).toBe(0);
          if (length === 0.5) {
            // Source .6 is zero-based declaration ordinal 5. At the shared
            // 0.5 um edge the source parser chooses it, not adjacent .5.
            expect(log).toContain("of model XN:nshort_model__5");
            expect(log).toContain("of model XP:pshort_model__5");
          }
          const parsed = parseVacaskRawfile(
            readFileSync(join(cwd, "bias.raw"), "utf8"),
          );
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) throw Error(parsed.error.message);
          for (const name of [
            "XN:msky130_fd_pr__nfet_01v8.gm",
            "XP:msky130_fd_pr__pfet_01v8.gm",
          ]) {
            const vector = parsed.plots[0].vectors.find(
              (v) => v.variable.name === name,
            );
            expect(vector?.real).toHaveLength(1);
            expect(vector.real[0]).toBeGreaterThan(0);
          }
        }
      }
    },
    60000,
  );

  it("rejects a wrong model revision before producing a candidate", () => {
    const result = convert(["tt"], upstream);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unexpected source revision");
    expect(result.stdout).toBe("");
  });
});

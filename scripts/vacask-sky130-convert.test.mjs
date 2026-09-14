import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const upstream = resolve(
  process.env.ICM_VACASK_CONVERTER_SOURCE ?? "plan/upstream/VACASK",
);
const models = resolve(
  process.env.ICM_SKY130_MODEL_SOURCE ?? "plan/upstream/sky130",
);
const python = process.env.ICM_PYTHON ?? "python";
const available =
  existsSync(join(upstream, "python/ng2vclib/converter.py")) &&
  existsSync(join(models, "combined_models/sky130.lib.spice")) &&
  spawnSync(python, ["--version"], { windowsHide: true }).status === 0;
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
      expect(text).toContain("(w)*$scale/(nf)");
      expect(text).toContain("model nshort_model__0 sp_bsim4v8");
      expect(text).toContain("rbody (rb r1) rbody_model");
      expect(text).toContain("dw=(-sw_activecd-nfom_dw/2) tnom=30");
      expect(text).toContain("$mfactor=(0.5)*$mfactor");
      expect(text).toContain("model defmod_c sp_capacitor");
      expect(text).toContain('load "spice/bsim4v8.osdi"');
      expect(text).not.toContain("lang=ngspice");
    }
  }, 60000);

  it("produces deterministic native bytes in fresh directories", () => {
    const first = converted(["tt"]);
    const second = converted(["tt"]);
    expect(first.directory).not.toBe(second.directory);
    expect(first.report.corners.tt).toEqual(second.report.corners.tt);
  }, 30000);

  it("rejects a wrong model revision before producing a candidate", () => {
    const result = convert(["tt"], upstream);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unexpected source revision");
    expect(result.stdout).toBe("");
  });
});

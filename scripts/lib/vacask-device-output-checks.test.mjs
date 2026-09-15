import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVacaskRawfile } from "../../packages/spice-run/src/vacask-rawfile.js";
import { deviceOutputChecks } from "./vacask-device-output-checks.mjs";

function captured(prefix = "") {
  return ["bias", "small", "nderivative", "pderivative"].map((name) => {
    const parsed = parseVacaskRawfile(
      readFileSync(
        new URL(
          `../../netlists/vacask-device-outputs/${prefix}${name}.raw`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    if (!parsed.ok) throw Error(parsed.error.message);
    return parsed.plots[0];
  });
}
const vector = (plot, name) =>
  plot.vectors.find((v) => v.variable.name === name).real;

describe("VACASK device output semantics qualification", () => {
  it("accepts real chain-rule-corrected Linux model outputs without rescaling OP fields", () => {
    const plots = captured("chainrule-corrected/");
    const before = structuredClone(plots);
    const checks = deviceOutputChecks(...plots);
    expect(checks).toHaveLength(25);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
    expect(plots).toEqual(before);
  });
  it("retains captured gm mapping discrepancies while independently passing terminal AC/DC and multiplicity", () => {
    const plots = captured();
    const before = structuredClone(plots);
    const checks = deviceOutputChecks(...plots);
    expect(checks).toHaveLength(25);
    expect(checks.filter((c) => !c.passed).map((c) => c.name)).toEqual([
      "N model gm versus terminal transconductance (S)",
      "P model gm versus terminal transconductance (S)",
    ]);
    expect(
      checks
        .filter((c) => c.name.includes("AC versus DC"))
        .every((c) => c.passed),
    ).toBe(true);
    // p(P1,id) is positive even though current into the actual P1 drain is negative.
    expect(vector(plots[0], "P1.id")[0]).toBeGreaterThan(0);
    expect(-vector(plots[0], "VDP1:flow(br)")[0]).toBeLessThan(0);
    expect(plots).toEqual(before);
  });
  it("can accept a matching mapping; it does not require a future module to preserve the captured discrepancy", () => {
    const plots = captured();
    // Synthetic checker input only, never a rewrite of model/raw evidence.
    for (const prefix of ["N", "P"]) {
      const gm = -vector(plots[1], `VD${prefix}1:flow(br)`)[0];
      vector(plots[0], `${prefix}1.gm`)[0] = gm;
      vector(plots[0], `${prefix}3.gm`)[0] = gm;
    }
    expect(deviceOutputChecks(...plots).every((c) => c.passed)).toBe(true);
  });
  it("rejects missing and non-finite model output rather than filling zeros", () => {
    const missing = captured();
    missing[0].vectors = missing[0].vectors.filter(
      (v) => v.variable.name !== "P1.gmbs",
    );
    expect(() => deviceOutputChecks(...missing)).toThrow("P1.gmbs");
    const invalid = captured();
    vector(invalid[0], "N1.id")[0] = NaN;
    expect(() => deviceOutputChecks(...invalid)).toThrow("N1.id");
  });
  it("catches damaged axis, multiplicity and current direction separately from OP field semantics", () => {
    const plots = captured();
    vector(plots[0], "VDN3:flow(br)")[0] *= 2;
    vector(plots[2], "ngate")[0] -= 1e-5;
    const failures = deviceOutputChecks(...plots)
      .filter((c) => !c.passed)
      .map((c) => c.name);
    expect(failures).toContain("N total drain current multiplicity (A)");
    expect(failures).toContain("N DC axis 0 (V)");
    vector(plots[0], "VDP1:flow(br)")[0] *= -1;
    expect(() => deviceOutputChecks(...plots)).toThrow(
      "physical drain-current direction",
    );
  });
  it("rejects a zero perturbation interval rather than serializing Infinity as null", () => {
    const plots = captured();
    vector(plots[2], "ngate")[2] = vector(plots[2], "ngate")[0];
    expect(() => deviceOutputChecks(...plots)).toThrow(
      "invalid DC derivative interval",
    );
  });
});

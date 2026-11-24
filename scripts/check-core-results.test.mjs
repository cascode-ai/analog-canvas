import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function check(needs) {
  return spawnSync(process.execPath, ["scripts/check-core-results.mjs"], {
    env: { ...process.env, CORE_NEEDS: JSON.stringify(needs) },
    encoding: "utf8",
  });
}

const fullOutputs = {
  heavy: "true",
  regional_python: "true",
  unit_mode: "full",
  unit_strict: "false",
  build: "true",
  unit_built: "true",
  performance: "true",
  release: "true",
};

const passing = {
  changes: { result: "success", outputs: fullOutputs },
  core_build: { result: "success" },
  core_static: { result: "success" },
  core_unit: { result: "success" },
  core_unit_built: { result: "success" },
  core_performance: { result: "success" },
  core_release: { result: "success" },
};

describe("Core required check", () => {
  it("accepts a successful full or scoped implementation plan", () => {
    expect(check(passing).status).toBe(0);
    // Scoped plan skipping unplanned build/release/perf/standalone jobs passes.
    expect(
      check({
        changes: {
          result: "success",
          outputs: {
            heavy: "true",
            regional_python: "false",
            unit_mode: "affected",
            unit_strict: "true",
            build: "false",
            unit_built: "false",
            performance: "false",
            release: "false",
          },
        },
        core_static: { result: "success" },
        core_unit: { result: "success" },
        core_build: { result: "skipped" },
        core_unit_built: { result: "skipped" },
        core_performance: { result: "skipped" },
        core_release: { result: "skipped" },
      }).status,
    ).toBe(0);
    const result = check({ ...passing, changes: { result: "failure" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("changes");
  });

  for (const job of Object.keys(passing)) {
    for (const result of ["failure", "cancelled", "skipped", undefined]) {
      it(`rejects ${job} when its result is ${result}`, () => {
        expect(check({ ...passing, [job]: { result } }).status).toBe(1);
      });
    }
  }

  it("rejects absent or inconsistent planning outputs", () => {
    for (const bad of [
      { ...fullOutputs, heavy: undefined },
      { ...fullOutputs, heavy: "false" },
      { ...fullOutputs, regional_python: undefined },
      { ...fullOutputs, unit_strict: undefined },
      { ...fullOutputs, unit_mode: undefined },
      { ...fullOutputs, release: undefined },
      { ...fullOutputs, build: "false", release: "true" },
    ]) {
      expect(
        check({
          ...passing,
          changes: { result: "success", outputs: bad },
        }).status,
      ).toBe(1);
    }
  });
});

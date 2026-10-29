import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function check(needs) {
  return spawnSync(process.execPath, ["scripts/check-core-results.mjs"], {
    env: { ...process.env, CORE_NEEDS: JSON.stringify(needs) },
    encoding: "utf8",
  });
}

const passing = {
  changes: { result: "success", outputs: { heavy: "true" } },
  core_build: { result: "success" },
  core_static: { result: "success" },
  core_unit: { result: "success" },
  core_release: { result: "success" },
};

describe("Core required check", () => {
  it("accepts only a completely successful implementation plan", () => {
    expect(check(passing).status).toBe(0);
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
    for (const heavy of [undefined, "false", ""]) {
      expect(
        check({
          ...passing,
          changes: { result: "success", outputs: { heavy } },
        }).status,
      ).toBe(1);
    }
  });
});

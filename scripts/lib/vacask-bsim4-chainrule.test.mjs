import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  repairBsim4ChainRule,
  sha256,
  BSIM4_CHAINRULE_PATCHED_SHA256,
} from "./vacask-bsim4-chainrule.mjs";

describe("exact-source BSIM4 candidate repair", () => {
  it("refuses a different or already modified model instead of guessing patch locations", () => {
    expect(() => repairBsim4ChainRule("module unknown; endmodule")).toThrow(
      "Unrecognized BSIM4 source",
    );
    expect(() =>
      repairBsim4ChainRule(
        "load_tmp1 = Gds;\n    load_tmp2 = Gmb;\n    load_tmp3 = 0;",
      ),
    ).toThrow("Unrecognized BSIM4 source");
  });
  it.skipIf(!process.env.ICM_VACASK_BSIM4_SOURCE)(
    "repairs the real pinned package without mutating it, and tolerates checkout line endings",
    () => {
      const path = process.env.ICM_VACASK_BSIM4_SOURCE;
      const bytes = readFileSync(path);
      const source = bytes.toString("utf8");
      const repaired = repairBsim4ChainRule(source);
      expect(sha256(repaired)).toBe(BSIM4_CHAINRULE_PATCHED_SHA256);
      expect(
        repairBsim4ChainRule(
          source.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"),
        ),
      ).toBe(repaired);
      expect(() => repairBsim4ChainRule(repaired)).toThrow(
        "Unrecognized BSIM4 source",
      );
      expect(readFileSync(path)).toEqual(bytes);
    },
  );
});

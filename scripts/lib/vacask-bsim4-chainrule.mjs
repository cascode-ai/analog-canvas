import { createHash } from "node:crypto";

// VACASK 0.3.4's supplied SPICE-derived BSIM4 4.8.3 source. This is a
// temporary, exact-source repair, not a general Verilog-A text converter.
export const BSIM4_CHAINRULE_SOURCE_SHA256 =
  "f1eecd715b90ab8a038c397a955beeb7ed4387b798791a2d9173122974034daa";
export const BSIM4_CHAINRULE_PATCHED_SHA256 =
  "54c0e4a241831bac826f977627ceb62708c62a15a53e531abd17e5427e34a0e2";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function repairBsim4ChainRule(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  if (sha256(normalized) !== BSIM4_CHAINRULE_SOURCE_SHA256)
    throw Error(
      "Unrecognized BSIM4 source; review the upstream model before applying this repair",
    );
  let result = normalized;
  for (const [before, after] of [
    [
      "load_tmp1 = Gds;\n    load_tmp2 = Gmb;\n    load_tmp3 = 0;",
      "load_tmp1 = Gds+Gm*dVgsteff_dVd;\n    load_tmp2 = Gmb+Gm*dVgsteff_dVb;\n    load_tmp3 = Gm;",
    ],
    [
      "dvs_dVg = cdrain*load_T10*dVgsteff_dVg;",
      "dvs_dVg = Gm*load_T11+cdrain*load_T10*dVgsteff_dVg;",
    ],
  ]) {
    if (result.split(before).length !== 2)
      throw Error("Ambiguous BSIM4 chain-rule repair location");
    result = result.replace(before, after);
  }
  if (sha256(result) !== BSIM4_CHAINRULE_PATCHED_SHA256)
    throw Error("Unexpected repaired BSIM4 source digest");
  return result;
}

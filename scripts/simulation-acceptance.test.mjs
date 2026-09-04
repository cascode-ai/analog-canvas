import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * One library, and no way to quietly use another.
 *
 * A machine with a volare or ciel checkout has the BINNED Sky130 model set.
 * It is not a lesser copy of the same thing: its widest `nfet_01v8` bin stops
 * at 100 um, so the benchmark suite's own reference devices do not resolve at
 * all, and the circuits that do resolve answer differently — on the
 * five-transistor OTA the unity-gain bandwidth moves 11% (#551).
 *
 * A search that falls back to it produces two runs of one circuit that
 * disagree, with nothing in either result saying why. Skipping is the better
 * outcome, so these assertions exist to keep a helpful-looking fallback from
 * being added back.
 */
const script = readFileSync("scripts/simulation-acceptance.mjs", "utf8");

describe("simulation acceptance uses one library", () => {
  it("does not look for a PDK checkout on the machine", () => {
    // The path forms, not the words: the file explains in prose why a volare
    // or ciel checkout is the wrong library, and that explanation is the
    // reason these assertions exist rather than something to forbid.
    expect(script).not.toMatch(/["'`~][.\/]*volare\//u);
    expect(script).not.toMatch(/["'`~][.\/]*ciel\//u);
    expect(script).not.toMatch(/homedir\s*\(/u);
  });

  it("takes the path from the shared constant, not a literal of its own", () => {
    expect(script).toContain("SKY130_LIBRARY_PATH");
    // A second spelling of the path is a second place for it to drift.
    expect(script).not.toContain("/opt/sky130/continuous");
  });

  it("skips rather than substituting when that library is absent", () => {
    expect(script).toMatch(/skip\(/u);
    expect(script).toContain("comes from the pinned");
  });
});

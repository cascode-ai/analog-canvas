import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  IDEAL_SPDT_TARGET,
  spiceClockedSwitchBody,
} from "./ideal-switch-model.js";

function ngspiceOnPath(): boolean {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

/** Skips cleanly where ngspice is absent. */
describe.skipIf(!ngspiceOnPath())("the ideal SPDT under ngspice", () => {
  it("throws COM to A while its clock is high and to B while it is low (#2440)", () => {
    // One SPDT clocked high, one low, each COM at 1 V with 1 kΩ loads.
    const deck = [
      "* ideal SPDT",
      ...spiceClockedSwitchBody(IDEAL_SPDT_TARGET),
      "VCOM com 0 1",
      "VHI hi 0 1",
      "VLO lo 0 0",
      "XH com ha hb hi ideal_spdt",
      "XL com la lb lo ideal_spdt",
      ...["ha", "hb", "la", "lb"].map((node) => `R${node} ${node} 0 1k`),
      ".control",
      "op",
      ...["ha", "hb", "la", "lb"].map((node) => `print v(${node})`),
      ".endc",
      ".end",
    ].join("\n");
    const directory = mkdtempSync(join(tmpdir(), "icm-spdt-"));
    try {
      writeFileSync(join(directory, "deck.cir"), deck, "utf8");
      const output = execFileSync("ngspice", ["-b", "deck.cir"], {
        cwd: directory,
        encoding: "utf8",
      });
      const measured = Object.fromEntries(
        [...output.matchAll(/^v\((\w+)\)\s+=\s+(\S+)/gmu)].map((match) => [
          match[1],
          Number(match[2]),
        ]),
      );
      expect(measured["ha"]).toBeCloseTo(1, 2);
      expect(measured["hb"]).toBeCloseTo(0, 6);
      expect(measured["la"]).toBeCloseTo(0, 6);
      expect(measured["lb"]).toBeCloseTo(1, 2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from "vitest";

import type { Instance } from "@icm/model";

import {
  sameSimulationOccurrence,
  terminalCurrentDirectionPartners,
} from "./terminal-current-pick";

function instance(symbolId: string): Instance {
  return {
    id: "device",
    symbolId,
    reference: "X1",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
  } as unknown as Instance;
}

describe("terminal current direction gesture", () => {
  it("pairs only drain and source on a MOS device", () => {
    const mos = instance("nmos");
    expect(
      terminalCurrentDirectionPartners(mos, "D", ["D", "G", "S", "B"]),
    ).toEqual(["S"]);
    expect(
      terminalCurrentDirectionPartners(mos, "S", ["D", "G", "S", "B"]),
    ).toEqual(["D"]);
    expect(
      terminalCurrentDirectionPartners(mos, "G", ["D", "G", "S", "B"]),
    ).toEqual([]);
  });

  it("uses the other pin as direction for a two-terminal primitive", () => {
    const source = instance("voltage-source");
    expect(terminalCurrentDirectionPartners(source, "+", ["+", "-"])).toEqual([
      "-",
    ]);
  });

  it("does not invent a pair for a general multi-terminal instance", () => {
    expect(
      terminalCurrentDirectionPartners(instance("unknown"), "A", [
        "A",
        "B",
        "C",
      ]),
    ).toEqual([]);
  });

  it("compares hierarchy occurrences without collapsing repeated cells", () => {
    expect(sameSimulationOccurrence(["X1", "X2"], ["X1", "X2"])).toBe(true);
    expect(sameSimulationOccurrence(["X1"], ["X2"])).toBe(false);
    expect(sameSimulationOccurrence(undefined, [])).toBe(false);
  });
});

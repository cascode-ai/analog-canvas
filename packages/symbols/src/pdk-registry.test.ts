import { describe, expect, it } from "vitest";

import {
  resolvePdkSymbolMapping,
  resolvePdkSymbolMappingForTerminalOrder,
  reviewedSky130MosModelSuggestions,
} from "./pdk-registry.js";

describe("PDK symbol mapping registry", () => {
  it("offers one bounded reviewed target per MOS polarity", () => {
    expect(reviewedSky130MosModelSuggestions("nmos")).toEqual([
      "sky130_fd_pr__nfet_01v8",
    ]);
    expect(reviewedSky130MosModelSuggestions("pmos")).toEqual([
      "sky130_fd_pr__pfet_01v8",
    ]);
    expect(reviewedSky130MosModelSuggestions("resistor")).toEqual([]);
  });

  it("maps only exact reviewed SKY130 bindings with canonical native pins", () => {
    expect(resolvePdkSymbolMapping("sky130_fd_pr__nfet_01v8", 4)).toEqual({
      symbolId: "nmos",
      pinNames: ["D", "G", "S", "B"],
      source: "exact",
      registryId: "sky130-nfet-01v8",
    });
    expect(
      resolvePdkSymbolMapping("SKY130_FD_PR__PFET_G5V0D10V5", 4),
    ).toBeUndefined();
    expect(
      resolvePdkSymbolMapping("sky130_fd_pr__res_high_po", 3),
    ).toMatchObject({ symbolId: "resistor", pinNames: ["1", "2", "B"] });
  });

  it("does not guess an unknown namespace or conflicting terminal count", () => {
    expect(
      resolvePdkSymbolMapping("unknown_fd_pr__nfet_01v8", 4),
    ).toBeUndefined();
    expect(
      resolvePdkSymbolMapping("sky130_fd_pr__nfet_01v8", 3),
    ).toBeUndefined();
  });

  it("accepts only the reviewed ordered external terminal interface", () => {
    expect(
      resolvePdkSymbolMappingForTerminalOrder("sky130_fd_pr__nfet_01v8", [
        "D",
        "G",
        "S",
        "B",
      ]),
    ).toMatchObject({ symbolId: "nmos" });
    expect(
      resolvePdkSymbolMappingForTerminalOrder("sky130_fd_pr__nfet_01v8", [
        "G",
        "D",
        "S",
        "B",
      ]),
    ).toBeUndefined();
  });

  it("ignores an exact override outside the approved Razavi catalog", () => {
    expect(
      resolvePdkSymbolMapping("sky130_fd_pr__nfet_01v8", 4, [
        {
          modelName: "sky130_fd_pr__nfet_01v8",
          terminalCount: 4,
          symbolId: "generic-block-4",
          pinNames: ["P1", "P2", "P3", "P4"],
          registryId: "project-reviewed-special-device",
        },
      ]),
    ).toEqual({
      symbolId: "nmos",
      pinNames: ["D", "G", "S", "B"],
      source: "exact",
      registryId: "sky130-nfet-01v8",
    });
  });
});

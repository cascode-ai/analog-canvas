import { describe, expect, it } from "vitest";
import { reviewedExternalDeviceBindings } from "@icm/devices";

import {
  isPdkMappableSymbolId,
  resolvePdkSymbolMapping,
  resolvePdkSymbolMappingForTerminalOrder,
  reviewedSky130MosModelSuggestions,
} from "./pdk-registry.js";

describe("PDK symbol mapping registry", () => {
  it("offers every reviewed SKY130 MOS target per polarity", () => {
    expect(reviewedSky130MosModelSuggestions("nmos")).toEqual([
      "sky130_fd_pr__nfet_01v8",
      "sky130_fd_pr__nfet_01v8_lvt",
      "sky130_fd_pr__nfet_03v3_nvt",
      "sky130_fd_pr__nfet_05v0_nvt",
      "sky130_fd_pr__nfet_g5v0d10v5",
    ]);
    expect(reviewedSky130MosModelSuggestions("pmos")).toEqual([
      "sky130_fd_pr__pfet_01v8",
      "sky130_fd_pr__pfet_01v8_lvt",
      "sky130_fd_pr__pfet_01v8_hvt",
      "sky130_fd_pr__pfet_g5v0d10v5",
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
    ).toMatchObject({ symbolId: "pmos", pinNames: ["D", "G", "S", "B"] });
    expect(
      resolvePdkSymbolMapping("sky130_fd_pr__res_high_po", 3),
    ).toMatchObject({ symbolId: "resistor", pinNames: ["1", "2", "B"] });
    expect(
      resolvePdkSymbolMapping("sky130_fd_pr__pnp_05v5_W0p68L0p68", 3),
    ).toMatchObject({ symbolId: "pnp", pinNames: ["C", "B", "E"] });
    expect(
      resolvePdkSymbolMapping("sky130_fd_pr__npn_05v5_W1p00L1p00", 4),
    ).toMatchObject({ symbolId: "npn", pinNames: ["C", "B", "E", "S"] });
    expect(
      resolvePdkSymbolMapping("sky130_fd_pr__cap_var_lvt", 3),
    ).toMatchObject({ symbolId: "capacitor", pinNames: ["1", "2", "B"] });
    expect(resolvePdkSymbolMapping("sky130_fd_pr__ind_03_90", 4)).toMatchObject(
      {
        symbolId: "inductor",
        pinNames: ["1", "2", "CT", "SUB"],
      },
    );
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

  it("maps SKY130's drain-extended devices to the Extended Devices DMOS", () => {
    expect(resolvePdkSymbolMapping("sky130_fd_pr__nfet_g5v0d16v0", 4)).toEqual({
      symbolId: "ndmos",
      pinNames: ["D", "G", "S", "B"],
      source: "exact",
      registryId: "sky130-nfet-g5v0d16v0",
    });
    expect(resolvePdkSymbolMapping("sky130_fd_pr__pfet_20v0", 4)).toMatchObject(
      { symbolId: "pdmos", registryId: "sky130-pfet-20v0" },
    );
    expect(isPdkMappableSymbolId("ndmos")).toBe(true);
    expect(isPdkMappableSymbolId("depletion-nmos")).toBe(true);
    expect(isPdkMappableSymbolId("generic-block-4")).toBe(false);
  });

  it("draws every reviewed binding with its own symbol", () => {
    // Import builds a reviewed definition and the instance's pins from two
    // lookups; they agree only when each binding's symbol can be drawn.
    for (const binding of reviewedExternalDeviceBindings)
      expect(
        resolvePdkSymbolMapping(binding.masterName, binding.terminals.length)
          ?.registryId,
        binding.masterName,
      ).toBe(binding.id);
  });
});

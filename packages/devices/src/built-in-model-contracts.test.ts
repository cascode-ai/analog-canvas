import { describe, expect, it } from "vitest";
import { IDEAL_COMPARATOR_TARGET } from "./contract.js";
import {
  builtInModelContract,
  builtInModelContracts,
  builtInModelDefaults,
} from "./built-in-model-contracts.js";
import {
  builtInSubcircuitDescriptors,
  subcircuitDescriptor,
} from "./registry.js";

describe("built-in model registration", () => {
  it("covers every implemented master and preserves ordered interfaces across artwork aliases", () => {
    for (const descriptor of builtInSubcircuitDescriptors) {
      // The historical five-port comparator is an external implementation.
      if (descriptor.target === "comparator") continue;
      const model = builtInModelContract(descriptor.target);
      expect(model, descriptor.symbolId).toBeDefined();
      expect(
        model!.ports.map((port) => port.name),
        descriptor.symbolId,
      ).toEqual(
        // An optional port, such as VOCM, has a body of its own.
        descriptor.ports
          .filter((port) => model!.family !== "comparator" || !port.supply)
          .filter((port) => !port.optional)
          .map((port) => port.name),
      );
    }
    expect(
      new Set(builtInModelContracts.map((model) => model.target)).size,
    ).toBe(builtInModelContracts.length);
  });

  it("keeps the isolated comparator's signal-only lowering distinct from the external interface", () => {
    const descriptor = subcircuitDescriptor("comparator")!;
    expect(descriptor.ports.map((port) => port.name)).toEqual([
      "VDD",
      "VSS",
      "VIP",
      "VIN",
      "VOUT",
    ]);
    expect(builtInModelContract("comparator")).toBeUndefined();
    expect(builtInModelContract(IDEAL_COMPARATOR_TARGET)!.ports).toEqual(
      descriptor.ports.filter((port) => !port.supply),
    );
  });

  it("does not fabricate an implementation for custom or drawing-only targets", () => {
    for (const target of ["custom_amplifier", "constructor", "__proto__"])
      expect(builtInModelContract(target), target).toBeUndefined();
  });

  it("retains backend scope and parameter defaults independently of Symbol variants", () => {
    for (const model of builtInModelContracts) {
      // A generic block is a call in every backend (#2445).
      if (model.family === "generic") {
        expect(model.backends).toEqual({
          spice: "external",
          spectre: "external",
        });
        continue;
      }
      expect(model.backends.spice).toBe("included");
      expect(model.backends.spectre).toBe(
        model.family === "signal" || model.implementation === "flip-flop"
          ? "external"
          : "included",
      );
    }
    expect(builtInModelDefaults("opamp")).toEqual({
      gain: "1e6",
      vhigh: "VDD",
      vlow: "VSS",
    });
    expect(builtInModelDefaults("nand_gate_4")).toEqual({
      vt: "10m",
      td: "10p",
    });
    expect(builtInModelDefaults("d_flip_flop_q")).toEqual({
      vt: "10m",
      td: "10p",
    });
    expect(builtInModelDefaults("adc")).toEqual({ bits: "8" });
    expect(builtInModelDefaults("adder")).toEqual({ signA: "+", signB: "+" });
  });
});

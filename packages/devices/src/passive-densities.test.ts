import { describe, expect, it } from "vitest";
import {
  formatPassiveValue,
  passiveNumber,
  PROCESS_PASSIVE_DENSITIES,
  reviewedPassive,
  reviewedPassiveValue,
  sizeReviewedPassive,
} from "./passive-densities.js";
import {
  LIBRARY_PROCESS,
  reviewedExternalBindingForMaster,
} from "./reviewed-external.js";

const XHIGH = "sky130_fd_pr__res_xhigh_po";
const MIM = "sky130_fd_pr__cap_mim_m3_1";

/** Within `tolerance` of `expected`, relatively. */
const near = (actual: number | undefined, expected: number, tolerance = 1e-3) =>
  expect(Math.abs(actual! / expected - 1)).toBeLessThan(tolerance);

describe("passive densities", () => {
  it("names only reviewed passives of their own Process", () => {
    for (const [process, { devices }] of Object.entries(
      PROCESS_PASSIVE_DENSITIES,
    ))
      for (const [master, density] of Object.entries(devices)) {
        const binding = reviewedExternalBindingForMaster(master);
        expect(binding?.masterName, master).toBe(master);
        expect(LIBRARY_PROCESS[binding!.libraryId]).toBe(process);
        expect(binding!.deviceClass).toBe(density.kind);
      }
  });

  it("reads and writes values as SPICE does, with units", () => {
    expect(passiveNumber("20pF")).toBeCloseTo(20e-12, 20);
    expect(passiveNumber("10kΩ")).toBe(10e3);
    expect(passiveNumber("1MegΩ")).toBe(1e6);
    expect(passiveNumber("1k")).toBe(1e3);
    for (const text of ["{rload}", "4.7µF", "abc", "0", "-1k"])
      expect(passiveNumber(text), text).toBeUndefined();
    expect(formatPassiveValue(25.38e-12, "capacitor")).toBe("25.4pF");
    expect(formatPassiveValue(231_884, "resistor")).toBe("232kΩ");
    expect(formatPassiveValue(1e6, "resistor")).toBe("1MegΩ");
    expect(formatPassiveValue(260, "resistor")).toBe("260Ω");
  });
});

describe("a PDK passive's value from its geometry", () => {
  it("reads a resistor as ρ·L/W over its parallel count", () => {
    near(
      reviewedPassiveValue(XHIGH, { w: "0.69u", l: "80u", mult: "1" }),
      (2000 * 80) / 0.69,
    );
    near(
      reviewedPassiveValue(XHIGH, { w: "0.69u", l: "80u", mult: "2" }),
      (2000 * 80) / 0.69 / 2,
    );
    // SG13G2's bends are series segments of the model's effective length.
    near(
      reviewedPassiveValue("rppd", { w: "0.5u", l: "10u", b: "1", m: "1" }),
      (260 * (2 * 10 + (2 * 0.5) / 1.85 + 0.18)) / 0.5,
    );
  });

  it("reads a capacitor by area and perimeter times its multiplier", () => {
    // 25 × 25 µm SKY130 MIM, 20 in parallel: 25.38 pF.
    near(
      reviewedPassiveValue(MIM, { w: "25u", l: "25u", mf: "20" }),
      (2e-15 * 625 + 0.19e-15 * 100) * 20,
    );
    near(
      reviewedPassiveValue("cap_cmim", { w: "7u", l: "7u", m: "1" }),
      1.5e-15 * 49 + 0.04e-15 * 28,
    );
  });

  it("knows no value it cannot read", () => {
    expect(
      reviewedPassiveValue(MIM, { w: "{side}", l: "25u" }),
    ).toBeUndefined();
    // 25 read as metres is a unit slip, not a 25 m plate.
    expect(reviewedPassiveValue(MIM, { w: "25", l: "25" })).toBeUndefined();
    for (const master of [
      "sky130_fd_pr__res_generic_po",
      "cap_rfcmim",
      "sky130_fd_pr__cap_var_lvt",
    ]) {
      expect(reviewedPassive(master), master).toBeUndefined();
      expect(
        reviewedPassiveValue(master, { w: "1u", l: "1u" }),
      ).toBeUndefined();
      expect(sizeReviewedPassive(master, 1e3)).toBeUndefined();
    }
  });
});

describe("a PDK passive sized for a value", () => {
  it("keeps a resistor's width and solves its length on the grid", () => {
    const sized = sizeReviewedPassive("rppd", 10e3)!;
    expect(sized.parameters).toEqual({
      w: "0.5u",
      l: "19.23u",
      b: "0",
      m: "1",
    });
    near(sized.value, 10e3);
    expect(sized.clamped).toBeUndefined();
    // SKY130 sizes at its narrowest precision width.
    expect(sizeReviewedPassive(XHIGH, 100e3)!.parameters).toMatchObject({
      w: "0.35u",
      l: "17.5u",
      mult: "1",
    });
  });

  it("puts a resistor too short for one device into parallel copies", () => {
    const sized = sizeReviewedPassive("rppd", 50)!;
    expect(sized.parameters.m).toBe("6");
    expect(Number.parseFloat(sized.parameters.l!)).toBeGreaterThanOrEqual(0.5);
    near(sized.value, 50, 5e-3);
  });

  it("bends a resistor longer than one segment allows, and stops where bends run out", () => {
    const bent = sizeReviewedPassive("rppd", 1e6)!;
    expect(bent.parameters.b).toBe("1");
    expect(Number.parseFloat(bent.parameters.l!)).toBeLessThanOrEqual(1000);
    near(bent.value, 1e6);
    const longest = sizeReviewedPassive("rppd", 1e9)!;
    expect(longest).toMatchObject({
      clamped: "maximum",
      parameters: { l: "1000u", b: "100" },
    });
    // Without bends, the longest L is as far as rsil goes.
    expect(sizeReviewedPassive("rsil", 100e3)).toMatchObject({
      clamped: "maximum",
      parameters: { w: "0.5u", l: "1000u", m: "1" },
    });
  });

  it("makes a capacitor square and splits it past its largest copy", () => {
    const small = sizeReviewedPassive("cap_cmim", 200e-15)!;
    expect(small.parameters).toEqual({ w: "11.495u", l: "11.495u", m: "1" });
    near(small.value, 200e-15);
    // 8 pF is the largest SG13G2 MIM copy, so 20 pF takes three.
    const large = sizeReviewedPassive("cap_cmim", 20e-12)!;
    expect(large.parameters.m).toBe("3");
    near(large.value, 20e-12);
    // SKY130's largest side is 30 µm.
    const mim = sizeReviewedPassive(MIM, 25e-12)!;
    expect(Number.parseFloat(mim.parameters.w!)).toBeLessThanOrEqual(30);
    expect(mim.parameters.mf).toBe("14");
    near(mim.value, 25e-12);
  });

  it("stops a capacitor too small for the device at its smallest side", () => {
    expect(sizeReviewedPassive("cap_cmim", 0.5e-15)).toMatchObject({
      clamped: "minimum",
      parameters: { w: "1.14u", l: "1.14u", m: "1" },
    });
  });

  it("takes at most 100 parallel copies: past them the value is wrong", () => {
    expect(sizeReviewedPassive("cap_cmim", 1e-6)).toMatchObject({
      clamped: "maximum",
      parameters: { m: "100" },
    });
    // A resistor given a capacitor's 1p.
    expect(sizeReviewedPassive("rppd", 1e-12)).toMatchObject({
      clamped: "minimum",
      parameters: { l: "0.5u", m: "100" },
    });
  });

  // The ideal value's three digits round by up to 0.5%, the grid by less.
  it("carries a value from SKY130 through ideal to SG13G2 within 1%", () => {
    for (const [from, parameters, to] of [
      [XHIGH, { w: "0.69u", l: "50u", mult: "1" }, "rppd"],
      [XHIGH, { w: "0.35u", l: "5u", mult: "1" }, "rhigh"],
      [MIM, { w: "25u", l: "25u", mf: "20" }, "cap_cmim"],
      [MIM, { w: "4u", l: "4u", mf: "1" }, "cap_cmim"],
    ] as const) {
      const value = reviewedPassiveValue(from, parameters)!;
      const kind = reviewedPassive(from)!.density.kind;
      const ideal = passiveNumber(formatPassiveValue(value, kind))!;
      near(sizeReviewedPassive(to, ideal)!.value, value, 1e-2);
    }
  });
});

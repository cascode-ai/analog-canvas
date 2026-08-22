import { describe, expect, it } from "vitest";

import { derivedFingerWidth } from "./finger-width";

describe("derivedFingerWidth", () => {
  it("divides the total width across the fingers", () => {
    expect(derivedFingerWidth("4u", "4")).toBe("1u");
    expect(derivedFingerWidth("1u", "2")).toBe("500n");
  });

  it("treats an absent finger count as a single finger", () => {
    expect(derivedFingerWidth("1u", undefined)).toBe("1u");
    expect(derivedFingerWidth("1u", "")).toBe("1u");
  });

  it("keeps W = FW * NF for a count that does not divide evenly", () => {
    const fingerWidth = derivedFingerWidth("1u", "3");
    expect(fingerWidth).not.toBeNull();
    // The identity holds to the precision the displayed figure carries; it is
    // rounded for reading, not re-derived from a second stored value.
    const product = Number(fingerWidth!.replace("n", "")) * 3;
    expect(Math.abs(product - 1000) / 1000).toBeLessThan(1e-5);
  });

  it("shows nothing rather than guessing at unusable input", () => {
    expect(derivedFingerWidth(undefined, "2")).toBeNull();
    expect(derivedFingerWidth("wide", "2")).toBeNull();
    expect(derivedFingerWidth("1u", "0")).toBeNull();
  });
});

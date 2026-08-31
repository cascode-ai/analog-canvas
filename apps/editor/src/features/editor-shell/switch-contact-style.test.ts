import { describe, expect, it } from "vitest";

import {
  planSwitchContactStyleSwap,
  switchContactStyleSibling,
} from "./switch-contact-style";

describe("switch contact style", () => {
  it("pairs each switch with its other drawing, both ways", () => {
    // Two axes are deliberately not mixed: this one is how the contacts are
    // DRAWN. The number of terminals is a different device, never a style.
    expect(switchContactStyleSibling("ideal-switch")).toBe("simple-switch");
    expect(switchContactStyleSibling("simple-switch")).toBe("ideal-switch");
    expect(switchContactStyleSibling("spdt-switch")).toBe("simple-spdt-switch");
    expect(switchContactStyleSibling("simple-spdt-switch")).toBe("spdt-switch");
  });

  it("offers nothing where there is no second drawing", () => {
    // A closed switch and a controlled switch have one drawing each; a
    // resistor has none. Silence is the answer, not an empty toggle.
    expect(switchContactStyleSibling("closed-switch")).toBeUndefined();
    expect(
      switchContactStyleSibling("voltage-controlled-switch"),
    ).toBeUndefined();
    expect(switchContactStyleSibling("resistor")).toBeUndefined();
  });

  it("swaps by exchanging Symbols so every wired terminal survives", () => {
    // The pair shares pin names and anchor positions, so exchanging the
    // Symbol keeps each terminal's identity — and with it every Net and
    // every drawn wire. Nothing is hidden, so nothing is orphaned.
    expect(planSwitchContactStyleSwap("S1", "spdt-switch")).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "S1",
        symbolId: "simple-spdt-switch",
      },
    ]);
    expect(planSwitchContactStyleSwap("S1", "closed-switch")).toEqual([]);
  });
});

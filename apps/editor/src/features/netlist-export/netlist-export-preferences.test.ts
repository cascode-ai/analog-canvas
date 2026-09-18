import { describe, expect, it } from "vitest";
import {
  createDefaultNetlistExportPreferences,
  readNetlistExportPreferences,
  selectNetlistExportFormat,
  selectNetlistPortCase,
} from "./netlist-export-preferences.js";

describe("netlist export preferences", () => {
  it("stores only output format and formal-port spelling", () => {
    const preferences = selectNetlistPortCase(
      selectNetlistExportFormat(
        createDefaultNetlistExportPreferences(),
        "spectre",
      ),
      "lower",
    );

    expect(readNetlistExportPreferences(JSON.stringify(preferences))).toEqual({
      format: "spectre",
      portCase: "lower",
    });
  });

  it("migrates old browser-only process profiles without retaining electrical authority", () => {
    const restored = readNetlistExportPreferences(
      JSON.stringify({
        selected: "sky130",
        format: "spectre",
        portCase: "lower",
        profiles: { sky130: { devices: {}, library: {} } },
      }),
    );

    expect(restored).toEqual({ format: "spectre", portCase: "lower" });
    expect(restored).not.toHaveProperty("selected");
    expect(restored).not.toHaveProperty("profiles");
  });

  it.each(["{", "null", "[]", '{"format":"custom"}'])(
    "recovers malformed preferences: %s",
    (raw) => {
      expect(readNetlistExportPreferences(raw)).toEqual({
        format: "spice",
        portCase: "upper",
      });
    },
  );
});

import { describe, expect, it } from "vitest";
import {
  createDefaultNetlistExportPreferences,
  parseNetlistExportPreferences,
  readNetlistExportPreferences,
  selectNetlistExportFormat,
  selectNetlistExportProfile,
  setNetlistExportDeviceTarget,
} from "./netlist-export-preferences.js";

describe("netlist authoring preferences", () => {
  it("remembers format, process and device choices independently", () => {
    const preferences = setNetlistExportDeviceTarget(
      selectNetlistExportProfile(
        selectNetlistExportFormat(
          createDefaultNetlistExportPreferences(),
          "spectre",
        ),
        "sky130",
      ),
      "nmos",
      "sky130_fd_pr__nfet_01v8_lvt",
    );
    expect(readNetlistExportPreferences(JSON.stringify(preferences))).toEqual(
      preferences,
    );
    expect(preferences.format).toBe("spectre");
    expect(preferences).not.toHaveProperty("portCase");
    expect(preferences.profiles.sky130.devices.nmos.target).toBe(
      "sky130_fd_pr__nfet_01v8_lvt",
    );
    expect(selectNetlistExportFormat(preferences, "spice").selected).toBe(
      "sky130",
    );
  });

  it("retains process choices but drops legacy case conversion preferences", () => {
    const restored = readNetlistExportPreferences(
      JSON.stringify({ format: "spectre", portCase: "lower" }),
    );
    // The regression's storage says nothing about a process, so the restored
    // preference is the default one a fresh editor starts in.
    expect(restored).toMatchObject({
      selected: "sky130",
      format: "spectre",
    });
    expect(restored).not.toHaveProperty("portCase");
    expect(restored.profiles.tsmc28.devices.nmos.target).toBe("nch_ulvt_mac");
    expect(restored.profiles.tsmc180.devices.pmos.target).toBe("pch");
  });

  it("does not accept a case override in new configuration code", () => {
    expect(() =>
      parseNetlistExportPreferences(
        JSON.stringify({
          ...createDefaultNetlistExportPreferences(),
          portCase: "upper",
        }),
      ),
    ).toThrow("Port names keep their authored case");
  });

  it("moves a stored Abstract default to SKY130 exactly once", () => {
    const stored = createDefaultNetlistExportPreferences();
    const legacy = JSON.stringify({
      ...stored,
      selected: "abstract",
      defaultProcess: undefined,
    });
    const moved = readNetlistExportPreferences(legacy);
    expect(moved.selected).toBe("sky130");

    // Abstract chosen after the move is a choice, and it stays.
    const chosen = readNetlistExportPreferences(
      JSON.stringify({ ...moved, selected: "abstract" }),
    );
    expect(chosen.selected).toBe("abstract");
  });

  it("retains complete legacy customized process templates", () => {
    const preferences = createDefaultNetlistExportPreferences();
    preferences.selected = "custom";
    preferences.profiles.custom.devices.nmos.target = "my_nmos";
    preferences.profiles.custom.devices.nmos.parameters.w = "5u";
    const restored = readNetlistExportPreferences(
      JSON.stringify({ ...preferences, portCase: "lower" }),
    );
    expect(restored).toEqual(preferences);
  });

  it.each(["{", "null", "[]", '{"format":"custom"}'])(
    "recovers malformed preferences: %s",
    (raw) => {
      expect(readNetlistExportPreferences(raw)).toEqual(
        createDefaultNetlistExportPreferences(),
      );
    },
  );
});

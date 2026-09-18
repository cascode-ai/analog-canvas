import { describe, expect, it } from "vitest";
import {
  createDefaultNetlistExportPreferences,
  readNetlistExportPreferences,
  selectNetlistExportFormat,
  selectNetlistPortCase,
  selectNetlistExportProfile,
  setNetlistExportDeviceTarget,
} from "./netlist-export-preferences.js";

describe("netlist authoring preferences", () => {
  it("remembers format, process, device choices and case independently", () => {
    const preferences = setNetlistExportDeviceTarget(
      selectNetlistExportProfile(
        selectNetlistPortCase(
          selectNetlistExportFormat(
            createDefaultNetlistExportPreferences(),
            "spectre",
          ),
          "lower",
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
    expect(preferences.portCase).toBe("lower");
    expect(preferences.profiles.sky130.devices.nmos.target).toBe(
      "sky130_fd_pr__nfet_01v8_lvt",
    );
    expect(selectNetlistExportFormat(preferences, "spice").selected).toBe(
      "sky130",
    );
  });

  it("restores templates around the format-only storage left by the regression", () => {
    const restored = readNetlistExportPreferences(
      JSON.stringify({ format: "spectre", portCase: "lower" }),
    );
    expect(restored).toMatchObject({
      selected: "abstract",
      format: "spectre",
      portCase: "lower",
    });
    expect(restored.profiles.tsmc28.devices.nmos.target).toBe("nch_ulvt_mac");
    expect(restored.profiles.tsmc180.devices.pmos.target).toBe("pch");
  });

  it("retains complete legacy customized process templates", () => {
    const preferences = createDefaultNetlistExportPreferences();
    preferences.selected = "custom";
    preferences.profiles.custom.devices.nmos.target = "my_nmos";
    preferences.profiles.custom.devices.nmos.parameters.w = "5u";
    const restored = readNetlistExportPreferences(JSON.stringify(preferences));
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

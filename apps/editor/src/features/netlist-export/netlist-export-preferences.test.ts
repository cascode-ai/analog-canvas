import { describe, expect, it } from "vitest";
import {
  createDefaultNetlistExportPreferences,
  readNetlistExportPreferences,
  selectNetlistExportFormat,
  selectNetlistExportProfile,
  setNetlistExportDeviceTarget,
} from "./netlist-export-preferences.js";

describe("netlist export preferences", () => {
  it("restores independent edited presets and the selected preset", () => {
    const preferences = readNetlistExportPreferences(null);
    preferences.selected = "custom";
    preferences.format = "spectre";
    preferences.profiles.custom.devices.resistor.parameters.value = "3k";
    expect(readNetlistExportPreferences(JSON.stringify(preferences))).toEqual(
      preferences,
    );
    expect(
      preferences.profiles.abstract.devices.resistor.parameters.value,
    ).toBe("1k");
    expect(Object.keys(preferences.profiles)).toEqual([
      "abstract",
      "sky130",
      "tsmc28",
      "tsmc180",
      "custom",
    ]);
  });

  it("migrates the three original cached presets without losing edits", () => {
    const preferences = readNetlistExportPreferences(null);
    preferences.selected = "custom";
    preferences.profiles.custom.devices.resistor.parameters.value = "7k";
    const legacy = {
      selected: preferences.selected,
      profiles: {
        abstract: preferences.profiles.abstract,
        sky130: preferences.profiles.sky130,
        custom: preferences.profiles.custom,
      },
    };

    const restored = readNetlistExportPreferences(JSON.stringify(legacy));

    expect(restored.selected).toBe("custom");
    expect(restored.format).toBe("spice");
    expect(restored.profiles.custom.devices.resistor.parameters.value).toBe(
      "7k",
    );
    expect(restored.profiles.tsmc28.id).toBe("tsmc28");
    expect(restored.profiles.tsmc180.id).toBe("tsmc180");
  });

  it("selects a cached preset while retaining every edited profile", () => {
    const preferences = readNetlistExportPreferences(null);
    preferences.profiles.custom.devices.capacitor.parameters.value = "8p";

    const selected = selectNetlistExportProfile(preferences, "tsmc28");

    expect(selected.selected).toBe("tsmc28");
    expect(selected.profiles.custom.devices.capacitor.parameters.value).toBe(
      "8p",
    );
  });

  it("selects the output format independently from the process", () => {
    const preferences = readNetlistExportPreferences(null);
    const selected = selectNetlistExportFormat(preferences, "spectre");

    expect(selected.format).toBe("spectre");
    expect(selected.selected).toBe("abstract");
    expect(selected.profiles).toBe(preferences.profiles);
  });
  it("edits device targets only in the selected process and loads target defaults", () => {
    const preferences = readNetlistExportPreferences(null);
    preferences.selected = "tsmc28";

    const nmos = setNetlistExportDeviceTarget(
      preferences,
      "nmos",
      "custom_nch",
    );
    const pmos = setNetlistExportDeviceTarget(nmos, "pmos", "custom_pch");

    expect(pmos.profiles.tsmc28.devices.nmos.target).toBe("custom_nch");
    expect(pmos.profiles.tsmc28.devices.pmos.target).toBe("custom_pch");
    expect(pmos.profiles.abstract.devices.nmos.target).toBe("NMOS");
    expect(pmos.profiles.abstract.devices.pmos.target).toBe("PMOS");
    expect(preferences.profiles.tsmc28.devices.nmos.target).toBe(
      "nch_ulvt_mac",
    );

    preferences.selected = "sky130";
    const resistor = setNetlistExportDeviceTarget(
      preferences,
      "resistor",
      "sky130_fd_pr__res_xhigh_po",
    );
    expect(resistor.profiles.sky130.devices.resistor).toMatchObject({
      target: "sky130_fd_pr__res_xhigh_po",
      parameters: { w: "1u", l: "5.5u", mult: "1" },
    });
  });
  it("rebuilds every preset when restoring defaults", () => {
    const preferences = readNetlistExportPreferences(null);
    preferences.selected = "tsmc28";
    preferences.format = "spectre";
    preferences.profiles.tsmc28.devices.nmos.target = "custom_nch";

    const restored = createDefaultNetlistExportPreferences();

    expect(restored).toEqual(readNetlistExportPreferences(null));
    expect(restored.selected).toBe("abstract");
    expect(restored.format).toBe("spice");
    expect(restored.profiles.tsmc28.devices.nmos.target).toBe("nch_ulvt_mac");
  });
  it.each(["{", "null", "[]", '{"selected":"custom","profiles":{}}'])(
    "recovers malformed preferences: %s",
    (raw) => {
      expect(readNetlistExportPreferences(raw)).toEqual(
        readNetlistExportPreferences(null),
      );
    },
  );
  it("rejects mismatched identities and unsafe library paths", () => {
    const preferences = readNetlistExportPreferences(null);
    preferences.profiles.abstract.id = "custom";
    expect(
      readNetlistExportPreferences(JSON.stringify(preferences)).profiles
        .abstract.id,
    ).toBe("abstract");
    preferences.profiles.abstract.id = "abstract";
    preferences.profiles.custom.library.path = 'a"\n.end';
    expect(
      readNetlistExportPreferences(JSON.stringify(preferences)).profiles.custom
        .library.path,
    ).toBe("");
  });
});

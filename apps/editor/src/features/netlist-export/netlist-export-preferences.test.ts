import { describe, expect, it } from "vitest";
import {
  readNetlistExportPreferences,
  selectNetlistExportProfile,
} from "./netlist-export-preferences.js";

describe("netlist export preferences", () => {
  it("restores independent edited presets and the selected preset", () => {
    const preferences = readNetlistExportPreferences(null);
    preferences.selected = "custom";
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

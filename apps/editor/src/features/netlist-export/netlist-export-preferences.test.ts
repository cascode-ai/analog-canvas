import { describe, expect, it } from "vitest";
import { readNetlistExportPreferences } from "./netlist-export-preferences.js";

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

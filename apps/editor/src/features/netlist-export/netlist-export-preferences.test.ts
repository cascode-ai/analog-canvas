import { describe, expect, it } from "vitest";
import {
  createDefaultNetlistExportPreferences,
  parseNetlistExportPreferences,
  readNetlistExportPreferences,
  selectNetlistExportMode,
  selectNetlistExportProfile,
  setNetlistExportDeviceTarget,
} from "./netlist-export-preferences.js";
import {
  createNetlistExportProfile,
  NETLIST_PROFILE_IDS,
} from "./netlist-process-presets.js";

describe("netlist authoring preferences", () => {
  it("moves the old SG13 ideal defaults once and preserves subsequent explicit Ideal choices", () => {
    const old = createDefaultNetlistExportPreferences();
    delete old.sg13Defaults;
    old.profiles.sg13g2.devices.resistor.target = "";
    old.profiles.sg13g2.devices.capacitor.target = "";
    old.profiles.sg13g2.devices.resistor.substrate = "VNEG";
    const updated = readNetlistExportPreferences(JSON.stringify(old));
    expect(updated.profiles.sg13g2.devices.resistor.target).toBe("rppd");
    expect(updated.profiles.sg13g2.devices.capacitor.target).toBe("cap_cmim");
    expect(updated.profiles.sg13g2.devices.resistor.substrate).toBe("VNEG");
    const ideal = setNetlistExportDeviceTarget(
      selectNetlistExportProfile(updated, "sg13g2"),
      "resistor",
      "",
    );
    expect(
      readNetlistExportPreferences(JSON.stringify(ideal)).profiles.sg13g2
        .devices.resistor.target,
    ).toBe("");
  });
  it("remembers an RNL mode as its dialect and a flag, and drops the flag again", () => {
    const rnl = selectNetlistExportMode(
      createDefaultNetlistExportPreferences(),
      "spectre+rnl",
    );
    expect(rnl.format).toBe("spectre");
    expect(rnl.rnl).toBe(true);
    expect(readNetlistExportPreferences(JSON.stringify(rnl))).toEqual(rnl);
    const plain = selectNetlistExportMode(rnl, "spice");
    expect(plain.format).toBe("spice");
    expect(plain).not.toHaveProperty("rnl");
    expect(() =>
      parseNetlistExportPreferences(JSON.stringify({ ...rnl, rnl: "yes" })),
    ).toThrow("rnl must be true or false.");
  });

  it("remembers format, process and device choices independently", () => {
    const preferences = setNetlistExportDeviceTarget(
      selectNetlistExportProfile(
        selectNetlistExportMode(
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
    expect(selectNetlistExportMode(preferences, "spice").selected).toBe(
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
    expect(Object.keys(restored.profiles)).toEqual([
      "abstract",
      "sky130",
      "sg13g2",
      "custom",
    ]);
  });

  /** A browser's preference from when TSMC 28 and TSMC 180 were Processes. */
  function storedWithTsmc(selected: string) {
    const stored = createDefaultNetlistExportPreferences();
    const tsmc = (id: string, nmos: string, pmos: string) => {
      const profile = createNetlistExportProfile("custom");
      profile.devices.nmos.target = nmos;
      profile.devices.pmos.target = pmos;
      for (const family of ["nmos", "pmos"] as const) {
        delete profile.devices[family].parameters.m;
        profile.devices[family].parameters.l = "30n";
        profile.devices[family].parameters.multi = "1";
      }
      return { ...profile, id };
    };
    return {
      ...stored,
      selected,
      profiles: {
        ...stored.profiles,
        tsmc28: tsmc("tsmc28", "nch_ulvt_mac", "pch_ulvt_mac"),
        tsmc180: tsmc("tsmc180", "nch", "pch"),
      },
    };
  }

  it("reads a remembered TSMC process as Custom with the templates its author worked with", () => {
    const restored = readNetlistExportPreferences(
      JSON.stringify(storedWithTsmc("tsmc28")),
    );
    expect(restored.selected).toBe("custom");
    expect(Object.keys(restored.profiles)).toEqual([
      "abstract",
      "sky130",
      "sg13g2",
      "custom",
    ]);
    expect(restored.profiles.custom.id).toBe("custom");
    expect(restored.profiles.custom.devices.nmos).toMatchObject({
      target: "nch_ulvt_mac",
      parameters: { l: "30n", multi: "1" },
    });
    expect(restored.profiles.custom.devices.pmos.target).toBe("pch_ulvt_mac");
    // The move is complete: reading it again changes nothing.
    expect(readNetlistExportPreferences(JSON.stringify(restored))).toEqual(
      restored,
    );
  });

  it("keeps an edited Custom when a remembered TSMC process moves to it", () => {
    const stored = storedWithTsmc("tsmc180");
    stored.profiles.custom.devices.nmos.target = "my_nmos";
    const restored = readNetlistExportPreferences(JSON.stringify(stored));
    expect(restored.selected).toBe("custom");
    expect(restored.profiles.custom.devices.nmos.target).toBe("my_nmos");
    expect(restored.profiles.custom.devices.pmos.target).toBe("PMOS");
    // An unselected TSMC template simply goes.
    const sky130 = readNetlistExportPreferences(
      JSON.stringify(storedWithTsmc("sky130")),
    );
    expect(sky130.selected).toBe("sky130");
    expect(sky130.profiles.custom).toEqual(
      createNetlistExportProfile("custom"),
    );
  });

  it("refuses a TSMC process in pasted configuration, naming the open ones", () => {
    expect(() =>
      parseNetlistExportPreferences(
        JSON.stringify({
          ...createDefaultNetlistExportPreferences(),
          selected: "tsmc28",
        }),
      ),
    ).toThrow("selected must be one of: abstract, sky130, sg13g2, custom.");
  });

  it("adds the IHP SG13G2 template to preferences saved before it existed", () => {
    const saved = createDefaultNetlistExportPreferences();
    const { sg13g2: _added, ...older } = saved.profiles;
    const restored = readNetlistExportPreferences(
      JSON.stringify({ ...saved, selected: "sky130", profiles: older }),
    );
    expect(restored.selected).toBe("sky130");
    expect(restored.profiles.sg13g2.devices.nmos.target).toBe("sg13_lv_nmos");
    expect(restored.profiles.sg13g2.devices.npn.target).toBe("npn13G2");
    expect(restored.profiles.sg13g2.devices.nmos.parameters).toMatchObject({
      l: "130n",
    });
    expect(restored.profiles.sg13g2.devices.nmos.parameters).not.toHaveProperty(
      "nf",
    );
  });

  it("gives preferences saved before the JFETs, Schottky diode and depletion MOS their stand-ins, keeping every other choice", () => {
    const saved = createDefaultNetlistExportPreferences();
    saved.selected = "custom";
    saved.profiles.custom.devices.npn.target = "my_npn";
    saved.profiles.sky130.devices.nmos.parameters.w = "5u";
    const older = structuredClone(saved);
    for (const id of NETLIST_PROFILE_IDS) {
      const devices: Record<string, unknown> = older.profiles[id].devices;
      delete devices.njfet;
      delete devices.pjfet;
      delete devices["schottky-diode"];
      delete devices["depletion-nmos"];
      delete devices["depletion-pmos"];
    }
    const restored = readNetlistExportPreferences(JSON.stringify(older));
    expect(restored).toEqual(saved);
    for (const id of NETLIST_PROFILE_IDS) {
      expect(restored.profiles[id].devices.njfet.target).toBe("NJF");
      expect(restored.profiles[id].devices.pjfet.target).toBe("PJF");
      expect(restored.profiles[id].devices["schottky-diode"].target).toBe(
        "DSCH",
      );
      expect(restored.profiles[id].devices["depletion-nmos"].target).toBe(
        "NMOS_DEP",
      );
      expect(restored.profiles[id].devices["depletion-pmos"].target).toBe(
        "PMOS_DEP",
      );
    }
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

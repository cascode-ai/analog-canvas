import {
  deviceDescriptor,
  reviewedExternalBindingForMaster,
} from "@icm/devices";
import { GENERIC_DIODE_MODEL } from "@icm/netlist";
export const NETLIST_PROFILE_IDS = [
  "abstract",
  "sky130",
  "sg13g2",
  "tsmc28",
  "tsmc180",
  "custom",
] as const;
export type NetlistProfileId = (typeof NETLIST_PROFILE_IDS)[number];
export const NETLIST_PROFILE_LABELS = {
  abstract: "Abstract",
  sky130: "SKY130",
  sg13g2: "IHP SG13G2",
  tsmc28: "TSMC 28",
  tsmc180: "TSMC 180",
  custom: "Custom",
} as const;
export const NETLIST_QUICK_TARGET_FAMILIES = [
  "nmos",
  "pmos",
  "resistor",
  "capacitor",
  "inductor",
] as const;
export type NetlistQuickTargetFamily =
  (typeof NETLIST_QUICK_TARGET_FAMILIES)[number];

const SKY130_QUICK_TARGETS = {
  sky130: {
    nmos: [
      "sky130_fd_pr__nfet_01v8",
      "sky130_fd_pr__nfet_01v8_lvt",
      "sky130_fd_pr__nfet_03v3_nvt",
      "sky130_fd_pr__nfet_05v0_nvt",
      "sky130_fd_pr__nfet_g5v0d10v5",
      "sky130_fd_pr__nfet_g5v0d16v0",
      "sky130_fd_pr__nfet_20v0",
      "sky130_fd_pr__nfet_20v0_nvt",
      "sky130_fd_pr__nfet_20v0_zvt",
    ],
    pmos: [
      "sky130_fd_pr__pfet_01v8",
      "sky130_fd_pr__pfet_01v8_lvt",
      "sky130_fd_pr__pfet_01v8_hvt",
      "sky130_fd_pr__pfet_g5v0d10v5",
      "sky130_fd_pr__pfet_g5v0d16v0",
      "sky130_fd_pr__pfet_20v0",
    ],
    resistor: ["", "sky130_fd_pr__res_high_po", "sky130_fd_pr__res_xhigh_po"],
    capacitor: [
      "",
      "sky130_fd_pr__cap_mim_m3_1",
      "sky130_fd_pr__cap_mim_m3_2",
      "sky130_fd_pr__cap_var_lvt",
    ],
    inductor: [
      "",
      "sky130_fd_pr__ind_03_90",
      "sky130_fd_pr__ind_05_125",
      "sky130_fd_pr__ind_05_220",
    ],
  },
} as const;

/** IHP SG13G2's core (1.2 V) and thick-oxide (3.3 V) MOS, poly resistors
 * and MIM capacitors, as IHP-Open-PDK's ngspice models name them. */
const SG13G2_QUICK_TARGETS = {
  sg13g2: {
    nmos: ["sg13_lv_nmos", "sg13_hv_nmos"],
    pmos: ["sg13_lv_pmos", "sg13_hv_pmos"],
    resistor: ["", "rsil", "rppd", "rhigh"],
    capacitor: ["", "cap_cmim", "cap_rfcmim"],
    inductor: [""],
  },
} as const;

export const NETLIST_DEVICE_TARGET_OPTIONS: Readonly<
  Record<
    NetlistProfileId,
    Readonly<Record<NetlistQuickTargetFamily, readonly string[]>>
  >
> = {
  abstract: {
    nmos: ["NMOS"],
    pmos: ["PMOS"],
    resistor: [""],
    capacitor: [""],
    inductor: [""],
  },
  ...SKY130_QUICK_TARGETS,
  ...SG13G2_QUICK_TARGETS,
  tsmc28: {
    nmos: [
      "nch_ulvt_mac",
      "nch_lvt_mac",
      "nch_mac",
      "nch_hvt_mac",
      "nch_ehvt_mac",
      "nch_18_mac",
    ],
    pmos: [
      "pch_ulvt_mac",
      "pch_lvt_mac",
      "pch_mac",
      "pch_ehvt_mac",
      "pch_18_mac",
    ],
    resistor: [""],
    capacitor: [""],
    inductor: [""],
  },
  tsmc180: {
    nmos: ["nch", "nch_mac"],
    pmos: ["pch", "pch_mac"],
    resistor: [""],
    capacitor: [""],
    inductor: [""],
  },
  custom: {
    nmos: [
      "NMOS",
      "sky130_fd_pr__nfet_01v8",
      "sky130_fd_pr__nfet_01v8_lvt",
      "sky130_fd_pr__nfet_03v3_nvt",
      "sky130_fd_pr__nfet_05v0_nvt",
      "sky130_fd_pr__nfet_g5v0d10v5",
      "sky130_fd_pr__nfet_g5v0d16v0",
      "sky130_fd_pr__nfet_20v0",
      "sky130_fd_pr__nfet_20v0_nvt",
      "sky130_fd_pr__nfet_20v0_zvt",
      ...SG13G2_QUICK_TARGETS.sg13g2.nmos,
      "nch_ulvt_mac",
      "nch_lvt_mac",
      "nch_mac",
      "nch_hvt_mac",
      "nch_ehvt_mac",
      "nch_18_mac",
      "nch",
    ],
    pmos: [
      "PMOS",
      "sky130_fd_pr__pfet_01v8",
      "sky130_fd_pr__pfet_01v8_lvt",
      "sky130_fd_pr__pfet_01v8_hvt",
      "sky130_fd_pr__pfet_g5v0d10v5",
      "sky130_fd_pr__pfet_g5v0d16v0",
      "sky130_fd_pr__pfet_20v0",
      ...SG13G2_QUICK_TARGETS.sg13g2.pmos,
      "pch_ulvt_mac",
      "pch_lvt_mac",
      "pch_mac",
      "pch_ehvt_mac",
      "pch_18_mac",
      "pch",
    ],
    resistor: [
      ...SKY130_QUICK_TARGETS.sky130.resistor,
      ...SG13G2_QUICK_TARGETS.sg13g2.resistor.slice(1),
    ],
    capacitor: [
      ...SKY130_QUICK_TARGETS.sky130.capacitor,
      ...SG13G2_QUICK_TARGETS.sg13g2.capacitor.slice(1),
    ],
    inductor: [...SKY130_QUICK_TARGETS.sky130.inductor],
  },
};
export const NETLIST_DEVICE_FAMILIES = [
  "nmos",
  "pmos",
  "resistor",
  "capacitor",
  "inductor",
  "voltage-source",
  "current-source",
  "npn",
  "pnp",
  "diode",
  "switch",
] as const;
export type NetlistDeviceFamily = (typeof NETLIST_DEVICE_FAMILIES)[number];
export interface NetlistDeviceDefaults {
  /** Empty uses an ideal primitive, or leaves a model target unspecified. */
  target: string;
  parameters: Record<string, string>;
  /** Default for new property-only substrate terminals; existing nets win. */
  substrate: string;
}
export interface NetlistExportProfile {
  id: NetlistProfileId;
  devices: Record<NetlistDeviceFamily, NetlistDeviceDefaults>;
}

const GENERIC_TARGETS: Partial<Record<NetlistDeviceFamily, string>> = {
  nmos: "NMOS",
  pmos: "PMOS",
  npn: "NPN",
  pnp: "PNP",
  // The netlist defines this one itself while nothing else does.
  diode: GENERIC_DIODE_MODEL.name,
  switch: "SW",
};
const SKY130_TARGETS: Partial<Record<NetlistDeviceFamily, string>> = {
  nmos: "sky130_fd_pr__nfet_01v8",
  pmos: "sky130_fd_pr__pfet_01v8",
  npn: "sky130_fd_pr__npn_05v5_W1p00L1p00",
  pnp: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
};
const SG13G2_TARGETS: Partial<Record<NetlistDeviceFamily, string>> = {
  nmos: "sg13_lv_nmos",
  pmos: "sg13_lv_pmos",
  npn: "npn13G2",
  pnp: "pnpMPA",
};
const TSMC28_TARGETS: Partial<Record<NetlistDeviceFamily, string>> = {
  nmos: "nch_ulvt_mac",
  pmos: "pch_ulvt_mac",
};
const TSMC180_TARGETS: Partial<Record<NetlistDeviceFamily, string>> = {
  nmos: "nch",
  pmos: "pch",
  pnp: "pnp10_5_rpo",
};

/**
 * A drain-extended (DMOS) symbol cannot take a process's core MOS model when
 * that model is drawn as a plain MOS; it takes the process's own
 * high-voltage device instead, with that device's geometry.
 */
export const NETLIST_HIGH_VOLTAGE_TARGETS: Partial<
  Record<NetlistProfileId, Readonly<Record<"ndmos" | "pdmos", string>>>
> = {
  sky130: {
    ndmos: "sky130_fd_pr__nfet_g5v0d16v0",
    pdmos: "sky130_fd_pr__pfet_g5v0d16v0",
  },
};

export function netlistDeviceFamily(
  symbolId: string,
): NetlistDeviceFamily | undefined {
  // A Zener's model is its own: BV builds one, or the author names one. The
  // diode family's generic model has no breakdown and would refuse BV.
  if (symbolId === "zener-diode") return undefined;
  const descriptor = deviceDescriptor(symbolId);
  if (descriptor?.mosBulkClass) return descriptor.mosBulkClass;
  if (descriptor?.deviceClass === "bjt")
    return symbolId === "pnp" ? "pnp" : "npn";
  if (
    descriptor &&
    (NETLIST_DEVICE_FAMILIES as readonly string[]).includes(
      descriptor.deviceClass,
    )
  )
    return descriptor.deviceClass as NetlistDeviceFamily;
  return undefined;
}

export function createNetlistExportProfile(
  id: NetlistProfileId,
): NetlistExportProfile {
  const foundryProfile = id === "tsmc28" || id === "tsmc180";
  const foundryTargets =
    id === "sky130"
      ? SKY130_TARGETS
      : id === "sg13g2"
        ? SG13G2_TARGETS
        : id === "tsmc28"
          ? TSMC28_TARGETS
          : id === "tsmc180"
            ? TSMC180_TARGETS
            : undefined;
  const devices = Object.fromEntries(
    NETLIST_DEVICE_FAMILIES.map((family) => {
      const parameters = Object.fromEntries(
        (deviceDescriptor(family)?.parameters ?? [])
          .filter(
            (parameter) =>
              parameter.defaultValue !== undefined &&
              (parameter.required ||
                ["w", "l", "m", "nf"].includes(parameter.name)),
          )
          .map((parameter) => [parameter.name, parameter.defaultValue!]),
      );
      if (["nmos", "pmos"].includes(family)) {
        if (id === "tsmc28") {
          parameters.l = "30n";
          delete parameters.m;
          parameters.multi = "1";
        } else if (id === "tsmc180") {
          parameters.l = "180n";
        } else if (id === "sg13g2") {
          // The core devices' minimum length; SG13G2 counts fingers as ng.
          parameters.l = "130n";
          delete parameters.nf;
        }
      }
      if (family === "voltage-source") parameters.dc = "1.8";
      if (family === "current-source") parameters.dc = "100u";
      return [
        family,
        {
          target:
            foundryTargets?.[family] ??
            (foundryProfile ? undefined : GENERIC_TARGETS[family]) ??
            "",
          parameters,
          substrate:
            family === "pmos" ? "VDD" : family === "nmos" ? "VSS" : "0",
        },
      ];
    }),
  ) as Record<NetlistDeviceFamily, NetlistDeviceDefaults>;
  return {
    id,
    devices,
  };
}

/** Switching a target starts its own parameter defaults; circuit values stay separate. */
export function setNetlistDefaultTarget(
  profile: NetlistExportProfile,
  family: NetlistDeviceFamily,
  target: string,
): NetlistExportProfile {
  const next = structuredClone(profile);
  const reviewed = reviewedExternalBindingForMaster(target);
  next.devices[family].target = target;
  next.devices[family].parameters = reviewed
    ? Object.fromEntries(
        reviewed.parameters.map((p) => [p.name, p.defaultValue ?? ""]),
      )
    : createNetlistExportProfile(profile.id).devices[family].parameters;
  return next;
}

/** Validate cached authoring templates and pasted configuration. */
export function isNetlistExportProfile(
  value: unknown,
): value is NetlistExportProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as NetlistExportProfile;
  const text = (v: unknown) =>
    typeof v === "string" && v.length <= 1024 && !/[\r\n\0]/u.test(v);
  if (!(NETLIST_PROFILE_IDS as readonly unknown[]).includes(p.id)) return false;
  return NETLIST_DEVICE_FAMILIES.every((family) => {
    const rule = p.devices?.[family];
    return (
      rule &&
      text(rule.target) &&
      (!rule.target || /^[A-Za-z_][A-Za-z0-9_]*$/u.test(rule.target)) &&
      text(rule.substrate) &&
      !!rule.parameters &&
      typeof rule.parameters === "object" &&
      Object.entries(rule.parameters).length <= 64 &&
      Object.entries(rule.parameters).every(
        ([key, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) && text(v),
      )
    );
  });
}

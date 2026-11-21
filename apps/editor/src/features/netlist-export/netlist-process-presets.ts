import {
  deviceDescriptor,
  GENERIC_MODEL_TARGETS,
  ICS55_MOS_MODELS,
  LIBRARY_PROCESS,
  reviewedExternalDeviceBindings,
  reviewedExternalBindingForMaster,
} from "@icm/devices";
export const NETLIST_PROFILE_IDS = [
  "abstract",
  "sky130",
  "sg13g2",
  "ics55",
  "custom",
] as const;
export type NetlistProfileId = (typeof NETLIST_PROFILE_IDS)[number];
export const NETLIST_PROFILE_LABELS = {
  abstract: "Abstract",
  sky130: "SKY130",
  sg13g2: "IHP SG13G2",
  ics55: "ICsprout55 (ICS55)",
  custom: "Custom",
} as const;
export const NETLIST_QUICK_TARGET_FAMILIES = [
  "nmos",
  "pmos",
  "resistor",
  "capacitor",
  "inductor",
  "npn",
  "pnp",
] as const;
export type NetlistQuickTargetFamily =
  (typeof NETLIST_QUICK_TARGET_FAMILIES)[number];

const SKY130_QUICK_TARGETS = {
  sky130: {
    npn: ["sky130_fd_pr__npn_05v5_W1p00L1p00"],
    pnp: ["sky130_fd_pr__pnp_05v5_W0p68L0p68"],
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
    npn: ["npn13G2", "npn13G2l", "npn13G2v"],
    pnp: ["pnpMPA"],
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
    npn: [GENERIC_MODEL_TARGETS.npn],
    pnp: [GENERIC_MODEL_TARGETS.pnp],
    nmos: ["NMOS"],
    pmos: ["PMOS"],
    resistor: [""],
    capacitor: [""],
    inductor: [""],
  },
  ...SKY130_QUICK_TARGETS,
  ...SG13G2_QUICK_TARGETS,
  ics55: {
    ...ICS55_MOS_MODELS,
    npn: [GENERIC_MODEL_TARGETS.npn],
    pnp: [GENERIC_MODEL_TARGETS.pnp],
    resistor: [""],
    capacitor: [""],
    inductor: [""],
  },
  custom: {
    npn: [
      GENERIC_MODEL_TARGETS.npn,
      ...SKY130_QUICK_TARGETS.sky130.npn,
      ...SG13G2_QUICK_TARGETS.sg13g2.npn,
    ],
    pnp: [
      GENERIC_MODEL_TARGETS.pnp,
      ...SKY130_QUICK_TARGETS.sky130.pnp,
      ...SG13G2_QUICK_TARGETS.sg13g2.pnp,
    ],
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
      ...ICS55_MOS_MODELS.nmos,
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
      ...ICS55_MOS_MODELS.pmos,
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
  "depletion-nmos",
  "depletion-pmos",
  "resistor",
  "capacitor",
  "inductor",
  "voltage-source",
  "current-source",
  "npn",
  "pnp",
  "njfet",
  "pjfet",
  "diode",
  "schottky-diode",
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
  ...GENERIC_MODEL_TARGETS,
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
  resistor: "rppd",
  capacitor: "cap_cmim",
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

/**
 * The Process's own device for a symbol that prints nothing itself, such as
 * the MOS Varactor (IHP's `sg13_hv_svaricap`, #2321): the one reviewed
 * device of that Process drawn with it, or undefined where there is none or
 * a choice to make (SKY130's three centre-tapped inductors).
 */
export function processOwnDevice(
  processId: NetlistProfileId,
  symbolId: string,
): string | undefined {
  if (deviceDescriptor(symbolId)?.targetPolicy !== "none") return undefined;
  const devices = reviewedExternalDeviceBindings.filter(
    (binding) =>
      binding.symbolId === symbolId &&
      !binding.legacy &&
      LIBRARY_PROCESS[binding.libraryId] === processId,
  );
  return devices.length === 1 ? devices[0]!.masterName : undefined;
}

export function netlistDeviceFamily(
  symbolId: string,
): NetlistDeviceFamily | undefined {
  // A Zener's model is its own: BV builds one, or the author names one. The
  // diode family's generic model has no breakdown and would refuse BV.
  if (symbolId === "zener-diode") return undefined;
  // A Schottky diode is a diode with its own generic barrier model.
  if (symbolId === "schottky-diode") return "schottky-diode";
  // An ammeter is a 0 V source: a Process's source defaults (1.8 V) never
  // apply to it.
  if (symbolId === "ammeter") return undefined;
  // A depletion MOS is on at VGS = 0: no Process's enhancement device fits
  // it, so it is a family of its own with a generic depletion model.
  if (symbolId === "depletion-nmos" || symbolId === "depletion-pmos")
    return symbolId;
  const descriptor = deviceDescriptor(symbolId);
  if (descriptor?.mosBulkClass) return descriptor.mosBulkClass;
  if (descriptor?.deviceClass === "bjt")
    return symbolId === "pnp" ? "pnp" : "npn";
  if (descriptor?.deviceClass === "jfet")
    return symbolId === "pjfet" ? "pjfet" : "njfet";
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
  const foundryTargets: Partial<Record<NetlistDeviceFamily, string>> = {
    abstract: GENERIC_TARGETS,
    custom: GENERIC_TARGETS,
    sky130: SKY130_TARGETS,
    sg13g2: SG13G2_TARGETS,
    ics55: { nmos: ICS55_MOS_MODELS.nmos[0], pmos: ICS55_MOS_MODELS.pmos[0] },
  }[id];
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
        if (id === "sg13g2") {
          // The core devices' minimum length; SG13G2 counts fingers as ng.
          parameters.l = "130n";
          delete parameters.nf;
        }
        if (id === "ics55") {
          // The CDL carries its own multiplicity (MR). Keep authored parameters.
          delete parameters.m;
          delete parameters.nf;
        }
      }
      if (family === "voltage-source") parameters.dc = "1.8";
      if (family === "current-source") parameters.dc = "100u";
      const target = foundryTargets?.[family] ?? GENERIC_TARGETS[family] ?? "";
      const reviewed =
        id === "sg13g2" && (family === "resistor" || family === "capacitor")
          ? reviewedExternalBindingForMaster(target)
          : undefined;
      return [
        family,
        {
          target,
          parameters: reviewed
            ? Object.fromEntries(
                reviewed.parameters.map((p) => [p.name, p.defaultValue ?? ""]),
              )
            : parameters,
          substrate:
            family === "pmos" || family === "depletion-pmos"
              ? "VDD"
              : family === "nmos" || family === "depletion-nmos"
                ? "VSS"
                : "0",
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
    : createNetlistExportProfile(target ? profile.id : "abstract").devices[
        family
      ].parameters;
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

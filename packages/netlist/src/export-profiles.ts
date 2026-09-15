import {
  deviceDescriptor,
  reviewedExternalBindingForMaster,
  resolveReviewedExternalBinding,
} from "@icm/devices";
import {
  deriveProjectNetNameProjection,
  directObjectLocator,
} from "@icm/derived";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import type { NetlistDiagnostic } from "./ir.js";

export const NETLIST_PROFILE_IDS = [
  "abstract",
  "sky130",
  "tsmc28",
  "tsmc180",
  "custom",
] as const;
export type NetlistProfileId = (typeof NETLIST_PROFILE_IDS)[number];
export const NETLIST_PROFILE_LABELS = {
  abstract: "Abstract",
  sky130: "SKY130 PDK",
  tsmc28: "TSMC 28",
  tsmc180: "TSMC 180",
  custom: "Custom",
} as const;
export const NETLIST_MOS_TARGET_OPTIONS: Readonly<
  Record<NetlistProfileId, Readonly<Record<"nmos" | "pmos", readonly string[]>>>
> = {
  abstract: { nmos: ["NMOS"], pmos: ["PMOS"] },
  sky130: {
    nmos: ["sky130_fd_pr__nfet_01v8", "sky130_fd_pr__nfet_01v8_lvt"],
    pmos: ["sky130_fd_pr__pfet_01v8", "sky130_fd_pr__pfet_01v8_lvt"],
  },
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
  },
  tsmc180: {
    nmos: ["nch", "nch_mac"],
    pmos: ["pch", "pch_mac"],
  },
  custom: {
    nmos: [
      "NMOS",
      "sky130_fd_pr__nfet_01v8",
      "sky130_fd_pr__nfet_01v8_lvt",
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
      "pch_ulvt_mac",
      "pch_lvt_mac",
      "pch_mac",
      "pch_ehvt_mac",
      "pch_18_mac",
      "pch",
    ],
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
  library: { path: string; section: string };
}

const GENERIC_TARGETS: Partial<Record<NetlistDeviceFamily, string>> = {
  nmos: "NMOS",
  pmos: "PMOS",
  npn: "NPN",
  pnp: "PNP",
  diode: "DIODE",
  switch: "SW",
};
const SKY130_TARGETS: Partial<Record<NetlistDeviceFamily, string>> = {
  nmos: "sky130_fd_pr__nfet_01v8",
  pmos: "sky130_fd_pr__pfet_01v8",
  npn: "sky130_fd_pr__npn_05v5_W1p00L1p00",
  pnp: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
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

export function netlistDeviceFamily(
  symbolId: string,
): NetlistDeviceFamily | undefined {
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
    library: {
      path:
        id === "sky130"
          ? "sky130.lib.spice"
          : id === "tsmc28"
            ? "toplevel.scs"
            : id === "tsmc180"
              ? "cmn018_gp2a_5v_v1d4_usage.scs"
              : "",
      section:
        id === "sky130"
          ? "tt"
          : id === "tsmc28"
            ? "TOP_TT"
            : id === "tsmc180"
              ? "tt_lib"
              : "",
    },
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

/** Used at both preference restoration and export. Never trust stored browser JSON. */
export function isNetlistExportProfile(
  value: unknown,
): value is NetlistExportProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as NetlistExportProfile;
  const text = (v: unknown) =>
    typeof v === "string" && v.length <= 1024 && !/[\r\n\0]/u.test(v);
  if (
    !(NETLIST_PROFILE_IDS as readonly unknown[]).includes(p.id) ||
    !p.library ||
    !text(p.library.path) ||
    /["\r\n]/u.test(p.library.path) ||
    !text(p.library.section) ||
    (p.library.section && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(p.library.section))
  )
    return false;
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

function matchingBinding(project: CircuitProject, instance: Instance) {
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "external-subcircuit") return undefined;
  const definition = project.externalSubcircuitDefinitions.find(
    (d) => d.id === binding.definitionId,
  );
  return definition && !definition.presentation
    ? resolveReviewedExternalBinding(
        definition.name,
        definition.terminals.map((t) => t.name),
      )
    : undefined;
}

export interface ProfiledNetlistProject {
  project: CircuitProject;
  diagnostics: NetlistDiagnostic[];
}

/** Apply an explicit export preset only to a copy; no persisted topology edits. */
export function projectNetlistExportProfile(
  source: CircuitProject,
  profile: NetlistExportProfile,
  rootDocumentId: string = source.topDocumentId,
): ProfiledNetlistProject {
  const project = structuredClone(source);
  const diagnostics: NetlistDiagnostic[] = [];
  const add = (
    document: SchematicDocument,
    instance: Instance | undefined,
    code: string,
    message: string,
    severity: "error" | "warning" = "warning",
  ) =>
    diagnostics.push({
      code,
      severity,
      documentId: document.id,
      objectIds: instance ? [instance.id] : [],
      primary: instance
        ? directObjectLocator(document.id, "instance", instance.id)
        : directObjectLocator(document.id, "document", document.id),
      message,
    });
  if (!isNetlistExportProfile(profile)) {
    add(
      project.documents[0]!,
      undefined,
      "INVALID_EXPORT_PROFILE",
      "Correct the netlist defaults or library settings before downloading.",
      "error",
    );
    return { project, diagnostics };
  }
  const projections = deriveProjectNetNameProjection({
    ...project,
    topDocumentId: rootDocumentId,
  }).byDocumentId;
  const reachable = new Set<string>();
  const pending = [rootDocumentId];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const instance of project.documents.find((d) => d.id === id)
      ?.instances ?? []) {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") pending.push(binding.childDocumentId);
    }
  }
  const fill = (
    document: SchematicDocument,
    instance: Instance,
    defaults: Record<string, string>,
  ) => {
    const parameters = instance.netlist!.parameters;
    for (const [name, value] of Object.entries(defaults)) {
      // A DC fallback must not change the operating point of an authored AC
      // or transient source that deliberately has no separate DC value.
      if (
        name.toLowerCase() === "dc" &&
        Object.entries(parameters).some(
          ([key, raw]) =>
            (key.toLowerCase() === "waveform" &&
              raw.trim().toLowerCase() !== "dc") ||
            (["acmag", "acphase"].includes(key.toLowerCase()) && raw.trim()),
        )
      )
        continue;
      const key =
        Object.keys(parameters).find(
          (k) => k.toLowerCase() === name.toLowerCase(),
        ) ?? name;
      if (parameters[key]?.trim() || !value.trim()) continue;
      parameters[key] = value;
      add(
        document,
        instance,
        "EXPORT_DEFAULT_PARAMETER",
        `${document.netlist?.name}/${instance.reference}: ${key}=${value} (preset default)`,
      );
    }
  };
  const renameParameter = (
    parameters: Record<string, string>,
    from: string,
    to: string,
  ) => {
    const source = Object.keys(parameters).find(
      (name) => name.toLowerCase() === from.toLowerCase(),
    );
    if (!source) return;
    const target = Object.keys(parameters).find(
      (name) => name.toLowerCase() === to.toLowerCase(),
    );
    if (!target || !parameters[target]?.trim())
      parameters[target ?? to] = parameters[source]!;
    if (source.toLowerCase() !== to.toLowerCase()) delete parameters[source];
  };
  const reference = (
    document: SchematicDocument,
    instance: Instance,
    wanted: string,
  ) => {
    if (
      document.instances.some(
        (i) =>
          i.id !== instance.id &&
          i.reference?.toLowerCase() === wanted.toLowerCase(),
      )
    ) {
      add(
        document,
        instance,
        "EXPORT_REFERENCE_CONFLICT",
        `Cannot map ${instance.reference} to ${wanted}: that reference is already used.`,
        "error",
      );
    } else instance.reference = wanted;
  };
  for (const document of project.documents) {
    if (!reachable.has(document.id)) continue;
    const substrateNets = new Map(
      [...(projections.get(document.id)?.values() ?? [])].flatMap((name) =>
        name.preferredSpelling && name.baseNetIds[0]
          ? [
              [
                name.preferredSpelling.toLowerCase(),
                name.baseNetIds[0],
              ] as const,
            ]
          : [],
      ),
    );
    for (const instance of document.instances) {
      const family = netlistDeviceFamily(instance.symbolId);
      const descriptor = deviceDescriptor(instance.symbolId);
      const data = instance.netlist;
      if (!family || !descriptor || !data) continue;
      const current = matchingBinding(project, instance);

      // Imported custom hierarchy keeps its explicit master/interface contract.
      if (
        data.binding?.kind === "subcircuit" ||
        data.binding?.kind === "unresolved-subcircuit" ||
        (data.binding?.kind === "external-subcircuit" && !current)
      )
        continue;
      // Presets must not repair an inconsistent binding into apparent validity.
      if (
        data.binding &&
        "deviceClass" in data.binding &&
        data.binding.deviceClass !== descriptor.deviceClass
      )
        continue;
      if (
        instance.reference &&
        !instance.reference
          .toUpperCase()
          .startsWith(current ? "X" : (descriptor.referencePrefix ?? ""))
      ) {
        add(
          document,
          instance,
          "EXPORT_REFERENCE_MISMATCH",
          `${instance.reference} has the wrong device reference prefix.`,
          "error",
        );
        continue;
      }
      const rule = profile.devices[family];
      const preserveTarget =
        (profile.id === "custom" &&
          !!data.binding &&
          data.binding.kind !== "primitive") ||
        (profile.id === "sky130" && !!current);
      const target = preserveTarget
        ? (current?.masterName ??
          (data.binding?.kind === "model" ? data.binding.name : ""))
        : rule.target;
      const reviewed = reviewedExternalBindingForMaster(target);
      if (reviewed && netlistDeviceFamily(reviewed.symbolId) !== family) {
        add(
          document,
          instance,
          "EXPORT_TARGET_CLASS_MISMATCH",
          `${target} is not compatible with ${family}.`,
          "error",
        );
        continue;
      }
      if (
        !reviewed &&
        !["required-model", "none"].includes(descriptor.targetPolicy) &&
        target
      ) {
        add(
          document,
          instance,
          "EXPORT_TARGET_INTERFACE_REQUIRED",
          `${family} needs an ideal primitive or a reviewed PDK target; author other subcircuit interfaces on the component.`,
          "error",
        );
        continue;
      }
      if (reviewed) {
        const defaults =
          preserveTarget && target !== rule.target
            ? Object.fromEntries(
                reviewed.parameters.map((p) => [p.name, p.defaultValue ?? ""]),
              )
            : rule.parameters;
        const allowed = new Set(
          reviewed.parameters.map((p) => p.name.toLowerCase()),
        );
        for (const key of Object.keys(data.parameters)) {
          if (allowed.has(key.toLowerCase()) || current) continue;
          if (
            key.toLowerCase() === "value" &&
            ["resistor", "capacitor"].includes(family)
          ) {
            add(
              document,
              instance,
              "EXPORT_PHYSICAL_PASSIVE",
              `${instance.reference}: physical ${family} uses W/L; the ideal value ${data.parameters[key]} is not converted.`,
            );
            delete data.parameters[key];
          } else {
            add(
              document,
              instance,
              "EXPORT_PARAMETER_MAPPING_REQUIRED",
              `${instance.reference}: map parameter ${key} explicitly before using ${target}.`,
              "error",
            );
          }
        }
        fill(document, instance, defaults);
        // Required geometry must be explicit; external library defaults must not
        // hide a blank field in the editable preset.
        for (const parameter of reviewed.parameters.filter((p) => p.required)) {
          if (
            !Object.entries(data.parameters).some(
              ([name, value]) =>
                name.toLowerCase() === parameter.name.toLowerCase() &&
                value.trim(),
            )
          )
            add(
              document,
              instance,
              "EXPORT_MISSING_PDK_PARAMETER",
              `${instance.reference}: ${target} requires ${parameter.name}.`,
              "error",
            );
        }
        let definition = project.externalSubcircuitDefinitions.find(
          (d) => d.name.toLowerCase() === target.toLowerCase(),
        );
        if (
          definition &&
          resolveReviewedExternalBinding(
            definition.name,
            definition.terminals.map((t) => t.name),
          )?.id !== reviewed.id
        ) {
          add(
            document,
            instance,
            "EXPORT_TARGET_INTERFACE_CONFLICT",
            `${target} has a different existing interface.`,
            "error",
          );
          continue;
        }
        if (!definition) {
          let id = `export-${reviewed.id}`;
          while (project.externalSubcircuitDefinitions.some((d) => d.id === id))
            id += "-new";
          definition = {
            id,
            name: reviewed.masterName,
            interfaceStatus: "declared",
            terminals: reviewed.terminals.map((t, i) => ({
              id: `${id}-${i}`,
              name: t.targetName,
              direction: "passive" as const,
            })),
            formalParameters: reviewed.parameters.map((p) => ({
              name: p.name,
              ...(p.targetDefaultValue === undefined
                ? {}
                : { defaultValue: p.targetDefaultValue }),
            })),
          };
          project.externalSubcircuitDefinitions.push(definition);
        }
        data.binding = {
          kind: "external-subcircuit",
          definitionId: definition.id,
        };
        if (instance.reference)
          reference(
            document,
            instance,
            /^x/iu.test(instance.reference)
              ? instance.reference
              : `X${instance.reference}`,
          );
        for (const pin of reviewed.terminals.filter(
          (t) => t.interaction === "property",
        )) {
          if (
            document.nets.some((net) =>
              net.terminals.some(
                (t) =>
                  t.instanceId === instance.id && t.pinName === pin.pinName,
              ),
            )
          )
            continue;
          const matched = substrateNets.get(rule.substrate.toLowerCase());
          let net = document.nets.find((n) => n.id === matched);
          if (!net && rule.substrate === "0") {
            let id = "export-ground";
            while (document.nets.some((n) => n.id === id)) id += "-new";
            net = { id, terminals: [] };
            document.nets.push(net);
            substrateNets.set("0", id);
            const labelId = `${id}-label`;
            document.annotations.push({
              id: labelId,
              kind: "net-label",
              netId: id,
              binding: { kind: "net-name", netId: id },
              anchor: { kind: "free", position: { x: 0, y: 0 } },
              alignment: "start",
              rotation: 0,
              locked: false,
            });
            document.connectivityEvidence.push({
              id: `${id}-claim`,
              kind: "name-claim",
              netId: id,
              name: "0",
              scope: "global",
              owner: { kind: "net-label", annotationId: labelId },
            });
          }
          if (!net) {
            add(
              document,
              instance,
              "EXPORT_SUBSTRATE_NET_REQUIRED",
              `${instance.reference}.${pin.pinName}: select an existing substrate Net or 0.`,
              "error",
            );
            continue;
          }
          net.terminals.push({ instanceId: instance.id, pinName: pin.pinName });
          add(
            document,
            instance,
            "EXPORT_SUBSTRATE_DEFAULT",
            `${instance.reference}.${pin.pinName} uses substrate ${rule.substrate} (preset default).`,
          );
        }
      } else {
        if (current) {
          const propertyPins = new Set(
            current.terminals
              .filter((t) => t.interaction === "property")
              .map((t) => t.pinName),
          );
          for (const net of document.nets)
            net.terminals = net.terminals.filter(
              (t) =>
                t.instanceId !== instance.id || !propertyPins.has(t.pinName),
            );
          if (instance.reference) {
            const body = instance.reference.replace(/^x/iu, "");
            reference(
              document,
              instance,
              body.toUpperCase().startsWith(descriptor.referencePrefix!)
                ? body
                : `${descriptor.referencePrefix}${body}`,
            );
          }
          const allowed = new Set(
            descriptor.parameters.map((p) => p.name.toLowerCase()),
          );
          data.parameters = Object.fromEntries(
            Object.entries(data.parameters).filter(([key]) =>
              allowed.has(key.toLowerCase()),
            ),
          );
        }
        data.binding =
          descriptor.targetPolicy === "required-model"
            ? target
              ? {
                  kind: "model",
                  deviceClass: descriptor.deviceClass,
                  name: target,
                }
              : undefined
            : { kind: "primitive", deviceClass: descriptor.deviceClass };
        // The TSMC 28 `_mac` wrapper interface calls the parallel device
        // multiplier `multi`; the editor's portable MOS property is `m`.
        if (profile.id === "tsmc28" && ["nmos", "pmos"].includes(family))
          renameParameter(data.parameters, "m", "multi");
        fill(document, instance, rule.parameters);
      }
      if (!preserveTarget && target)
        add(
          document,
          instance,
          "EXPORT_DEVICE_TARGET",
          `${instance.reference}: ${target} (${NETLIST_PROFILE_LABELS[profile.id]} preset).`,
        );
    }
  }
  return { project, diagnostics };
}

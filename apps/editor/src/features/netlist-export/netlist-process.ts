import {
  createReferenceIndex,
  deviceDescriptor,
  formatPassiveValue,
  gpdk045MosGeometry,
  gpdk045MosType,
  ics55MosType,
  passiveNumber,
  referenceIssuesForInstance,
  reviewedPassive,
  reviewedPassiveValue,
  sizeReviewedPassive,
  reviewedExternalBindingForMaster,
  reviewedExternalBindingSupportsSymbol,
  resolveReviewedExternalBinding,
  type DeviceDescriptor,
  type ReviewedExternalDeviceBinding,
} from "@icm/devices";
import { pdkSubstrateDefaultNet } from "@icm/derived";
import {
  createNetlistPlanningProjection,
  executeProjectTransaction,
  planSetDeviceModelTarget,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveStableId,
  type CircuitProject,
  type Instance,
  type InstanceNetlistData,
} from "@icm/model";
import type { NetlistFormat } from "@icm/netlist";
import {
  createNetlistExportProfile,
  GPDK045_DEFAULT_MODELS,
  NETLIST_DEVICE_TARGET_OPTIONS,
  NETLIST_HIGH_VOLTAGE_TARGETS,
  NETLIST_QUICK_TARGET_FAMILIES,
  netlistDeviceFamily,
  processOwnDevice,
  type NetlistExportProfile,
  type NetlistModelLibrary,
  type NetlistProfileId,
  type NetlistDeviceFamily,
  type NetlistQuickTargetFamily,
} from "./netlist-process-presets";
import { initialInstanceNetlist } from "./netlist-authoring";

export function instanceModelTarget(
  project: CircuitProject,
  instance: Instance,
): string | undefined {
  const binding = instance.netlist?.binding;
  if (!binding || binding.kind === "primitive") return "";
  if (binding.kind === "model") return binding.name;
  if (binding.kind !== "external-subcircuit") return undefined;
  const definition = project.externalSubcircuitDefinitions.find(
    (item) => item.id === binding.definitionId,
  );
  return definition &&
    !definition.presentation &&
    resolveReviewedExternalBinding(
      definition.name,
      definition.terminals.map((terminal) => terminal.name),
    )
    ? definition.name
    : undefined;
}

export function netlistFamilyTarget(
  project: CircuitProject,
  family: NetlistQuickTargetFamily,
): string | null | undefined {
  const targets = new Set(
    project.documents.flatMap((document) =>
      document.instances.flatMap((instance) =>
        netlistDeviceFamily(instance.symbolId) === family
          ? [instanceModelTarget(project, instance)]
          : [],
      ),
    ),
  );
  return targets.size === 0
    ? undefined
    : targets.size === 1
      ? ([...targets][0] ?? null)
      : null;
}

/** The symbol a device's current reviewed model is drawn as, else its own. */
function drawnSymbolId(project: CircuitProject, instance: Instance): string {
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "external-subcircuit") return instance.symbolId;
  const definition = project.externalSubcircuitDefinitions.find(
    (item) => item.id === binding.definitionId,
  );
  return (
    (definition &&
      reviewedExternalBindingForMaster(definition.name, instance.symbolId)
        ?.symbolId) ??
    instance.symbolId
  );
}

/** Display what the Project actually contains, not an unrelated browser default. */
export function inferNetlistProcess(
  project: CircuitProject,
  fallback: NetlistProfileId,
): NetlistProfileId {
  const targets = project.documents.flatMap((document) =>
    document.instances.flatMap((instance) => {
      const family = netlistDeviceFamily(instance.symbolId);
      const target = instanceModelTarget(project, instance);
      return (family === "nmos" || family === "pmos") && target
        ? [{ family, target }]
        : [];
    }),
  );
  if (!targets.length) return fallback;
  return (
    (["abstract", "sky130", "sg13g2", "ics55", "gpdk045"] as const).find((id) =>
      targets.every(({ family, target }) =>
        id === "ics55" || id === "gpdk045"
          ? namedMosType(id, target) === family
          : NETLIST_DEVICE_TARGET_OPTIONS[id][family].includes(target),
      ),
    ) ?? "custom"
  );
}

/** A Process whose MOS names say their channel, in any case. */
function namedMosType(process: "ics55" | "gpdk045", target: string) {
  return process === "ics55" ? ics55MosType(target) : gpdk045MosType(target);
}

/**
 * The model library a Spectre netlist of a GPDK045 Project includes, from
 * the reader's own GPDK045 settings (defaults where none are given); none
 * for SPICE, whose files cannot read the kit's Spectre models, or for any
 * other Process.
 */
export function netlistModelInclude(
  project: CircuitProject,
  format: NetlistFormat,
  models: NetlistModelLibrary = GPDK045_DEFAULT_MODELS,
): { path: string; section: string } | undefined {
  if (
    format !== "spectre" ||
    inferNetlistProcess(project, "custom") !== "gpdk045"
  )
    return undefined;
  const { directory, corner } = models;
  return {
    path: `${directory.replace(/\/+$/u, "")}/gpdk045.scs`,
    section: corner,
  };
}

/**
 * The model a transistor placed now takes: the one named by the Process the
 * Netlist panel shows — the Process the Project's transistors already use,
 * else the one chosen in this browser. A device drawn while working in a
 * process is that process's device, whether a person or an Agent places it.
 *
 * Undefined for a reviewed device such as SKY130's transistors (#1249): it
 * is a subcircuit called on an X line, so a model card of that name is one
 * the SKY130 simulation profile cannot run. The placement's process fill
 * (`placementProcessFill`) binds it instead, with its definition.
 */
export function placementModelTarget(
  project: CircuitProject,
  preferences: {
    selected: NetlistProfileId;
    profiles: Record<NetlistProfileId, NetlistExportProfile>;
  },
  symbolId: string,
): string | undefined {
  const family = netlistDeviceFamily(symbolId);
  if (family !== "nmos" && family !== "pmos") return undefined;
  const process =
    preferences.selected === "custom"
      ? "custom"
      : inferNetlistProcess(project, preferences.selected);
  const target = preferences.profiles[process].devices[family].target;
  return target &&
    fitsPrimitiveMos(target, symbolId) &&
    !reviewedExternalBindingForMaster(target)
    ? target
    : undefined;
}

function fitsPrimitiveMos(target: string, symbolId: string): boolean {
  const channel = ics55MosType(target) ?? gpdk045MosType(target);
  return channel === undefined || channel === symbolId;
}

/**
 * The device a part placed now becomes under the Process the Netlist panel
 * shows, as "Apply process" chooses it: the family's target, or the
 * high-voltage device a drain-extended part takes when the family's does not
 * fit it. Undefined when the Process names nothing for the part.
 */
export function processPlacementTarget(
  project: CircuitProject,
  preferences: {
    selected: NetlistProfileId;
    profiles: Record<NetlistProfileId, NetlistExportProfile>;
  },
  symbolId: string,
): string | undefined {
  const family = netlistDeviceFamily(symbolId);
  if (!family) return undefined;
  const process =
    preferences.selected === "custom"
      ? "custom"
      : inferNetlistProcess(project, preferences.selected);
  const profile = preferences.profiles[process];
  if (deviceDescriptor(symbolId)?.targetPolicy === "none")
    return processOwnDevice(profile.id, symbolId);
  const target = profile.devices[family].target;
  if (!target || !fitsPrimitiveMos(target, symbolId)) return undefined;
  const reviewed = reviewedExternalBindingForMaster(target);
  if (
    reviewed &&
    !reviewedExternalBindingSupportsSymbol(reviewed, symbolId) &&
    (symbolId === "ndmos" || symbolId === "pdmos")
  )
    return NETLIST_HIGH_VOLTAGE_TARGETS[profile.id]?.[symbolId];
  return target;
}

/**
 * What the Process gives the parts a placement adds, committed with the
 * placement as one Project transaction.
 *
 * A transistor whose Process names a plain model takes it when it is made
 * (`placementModelTarget`). Every other part that needs a model takes here
 * what "Apply process" would give it: a BJT, a diode, and a transistor the
 * Process maps to a reviewed device. SKY130's transistors, PNP and NPN are
 * reviewed subcircuits called on X lines, so they need a definition, and the
 * NPN a substrate terminal, that no Document edit can add. Undefined when the
 * placement adds no such part, or the Process names nothing for it: the
 * placement then commits exactly as before.
 */
export function placementProcessFill(
  project: CircuitProject,
  preferences: {
    selected: NetlistProfileId;
    profiles: Record<NetlistProfileId, NetlistExportProfile>;
  },
  documentId: string,
  placementEdits: readonly SchematicEdit[],
): ProjectStructureEdit[] | undefined {
  const document = project.documents.find((item) => item.id === documentId);
  const pending = new Set(
    placementEdits.flatMap((edit) =>
      edit.kind === "add_instance" &&
      (!edit.instance.netlist?.binding ||
        edit.instance.netlist.binding.kind === "primitive") &&
      (deviceDescriptor(edit.instance.symbolId)?.targetPolicy ===
        "required-model" ||
        !!reviewedExternalBindingForMaster(
          processPlacementTarget(
            project,
            preferences,
            edit.instance.symbolId,
          ) ?? "",
        ))
        ? [edit.instance.id]
        : [],
    ),
  );
  if (!document || pending.size === 0) return undefined;
  const placement: ProjectStructureEdit = {
    kind: "transact_document",
    documentId,
    expectedRevision: document.revision,
    edits: [...placementEdits],
  };
  const placed = executeProjectTransaction(project, {
    transactionId: "plan-placement-process",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "netlist-process" },
    edits: [placement],
  });
  if (!placed.ok) return undefined;
  const process =
    preferences.selected === "custom"
      ? "custom"
      : inferNetlistProcess(project, preferences.selected);
  let fill: ProjectStructureEdit[];
  try {
    fill = planNetlistProcess(placed.project, preferences.profiles[process], {
      onlyMissing: true,
      instanceIds: pending,
    });
  } catch {
    // The part then keeps its missing-model finding, as before.
    return undefined;
  }
  const fillEdits = fill.flatMap((edit) =>
    edit.kind === "transact_document" && edit.documentId === documentId
      ? edit.edits
      : [],
  );
  const binds = fillEdits.some(
    (edit) =>
      (edit.kind === "bulk_patch_instance_netlist" &&
        edit.assignments.some(
          (assignment) =>
            pending.has(assignment.instanceId) && assignment.binding,
        )) ||
      (edit.kind === "set_instance_netlist" &&
        pending.has(edit.instanceId) &&
        edit.netlist.binding),
  );
  if (!binds) return undefined;
  return [
    ...fill.filter((edit) => edit.kind !== "transact_document"),
    { ...placement, edits: [...placementEdits, ...fillEdits] },
  ];
}

/**
 * The reviewed PDK library of the Process the Netlist panel shows, so model
 * suggestions stay within it: SKY130's in a SKY130 Project, IHP SG13G2's in
 * an SG13G2 one (#1450).
 * Undefined for a Process without one, which suggests all.
 */
export function processReviewedLibrary(
  project: CircuitProject,
  preferences: {
    selected: NetlistProfileId;
    profiles: Record<NetlistProfileId, NetlistExportProfile>;
  },
): ReviewedExternalDeviceBinding["libraryId"] | undefined {
  const process =
    preferences.selected === "custom"
      ? "custom"
      : inferNetlistProcess(project, preferences.selected);
  return process === "sky130"
    ? "sky130_fd_pr"
    : process === "sg13g2"
      ? "sg13g2_pr"
      : undefined;
}

/**
 * The full target a short device name stands for in the Process the Netlist
 * panel shows. The panel lists SKY130's devices without their library
 * prefix, so in a SKY130 Project `nfet_01v8` means `sky130_fd_pr__nfet_01v8`.
 * Undefined unless the name is exactly such a short name for this part; in
 * another Process a name is taken as written, since it may name a model of
 * the author's own.
 */
export function processTargetForShortName(
  project: CircuitProject,
  preferences: {
    selected: NetlistProfileId;
    profiles: Record<NetlistProfileId, NetlistExportProfile>;
  },
  symbolId: string,
  name: string,
): string | undefined {
  const family = netlistDeviceFamily(symbolId);
  const process =
    preferences.selected === "custom"
      ? "custom"
      : inferNetlistProcess(project, preferences.selected);
  if (
    process !== "sky130" ||
    !family ||
    !(NETLIST_QUICK_TARGET_FAMILIES as readonly string[]).includes(family)
  )
    return undefined;
  const full = `sky130_fd_pr__${name.trim()}`.toLowerCase();
  return NETLIST_DEVICE_TARGET_OPTIONS.sky130[
    family as NetlistQuickTargetFamily
  ].find((target) => target !== "" && target.toLowerCase() === full);
}

/**
 * A resistor or capacitor that changed device by value, or kept its device
 * because its value could not be carried: an approximate conversion the
 * author should check.
 */
export interface ProcessValueConversion {
  readonly documentId: string;
  readonly instanceId: string;
  readonly reference: string;
  /** `ideal`, or the reviewed device the part was. */
  readonly from: string;
  /** `ideal`, or the reviewed device the Process gives it. */
  readonly to: string;
  /** The value the part had; absent when it could not be read. */
  readonly value?: string;
  /** The value its new parameters give. */
  readonly result?: string;
  /**
   * `converted`; `clamped`: the device cannot reach the value and stops at
   * its size limit; `kept`: the part keeps its device and parameters.
   */
  readonly status: "converted" | "clamped" | "kept";
  readonly message: string;
}

/** The export warning code a conversion reads as. */
export function processValueConversionCode(
  conversion: ProcessValueConversion,
): string {
  return {
    converted: "PROCESS_VALUE_CONVERTED",
    clamped: "PROCESS_VALUE_CLAMPED",
    kept: "PROCESS_VALUE_KEPT",
  }[conversion.status];
}

type PassivePlan =
  | { readonly kind: "kept"; readonly note: ProcessValueConversion }
  | {
      readonly kind: "set";
      readonly note: ProcessValueConversion;
      readonly parameters: Readonly<Record<string, string>>;
    };

const parameterEntry = (
  parameters: Readonly<Record<string, string>>,
  name: string,
) =>
  Object.entries(parameters).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );

/** A reviewed passive's size as its X line reads, for a note. */
function geometryText(
  master: string,
  parameters: Readonly<Record<string, string>>,
): string {
  const passive = reviewedPassive(master);
  if (!passive) return "";
  const role = (roles: readonly string[]) =>
    passive.binding.parameters
      .filter((parameter) => roles.includes(parameter.displayRole))
      .map((parameter) => parameter.name);
  return [
    ...role(["width", "length"]),
    ...(passive.density.kind === "resistor" && passive.density.bends
      ? [passive.density.bends.parameter]
      : []),
    ...role(["multiplier"]),
  ]
    .flatMap((name) => {
      const entry = parameterEntry(parameters, name);
      return entry ? [`${entry[0]}=${entry[1]}`] : [];
    })
    .join(" ");
}

/**
 * How a resistor or capacitor keeps its value when the Process changes its
 * device: a PDK device's geometry is read through its Process's densities
 * (`PROCESS_PASSIVE_DENSITIES`) and the new device sized for that value, or
 * an ideal one given it. Undefined when there is nothing to carry: not an
 * R or C, the same device, or an ideal part without a value.
 */
function planPassiveValue(
  documentId: string,
  instance: Instance,
  netlist: InstanceNetlistData,
  descriptor: DeviceDescriptor,
  from: string,
  to: string,
): PassivePlan | undefined {
  const kind = descriptor.deviceClass;
  if (
    (kind !== "resistor" && kind !== "capacitor") ||
    !descriptor.parameters.some((parameter) => parameter.name === "value") ||
    from.toLowerCase() === to.toLowerCase()
  )
    return undefined;
  const authored = from
    ? undefined
    : parameterEntry(netlist.parameters, "value")?.[1].trim();
  if (!from && !authored) return undefined;
  const value = from
    ? reviewedPassiveValue(from, netlist.parameters)
    : passiveNumber(authored!);
  const valueText =
    value === undefined ? authored : formatPassiveValue(value, kind);
  const fromText = from
    ? `${from} ${geometryText(from, netlist.parameters)}${valueText ? ` ≈ ${valueText}` : ""}`
    : `ideal ${authored}`;
  const base = {
    documentId,
    instanceId: instance.id,
    reference: instance.reference!,
    from: from || "ideal",
    to: to || "ideal",
    ...(valueText ? { value: valueText } : {}),
  };
  const kept = (why: string): PassivePlan => ({
    kind: "kept",
    note: {
      ...base,
      status: "kept",
      message: `${instance.reference} keeps ${fromText}: ${why}`,
    },
  });
  if (value === undefined)
    return kept(
      !from
        ? "its value is not a number"
        : reviewedPassive(from)
          ? "its size is not a number"
          : `the density of ${from} is not known`,
    );
  if (!to) {
    const result = formatPassiveValue(value, kind);
    return {
      kind: "set",
      parameters: { value: result },
      note: {
        ...base,
        result,
        status: "converted",
        message: `${instance.reference}: ${fromText} → ideal ${result} (approximate)`,
      },
    };
  }
  const sized = sizeReviewedPassive(to, value);
  if (!sized) return kept(`the density of ${to} is not known`);
  const result = formatPassiveValue(sized.value, kind);
  const toText = `${to} ${geometryText(to, sized.parameters)} ≈ ${result}`;
  return {
    kind: "set",
    parameters: sized.parameters,
    note: {
      ...base,
      result,
      status: sized.clamped ? "clamped" : "converted",
      message: sized.clamped
        ? `${instance.reference}: ${fromText} → ${toText}, the ${sized.clamped === "maximum" ? "largest" : "smallest"} ${to} allowed; check the value`
        : `${instance.reference}: ${fromText} → ${toText} (approximate)`,
    },
  };
}

/** One undoable authoring transaction. Exporters continue to read only Project facts. */
export function planNetlistProcess(
  project: CircuitProject,
  profile: NetlistExportProfile,
  options: Parameters<typeof planNetlistProcessReport>[2] = {},
): ProjectStructureEdit[] {
  return planNetlistProcessReport(project, profile, options).edits;
}

/**
 * The Apply process plan, with the resistors and capacitors it converts by
 * value. A fresh placement's parts take the device's own defaults instead:
 * their value is the catalog's, not the author's.
 */
export function planNetlistProcessReport(
  project: CircuitProject,
  profile: NetlistExportProfile,
  options: {
    onlyMissing?: boolean;
    family?: NetlistDeviceFamily;
    /** Only these Instances, as a fresh placement fills its own parts. */
    instanceIds?: ReadonlySet<string>;
  } = {},
): {
  edits: ProjectStructureEdit[];
  conversions: ProcessValueConversion[];
} {
  const conversions: ProcessValueConversion[] = [];
  const projection = createNetlistPlanningProjection(project);
  const definitions = new Map<
    string,
    Extract<
      ProjectStructureEdit,
      { kind: "upsert_external_subcircuit_definition" }
    >
  >();
  const documents = new Map<string, SchematicEdit[]>();
  function stage(edits: ProjectStructureEdit[]) {
    if (!edits.length) return;
    projection.stage(edits);
    for (const edit of edits) {
      if (edit.kind === "upsert_external_subcircuit_definition")
        definitions.set(edit.definition.id, edit);
      else if (edit.kind === "transact_document") {
        const accumulated = documents.get(edit.documentId) ?? [];
        accumulated.push(...edit.edits);
        documents.set(edit.documentId, accumulated);
      } else throw new Error(`Unsupported process edit: ${edit.kind}`);
    }
  }
  function transact(documentId: string, edits: SchematicEdit[]) {
    if (edits.length)
      stage([
        {
          kind: "transact_document",
          documentId,
          expectedRevision: projection.project.documents.find(
            (document) => document.id === documentId,
          )!.revision,
          edits,
        },
      ]);
  }
  for (const originalDocument of project.documents) {
    const documentId = originalDocument.id;
    // The Edit Engine refuses netlist edits to a device whose Reference is
    // missing, taken or of another class. Such a device keeps its finding
    // until the author renames it, and the rest of the circuit still fills.
    const references = createReferenceIndex(originalDocument, project);
    for (const original of originalDocument.instances) {
      const family = netlistDeviceFamily(original.symbolId);
      const descriptor = deviceDescriptor(original.symbolId);
      if (
        !family ||
        !descriptor ||
        !original.reference ||
        referenceIssuesForInstance(references, original.id).length ||
        (options.family && family !== options.family) ||
        (options.instanceIds && !options.instanceIds.has(original.id))
      )
        continue;
      // A device drawn with no netlist record at all (by an Agent, or before
      // the editor bound devices) is owed the record a freshly placed one
      // carries; the process then fills it like any other.
      const originalNetlist =
        original.netlist ?? initialInstanceNetlist(original.symbolId, {});
      if (!originalNetlist) continue;
      const originalTarget = instanceModelTarget(project, original);
      // Custom external blocks and child Cells own their interfaces. Opening
      // a Project must never reinterpret an existing authored model or wrapper.
      if (
        originalTarget === undefined ||
        (options.onlyMissing && originalTarget)
      )
        continue;
      if (
        originalNetlist.binding &&
        "deviceClass" in originalNetlist.binding &&
        originalNetlist.binding.deviceClass !== descriptor.deviceClass
      )
        continue;
      const rule = profile.devices[family];
      // A part that prints nothing itself takes the Process's one device
      // drawn with its symbol, the MOS Varactor IHP's varactor (#2321), and
      // none of its family's defaults.
      const own = processOwnDevice(profile.id, original.symbolId);
      if (descriptor.targetPolicy === "none" && !own) continue;
      // A reviewed model belongs to one drawn symbol. A drain-extended device
      // the family's model does not fit takes the process's high-voltage
      // device, unless a model is being chosen for the whole family. Without
      // one it keeps its finding for the author, and the rest still fills.
      const drawn = drawnSymbolId(project, original);
      const fits = (master: string) => {
        if (!fitsPrimitiveMos(master, drawn)) return false;
        const binding = reviewedExternalBindingForMaster(master);
        return (
          !binding || reviewedExternalBindingSupportsSymbol(binding, drawn)
        );
      };
      const highVoltage =
        !fits(rule.target) &&
        !options.family &&
        (drawn === "ndmos" || drawn === "pdmos")
          ? NETLIST_HIGH_VOLTAGE_TARGETS[profile.id]?.[drawn]
          : undefined;
      // A whole-process read keeps the threshold and oxide mix of an ICS55
      // or GPDK045 Cell.
      const keepVariant =
        (profile.id === "ics55" || profile.id === "gpdk045") &&
        !options.family &&
        namedMosType(profile.id, originalTarget) === family;
      const chosen = keepVariant
        ? originalTarget
        : (own ?? highVoltage ?? rule.target);
      // A built-in part the Process's device cannot be drawn as, a Var Cap
      // where the capacitor is IHP's MIM one, stays ideal and still takes
      // its own defaults.
      const ideal = !fits(chosen) && descriptor.targetPolicy === "builtin";
      const target = ideal ? "" : chosen;
      if (!fits(target)) continue;
      const reviewed = reviewedExternalBindingForMaster(target, drawn);
      const passive = options.instanceIds
        ? undefined
        : planPassiveValue(
            documentId,
            original,
            originalNetlist,
            descriptor,
            originalTarget,
            target,
          );
      if (passive) conversions.push(passive.note);
      if (passive?.kind === "kept") continue;
      // A high-voltage device brings its own geometry, not the family's; a
      // GPDK045 device other than the family's, its own CDF geometry.
      const familyDefaults: Readonly<Record<string, string>> = ideal
        ? Object.fromEntries(
            descriptor.parameters.flatMap((parameter) =>
              parameter.required && parameter.defaultValue !== undefined
                ? [[parameter.name, parameter.defaultValue]]
                : [],
            ),
          )
        : highVoltage || own
          ? {}
          : profile.id === "gpdk045" &&
              target !== rule.target &&
              gpdk045MosType(target) === family
            ? { ...rule.parameters, ...gpdk045MosGeometry(target) }
            : rule.parameters;
      if (!original.netlist)
        transact(documentId, [
          {
            kind: "set_instance_netlist",
            instanceId: original.id,
            netlist: originalNetlist,
          },
        ]);
      let document = projection.project.documents.find(
        (item) => item.id === documentId,
      )!;
      let instance = document.instances.find(
        (item) => item.id === original.id,
      )!;
      const external =
        instance.netlist!.binding?.kind === "external-subcircuit";
      if (
        !keepVariant &&
        (target || external || descriptor.targetPolicy === "required-model")
      ) {
        stage(
          planSetDeviceModelTarget(
            projection.project,
            documentId,
            instance.id,
            target,
            // Its substrate rule binds the hidden terminals below.
            { substrateDefault: false },
          ),
        );
      }
      document = projection.project.documents.find(
        (item) => item.id === documentId,
      )!;
      instance = document.instances.find((item) => item.id === original.id)!;
      const parameters = { ...instance.netlist!.parameters };
      const defaults = reviewed
        ? Object.fromEntries(
            reviewed.parameters.map((parameter) => [
              parameter.name,
              familyDefaults[parameter.name] ?? parameter.defaultValue ?? "",
            ]),
          )
        : familyDefaults;
      for (const [name, value] of Object.entries(defaults)) {
        if (!value) continue;
        if (
          name === "dc" &&
          Object.entries(parameters).some(
            ([key, raw]) =>
              (key.toLowerCase() === "waveform" &&
                raw.toLowerCase() !== "dc") ||
              (["acmag", "acmagnitude", "acphase"].includes(
                key.toLowerCase(),
              ) &&
                raw.trim()),
          )
        )
          continue;
        const key =
          Object.keys(parameters).find(
            (key) => key.toLowerCase() === name.toLowerCase(),
          ) ?? name;
        const authored = Object.keys(originalNetlist.parameters).some(
          (key) => key.toLowerCase() === name.toLowerCase(),
        );
        if (!parameters[key]?.trim() || (reviewed && !authored))
          parameters[key] = value;
      }
      if (passive?.kind === "set")
        for (const [name, value] of Object.entries(passive.parameters))
          parameters[parameterEntry(parameters, name)?.[0] ?? name] = value;
      if (
        JSON.stringify(parameters) !==
        JSON.stringify(instance.netlist!.parameters)
      )
        transact(documentId, [
          {
            kind: "set_instance_netlist",
            instanceId: instance.id,
            netlist: { ...instance.netlist!, parameters },
          },
        ]);
      for (const terminal of reviewed?.terminals.filter(
        (item) => item.interaction === "property",
      ) ?? []) {
        document = projection.project.documents.find(
          (item) => item.id === documentId,
        )!;
        if (
          document.nets.some((net) =>
            net.terminals.some(
              (pin) =>
                pin.instanceId === instance.id &&
                pin.pinName === terminal.pinName,
            ),
          )
        )
          continue;
        const logical = projection.logicalNets(documentId);
        const ground =
          rule.substrate === "0" || rule.substrate.toUpperCase() === "VSS";
        // The p-substrate belongs on the lowest supply: the Cell's negative
        // rail unless its NMOS body default names another Net than ground,
        // then that Net; else ground (#1530).
        let netId =
          terminal.role === "floating"
            ? undefined
            : ((terminal.role === "substrate" && ground
                ? pdkSubstrateDefaultNet(document, logical)?.id
                : undefined) ??
              [...logical.byBaseNetId].find(([, net]) =>
                ground
                  ? net.powerDomain === "ground"
                  : net.name?.toLowerCase() === rule.substrate.toLowerCase(),
              )?.[0]);
        const edits: SchematicEdit[] = [];
        if (!netId) {
          netId = deriveStableId(
            "process-net",
            documentId,
            instance.id,
            terminal.pinName,
          );
          if (!document.nets.some((net) => net.id === netId))
            edits.push({ kind: "create_base_net", netId });
          if (terminal.role !== "floating") {
            const id = deriveStableId("process-supply", netId);
            edits.push(
              {
                kind: "upsert_schematic_annotation",
                annotation: {
                  id,
                  kind: "net-label",
                  netId,
                  binding: { kind: "net-name", netId },
                  visible: false,
                  anchor: {
                    kind: "object",
                    objectId: instance.id,
                    localOffset: { x: 0, y: 0 },
                    fallbackPosition: instance.placement?.position ?? {
                      x: 0,
                      y: 0,
                    },
                  },
                  alignment: "start",
                  rotation: 0,
                  locked: false,
                },
              },
              {
                kind: "upsert_connectivity_evidence",
                evidence: {
                  id: `${id}-name`,
                  kind: "name-claim",
                  netId,
                  name: ground ? "0" : rule.substrate,
                  scope: "global",
                  ...(ground ? { powerDomain: "ground" as const } : {}),
                  owner: { kind: "net-label", annotationId: id },
                },
              },
            );
          }
        }
        edits.push({
          kind: "set_property_terminal_net",
          instanceId: instance.id,
          pinName: terminal.pinName,
          netId,
        });
        transact(documentId, edits);
      }
    }
  }
  const edits: ProjectStructureEdit[] = [
    ...definitions.values(),
    ...[...documents].map(([documentId, edits]) => ({
      kind: "transact_document" as const,
      documentId,
      expectedRevision: project.documents.find(
        (item) => item.id === documentId,
      )!.revision,
      edits,
    })),
  ];
  // Preparation does not commit its projection. Validate the complete real
  // edits once; the GUI retains its existing authoritative commit and history.
  if (edits.length) {
    const validated = executeProjectTransaction(project, {
      transactionId: "plan-netlist-process",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "netlist-process" },
      edits,
      dryRun: true,
    });
    if (!validated.ok) throw new Error(validated.error.message);
  }
  return { edits, conversions };
}

/** One prepared snapshot consumed by both the exact count and its action. */
export function prepareNetlistProcess(
  project: CircuitProject,
  profile: NetlistExportProfile,
  options: Parameters<typeof planNetlistProcess>[2] = {},
) {
  const { edits, conversions } = planNetlistProcessReport(
    project,
    profile,
    options,
  );
  const filled = new Set<string>();
  for (const edit of edits) {
    if (edit.kind !== "transact_document") continue;
    for (const item of edit.edits) {
      if (item.kind === "set_instance_netlist")
        filled.add(`${edit.documentId}:${item.instanceId}`);
      if (item.kind === "bulk_patch_instance_netlist")
        for (const assignment of item.assignments)
          filled.add(`${edit.documentId}:${assignment.instanceId}`);
    }
  }
  return { edits, instanceCount: filled.size, conversions };
}

/**
 * The Project as Apply process would leave it, for one export, and the values
 * it converted; nothing is committed.
 */
export function netlistProcessProjection(
  project: CircuitProject,
  process: Exclude<NetlistProfileId, "custom">,
): { project: CircuitProject; conversions: ProcessValueConversion[] } {
  const { edits, conversions } = planNetlistProcessReport(
    project,
    createNetlistExportProfile(process),
  );
  if (!edits.length) return { project, conversions };
  const result = executeProjectTransaction(project, {
    transactionId: "export-netlist-process",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "netlist-process" },
    edits,
  });
  if (!result.ok) throw new Error(result.error.message);
  return { project: result.project, conversions };
}

/** Defaults belong to creating an example, never to mounting a reader of a saved Project. */
export function prepareNetlistExample(
  project: CircuitProject,
  profile: NetlistExportProfile,
): CircuitProject {
  const edits = planNetlistProcess(project, profile, { onlyMissing: true });
  if (!edits.length) return project;
  const result = executeProjectTransaction(project, {
    transactionId: "prepare-netlist-example",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "netlist-process" },
    edits,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}

/** Only immutable committed editor snapshots may enter this cache. */
export function createNetlistDefaultsCache() {
  const snapshots = new WeakMap<
    CircuitProject,
    Map<string, ReturnType<typeof prepareNetlistProcess>>
  >();
  return (project: CircuitProject, profile: NetlistExportProfile) => {
    const key = JSON.stringify(profile);
    let profiles = snapshots.get(project);
    const cached = profiles?.get(key);
    if (cached) return cached;
    const prepared = prepareNetlistProcess(project, profile, {
      onlyMissing: true,
    });
    if (!profiles) snapshots.set(project, (profiles = new Map()));
    const oldest = profiles.keys().next().value;
    if (profiles.size >= 4 && oldest !== undefined) profiles.delete(oldest);
    profiles.set(key, prepared);
    return prepared;
  };
}
export const preparedNetlistDefaults = createNetlistDefaultsCache();

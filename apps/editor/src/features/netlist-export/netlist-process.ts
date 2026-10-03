import {
  createReferenceIndex,
  deviceDescriptor,
  referenceIssuesForInstance,
  reviewedExternalBindingForMaster,
  reviewedExternalBindingSupportsSymbol,
  resolveReviewedExternalBinding,
} from "@icm/devices";
import { resolveDocumentLogicalNets } from "@icm/derived";
import {
  executeProjectTransaction,
  planSetDeviceModelTarget,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import { deriveStableId, type CircuitProject, type Instance } from "@icm/model";
import {
  NETLIST_DEVICE_TARGET_OPTIONS,
  NETLIST_HIGH_VOLTAGE_TARGETS,
  NETLIST_QUICK_TARGET_FAMILIES,
  netlistDeviceFamily,
  type NetlistExportProfile,
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
      reviewedExternalBindingForMaster(definition.name)?.symbolId) ??
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
    (["abstract", "sky130", "tsmc28", "tsmc180"] as const).find((id) =>
      targets.every(({ family, target }) =>
        NETLIST_DEVICE_TARGET_OPTIONS[id][family].includes(target),
      ),
    ) ?? "custom"
  );
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
  return target && !reviewedExternalBindingForMaster(target)
    ? target
    : undefined;
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
  const target = profile.devices[family].target;
  if (!target) return undefined;
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
      !edit.instance.netlist?.binding &&
      deviceDescriptor(edit.instance.symbolId)?.targetPolicy ===
        "required-model"
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

/** One undoable authoring transaction. Exporters continue to read only Project facts. */
export function planNetlistProcess(
  project: CircuitProject,
  profile: NetlistExportProfile,
  options: {
    onlyMissing?: boolean;
    family?: NetlistDeviceFamily;
    /** Only these Instances, as a fresh placement fills its own parts. */
    instanceIds?: ReadonlySet<string>;
  } = {},
): ProjectStructureEdit[] {
  let working = project;
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
    const result = executeProjectTransaction(working, {
      transactionId: "plan-netlist-process",
      projectId: working.id,
      expectedStructureRevision: working.structureRevision,
      actor: { kind: "human", id: "netlist-process" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    working = result.project;
    for (const edit of edits) {
      if (edit.kind === "upsert_external_subcircuit_definition")
        definitions.set(edit.definition.id, edit);
      else if (edit.kind === "transact_document")
        documents.set(edit.documentId, [
          ...(documents.get(edit.documentId) ?? []),
          ...edit.edits,
        ]);
      else throw new Error(`Unsupported process edit: ${edit.kind}`);
    }
  }
  function transact(documentId: string, edits: SchematicEdit[]) {
    if (edits.length)
      stage([
        {
          kind: "transact_document",
          documentId,
          expectedRevision: working.documents.find(
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
      if (descriptor.targetPolicy === "none") continue;
      // A reviewed model belongs to one drawn symbol. A drain-extended device
      // the family's model does not fit takes the process's high-voltage
      // device, unless a model is being chosen for the whole family. Without
      // one it keeps its finding for the author, and the rest still fills.
      const drawn = drawnSymbolId(project, original);
      const fits = (master: string) => {
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
      const target = highVoltage ?? rule.target;
      if (!fits(target)) continue;
      const reviewed = reviewedExternalBindingForMaster(target);
      // A high-voltage device brings its own geometry, not the family's.
      const familyDefaults: Readonly<Record<string, string>> = highVoltage
        ? {}
        : rule.parameters;
      if (!original.netlist)
        transact(documentId, [
          {
            kind: "set_instance_netlist",
            instanceId: original.id,
            netlist: originalNetlist,
          },
        ]);
      let document = working.documents.find((item) => item.id === documentId)!;
      let instance = document.instances.find(
        (item) => item.id === original.id,
      )!;
      const external =
        instance.netlist!.binding?.kind === "external-subcircuit";
      if (target || external || descriptor.targetPolicy === "required-model") {
        stage(
          planSetDeviceModelTarget(working, documentId, instance.id, target),
        );
      }
      document = working.documents.find((item) => item.id === documentId)!;
      instance = document.instances.find((item) => item.id === original.id)!;
      const parameters = { ...instance.netlist!.parameters };
      // TSMC 28 names the parallel-device count multi; preserve its value on
      // transitions both ways instead of carrying both spellings.
      if (family === "nmos" || family === "pmos") {
        const from = profile.id === "tsmc28" ? "m" : "multi";
        const to = profile.id === "tsmc28" ? "multi" : "m";
        const old = Object.entries(originalNetlist.parameters).find(
          ([name]) => name.toLowerCase() === from,
        );
        if (old) {
          const destination = Object.keys(parameters).find(
            (name) => name.toLowerCase() === to,
          );
          if (
            !destination ||
            originalNetlist.parameters[destination] === undefined
          )
            parameters[destination ?? to] = old[1];
          for (const name of Object.keys(parameters))
            if (name.toLowerCase() === from) delete parameters[name];
        }
      }
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
        const mappedCount =
          (name === "m" || name === "multi") &&
          Object.keys(originalNetlist.parameters).some((key) =>
            ["m", "multi"].includes(key.toLowerCase()),
          );
        if (!parameters[key]?.trim() || (reviewed && !authored && !mappedCount))
          parameters[key] = value;
      }
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
        document = working.documents.find((item) => item.id === documentId)!;
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
        const logical = resolveDocumentLogicalNets(document);
        const ground =
          rule.substrate === "0" || rule.substrate.toUpperCase() === "VSS";
        let netId =
          terminal.role === "floating"
            ? undefined
            : [...logical.byBaseNetId].find(([, net]) =>
                ground
                  ? net.powerDomain === "ground"
                  : net.name?.toLowerCase() === rule.substrate.toLowerCase(),
              )?.[0];
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
  return [
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
}

/**
 * How many Instances the process in hand would fill in, changing nothing.
 *
 * The same plan the button applies, counted rather than committed: a circuit
 * drawn before this process was chosen — or before the editor bound devices at
 * all — says here how many of its devices are still waiting for a model and
 * the dimensions that come with it.
 */
export function netlistProcessPendingInstances(
  project: CircuitProject,
  profile: NetlistExportProfile,
): number {
  const filled = new Set<string>();
  for (const edit of planNetlistProcess(project, profile, {
    onlyMissing: true,
  })) {
    if (edit.kind !== "transact_document") continue;
    for (const item of edit.edits) {
      if (item.kind === "set_instance_netlist")
        filled.add(`${edit.documentId}:${item.instanceId}`);
      if (item.kind === "bulk_patch_instance_netlist")
        for (const assignment of item.assignments)
          filled.add(`${edit.documentId}:${assignment.instanceId}`);
    }
  }
  return filled.size;
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

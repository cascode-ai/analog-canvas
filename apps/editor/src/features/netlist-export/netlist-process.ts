import {
  deviceDescriptor,
  reviewedExternalBindingForMaster,
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
  netlistDeviceFamily,
  type NetlistExportProfile,
  type NetlistProfileId,
  type NetlistDeviceFamily,
  type NetlistQuickTargetFamily,
} from "./netlist-process-presets";

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

/** One undoable authoring transaction. Exporters continue to read only Project facts. */
export function planNetlistProcess(
  project: CircuitProject,
  profile: NetlistExportProfile,
  options: { onlyMissing?: boolean; family?: NetlistDeviceFamily } = {},
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
    for (const original of originalDocument.instances) {
      const family = netlistDeviceFamily(original.symbolId);
      const descriptor = deviceDescriptor(original.symbolId);
      if (
        !family ||
        !descriptor ||
        !original.netlist ||
        !original.reference ||
        (options.family && family !== options.family)
      )
        continue;
      const originalTarget = instanceModelTarget(project, original);
      // Custom external blocks and child Cells own their interfaces. Opening
      // a Project must never reinterpret an existing authored model or wrapper.
      if (
        originalTarget === undefined ||
        (options.onlyMissing && originalTarget)
      )
        continue;
      if (
        original.netlist.binding &&
        "deviceClass" in original.netlist.binding &&
        original.netlist.binding.deviceClass !== descriptor.deviceClass
      )
        continue;
      const rule = profile.devices[family];
      if (descriptor.targetPolicy === "none") continue;
      const target = rule.target;
      let document = working.documents.find((item) => item.id === documentId)!;
      let instance = document.instances.find(
        (item) => item.id === original.id,
      )!;
      const reviewed = reviewedExternalBindingForMaster(target);
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
        const old = Object.entries(original.netlist.parameters).find(
          ([name]) => name.toLowerCase() === from,
        );
        if (old) {
          const destination = Object.keys(parameters).find(
            (name) => name.toLowerCase() === to,
          );
          if (
            !destination ||
            original.netlist.parameters[destination] === undefined
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
              rule.parameters[parameter.name] ?? parameter.defaultValue ?? "",
            ]),
          )
        : rule.parameters;
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
        const authored = Object.keys(original.netlist.parameters).some(
          (key) => key.toLowerCase() === name.toLowerCase(),
        );
        const mappedCount =
          (name === "m" || name === "multi") &&
          Object.keys(original.netlist.parameters).some((key) =>
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

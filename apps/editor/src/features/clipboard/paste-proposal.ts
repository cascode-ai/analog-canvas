// The edits that paste a clipboard into a Document, and the ID map they make.
import {
  createReferenceIndex,
  nextReference,
  referencePolicyForInstance,
  referenceSuffixForPolicy,
} from "@icm/devices";
import {
  createRoutingOperationPlan,
  gridAlignmentDiagnostics,
  powerConnectionForSymbol,
  type OperationIdRemap,
  type RoutingOperationPlan,
} from "@icm/edit-engine";
import { translateDraftingObject } from "@icm/edit-engine";
import type { SchematicEdit } from "@icm/edit-engine";
import type {
  CircuitProject,
  Instance,
  Point,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  createRoutePath,
  controlledSourceExpressionDocument,
  controlledSourceExpressionSource,
  defaultControlledSourceExpression,
  LINEAR_CONTROLLED_SOURCE_KINDS,
  rewriteRichTextPlainText,
  routeBends,
  routeEnd,
} from "@icm/model";

import { createNewInstance } from "../netlist-export/netlist-authoring";
import type { SchematicClipboard } from "./clipboard";
import {
  nextUnconstrainedReference,
  pastedIdentities,
} from "./paste-identities";
import {
  mapEndpoint,
  movePoint,
  remapPastedDraftingAnchors,
  remapPastedVisualAnchor,
} from "./paste-remap";

export interface PasteProposal {
  edits: SchematicEdit[];
  instanceIds: string[];
  errors: string[];
  idRemap: OperationIdRemap;
  /**
   * Non-electrical provenance for this one flattened Document insertion.
   * It can identify two imports of the same source without changing target
   * Net naming, topology, or Evidence resolution.
   */
  compositionOccurrence?: {
    id: string;
    sourceDocumentId: string;
    targetDocumentId: string;
    objectIdRemap: OperationIdRemap;
  };
  operationPlan: RoutingOperationPlan;
}

export function proposePaste(
  document: SchematicDocument,
  clipboard: SchematicClipboard,
  offset: Point,
  sequence: number,
  project?: Pick<CircuitProject, "componentDefinitions"> &
    Partial<Pick<CircuitProject, "id">>,
  resolver?: SymbolResolver,
): PasteProposal {
  // New Projects can both contain `document-main`; Cell ID alone is not
  // authority to retain an unselected electrical control across Projects.
  const sameControlScope =
    clipboard.sourceDocumentId === document.id &&
    (clipboard.context ? clipboard.context.id === project?.id : !project);
  const occupied = new Set<string>(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.layoutGroups,
      ...document.constraints,
      ...document.connectivityEvidence,
      ...(document.netlist?.terminals ?? []),
      ...(document.drafting?.objects ?? []),
    ].map((object) => object.id),
  );
  const occupiedRouteChildren = new Set(
    document.routes.flatMap((route) =>
      route.legs.flatMap((leg) => [
        leg.id,
        ...(leg.to.kind === "bend" ? [leg.to.bendId] : []),
      ]),
    ),
  );
  const pasted = pastedIdentities(
    [
      ...clipboard.instances,
      ...clipboard.routes,
      ...clipboard.junctions,
      ...clipboard.noConnects,
      ...clipboard.annotations,
      ...clipboard.connectivityEvidence,
      ...clipboard.layoutGroups,
      ...clipboard.constraints,
      ...clipboard.cellTerminals,
      ...clipboard.nets,
      // A junction can arrive without its net (a junction-only marquee copy
      // clones no internal Route, so the net is never cloned): the paste
      // creates a fresh net for it instead of emitting an undefined netId.
      ...clipboard.junctions.map((junction) => ({ id: junction.netId })),
      ...clipboard.draftingObjects,
    ].map((object) => object.id),
    clipboard.routes,
    clipboard.annotations.flatMap((annotation) =>
      annotation.anchor.kind === "object"
        ? [{ id: annotation.id, ownerId: annotation.anchor.objectId }]
        : annotation.anchor.kind === "route"
          ? [{ id: annotation.id, ownerId: annotation.anchor.routeId }]
          : [],
    ),
    occupied,
    occupiedRouteChildren,
  );
  for (const id of pasted.values()) occupied.add(id);
  const pastedId = (id: string) => pasted.get(id)!;
  let compositionOccurrenceId: string | undefined;
  if (clipboard.intent === "compose-document") {
    compositionOccurrenceId = `composition-${clipboard.sourceDocumentId}-${sequence}`;
    for (let ordinal = 2; occupied.has(compositionOccurrenceId); ordinal += 1)
      compositionOccurrenceId = `composition-${clipboard.sourceDocumentId}-${sequence}_${ordinal}`;
    occupied.add(compositionOccurrenceId);
  }
  const referenceIndex = createReferenceIndex(document, project);
  const reservedReferences = new Set<string>();
  const occupiedReferences = new Set(
    document.instances.flatMap((instance) =>
      instance.reference ? [instance.reference.toLowerCase()] : [],
    ),
  );
  const instanceReferences = new Map(
    (clipboard.intent === "compose-document"
      ? clipboard.instances
      : []
    ).flatMap((instance) => {
      if (!instance.reference) return [];
      if (
        clipboard.intent === "compose-document" &&
        !occupiedReferences.has(instance.reference.toLowerCase()) &&
        !reservedReferences.has(instance.reference.toLowerCase())
      ) {
        reservedReferences.add(instance.reference.toLowerCase());
        return [[instance.id, instance.reference] as const];
      }
      const policy = referencePolicyForInstance(instance, project);
      if (policy.kind === "none") {
        const reference = nextUnconstrainedReference(
          instance.reference,
          sequence,
          occupiedReferences,
          reservedReferences,
        );
        reservedReferences.add(reference.toLowerCase());
        return [[instance.id, reference] as const];
      }
      const sourceSuffix = referenceSuffixForPolicy(instance.reference, policy);
      const reference = nextReference(referenceIndex, policy, {
        ...(sourceSuffix !== null ? { startAt: sourceSuffix + 1 } : {}),
        reservedReferences,
      });
      if (!reference) return [];
      reservedReferences.add(reference.toLowerCase());
      return [[instance.id, reference] as const];
    }),
  );
  const instanceIds = new Map(
    clipboard.instances.map((instance) => [instance.id, pastedId(instance.id)]),
  );
  const freshInstances = new Map<string, Instance>();
  if (clipboard.intent === "clone-selection") {
    instanceReferences.clear();
    const allocationDocument = {
      ...document,
      instances: [...document.instances],
    };
    // A copy keeps its Reference wherever that name is still free, so a
    // circuit copied into another tab keeps R7 and XDUT, and what its
    // simulation setups call them. Only a taken name gets the next free one,
    // and names that can be kept are claimed before any is allocated.
    const taken = new Set(occupiedReferences);
    const keptReferences = new Map<string, string>();
    for (const source of clipboard.instances) {
      const key = source.reference?.toLowerCase();
      if (!source.reference || !key || taken.has(key)) continue;
      taken.add(key);
      keptReferences.set(source.id, source.reference);
    }
    const allocationOrder = [
      ...clipboard.instances.filter((item) => keptReferences.has(item.id)),
      ...clipboard.instances.filter((item) => !keptReferences.has(item.id)),
    ];
    for (const source of allocationOrder) {
      const instance = createNewInstance(allocationDocument, source, {
        id: instanceIds.get(source.id)!,
        project,
        reference: keptReferences.get(source.id),
      });
      freshInstances.set(source.id, instance);
      allocationDocument.instances.push(instance);
      if (instance.reference)
        instanceReferences.set(source.id, instance.reference);
    }
  }
  const routeIds = new Map(
    clipboard.routes.map((route) => [route.id, pastedId(route.id)]),
  );
  const junctionIds = new Map(
    clipboard.junctions.map((junction) => [junction.id, pastedId(junction.id)]),
  );
  const netIds = new Map<string, string>();
  const noConnectIds = new Map(
    clipboard.noConnects.map((noConnect) => [
      noConnect.id,
      pastedId(noConnect.id),
    ]),
  );
  const annotationIds = new Map(
    clipboard.annotations.map((annotation) => [
      annotation.id,
      pastedId(annotation.id),
    ]),
  );
  const evidenceIds = new Map(
    clipboard.connectivityEvidence.map((evidence) => [
      evidence.id,
      pastedId(evidence.id),
    ]),
  );
  const layoutGroupIds = new Map(
    clipboard.layoutGroups.map((group) => [group.id, pastedId(group.id)]),
  );
  const constraintIds = new Map(
    clipboard.constraints.map((constraint) => [
      constraint.id,
      pastedId(constraint.id),
    ]),
  );
  const errors: string[] = [];
  // Net names survive paste, so V(node) expressions are stable. Device
  // References still need unique names: reject expressions that would silently
  // keep targeting the original device after its copied instance is renamed.
  const renamedReferences = new Set(
    clipboard.instances.flatMap((instance) =>
      instance.reference &&
      instanceReferences.has(instance.id) &&
      instanceReferences.get(instance.id) !== instance.reference
        ? [instance.reference.toLowerCase()]
        : [],
    ),
  );
  if (
    clipboard.instances.some((instance) =>
      Object.values(instance.netlist?.parameters ?? {}).some((value) =>
        [
          ...value.matchAll(/\bi\s*\(\s*([^\s,)]+)|@([^\s[\](){}+*/=,]+)/giu),
        ].some((match) =>
          renamedReferences.has((match[1] ?? match[2]!).toLowerCase()),
        ),
      ),
    )
  )
    errors.push(
      "Copied behavioral expressions refer to device names that conflict with this Cell; paste into an empty Cell first",
    );
  const terminalIds = new Map(
    clipboard.cellTerminals.map((terminal) => [
      terminal.id,
      pastedId(terminal.id),
    ]),
  );
  for (const net of clipboard.nets) {
    netIds.set(net.id, pastedId(net.id));
  }
  for (const junction of clipboard.junctions) {
    if (!netIds.has(junction.netId))
      netIds.set(junction.netId, pastedId(junction.netId));
  }
  const draftingIds = new Map(
    clipboard.draftingObjects.map((object) => [object.id, pastedId(object.id)]),
  );
  const objectIds = new Map<string, string>([
    ...instanceIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
    ...annotationIds,
    ...draftingIds,
  ]);
  const interfaceEdits: SchematicEdit[] = [];
  const sourceNeedsCellInterface =
    clipboard.cellTerminals.length > 0 || clipboard.formalParameters.length > 0;
  if (sourceNeedsCellInterface && !document.netlist) {
    if (clipboard.intent === "compose-document" || clipboard.context) {
      interfaceEdits.push({
        kind: "create_cell_interface",
        name: document.name,
      });
    } else {
      errors.push("Target Document has no formal Cell interface");
    }
  }
  if (
    (clipboard.intent === "compose-document" || clipboard.context) &&
    clipboard.formalParameters.length > 0
  ) {
    const merged = structuredClone(document.netlist?.formalParameters ?? []);
    const byName = new Map(
      merged.map((parameter) => [parameter.name.toLowerCase(), parameter]),
    );
    for (const parameter of clipboard.formalParameters) {
      const existing = byName.get(parameter.name.toLowerCase());
      if (existing) {
        if (existing.defaultValue !== parameter.defaultValue) {
          errors.push(
            `Cell formal parameter conflict: ${parameter.name} has incompatible defaults`,
          );
        }
        continue;
      }
      const copy = structuredClone(parameter);
      merged.push(copy);
      byName.set(copy.name.toLowerCase(), copy);
    }
    interfaceEdits.push({
      kind: "set_cell_formal_parameters",
      formalParameters: merged,
    });
  }
  const edits: SchematicEdit[] = [
    ...interfaceEdits,
    ...clipboard.instances.map((instance): SchematicEdit => ({
      kind: "add_instance",
      instance: {
        ...structuredClone(freshInstances.get(instance.id) ?? instance),
        id: instanceIds.get(instance.id)!,
        ...(instance.netlist?.control
          ? {
              netlist: {
                ...structuredClone(instance.netlist),
                control: (() => {
                  const control = instance.netlist!.control!;
                  const mappedInstance = (id: string | undefined) =>
                    id
                      ? (instanceIds.get(id) ??
                        (sameControlScope ? id : undefined))
                      : undefined;
                  const mappedNet = (id: string | undefined) =>
                    id
                      ? (netIds.get(id) ?? (sameControlScope ? id : undefined))
                      : undefined;
                  if (control.kind === "terminal-current")
                    return {
                      ...control,
                      instanceId: mappedInstance(control.instanceId),
                    };
                  if (control.kind === "current")
                    return {
                      ...control,
                      sensorInstanceId: mappedInstance(
                        control.sensorInstanceId,
                      ),
                    };
                  return {
                    ...control,
                    positiveNetId: mappedNet(control.positiveNetId),
                    negativeNetId: mappedNet(control.negativeNetId),
                  };
                })(),
              },
            }
          : {}),
        ...(instanceReferences.has(instance.id)
          ? {
              reference: instanceReferences.get(instance.id)!,
            }
          : {}),
        ...(clipboard.intent === "compose-document" && instance.mosBulkBinding
          ? {
              mosBulkBinding: {
                ...instance.mosBulkBinding,
                ...(clipboard.intent === "compose-document"
                  ? { origin: "instance-override" as const }
                  : {}),
                netId:
                  netIds.get(instance.mosBulkBinding.netId) ??
                  instance.mosBulkBinding.netId,
              },
            }
          : {}),
        placement: instance.placement
          ? {
              ...instance.placement,
              position: movePoint(instance.placement.position, offset),
            }
          : null,
      },
    })),
  ];
  edits.push(
    ...[...new Set(netIds.values())].map((netId): SchematicEdit => ({
      kind: "create_base_net",
      netId,
    })),
  );

  for (const terminal of clipboard.cellTerminals) {
    const copiedMarkerIds = terminal.interfaceInstanceIds.flatMap(
      (instanceId) => {
        const copiedId = instanceIds.get(instanceId);
        return copiedId ? [copiedId] : [];
      },
    );
    const copiedAnnotationId = terminal.interfaceAnnotationId
      ? annotationIds.get(terminal.interfaceAnnotationId)
      : undefined;
    if (copiedMarkerIds.length === 0 && !copiedAnnotationId) continue;
    edits.push({
      kind: "add_cell_terminal",
      terminal: {
        ...terminal,
        id: terminalIds.get(terminal.id)!,
        netId: netIds.get(terminal.netId) ?? terminal.netId,
        interfaceInstanceIds: copiedMarkerIds,
        ...(copiedAnnotationId
          ? { interfaceAnnotationId: copiedAnnotationId }
          : {}),
      },
    });
  }

  // A pin its symbol does not draw, such as a transistor substrate, has no
  // place for a wire: it joins its Net as a property, as the process binds it.
  const drawsPin = (instanceId: string, pinName: string): boolean => {
    const instance = clipboard.instances.find((item) => item.id === instanceId);
    const symbol =
      instance &&
      resolver?.resolve(instance.symbolId, instance.symbolVariantId);
    return (
      !symbol || symbol.definition.pins.some((pin) => pin.name === pinName)
    );
  };
  const propertyEdits: SchematicEdit[] = [];
  for (const net of clipboard.nets) {
    const netId = netIds.get(net.id)!;
    const mappedTerminals = net.terminals.flatMap(
      (terminal): RouteEndpoint[] => {
        const instanceId = instanceIds.get(terminal.instanceId);
        if (!instanceId) {
          // Legacy clipboards could carry terminals of uncopied instances;
          // surface a plan-time error instead of a raw schema rejection.
          errors.push(`Unknown terminal instance: ${terminal.instanceId}`);
          return [];
        }
        if (!drawsPin(terminal.instanceId, terminal.pinName)) {
          propertyEdits.push({
            kind: "set_property_terminal_net",
            instanceId,
            pinName: terminal.pinName,
            netId,
          });
          return [];
        }
        return [{ kind: "terminal", instanceId, pinName: terminal.pinName }];
      },
    );
    if (mappedTerminals[0]) {
      edits.push({
        kind: "connect_endpoints",
        from: mappedTerminals[0],
        to: mappedTerminals[1] ?? mappedTerminals[0],
        newNetId: netId,
      });
      for (const terminal of mappedTerminals.slice(2)) {
        edits.push({
          kind: "connect_endpoints",
          from: mappedTerminals[0],
          to: terminal,
        });
      }
    }
  }
  edits.push(...propertyEdits);
  // An implicit MOS bulk binding is a Cell policy, not a copied boundary
  // Wire. Re-materialize that one declared policy connection explicitly;
  // ordinary boundary terminals never enter this loop.
  for (const instance of clipboard.intent === "compose-document"
    ? clipboard.instances
    : []) {
    const binding = instance.mosBulkBinding;
    if (!binding || netIds.has(binding.netId)) continue;
    const sourceNet = document.nets.find((net) => net.id === binding.netId);
    const sourceBulk = sourceNet?.terminals.find(
      (terminal) => terminal.instanceId === instance.id,
    );
    const anchor = sourceNet?.terminals[0];
    const copiedInstanceId = instanceIds.get(instance.id);
    if (!sourceBulk || !anchor || !copiedInstanceId) {
      errors.push(
        `Cannot copy implicit bulk policy for ${instance.id}: ${binding.netId} is unavailable`,
      );
      continue;
    }
    edits.push({
      kind: "connect_endpoints",
      from: { kind: "terminal", ...anchor },
      to: {
        kind: "terminal",
        instanceId: copiedInstanceId,
        pinName: sourceBulk.pinName,
      },
    });
  }
  // A pasted supply marker settles Cell body policy exactly as placing that
  // marker by hand does. Without this, a Cell assembled by pasting has no
  // body default at all, every MOS body stays unresolved, and the netlist
  // refuses to export the fourth node.
  for (const domain of ["ground", "vdd"] as const) {
    const configured =
      domain === "ground"
        ? document.mosBulkDefaults?.nmosNetId
        : document.mosBulkDefaults?.pmosNetId;
    if (configured) continue;
    const marker = clipboard.instances.find(
      (instance) =>
        powerConnectionForSymbol(instance.symbolId)?.domain === domain,
    );
    const connection = marker
      ? powerConnectionForSymbol(marker.symbolId)
      : undefined;
    const markerNet = connection
      ? clipboard.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === marker!.id &&
              terminal.pinName === connection.pinName,
          ),
        )
      : undefined;
    const netId = markerNet ? netIds.get(markerNet.id) : undefined;
    if (!netId) continue;
    edits.push(
      domain === "ground"
        ? { kind: "set_mos_bulk_defaults", nmosNetId: netId }
        : { kind: "set_mos_bulk_defaults", pmosNetId: netId },
      { kind: "reconcile_mos_bulk" },
    );
  }
  edits.push(
    ...clipboard.noConnects.map((noConnect): SchematicEdit => {
      if (noConnect.endpoint.kind !== "terminal") {
        throw new Error("Clipboard NoConnect must target a copied terminal");
      }
      return {
        kind: "add_no_connect",
        noConnect: {
          ...structuredClone(noConnect),
          id: noConnectIds.get(noConnect.id)!,
          endpoint: {
            kind: "terminal",
            instanceId: instanceIds.get(noConnect.endpoint.instanceId)!,
            pinName: noConnect.endpoint.pinName,
          },
        },
      };
    }),
  );
  edits.push(
    ...clipboard.junctions.map((junction): SchematicEdit => {
      const netId = netIds.get(junction.netId)!;
      return {
        kind: "add_junction",
        junctionId: junctionIds.get(junction.id)!,
        netId,
        position: movePoint(junction.position, offset),
        ...(junction.documentStyle
          ? { documentStyle: structuredClone(junction.documentStyle) }
          : {}),
      };
    }),
  );
  // Name/source evidence must exist before a copied power-rail Route is
  // validated. Owners may be added later in the same atomic transaction; the
  // final Document validator checks their complete lifecycle closure.
  edits.push(
    ...clipboard.connectivityEvidence.map((evidence): SchematicEdit => {
      const clone = structuredClone(evidence);
      clone.id = evidenceIds.get(evidence.id)!;
      clone.netId = netIds.get(clone.netId) ?? clone.netId;
      if (clone.kind === "name-claim") {
        switch (clone.owner.kind) {
          case "net-label":
            clone.owner.annotationId =
              annotationIds.get(clone.owner.annotationId) ??
              clone.owner.annotationId;
            break;
          case "power-marker":
            clone.owner.objectId =
              objectIds.get(clone.owner.objectId) ??
              annotationIds.get(clone.owner.objectId) ??
              clone.owner.objectId;
            break;
          case "global-declaration":
            break;
        }
      }
      return { kind: "upsert_connectivity_evidence", evidence: clone };
    }),
  );
  const clonedRoutesBySource = new Map(
    clipboard.routes.map((source) => [
      source,
      createRoutePath({
        id: routeIds.get(source.id)!,
        netId: netIds.get(source.netId)!,
        start: mapEndpoint(source.start, instanceIds, junctionIds),
        end: mapEndpoint(routeEnd(source), instanceIds, junctionIds),
        bends: routeBends(source).map((point) => movePoint(point, offset)),
        modes: source.legs.map((leg) => leg.mode),
        ...(source.presentation ? { presentation: source.presentation } : {}),
        ...(source.styleOverride
          ? { styleOverride: structuredClone(source.styleOverride) }
          : {}),
        ...(source.documentStyle
          ? { documentStyle: source.documentStyle }
          : {}),
      }),
    ]),
  );
  const pastedLegIds = new Map(
    [...clonedRoutesBySource].flatMap(([source, clone]) =>
      source.legs.map((leg, index) => [leg.id, clone.legs[index]!.id]),
    ),
  );
  for (const annotation of clipboard.annotations) {
    if (
      annotation.anchor.kind === "route" &&
      routeIds.has(annotation.anchor.routeId) &&
      !pastedLegIds.has(annotation.anchor.legId)
    ) {
      errors.push(
        `Annotation ${annotation.id} references a Leg outside its copied Route`,
      );
    }
  }
  edits.push(
    ...[...clonedRoutesBySource.values()].map((route): SchematicEdit => ({
      kind: "set_route_path",
      route,
    })),
  );
  edits.push(
    ...clipboard.annotations.map((annotation): SchematicEdit => {
      const clone = structuredClone(annotation);
      const owner =
        clone.anchor.kind === "object"
          ? clipboard.instances.find(
              (item) =>
                clone.anchor.kind === "object" &&
                item.id === clone.anchor.objectId,
            )
          : undefined;
      if (
        clipboard.intent === "clone-selection" &&
        clone.kind === "instance-label" &&
        owner &&
        instanceReferences.has(owner.id)
      ) {
        // The unbound controlled-source expression is still authored text.
        // Renumber only an untouched default when the copy receives a fresh
        // Reference; preserve any formula the user actually edited.
        if (
          !clone.binding &&
          clone.content &&
          LINEAR_CONTROLLED_SOURCE_KINDS.has(owner.symbolId)
        ) {
          const kind = owner.symbolId as "vcvs" | "vccs" | "cccs" | "ccvs";
          const current = controlledSourceExpressionSource(clone.content);
          const sourceOrdinal = owner.reference?.match(/\d+$/u)?.[0] ?? "1";
          if (
            current ===
              defaultControlledSourceExpression(kind, sourceOrdinal) ||
            current === defaultControlledSourceExpression(kind)
          ) {
            const nextOrdinal =
              instanceReferences.get(owner.id)?.match(/\d+$/u)?.[0] ?? "1";
            clone.content = controlledSourceExpressionDocument(
              defaultControlledSourceExpression(kind, nextOrdinal),
            );
          }
        }
        // A copy reads like its source. A bound label follows the copy's new
        // Reference in the same look; an unbound label is an authored display
        // alias and must stay exactly as drawn, even when its spelling happens
        // to equal the source Reference. Never infer a binding from text: the
        // user chose alias semantics by leaving this annotation unbound.
        if (clone.binding?.kind === "instance-reference") {
          clone.binding = { kind: "instance-reference", instanceId: owner.id };
          if (!owner.reference) clone.visible = false;
        }
      }
      if (
        clone.binding?.kind === "instance-reference" &&
        clone.formatOverride
      ) {
        const mappedReference = instanceReferences.get(
          clone.binding.instanceId,
        );
        if (mappedReference) {
          clone.formatOverride = rewriteRichTextPlainText(
            clone.formatOverride,
            mappedReference,
          );
        }
      }
      return {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...clone,
          id: annotationIds.get(annotation.id)!,
          ...(clone.binding?.kind === "net-name"
            ? {
                binding: {
                  kind: "net-name" as const,
                  netId: netIds.get(clone.binding.netId) ?? clone.binding.netId,
                },
              }
            : clone.binding?.kind === "cell-terminal-name"
              ? {
                  binding: {
                    kind: "cell-terminal-name" as const,
                    terminalId:
                      terminalIds.get(clone.binding.terminalId) ??
                      clone.binding.terminalId,
                  },
                }
              : clone.binding?.kind === "instance-value" ||
                  clone.binding?.kind === "instance-reference"
                ? {
                    binding: {
                      ...clone.binding,
                      instanceId:
                        objectIds.get(clone.binding.instanceId) ??
                        clone.binding.instanceId,
                    },
                  }
                : {}),
          ...(annotation.netId
            ? { netId: netIds.get(annotation.netId) ?? annotation.netId }
            : {}),
          anchor: remapPastedVisualAnchor(
            annotation.anchor,
            objectIds,
            routeIds,
            pastedLegIds,
            offset,
            true,
          ),
        },
      };
    }),
  );
  const idRemap: OperationIdRemap = {
    instances: Object.fromEntries(instanceIds),
    nets: Object.fromEntries(netIds),
    routes: Object.fromEntries(routeIds),
    legs: Object.fromEntries(pastedLegIds),
    bends: Object.fromEntries(
      [...clonedRoutesBySource].flatMap(([source, clone]) =>
        source.legs.flatMap((leg, index) => {
          const target = clone.legs[index]?.to;
          return leg.to.kind === "bend" && target?.kind === "bend"
            ? [[leg.to.bendId, target.bendId] as const]
            : [];
        }),
      ),
    ),
    junctions: Object.fromEntries(junctionIds),
    annotations: Object.fromEntries(annotationIds),
    evidence: Object.fromEntries(evidenceIds),
    noConnects: Object.fromEntries(noConnectIds),
    draftingObjects: Object.fromEntries(draftingIds),
    layoutGroups: Object.fromEntries(layoutGroupIds),
    constraints: Object.fromEntries(constraintIds),
    cellTerminals: Object.fromEntries(terminalIds),
  };
  // Drafting objects carry no connectivity, so a copy is the object itself
  // under a fresh id, shifted by the same placement offset as everything else.
  const pastedAnchorObjectIds = new Map([...objectIds, ...draftingIds]);
  for (const object of clipboard.draftingObjects) {
    const id = draftingIds.get(object.id)!;
    const translated = translateDraftingObject(
      object,
      offset,
      clipboard.intent === "compose-document" ? 1 : document.presentation.grid,
    );
    edits.push({
      kind: "upsert_drafting_object",
      object: {
        ...remapPastedDraftingAnchors(
          translated,
          pastedAnchorObjectIds,
          routeIds,
          pastedLegIds,
          offset,
        ),
        id,
      },
    });
  }
  for (const group of clipboard.layoutGroups) {
    const mappedObjectIds = group.objectIds.flatMap((objectId) => {
      const mapped = objectIds.get(objectId);
      if (!mapped) {
        errors.push(
          `Layout group ${group.id} references unavailable object ${objectId}`,
        );
        return [];
      }
      return [mapped];
    });
    if (mappedObjectIds.length !== group.objectIds.length) continue;
    edits.push({
      kind: "set_layout_group",
      group: {
        ...structuredClone(group),
        id: layoutGroupIds.get(group.id)!,
        objectIds: mappedObjectIds,
      },
    });
  }
  for (const constraint of clipboard.constraints) {
    const mappedObjectIds = constraint.objectIds.flatMap((objectId) => {
      const mapped = objectIds.get(objectId);
      if (!mapped) {
        errors.push(
          `Layout constraint ${constraint.id} references unavailable object ${objectId}`,
        );
        return [];
      }
      return [mapped];
    });
    if (mappedObjectIds.length !== constraint.objectIds.length) continue;
    edits.push({
      kind: "set_layout_constraint",
      constraint: {
        ...structuredClone(constraint),
        id: constraintIds.get(constraint.id)!,
        objectIds: mappedObjectIds,
      },
    });
  }
  if (clipboard.intent === "compose-document" || clipboard.context) {
    const gridErrors = edits.flatMap((edit) =>
      gridAlignmentDiagnostics(edit, document.presentation.grid),
    );
    if (gridErrors.length > 0) {
      errors.push(
        `Source geometry is incompatible with target grid ${document.presentation.grid}; composition does not rescale or snap electrical geometry`,
      );
    }
  }
  const operationPlan = createRoutingOperationPlan(document, {
    intent: clipboard.intent === "compose-document" ? "compose" : "clone",
    affected: {
      instances: clipboard.instances.map((item) => item.id),
      internalRoutes: clipboard.routes.map((item) => item.id),
      boundaryRoutes: [],
      externalRoutes: [],
      internalJunctions: clipboard.junctions.map((item) => item.id),
      boundaryJunctions: [],
      electricalAnnotationIds: clipboard.annotations.map((item) => item.id),
      protectedObjectIds: [],
    },
    expectedElectricalEffect:
      clipboard.intent === "compose-document"
        ? {
            kind: "compose",
            mapping: idRemap.instances,
            boundaryPolicy: "preserve-target-physical",
          }
        : {
            kind: "clone",
            mapping: idRemap.instances,
            boundaryPolicy: "disconnect",
          },
    idRemap,
    edits,
    diagnostics: errors.map((message) => ({
      code: "ROUTING_CLONE_SOURCE_UNAVAILABLE",
      severity: "error" as const,
      message,
    })),
  });

  return {
    edits,
    instanceIds: [...instanceIds.values()],
    errors,
    idRemap,
    ...(compositionOccurrenceId
      ? {
          compositionOccurrence: {
            id: compositionOccurrenceId,
            sourceDocumentId: clipboard.sourceDocumentId,
            targetDocumentId: document.id,
            objectIdRemap: idRemap,
          },
        }
      : {}),
    operationPlan,
  };
}

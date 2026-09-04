import { deriveStableId, semanticTextDocument } from "@icm/model";

export interface Schema34To35MigrationReport {
  readonly unifiedReferences: number;
  readonly renamedConflictingReferences: number;
  readonly materializedSchematicLabels: number;
  readonly migratedReferenceBindings: number;
  readonly retiredMasterBindings: number;
  readonly removedMarkerReferences: number;
  readonly migratedImportProvenance: number;
  readonly changed: boolean;
}

export interface Schema34To35MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema34To35MigrationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function richText(value: string): Record<string, unknown> {
  return structuredClone(
    semanticTextDocument(value, "instance-label"),
  ) as unknown as Record<string, unknown>;
}

function referenceLessMarker(instance: Record<string, unknown>): boolean {
  return (
    instance.symbolId === "port" ||
    instance.symbolId === "port-filled" ||
    instance.symbolId === "ground" ||
    instance.symbolId === "vdd-port"
  );
}

function migratedLabelAnnotation(
  documentId: string,
  instance: Record<string, unknown>,
  content: Record<string, unknown>,
): Record<string, unknown> {
  const instanceId = stringValue(instance.id)!;
  const placement = isRecord(instance.placement) ? instance.placement : null;
  const position =
    placement && isRecord(placement.position)
      ? placement.position
      : { x: 0, y: 0 };
  return {
    id: deriveStableId("instance-label", documentId, instanceId),
    kind: "instance-label",
    content: structuredClone(content),
    anchor: {
      kind: "object",
      objectId: instanceId,
      localOffset: { x: 0, y: 0 },
      fallbackPosition: structuredClone(position),
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  };
}

/**
 * Schema 35 gives an Instance exactly one authored Reference. The former
 * canvas-only Reference and emitted netlist Reference cannot survive as
 * parallel mutable authorities. User RichText labels become ordinary attached
 * Annotation content, while master/value/reference labels remain live bound
 * projections.
 */
export function upgradeSchema34To35WithReport(
  raw: Record<string, unknown>,
): Schema34To35MigrationResult {
  const project = structuredClone(raw);
  let unifiedReferences = 0;
  let renamedConflictingReferences = 0;
  let materializedSchematicLabels = 0;
  let migratedReferenceBindings = 0;
  let retiredMasterBindings = 0;
  let removedMarkerReferences = 0;
  let migratedImportProvenance = 0;

  const documents = Array.isArray(project.documents) ? project.documents : [];
  for (const document of documents) {
    if (!isRecord(document)) continue;
    const documentId = stringValue(document.id) ?? "document";
    const instances = Array.isArray(document.instances)
      ? document.instances.filter(isRecord)
      : [];
    const instanceById = new Map(
      instances.flatMap((instance) => {
        const id = stringValue(instance.id);
        return id ? [[id, instance] as const] : [];
      }),
    );
    const oldDisplayByInstanceId = new Map<
      string,
      Record<string, unknown> | undefined
    >();
    const oldSchematicReferenceByInstanceId = new Map<string, string>();
    const oldSchematicReferenceMatchedChosen = new Set<string>();
    const oldSchematicNameInstanceIds = new Set<string>();
    const referenceCandidates: Array<{
      readonly instance: Record<string, unknown>;
      readonly reference: string;
      readonly emitted: boolean;
      readonly order: number;
    }> = [];

    for (const [order, instance] of instances.entries()) {
      const id = stringValue(instance.id);
      if (!id) continue;
      const oldSchematicReference = stringValue(instance.schematicReference);
      const oldSchematicName = isRecord(instance.schematicName)
        ? structuredClone(instance.schematicName)
        : undefined;
      if (oldSchematicReference) {
        oldSchematicReferenceByInstanceId.set(id, oldSchematicReference);
      }
      if (oldSchematicName) oldSchematicNameInstanceIds.add(id);
      const netlist = isRecord(instance.netlist) ? instance.netlist : undefined;
      const provenance = isRecord(instance.importProvenance)
        ? instance.importProvenance
        : undefined;
      if (provenance) {
        const sourceMasterName = stringValue(provenance.name);
        if (sourceMasterName) {
          provenance.sourceMasterName = sourceMasterName;
          migratedImportProvenance += 1;
        }
        delete provenance.name;
      }
      const oldNetlistReference = stringValue(netlist?.reference);
      const marker = referenceLessMarker(instance);
      const reference = marker
        ? undefined
        : (oldNetlistReference ?? oldSchematicReference);
      if (oldSchematicReference && oldSchematicReference === reference) {
        oldSchematicReferenceMatchedChosen.add(id);
      }

      oldDisplayByInstanceId.set(
        id,
        oldSchematicName ??
          (oldSchematicReference
            ? richText(oldSchematicReference)
            : oldNetlistReference
              ? richText(oldNetlistReference)
              : undefined),
      );
      if (reference) {
        referenceCandidates.push({
          instance,
          reference,
          emitted: oldNetlistReference !== undefined,
          order,
        });
        unifiedReferences += 1;
      } else if (oldSchematicReference || oldNetlistReference) {
        removedMarkerReferences += 1;
      }
      delete instance.schematicReference;
      delete instance.schematicName;
      if (netlist) {
        if (marker) delete instance.netlist;
        else delete netlist.reference;
      }
    }

    // Schema 34 enforced canvas and emitted references in separate domains, so
    // a schematic-only Instance could legally collide with an emitted one.
    // Preserve emitted tokens first, then deterministically disambiguate the
    // lower-authority schematic-only candidate. Schema 35 never loads with two
    // Instance identities claiming the same case-folded Reference.
    const occupiedReferences = new Set<string>();
    for (const candidate of referenceCandidates.toSorted(
      (left, right) =>
        Number(right.emitted) - Number(left.emitted) ||
        left.order - right.order,
    )) {
      let reference = candidate.reference;
      let suffix = 2;
      while (occupiedReferences.has(reference.toLowerCase())) {
        reference = `${candidate.reference}_${suffix}`;
        suffix += 1;
      }
      if (reference !== candidate.reference) renamedConflictingReferences += 1;
      candidate.instance.reference = reference;
      occupiedReferences.add(reference.toLowerCase());
    }

    const annotations = Array.isArray(document.annotations)
      ? document.annotations.filter(isRecord)
      : [];
    const retainedAnnotations: Record<string, unknown>[] = [];
    const migratedDisplayIds = new Set<string>();
    for (const annotation of annotations) {
      const binding = isRecord(annotation.binding)
        ? annotation.binding
        : undefined;
      const instanceId = stringValue(binding?.instanceId);
      if (binding?.kind === "instance-designator") {
        if (!instanceId || !instanceById.get(instanceId)?.reference) continue;
        annotation.binding = { kind: "instance-reference", instanceId };
        migratedReferenceBindings += 1;
      } else if (binding?.kind === "instance-schematic-name" && instanceId) {
        const instance = instanceById.get(instanceId);
        const oldDisplay = oldDisplayByInstanceId.get(instanceId);
        migratedDisplayIds.add(instanceId);
        if (!instance || !oldDisplay) continue;
        const oldHadSchematicName = oldSchematicNameInstanceIds.has(instanceId);
        if (
          !oldHadSchematicName &&
          oldSchematicReferenceMatchedChosen.has(instanceId)
        ) {
          annotation.binding = { kind: "instance-reference", instanceId };
          migratedReferenceBindings += 1;
        } else {
          delete annotation.binding;
          annotation.content = structuredClone(oldDisplay);
          materializedSchematicLabels += 1;
        }
      } else if (binding?.kind === "instance-schematic-name") {
        continue;
      } else if (binding?.kind === "instance-master-name" && instanceId) {
        const instance = instanceById.get(instanceId);
        const netlist =
          instance && isRecord(instance.netlist) ? instance.netlist : undefined;
        const target =
          netlist && isRecord(netlist.binding) ? netlist.binding : undefined;
        const provenance =
          instance && isRecord(instance.importProvenance)
            ? instance.importProvenance
            : undefined;
        const masterName =
          stringValue(target?.name) ??
          stringValue(target?.deviceClass) ??
          stringValue(provenance?.sourceMasterName);
        if (!masterName) continue;
        delete annotation.binding;
        annotation.content = richText(masterName);
        retiredMasterBindings += 1;
      }
      retainedAnnotations.push(annotation);
    }

    for (const [instanceId, content] of oldDisplayByInstanceId) {
      if (!content || migratedDisplayIds.has(instanceId)) continue;
      const source = instanceById.get(instanceId);
      if (!source || !oldSchematicNameInstanceIds.has(instanceId)) continue;
      retainedAnnotations.push(
        migratedLabelAnnotation(documentId, source, content),
      );
      materializedSchematicLabels += 1;
    }
    document.annotations = retainedAnnotations;
  }

  project.schemaVersion = 35;
  return {
    project,
    report: {
      unifiedReferences,
      renamedConflictingReferences,
      materializedSchematicLabels,
      migratedReferenceBindings,
      retiredMasterBindings,
      removedMarkerReferences,
      migratedImportProvenance,
      changed:
        unifiedReferences > 0 ||
        renamedConflictingReferences > 0 ||
        materializedSchematicLabels > 0 ||
        migratedReferenceBindings > 0 ||
        retiredMasterBindings > 0 ||
        removedMarkerReferences > 0 ||
        migratedImportProvenance > 0,
    },
  };
}

export function upgradeSchema34To35(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema34To35WithReport(raw).project;
}

import { z } from "zod";
import {
  ProjectModelSourceSchema,
  ExternalSubcircuitDefinitionSchema,
  type CircuitProject,
} from "@icm/model";
import {
  prepareComponentVariant,
  buildCircuitComponentPackage,
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "@icm/edit-engine";

// Persist only detached resources, never stale documents from the live project.
const VariantDraftSchema = z.strictObject({
  kind: z.literal("component-variant"),
  identity: z.string().min(1),
  documentId: z.string().min(1),
  instanceId: z.string().min(1),
  baseline: z.string(),
  sources: z.array(ProjectModelSourceSchema),
  owners: z.array(ExternalSubcircuitDefinitionSchema),
  artworkText: z.string().optional(),
});

function baseline(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
) {
  const instance = project.documents
    .find((d) => d.id === documentId)
    ?.instances.find((i) => i.id === instanceId);
  if (!instance) throw Error("The variant's original instance is missing");
  const binding = instance.netlist?.binding;
  return JSON.stringify({
    instance,
    definition:
      binding?.kind === "external-subcircuit"
        ? buildCircuitComponentPackage(
            project,
            binding.definitionId,
            instance.symbolId,
          )
        : project.componentDefinitions?.find(
            (d) => d.symbol.id === instance.symbolId,
          ),
  });
}

export function writeComponentVariantDraft(
  current: CircuitProject,
  documentId: string,
  instanceId: string,
  variant: ReturnType<typeof prepareComponentVariant>,
  candidate: CircuitProject,
  artworkText?: string,
) {
  return JSON.stringify(
    VariantDraftSchema.parse({
      kind: "component-variant",
      identity: variant.identity,
      documentId,
      instanceId,
      baseline: baseline(current, documentId, instanceId),
      sources: (candidate.modelSources ?? []).filter(
        (s) => !current.modelSources?.some((original) => original.id === s.id),
      ),
      owners: candidate.externalSubcircuitDefinitions.filter(
        (d) =>
          !current.externalSubcircuitDefinitions.some(
            (original) => original.id === d.id,
          ),
      ),
      ...(artworkText === undefined ? {} : { artworkText }),
    }),
  );
}

export function readComponentVariantDraft(
  current: CircuitProject,
  text: string,
) {
  const data = VariantDraftSchema.parse(JSON.parse(text));
  if (data.baseline !== baseline(current, data.documentId, data.instanceId))
    throw Error(
      "The original component changed. Create a new variant from its current definition.",
    );
  if (
    data.sources.some((s) =>
      current.modelSources?.some((o) => o.id === s.id),
    ) ||
    data.owners.some((d) =>
      current.externalSubcircuitDefinitions.some((o) => o.id === d.id),
    )
  )
    throw Error("The variant draft conflicts with existing project resources");
  const prepared = prepareComponentVariant(
    current,
    data.documentId,
    data.instanceId,
    data.identity,
  );
  const edits: ProjectStructureEdit[] = [];
  for (const source of data.sources) {
    const original = prepared.project.modelSources?.find(
      (s) => s.id === source.id,
    );
    if (!original) {
      edits.push({ kind: "upsert_model_source", source });
      continue;
    }
    const { draft, ...applied } = source;
    if (JSON.stringify(applied) !== JSON.stringify(original))
      throw Error(
        "The variant's applied source changed; reopen the original definition",
      );
    if (draft) {
      const { baseRevision, ...candidate } = draft;
      edits.push({
        kind: "save_model_source_draft",
        sourceId: source.id,
        expectedRevision: baseRevision,
        ...candidate,
        dependencies: candidate.dependencies ?? source.dependencies,
      });
    }
  }
  for (const definition of data.owners) {
    const original = prepared.project.externalSubcircuitDefinitions.find(
      (d) => d.id === definition.id,
    );
    if (original && JSON.stringify(original) !== JSON.stringify(definition))
      throw Error(
        "The variant's interface changed; reopen the original definition",
      );
    if (!original)
      edits.push({ kind: "upsert_external_subcircuit_definition", definition });
  }
  let project = prepared.project;
  if (edits.length) {
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      transactionId: "restore-variant-draft",
      actor: { kind: "human", id: "variant-draft" },
      edits,
    });
    if (!result.ok)
      throw Error(result.diagnostics[0]?.message ?? result.error.message);
    project = result.project;
  }
  return {
    ...data,
    variant: { ...prepared, project, baseRevision: current.structureRevision },
    definition: prepared.definition,
  };
}

export function isComponentVariantDraft(text: string) {
  try {
    return JSON.parse(text)?.kind === "component-variant";
  } catch {
    return false;
  }
}

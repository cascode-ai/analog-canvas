import {
  executeProjectTransaction,
  executeTransaction,
  planRenameCellTerminal,
  type SchematicEdit,
} from "@icm/edit-engine";
import { resolveAnnotationName } from "@icm/derived";
import {
  CircuitProjectSchema,
  identifierSubscriptCase,
  rewriteRichTextIdentifier,
  type CircuitProject,
  type LabelSubscriptCase,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

/** Prepare on an isolated Project, then the caller commits one undoable change.
 * Same-name Nets/Pins keep the engine's merge semantics; only duplicate device
 * identities are refused, without a modal or a partial rename. */
export function applyLabelSubscriptCase(
  source: CircuitProject,
  documentId: string,
  mode: LabelSubscriptCase,
  resolver: SymbolResolver,
  additionalEdits: SchematicEdit[] = [],
): CircuitProject {
  let project = source;
  const original = source.documents.find((item) => item.id === documentId)!;
  const names = new Set<string>();
  for (const instance of original.instances) {
    if (!instance.reference) continue;
    const name = identifierSubscriptCase(instance.reference, mode);
    if (names.has(name.toLowerCase()))
      throw new Error(
        `Instance name ${name} already exists. Use display alias to show the same text without renaming the device.`,
      );
    names.add(name.toLowerCase());
  }
  for (const terminal of original.netlist?.terminals ?? []) {
    const name = identifierSubscriptCase(terminal.name, mode);
    if (name === terminal.name) continue;
    const current = project.documents.find((item) => item.id === documentId)!;
    if (!current.netlist?.terminals.some((item) => item.id === terminal.id))
      continue;
    const result = executeProjectTransaction(project, {
      transactionId: "label-subscript-port-case",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "local" },
      edits: planRenameCellTerminal(project, documentId, terminal.id, name, {
        mergeExistingPort: true,
      }),
    });
    if (!result.ok)
      throw new Error(result.diagnostics[0]?.message ?? result.error.message);
    project = result.project;
  }
  const document = project.documents.find((item) => item.id === documentId)!;
  const edits: SchematicEdit[] = [...additionalEdits];
  for (const instance of document.instances) {
    if (!instance.reference) continue;
    const reference = identifierSubscriptCase(instance.reference, mode);
    if (reference !== instance.reference)
      edits.push({
        kind: "set_instance_reference",
        instanceId: instance.id,
        reference,
      });
  }
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "name-claim") continue;
    const name = identifierSubscriptCase(evidence.name, mode);
    if (name !== evidence.name)
      edits.push({
        kind: "upsert_connectivity_evidence",
        evidence: { ...evidence, name },
      });
  }
  for (const annotation of document.annotations) {
    if (!annotation.binding || !annotation.formatOverride) continue;
    const name = resolveAnnotationName(document, annotation);
    const next = identifierSubscriptCase(name, mode);
    if (next !== name)
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          formatOverride: rewriteRichTextIdentifier(
            annotation.formatOverride,
            next,
          ),
        },
      });
  }
  // Also advance the revision when only the persisted choice changes.
  edits.push({
    kind: "set_presentation_style",
    styleProfileId: document.presentation.styleProfileId,
  });
  const result = executeTransaction(
    document,
    {
      transactionId: "label-subscript-case",
      documentId,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "local" },
      edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok)
    throw new Error(result.diagnostics[0]?.message ?? result.error.message);
  const next = {
    ...result.document,
    presentation: { ...result.document.presentation, labelSubscriptCase: mode },
  };
  return CircuitProjectSchema.parse({
    ...project,
    structureRevision: source.structureRevision + 1,
    documents: project.documents.map((item) =>
      item.id === documentId ? next : item,
    ),
  });
}

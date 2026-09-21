import {
  executeProjectTransaction,
  executeTransaction,
  planRenameCellTerminal,
  type SchematicEdit,
} from "@icm/edit-engine";
import { resolveAnnotationName, resolveAnnotationText } from "@icm/derived";
import {
  CircuitProjectSchema,
  identifierSubscriptCase,
  formatLabelSubscripts,
  flattenRichText,
  richTextIdentifier,
  type Annotation,
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
  italic?: boolean,
): CircuitProject {
  let project = source;
  const original = source.documents.find((item) => item.id === documentId)!;
  const changeCase =
    mode !== (original.presentation.labelSubscriptCase ?? "preserve");
  const changeItalic =
    italic !== undefined &&
    italic !== (original.presentation.labelSubscriptItalic ?? true);
  // Historical explicit subscripts can be bound to a name without `_`. Only
  // an explicit case edit adopts their script boundaries; opening a file or
  // changing slant must never rename a terminal.
  const rename = (
    name: string,
    matches: (annotation: Annotation) => boolean,
  ): string => {
    if (!changeCase || mode === "preserve") return name;
    const legacy = original.annotations.find(
      (annotation) =>
        matches(annotation) &&
        annotation.formatOverride &&
        flattenRichText(annotation.formatOverride) === name &&
        richTextIdentifier(annotation.formatOverride) !== name,
    );
    return identifierSubscriptCase(
      legacy?.formatOverride ? richTextIdentifier(legacy.formatOverride) : name,
      mode,
    );
  };
  const instanceName = (id: string, name: string) =>
    rename(
      name,
      (a) =>
        a.binding?.kind === "instance-reference" && a.binding.instanceId === id,
    );
  const portName = (id: string, name: string) =>
    rename(
      name,
      (a) =>
        a.binding?.kind === "cell-terminal-name" && a.binding.terminalId === id,
    );
  const netName = (id: string, name: string) =>
    rename(
      name,
      (a) => a.binding?.kind === "net-name" && a.binding.netId === id,
    );
  const names = new Map<string, boolean>();
  for (const instance of original.instances) {
    if (!instance.reference) continue;
    const name = instanceName(instance.id, instance.reference);
    const changed = name !== instance.reference;
    if (
      names.has(name.toLowerCase()) &&
      (changed || names.get(name.toLowerCase()))
    )
      throw new Error(
        `Instance name ${name} already exists. Use display alias to show the same text without renaming the device.`,
      );
    names.set(name.toLowerCase(), changed);
  }
  for (const terminal of original.netlist?.terminals ?? []) {
    const name = portName(terminal.id, terminal.name);
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
    const reference = instanceName(instance.id, instance.reference);
    if (reference !== instance.reference)
      edits.push({
        kind: "set_instance_reference",
        instanceId: instance.id,
        reference,
      });
  }
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "name-claim") continue;
    const name = netName(evidence.netId, evidence.name);
    if (name !== evidence.name)
      edits.push({
        kind: "upsert_connectivity_evidence",
        evidence: { ...evidence, name },
      });
  }
  for (const annotation of document.annotations) {
    const binding = annotation.binding;
    if (
      binding?.kind === "instance-value" ||
      annotation.kind === "instance-value"
    )
      continue;
    if (
      !binding &&
      !["instance-label", "net-label", "power-label"].includes(annotation.kind)
    )
      continue;
    // Unformatted bound labels derive both their new name and slant; do not
    // materialize redundant per-label copies of the generated text.
    if (binding && !annotation.formatOverride) continue;
    let content = resolveAnnotationText(document, annotation);
    if (binding) {
      const name = resolveAnnotationName(document, annotation);
      const next =
        binding.kind === "instance-reference"
          ? instanceName(binding.instanceId, name)
          : binding.kind === "cell-terminal-name"
            ? portName(binding.terminalId, name)
            : netName(binding.netId, name);
      if (next !== name) content = rewriteRichTextIdentifier(content, next);
    }
    const formatted = formatLabelSubscripts(content, {
      ...(changeCase ? { case: mode } : {}),
      ...(changeItalic ? { italic } : {}),
    });
    if (
      JSON.stringify(formatted) !==
      JSON.stringify(resolveAnnotationText(document, annotation))
    )
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          ...(binding ? { formatOverride: formatted } : { content: formatted }),
        },
      });
  }
  // Also advance the revision when only the persisted choice changes.
  if (!edits.some((edit) => edit.kind === "set_presentation_style"))
    edits.push({
      kind: "set_presentation_style",
      styleProfileId: document.presentation.styleProfileId,
      ...(document.presentation.styleOverrides
        ? { styleOverrides: document.presentation.styleOverrides }
        : {}),
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
    presentation: {
      ...result.document.presentation,
      labelSubscriptCase: mode,
      ...(italic !== undefined ? { labelSubscriptItalic: italic } : {}),
    },
  };
  return CircuitProjectSchema.parse({
    ...project,
    structureRevision: source.structureRevision + 1,
    documents: project.documents.map((item) =>
      item.id === documentId ? next : item,
    ),
  });
}

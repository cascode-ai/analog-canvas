import { isFrozenSnapshot, type SchematicDocument } from "@icm/model";
import type { SchematicEdit } from "./edit-schema.js";
import type { EditExecutionContext } from "./transaction-result.js";

type Annotation = SchematicDocument["annotations"][number];
function instanceCaption(annotation: Annotation): boolean {
  return (
    annotation.anchor.kind === "object" &&
    !annotation.netId &&
    (!annotation.binding ||
      annotation.binding.kind === "instance-reference" ||
      annotation.binding.kind === "instance-value")
  );
}

function fallbackReason(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
  context: EditExecutionContext,
) {
  if (!isFrozenSnapshot(document)) return "mutable-source";
  const addedInstances = new Set<string>();
  if (
    edits.some((edit) => {
      switch (edit.kind) {
        case "noop":
        case "merge_nets":
          return false;
        case "set_instance_netlist":
          return !addedInstances.has(edit.instanceId);
        case "bulk_patch_instance_netlist":
          return edit.assignments.some(
            (assignment) => !addedInstances.has(assignment.instanceId),
          );
        case "add_instance":
          addedInstances.add(edit.instance.id);
          return Boolean(
            edit.instance.mosBulkBinding ||
            edit.instance.sourceRef ||
            edit.instance.importProvenance,
          );
        case "add_junction":
          return Boolean(edit.members);
        case "set_route_path":
          return Boolean(edit.route.members);
        case "connect_endpoints":
          return Boolean(edit.from.memberId || edit.to.memberId);
        case "upsert_schematic_annotation":
          return !instanceCaption(edit.annotation);
        default:
          return true;
      }
    })
  )
    return "edit-family";
  // Group, bus, bulk, annotation and interface policies can also write nested
  // owners as a consequence of a scalar edit. Keep their complete executor.
  if (document.netlist?.terminals.length) return "cell-interface";
  if (
    document.junctions.some((j) => j.members) ||
    document.routes.some((r) => r.members)
  )
    return "bus-members";
  if (
    document.layoutGroups.length ||
    document.constraints.length ||
    document.connectivityEvidence.some(
      (e) =>
        e.kind === "name-claim" &&
        (e.owner.kind !== "global-declaration" || e.signal),
    ) ||
    document.mosBulkDefaults ||
    context.pinsMovedInstanceIds?.size ||
    document.annotations.some((a) => !instanceCaption(a)) ||
    document.instances.some(
      (i) =>
        i.mosBulkBinding ||
        i.sourceRef ||
        i.importProvenance ||
        i.netlist?.control?.kind === "voltage" ||
        (context.externalSubcircuitDefinitions?.length &&
          i.netlist?.binding?.kind === "external-subcircuit"),
    )
  )
    return "dependent-document-policy";
  return undefined;
}

const drafts = new WeakMap<
  SchematicDocument,
  {
    copies: WeakMap<object, object>;
    rowsCopied: number;
  }
>();
type Fallback = NonNullable<ReturnType<typeof fallbackReason>>;
type TransactionDraftWork =
  | { readonly mode: "full"; readonly reason: Fallback }
  | { readonly mode: "local"; readonly rowsCopied: number };
const validatedDraftWork = new WeakMap<
  SchematicDocument,
  TransactionDraftWork
>();

/** Work evidence belongs to this execution result, never to the persisted model or Agent response. */
export function readTransactionDraftWork(result: SchematicDocument) {
  return validatedDraftWork.get(result);
}
export function recordTransactionDraftWork(
  draft: SchematicDocument,
  result: SchematicDocument,
  fallback: Fallback | undefined,
) {
  const work = fallback
    ? { mode: "full" as const, reason: fallback }
    : { mode: "local" as const, rowsCopied: drafts.get(draft)!.rowsCopied };
  validatedDraftWork.set(result, Object.freeze(work));
}

export function createTransactionDraft(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
  context: EditExecutionContext,
) {
  const fallback = fallbackReason(document, edits, context);
  if (fallback)
    return { document: structuredClone(document), fallback } as const;
  const draft = {
    ...document,
    instances: [...document.instances],
    nets: [...document.nets],
    routes: [...document.routes],
    junctions: [...document.junctions],
    annotations: [...document.annotations],
    noConnects: [...document.noConnects],
    connectivityEvidence: [...document.connectivityEvidence],
  };
  drafts.set(draft, { copies: new WeakMap(), rowsCopied: 0 });
  return { document: draft, fallback };
}

/** A graph phase can still hold a row read before a Net merge. */
export function currentDraftRow<T extends object>(
  draft: SchematicDocument,
  row: T,
): T {
  return (drafts.get(draft)?.copies.get(row) as T | undefined) ?? row;
}

/** Called at the write, after the owning rule has found a real target. */
export function writableDraftRow<T extends { id: string }>(
  draft: SchematicDocument,
  rows: T[],
  row: T,
  index?: number,
): T {
  if (!isFrozenSnapshot(row)) return row;
  const state = drafts.get(draft);
  if (!state) return row;
  const prior = state.copies.get(row) as T | undefined;
  if (prior) return prior;
  const copy = structuredClone(row);
  const at = index ?? rows.indexOf(row);
  if (at < 0) throw new Error("Transaction attempted to write a retired row");
  rows[at] = copy;
  state.copies.set(row, copy);
  state.rowsCopied++;
  return copy;
}

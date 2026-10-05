import { createLabelClearanceContext } from "@icm/derived";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { arrangeInstanceLabels, partLabelOf } from "./arrange-instance-labels";

/** The part a label belongs to: a part's name or value, or a Pin's name. */
function ownerOf(
  label: Annotation,
  visible: readonly Annotation[],
): string | null {
  if (label.binding?.kind === "cell-terminal-name")
    return label.anchor.kind === "object" ? label.anchor.objectId : null;
  return partLabelOf(label, visible)?.instanceId ?? null;
}

/** The labels a wire is drawn across, with the parts they belong to. */
function struckLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Map<string, string> {
  const context = createLabelClearanceContext(document, resolver);
  const struck = new Map<string, string>();
  for (const label of context.visible) {
    const owner = ownerOf(label, context.visible);
    if (owner && context.wiresAt(context.measure(label).inkBounds).length)
      struck.set(label.id, owner);
  }
  return struck;
}

/**
 * Labels a change newly strikes with a wire, arranged clear as
 * `arrange-labels` would place them (#1366). The editor draws some wires
 * itself: a typed move's or an arrange's stretched wires redrawn clear of
 * what they cross (#1344), and a caller's wires redrawn after its Cell's
 * Pins change sides (#1320). Those paths keep clear of parts, pins and other
 * Nets, but not of labels; an SRAM column's two blb wires ran under their
 * blocks, straight through each block's "sram6t". Labels can move, and
 * wires are the drawing's structure, so the label moves: the parts whose
 * labels were clear before the change and are struck after it are arranged,
 * and only labels still in a default slot move. A label already struck
 * before is left as it was.
 */
export function arrangeNewlyStruckLabels(
  before: { document: SchematicDocument; resolver: SymbolResolver },
  after: SchematicDocument,
  resolver: SymbolResolver,
): SchematicEdit[] {
  const now = struckLabels(after, resolver);
  if (!now.size) return [];
  const was = struckLabels(before.document, before.resolver);
  const owners = new Set(
    [...now]
      .filter(([id]) => !was.has(id))
      .map(([, owner]) => owner)
      .filter((owner) => after.instances.some((item) => item.id === owner)),
  );
  // Rows stay as they are: only a struck group moves, not a value that
  // could also take its hidden Reference's row.
  return owners.size
    ? arrangeInstanceLabels(after, resolver, [...owners], {
        compact: false,
        formerResolver: before.resolver,
      })
    : [];
}

/** Edits that move parts, turn them or change their pins, so their wires. */
const GEOMETRY_EDITS = new Set<SchematicEdit["kind"]>([
  "move_instance",
  "rotate_instance",
  "mirror_instance",
  "align_instances",
  "set_instance_symbol",
  "set_instance_signal_flow_parameters",
  "set_route_path",
]);

/**
 * `edits`, then the label moves their result calls for: a part moved or
 * changed by typing, in Properties or by an Agent, redraws its stretched
 * wires (#1344), and labels those wires newly strike move clear (#1366).
 * Edits that move nothing are returned as they are.
 */
export function withStruckLabelsArranged(
  document: SchematicDocument,
  resolver: SymbolResolver,
  edits: readonly SchematicEdit[],
): SchematicEdit[] {
  if (!edits.some((edit) => GEOMETRY_EDITS.has(edit.kind))) return [...edits];
  const result = executeTransaction(
    document,
    {
      transactionId: "struck-label-preview",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "struck-label-preview" },
      edits: [...edits],
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) return [...edits];
  return [
    ...edits,
    ...arrangeNewlyStruckLabels(
      { document, resolver },
      result.document,
      resolver,
    ),
  ];
}

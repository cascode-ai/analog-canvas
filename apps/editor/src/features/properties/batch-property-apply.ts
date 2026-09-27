/**
 * One Properties edit, carried to every selected object of the same kind.
 *
 * Properties shows the object selected last. When more are selected, the
 * settings the person changed there — a size, a color, a weight — apply to
 * the others as well, each through its own Properties value so it keeps what
 * is only its own: where it sits and what it says.
 */
import type { SchematicEdit } from "@icm/edit-engine";
import type { Annotation, DraftingObject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  annotationPropertyValue,
  draftingPropertyValue,
  parseAnnotationPropertyCode,
  parseDraftingPropertyCode,
  serializeAnnotationPropertyCode,
  type AnnotationPropertyValue,
} from "./annotation-property-code";

/** Settings a batch may share; placement and content stay per object. */
const SHARED_PREFIXES = [
  "appearance.",
  "display.",
  "stacking.",
  "placement.rotation",
  "placement.mirror",
  "geometry.width",
  "geometry.height",
  "geometry.radius",
  "locked",
] as const;

type Tree = Readonly<Record<string, unknown>>;

const isTree = (value: unknown): value is Tree =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function leaves(value: unknown, prefix = ""): Map<string, unknown> {
  const found = new Map<string, unknown>();
  if (!isTree(value)) {
    found.set(prefix, value);
    return found;
  }
  for (const [key, child] of Object.entries(value))
    for (const [path, leaf] of leaves(child, prefix ? `${prefix}.${key}` : key))
      found.set(path, leaf);
  return found;
}

const shared = (path: string) =>
  SHARED_PREFIXES.some((prefix) =>
    prefix.endsWith(".") ? path.startsWith(prefix) : path === prefix,
  );

/** The shareable settings an edit changed, as leaf paths and new values. */
export function changedSharedSettings(
  before: AnnotationPropertyValue,
  after: AnnotationPropertyValue,
): ReadonlyMap<string, unknown> {
  const was = leaves(before);
  const changed = new Map<string, unknown>();
  for (const [path, value] of leaves(after))
    if (shared(path) && JSON.stringify(was.get(path)) !== JSON.stringify(value))
      changed.set(path, value);
  return changed;
}

/**
 * Another object's Properties value with the changed settings it also has.
 * Null when it has none of them, so nothing is written for it.
 */
export function withSharedSettings(
  target: AnnotationPropertyValue,
  settings: ReadonlyMap<string, unknown>,
): AnnotationPropertyValue | null {
  const own = leaves(target);
  const next = structuredClone(target) as Record<string, unknown>;
  let applied = false;
  for (const [path, value] of settings) {
    if (!own.has(path)) continue;
    if (JSON.stringify(own.get(path)) === JSON.stringify(value)) continue;
    const keys = path.split(".");
    let node = next;
    for (const key of keys.slice(0, -1))
      node = node[key] as Record<string, unknown>;
    node[keys.at(-1)!] = structuredClone(value);
    applied = true;
  }
  return applied ? (next as AnnotationPropertyValue) : null;
}

/**
 * A locked object keeps its settings; the lock itself is the one setting a
 * batch may still change on it.
 */
function settingsFor(
  locked: boolean,
  settings: ReadonlyMap<string, unknown>,
): ReadonlyMap<string, unknown> {
  if (!locked) return settings;
  return settings.has("locked")
    ? new Map([["locked", settings.get("locked")]])
    : new Map();
}

/** The edits that carry a drawing object's Properties edit to the rest. */
export function batchDraftingEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  grid: number,
  before: DraftingObject,
  after: DraftingObject,
  selectedIds: readonly string[],
): SchematicEdit[] {
  const others = (document.drafting?.objects ?? []).filter(
    (object) => object.id !== before.id && selectedIds.includes(object.id),
  );
  if (others.length === 0) return [];
  const settings = changedSharedSettings(
    draftingPropertyValue({ document, resolver, grid, object: before }),
    draftingPropertyValue({ document, resolver, grid, object: after }),
  );
  if (settings.size === 0) return [];
  return others.flatMap((object): SchematicEdit[] => {
    const context = { document, resolver, grid, object };
    const value = withSharedSettings(
      draftingPropertyValue(context),
      settingsFor(object.locked, settings),
    );
    if (!value) return [];
    const parsed = parseDraftingPropertyCode(
      serializeAnnotationPropertyCode(value),
      context,
    );
    return parsed.ok
      ? [{ kind: "upsert_drafting_object", object: parsed.value }]
      : [];
  });
}

/** The edits that carry a label's Properties edit to the other labels. */
export function batchAnnotationEdits(
  document: SchematicDocument,
  before: Annotation,
  after: Annotation,
  selectedIds: readonly string[],
): SchematicEdit[] {
  const others = document.annotations.filter(
    (annotation) =>
      annotation.id !== before.id && selectedIds.includes(annotation.id),
  );
  if (others.length === 0) return [];
  const settings = changedSharedSettings(
    annotationPropertyValue(before),
    annotationPropertyValue(after),
  );
  if (settings.size === 0) return [];
  return others.flatMap((annotation): SchematicEdit[] => {
    const value = withSharedSettings(
      annotationPropertyValue(annotation),
      settingsFor(annotation.locked, settings),
    );
    if (!value) return [];
    const parsed = parseAnnotationPropertyCode(
      serializeAnnotationPropertyCode(value),
      annotation,
    );
    return parsed.ok
      ? [{ kind: "upsert_schematic_annotation", annotation: parsed.value }]
      : [];
  });
}

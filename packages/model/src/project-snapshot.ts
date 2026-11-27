import {
  CircuitProjectSchema,
  safeParseWithRetainedCells,
} from "./schema/project.js";
import {
  SchematicDocumentSchema,
  parseOwnedRoutingDocument,
} from "./schema/document.js";
import { freezeSnapshot, isFrozenSnapshot } from "./immutable-snapshot.js";
import type { CircuitProject, SchematicDocument } from "./schema/types.js";
import {
  detachAndShareProjectStructure,
  shareEqualDocumentStructure,
  shareEqualProjectStructure,
} from "./snapshot-structural-sharing.js";
import {
  hasValidatedCells,
  rememberValidatedCells,
} from "./validated-cells.js";

// Record candidates under their source Project so a live successor cannot
// retain a chain of predecessor Projects beyond the bounded history.
const wireSources = new WeakMap<
  CircuitProject,
  WeakMap<SchematicDocument, SchematicDocument>
>();

const validatedSnapshots = new WeakSet<CircuitProject>();
const sharedSnapshots = new WeakMap<CircuitProject, WeakSet<CircuitProject>>();
const restoredProjects = new WeakMap<object, CircuitProject>();
const restoredContent = new WeakMap<SchematicDocument, SchematicDocument>();

function recordSharedSnapshot(
  snapshot: CircuitProject,
  before: CircuitProject,
): void {
  let sources = sharedSnapshots.get(snapshot);
  if (!sources) {
    sources = new WeakSet();
    sharedSnapshots.set(snapshot, sources);
  }
  sources.add(before);
}

/** The immutable document whose content history restored, apart from revision. */
export function documentContentSource(
  document: SchematicDocument,
): SchematicDocument {
  return restoredContent.get(document) ?? document;
}
/** The whole Project whose content history restored, including all other Cells and sources. */
export function projectContentSource(
  project: Pick<CircuitProject, "documents">,
): object {
  return restoredProjects.get(project) ?? project;
}

const validatedResults = new WeakMap<
  CircuitProject,
  { source: string; snapshot?: CircuitProject }
>();

/** Validate the public, mutable transaction result and retain its provenance. */
export function validateProjectResult(
  input: unknown,
): ReturnType<typeof CircuitProjectSchema.safeParse> {
  const result = CircuitProjectSchema.safeParse(input);
  if (result.success)
    validatedResults.set(result.data, { source: JSON.stringify(result.data) });
  return result;
}

/** Validate the Cell once and retain its exact source through Canvas commit. */
export function prepareWireCell(
  draft: SchematicDocument,
  source: SchematicDocument,
  readMembership: Parameters<typeof parseOwnedRoutingDocument>[2],
  changedNetIds: Set<string>,
  project?: CircuitProject,
) {
  const result = parseOwnedRoutingDocument(draft, source, readMembership);
  if (!result.success || !isFrozenSnapshot(source)) return result;
  const cell = freezeSnapshot(
    shareEqualDocumentStructure(source, result.data, changedNetIds),
  );
  if (
    project &&
    hasValidatedCells(project) &&
    project.documents.includes(source)
  ) {
    const candidates = wireSources.get(project) ?? new WeakMap();
    candidates.set(cell, source);
    wireSources.set(project, candidates);
  }
  return { success: true as const, data: cell };
}

const wireFields: ReadonlySet<keyof SchematicDocument> = new Set([
  "revision",
  "sourceStatus",
  "nets",
  "routes",
  "junctions",
  "connectivityEvidence",
  "drawingOrder",
]);

/** A scalar routing-only edit preserves symbol dependencies and all other Cells.
 * Interface membership and hierarchical terminal references require the normal Project checks. */
export function installPreparedWireCell(
  project: CircuitProject,
  source: SchematicDocument,
  cell: SchematicDocument,
): CircuitProject | undefined {
  if (wireSources.get(project)?.get(cell) !== source) return undefined;
  const fields = Object.keys({
    ...source,
    ...cell,
  }) as (keyof SchematicDocument)[];
  if (fields.some((key) => !wireFields.has(key) && cell[key] !== source[key]))
    return undefined;
  if (fields.every((key) => key === "revision" || cell[key] === source[key]))
    return project;
  if (
    cell.revision !== source.revision + 1 ||
    source.instances.some(
      (instance) => instance.netlist?.binding?.kind === "subcircuit",
    ) ||
    source.netlist?.terminals.some(
      (terminal) => terminal.signal?.members.length,
    ) ||
    cell.nets.some((net) =>
      net.terminals.some((terminal) => terminal.memberId !== undefined),
    )
  )
    return undefined;
  const snapshot = freezeSnapshot({
    ...project,
    documents: project.documents.map((previous) =>
      previous === source ? cell : previous,
    ),
  });
  validatedSnapshots.add(snapshot);
  rememberValidatedCells(snapshot);
  return snapshot;
}

/** Validate an owned placement, including all cross-Cell constraints. */
export function validatePlacementProjectSnapshot(
  candidate: CircuitProject,
  previous: CircuitProject,
): ReturnType<typeof CircuitProjectSchema.safeParse> {
  return validateProjectCandidate(candidate, previous);
}

/** Fully validate incoming models; reuse only immutable snapshots owned here. */
export function validateProjectSnapshot(
  input: unknown,
  previous?: CircuitProject,
): ReturnType<typeof CircuitProjectSchema.safeParse> {
  if (
    typeof input === "object" &&
    input !== null &&
    validatedSnapshots.has(input as CircuitProject)
  )
    return { success: true, data: input as CircuitProject };
  const known =
    typeof input === "object" && input !== null
      ? validatedResults.get(input as CircuitProject)
      : undefined;
  if (known && known.source === JSON.stringify(input)) {
    if (!known.snapshot) {
      const share = Boolean(previous && validatedSnapshots.has(previous));
      known.snapshot = freezeSnapshot(
        share
          ? detachAndShareProjectStructure(previous!, input as CircuitProject)
          : structuredClone(input as CircuitProject),
      );
      if (share) recordSharedSnapshot(known.snapshot, previous!);
    }
    const project = known.snapshot;
    validatedSnapshots.add(project);
    return { success: true, data: project };
  }
  return validateProjectCandidate(input, previous);
}

function validateProjectCandidate(
  input: unknown,
  previous?: CircuitProject,
): ReturnType<typeof CircuitProjectSchema.safeParse> {
  const retained =
    previous && hasValidatedCells(previous)
      ? safeParseWithRetainedCells(input, previous)
      : undefined;
  // Reject with the canonical paths and diagnostic order, including schema
  // failures where the retained-Cell alternative appears in a union error.
  const result = retained?.success
    ? retained
    : CircuitProjectSchema.safeParse(input);
  if (!result.success) return result;
  const share = Boolean(
    previous &&
    (validatedSnapshots.has(previous) ||
      (previous === input && isFrozenSnapshot(previous))),
  );
  const project = freezeSnapshot(
    share ? shareEqualProjectStructure(previous!, result.data) : result.data,
  );
  if (share) recordSharedSnapshot(project, previous!);
  validatedSnapshots.add(project);
  rememberValidatedCells(project);
  return { success: true, data: project };
}

/** Reuse equal immutable facts without revalidating the same owned result. */
export function shareProjectSnapshot(
  before: CircuitProject,
  after: CircuitProject,
): CircuitProject {
  const validated = parseProjectSnapshot(after, before);
  if (
    !validatedSnapshots.has(before) ||
    sharedSnapshots.get(validated)?.has(before)
  )
    return validated;
  const project = freezeSnapshot(shareEqualProjectStructure(before, validated));
  validatedSnapshots.add(project);
  recordSharedSnapshot(project, before);
  if (hasValidatedCells(before) && hasValidatedCells(validated)) {
    rememberValidatedCells(project);
  }
  return project;
}

/** History restores validated content with fresh live revision numbers. */
export function restoreProjectSnapshot(
  retained: CircuitProject,
  structureRevision: number,
  documentRevision: (document: SchematicDocument) => number,
): CircuitProject {
  const source = parseProjectSnapshot(retained);
  const documents = source.documents.map((document) => {
    const revision = documentRevision(document);
    if (revision === document.revision) return document;
    const restored = { ...document, revision };
    restoredContent.set(restored, documentContentSource(document));
    return restored;
  });
  const next = { ...source, documents, structureRevision };
  // The source owns every field except the revisions. Delegate invalid values
  // to the full schema so callers receive the original paths and diagnostics.
  if (
    !CircuitProjectSchema.shape.structureRevision.safeParse(structureRevision)
      .success ||
    documents.some(
      (doc) =>
        !SchematicDocumentSchema.shape.revision.safeParse(doc.revision).success,
    )
  )
    return parseProjectSnapshot(next, source);
  const snapshot = freezeSnapshot(next);
  restoredProjects.set(snapshot, restoredProjects.get(source) ?? source);
  validatedSnapshots.add(snapshot);
  if (hasValidatedCells(source)) {
    rememberValidatedCells(snapshot);
  }
  return snapshot;
}

export function parseProjectSnapshot(
  input: unknown,
  previous?: CircuitProject,
): CircuitProject {
  const result = validateProjectSnapshot(input, previous);
  if (!result.success) throw result.error;
  return result.data;
}

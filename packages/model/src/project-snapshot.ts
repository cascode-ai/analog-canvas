import { CircuitProjectSchema } from "./schema/project.js";
import { SchematicDocumentSchema } from "./schema/document.js";
import { freezeSnapshot, isFrozenSnapshot } from "./immutable-snapshot.js";
import type { CircuitProject, SchematicDocument } from "./schema/types.js";
import { shareEqualProjectStructure } from "./snapshot-structural-sharing.js";

const validatedSnapshots = new WeakSet<CircuitProject>();
const restoredContent = new WeakMap<SchematicDocument, SchematicDocument>();

/** The immutable document whose content history restored, apart from revision. */
export function documentContentSource(
  document: SchematicDocument,
): SchematicDocument {
  return restoredContent.get(document) ?? document;
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
      const detached = structuredClone(input as CircuitProject);
      known.snapshot = freezeSnapshot(
        previous && validatedSnapshots.has(previous)
          ? shareEqualProjectStructure(previous, detached)
          : detached,
      );
    }
    const project = known.snapshot;
    validatedSnapshots.add(project);
    return { success: true, data: project };
  }
  const result = CircuitProjectSchema.safeParse(input);
  if (!result.success) return result;
  const project = freezeSnapshot(
    previous &&
      (validatedSnapshots.has(previous) ||
        (previous === input && isFrozenSnapshot(previous)))
      ? shareEqualProjectStructure(previous, result.data)
      : result.data,
  );
  validatedSnapshots.add(project);
  return { success: true, data: project };
}

/** Reuse equal immutable facts without revalidating the same owned result. */
export function shareProjectSnapshot(
  before: CircuitProject,
  after: CircuitProject,
): CircuitProject {
  const validated = parseProjectSnapshot(after, before);
  if (!validatedSnapshots.has(before)) return validated;
  const project = freezeSnapshot(shareEqualProjectStructure(before, validated));
  validatedSnapshots.add(project);
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
  validatedSnapshots.add(snapshot);
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

/**
 * How many authored objects make a circuit worth protecting. Below this the
 * user is sketching throwaways: no leave prompt, no blocked refresh, no
 * startup recovery banner.
 */
export const MEANINGFUL_CONTENT_MIN_OBJECTS = 3;

interface CountableDocument {
  readonly instances?: readonly unknown[];
  readonly routes?: readonly unknown[];
  readonly drafting?: { readonly objects?: readonly unknown[] } | undefined;
}

interface CountableProject {
  readonly documents?: readonly CountableDocument[];
}

/**
 * Count user-authored objects: placed devices, drawn wires, and drafting
 * objects. Junctions and annotations ride along with these, so counting them
 * too would inflate one resistor into several "objects".
 */
export function authoredObjectCount(project: CountableProject): number {
  return (project.documents ?? []).reduce(
    (total, document) =>
      total +
      (document.instances?.length ?? 0) +
      (document.routes?.length ?? 0) +
      (document.drafting?.objects?.length ?? 0),
    0,
  );
}

export function projectHasMeaningfulContent(
  project: CountableProject,
): boolean {
  return authoredObjectCount(project) >= MEANINGFUL_CONTENT_MIN_OBJECTS;
}

/** The same threshold for a serialized snapshot, tolerant of bad text. */
export function projectTextHasMeaningfulContent(projectText: string): boolean {
  try {
    return projectHasMeaningfulContent(
      JSON.parse(projectText) as CountableProject,
    );
  } catch {
    return false;
  }
}

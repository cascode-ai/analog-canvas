import { CircuitProjectSchema } from "./schema/project.js";
import { freezeSnapshot, isFrozenSnapshot } from "./immutable-snapshot.js";
import type { CircuitProject } from "./schema/types.js";
import { shareEqualProjectStructure } from "./snapshot-structural-sharing.js";

const validatedSnapshots = new WeakSet<CircuitProject>();
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

export function parseProjectSnapshot(
  input: unknown,
  previous?: CircuitProject,
): CircuitProject {
  const result = validateProjectSnapshot(input, previous);
  if (!result.success) throw result.error;
  return result.data;
}

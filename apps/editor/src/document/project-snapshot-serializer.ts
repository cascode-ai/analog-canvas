import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

/** Browser-session computation cache, ONLY for immutable committed snapshots.
 * Public file serialization remains uncached for callers with mutable input.
 * Identity, not project ID or document revision, includes every Cell, symbol
 * and project-level change. Bounds prevent retained undo generations growing
 * without limit; misses always use the canonical validating serializer. */
export function createProjectSnapshotSerializer(
  serialize: (project: CircuitProject) => string = serializeProject,
  limits = { entries: 16, bytes: 16 * 1024 * 1024 },
) {
  const texts = new Map<CircuitProject, string>();
  let bytes = 0;
  const remove = (project: CircuitProject) => {
    const text = texts.get(project);
    if (text === undefined) return;
    bytes -= text.length * 2;
    texts.delete(project);
  };
  return {
    serialize(project: CircuitProject): string {
      const cached = texts.get(project);
      if (cached !== undefined) {
        texts.delete(project);
        texts.set(project, cached);
        return cached;
      }
      // A failure must neither poison the cache nor change recovery reporting.
      const text = serialize(project);
      const size = text.length * 2;
      if (limits.entries > 0 && size <= limits.bytes) {
        while (texts.size >= limits.entries || bytes + size > limits.bytes)
          remove(texts.keys().next().value!);
        texts.set(project, text);
        bytes += size;
      }
      return text;
    },
    /** Drop closed tabs and older snapshots when the live workspace is saved. */
    retain(projects: readonly CircuitProject[]): void {
      const live = new Set(projects);
      for (const project of texts.keys())
        if (!live.has(project)) remove(project);
    },
  };
}

import { buildProjectConnectivityIndex, deriveCrossings } from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

/** Only immutable editor snapshots and their immutable symbol contexts enter.
 * Weak keys release closed tabs and undo snapshots without a tab-count limit.
 * Public derivation functions remain uncached for mutable callers. */
export function createEditorSnapshotDerivedCache() {
  const projects = new WeakMap<
    CircuitProject,
    WeakMap<SymbolResolver, ReturnType<typeof buildProjectConnectivityIndex>>
  >();
  const documents = new WeakMap<
    SchematicDocument,
    WeakMap<SymbolResolver, ReturnType<typeof deriveCrossings>>
  >();
  return {
    connectivity(project: CircuitProject, resolver: SymbolResolver) {
      let contexts = projects.get(project);
      const cached = contexts?.get(resolver);
      if (cached) return cached;
      const result = buildProjectConnectivityIndex(project, resolver);
      if (!contexts) projects.set(project, (contexts = new WeakMap()));
      contexts.set(resolver, result);
      return result;
    },
    crossings(document: SchematicDocument, resolver: SymbolResolver) {
      let contexts = documents.get(document);
      const cached = contexts?.get(resolver);
      if (cached) return cached;
      const result = deriveCrossings(document, resolver);
      if (!contexts) documents.set(document, (contexts = new WeakMap()));
      contexts.set(resolver, result);
      return result;
    },
  };
}
export const editorSnapshotDerived = createEditorSnapshotDerivedCache();

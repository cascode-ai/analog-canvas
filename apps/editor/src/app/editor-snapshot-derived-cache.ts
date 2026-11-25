import {
  buildProjectConnectivityIndex,
  cachedDocumentConnectivityIndex,
  deriveCrossings,
  updateCommittedCrossings,
} from "@icm/derived";
import type {
  CommittedCrossingSnapshot,
  ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { documentContentSource } from "@icm/model";
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
    WeakMap<SymbolResolver, Pick<CommittedCrossingSnapshot, "crossings">>
  >();
  let previous: WeakRef<CommittedCrossingSnapshot> | undefined;
  return {
    connectivity(project: CircuitProject, resolver: SymbolResolver) {
      let contexts = projects.get(project);
      const cached = contexts?.get(resolver);
      if (cached) return cached;
      const result = buildProjectConnectivityIndex(project, resolver, {
        reuseRestoredContent: true,
      });
      if (!contexts) projects.set(project, (contexts = new WeakMap()));
      contexts.set(resolver, result);
      return result;
    },
    crossings(
      document: SchematicDocument,
      resolver: SymbolResolver,
      geometry?: ResolvedDocumentRoutingGeometry,
    ) {
      const content = documentContentSource(document);
      let contexts = documents.get(content);
      const cached = contexts?.get(resolver);
      if (cached) return cached.crossings;
      const prior = previous?.deref();
      const index = cachedDocumentConnectivityIndex(document, resolver);
      // An explicitly supplied geometry can belong to an editing preview.
      const canonical =
        index && index.routingGeometry === geometry ? index : undefined;
      const crossings =
        canonical && prior?.document.id === document.id
          ? updateCommittedCrossings(document, resolver, canonical, prior)
          : deriveCrossings(document, resolver, geometry);
      const snapshot = canonical && {
        document,
        resolver,
        geometry: canonical.routingGeometry,
        crossings,
      };
      if (snapshot) previous = new WeakRef(snapshot);
      if (!contexts) documents.set(content, (contexts = new WeakMap()));
      contexts.set(resolver, snapshot ?? { crossings });
      return crossings;
    },
  };
}
export const editorSnapshotDerived = createEditorSnapshotDerivedCache();

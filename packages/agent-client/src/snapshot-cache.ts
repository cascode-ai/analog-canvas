import type {
  AgentBootstrapSnapshot,
  AgentDiagnostic,
  AgentSessionSnapshot,
} from "@icm/agent-adapter";

/** One document's last complete Snapshot plus the response-level diagnostics. */
export interface CachedSnapshot {
  documentId: string;
  revision: number;
  snapshot: AgentSessionSnapshot;
  diagnostics: AgentDiagnostic[];
  fetchedAt: number;
  requestId: string;
  /**
   * A local transaction moved the revision after this Snapshot was fetched.
   * The next read must refetch instead of trusting this revision.
   */
  dirty: boolean;
}

export interface SnapshotSummary {
  projectId: string;
  documentId: string;
  documentName: string;
  revision: number;
  instanceCount: number;
  netCount: number;
  errors: number;
  warnings: number;
}

export interface BootstrapSummary {
  byteLength: number;
  projectId: string;
  projectName: string;
  documentId: string;
  documentName: string;
  revision: number;
  structureRevision: number;
  topDocumentId: string;
  documentCount: number;
  simulationFolderCount: number;
  instanceCount: number;
  netCount: number;
  routeCount: number;
  junctionCount: number;
  annotationCount: number;
  noConnectCount: number;
  draftingObjectCount: number;
  /** Bootstrap deliberately does not run full diagnostic derivation. */
  diagnosticsLoaded: false;
}

export function bootstrapSummary(
  context: AgentBootstrapSnapshot,
): BootstrapSummary {
  return {
    byteLength: context.byteLength,
    projectId: context.project.id,
    projectName: context.project.name,
    documentId: context.document.id,
    documentName: context.document.name,
    revision: context.document.revision,
    structureRevision: context.project.structureRevision,
    topDocumentId: context.project.topDocumentId,
    documentCount: context.project.documents.length,
    simulationFolderCount: context.project.simulationFolderCount,
    instanceCount: context.document.instanceCount,
    netCount: context.document.netCount,
    routeCount: context.document.routeCount,
    junctionCount: context.document.junctionCount,
    annotationCount: context.document.annotationCount,
    noConnectCount: context.document.noConnectCount,
    draftingObjectCount: context.document.draftingObjectCount,
    diagnosticsLoaded: false,
  };
}

/** Rolling-deploy fallback when an older host answers a bootstrap request with a full Snapshot. */
export function bootstrapFromFullSnapshot(
  snapshot: AgentSessionSnapshot,
): AgentBootstrapSnapshot {
  const current = snapshot.document;
  return {
    snapshotVersion: snapshot.snapshotVersion,
    // This fallback really transferred the full payload, so report that cost.
    byteLength: snapshot.byteLength,
    project: {
      id: snapshot.project.id,
      name: snapshot.project.name,
      structureRevision: snapshot.project.structureRevision,
      topDocumentId: snapshot.project.topDocumentId,
      simulationFolderCount: snapshot.project.simulationFolders.length,
      documents: snapshot.project.documents.map((document) => ({
        id: document.id,
        name: document.name,
        revision: document.id === current.id ? current.revision : 0,
        instanceCount: document.instanceCount,
        netCount: document.netCount,
      })),
    },
    document: {
      id: current.id,
      name: current.name,
      revision: current.revision,
      instanceCount: current.instances.length,
      netCount: current.nets.length,
      routeCount: current.routes.length,
      junctionCount: current.junctions.length,
      annotationCount: current.annotations.length,
      noConnectCount: current.noConnects.length,
      draftingObjectCount: current.drafting.objects.length,
    },
  };
}

export function countDiagnostics(diagnostics: readonly AgentDiagnostic[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    if (diagnostic.severity === "warning") warnings += 1;
  }
  return { errors, warnings };
}

export function snapshotSummary(entry: CachedSnapshot): SnapshotSummary {
  const { errors, warnings } = countDiagnostics(entry.diagnostics);
  return {
    projectId: entry.snapshot.project.id,
    documentId: entry.snapshot.document.id,
    documentName: entry.snapshot.document.name,
    revision: entry.revision,
    instanceCount: entry.snapshot.document.instances.length,
    netCount: entry.snapshot.document.nets.length,
    errors,
    warnings,
  };
}

interface ObjectCollection {
  ids: string[];
  identity: (id: string) => string;
}

function documentCollections(
  snapshot: AgentSessionSnapshot,
): Record<string, ObjectCollection> {
  const document = snapshot.document;
  const instances = new Map(
    document.instances.map((i) => [i.id, JSON.stringify(i)]),
  );
  const nets = new Map(document.nets.map((n) => [n.id, JSON.stringify(n)]));
  const routes = new Map(document.routes.map((r) => [r.id, JSON.stringify(r)]));
  const junctions = new Map(
    document.junctions.map((j) => [j.id, JSON.stringify(j)]),
  );
  const annotations = new Map(
    document.annotations.map((a) => [a.id, JSON.stringify(a)]),
  );
  const noConnects = new Map(
    document.noConnects.map((n) => [n.id, JSON.stringify(n)]),
  );
  const drafting = new Map(
    document.drafting.objects.map((o) => [
      o.object.id,
      JSON.stringify(o.object),
    ]),
  );
  const collection = (map: Map<string, string>): ObjectCollection => ({
    ids: [...map.keys()],
    identity: (id: string) => map.get(id) ?? "",
  });
  return {
    instances: collection(instances),
    nets: collection(nets),
    routes: collection(routes),
    junctions: collection(junctions),
    annotations: collection(annotations),
    noConnects: collection(noConnects),
    drafting: collection(drafting),
  };
}

/**
 * Object IDs whose presence or content differs between two Snapshots of the
 * same document. Used for the compact `STATE_CHANGED`/`verify` reports; it is
 * a diff of facts, not a second connectivity engine.
 */
export function changedObjectIds(
  before: AgentSessionSnapshot,
  after: AgentSessionSnapshot,
): string[] {
  const beforeCollections = documentCollections(before);
  const afterCollections = documentCollections(after);
  const changed = new Set<string>();
  for (const key of Object.keys(beforeCollections)) {
    const b = beforeCollections[key]!;
    const a = afterCollections[key]!;
    for (const id of b.ids) {
      if (!a.ids.includes(id) || a.identity(id) !== b.identity(id)) {
        changed.add(id);
      }
    }
    for (const id of a.ids) {
      if (!b.ids.includes(id)) changed.add(id);
    }
  }
  return [...changed].sort();
}

export class SnapshotCache {
  private readonly entries = new Map<string, CachedSnapshot>();

  get(documentId: string): CachedSnapshot | null {
    return this.entries.get(documentId) ?? null;
  }

  set(entry: CachedSnapshot): void {
    this.entries.set(entry.documentId, { ...entry, dirty: false });
  }

  invalidate(documentId: string): void {
    this.entries.delete(documentId);
  }

  clear(): void {
    this.entries.clear();
  }

  documents(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Record that a committed transaction moved the revision; the cached
   * Snapshot stays readable for name resolution but its revision must not be
   * used as `expectedRevision` and the next verify must refetch.
   */
  markDirty(documentId: string, revision: number): void {
    const entry = this.entries.get(documentId);
    if (entry) {
      entry.revision = revision;
      entry.dirty = true;
    }
  }

  summary(documentId: string): SnapshotSummary | null {
    const entry = this.entries.get(documentId);
    return entry ? snapshotSummary(entry) : null;
  }
}

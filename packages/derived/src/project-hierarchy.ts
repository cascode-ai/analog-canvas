import type { CircuitProject, HierarchyFrame } from "@icm/model";

interface CellOccurrence {
  rootDocumentId: string;
  documentId: string;
  path: readonly HierarchyFrame[];
}

const COUNT_LIMIT = 1_000_000;

/** Shared structural calls, independent of resolved Symbols, Pins or wiring. */
export function projectHierarchyCalls(
  project: CircuitProject,
): HierarchyFrame[] {
  const documentIds = new Set(project.documents.map((cell) => cell.id));
  const calls: HierarchyFrame[] = [];
  for (const parent of project.documents) {
    for (const instance of parent.instances) {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind === "subcircuit" &&
        documentIds.has(binding.childDocumentId)
      ) {
        calls.push({
          parentDocumentId: parent.id,
          instanceId: instance.id,
          childDocumentId: binding.childDocumentId,
        });
      }
    }
  }
  return calls;
}

/** Structural calls include unwired Cells; electrical edges do not define the tree. */
export function buildProjectHierarchy(project: CircuitProject) {
  const documents = new Map(project.documents.map((cell) => [cell.id, cell]));
  const children = new Map<string, HierarchyFrame[]>();
  const parents = new Map<string, HierarchyFrame[]>();
  for (const frame of projectHierarchyCalls(project)) {
    const below = children.get(frame.parentDocumentId) ?? [];
    below.push(frame);
    children.set(frame.parentDocumentId, below);
    const above = parents.get(frame.childDocumentId) ?? [];
    above.push(frame);
    parents.set(frame.childDocumentId, above);
  }
  const reachable = new Set<string>();
  const pending = [project.topDocumentId];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const frame of children.get(id) ?? [])
      pending.push(frame.childDocumentId);
  }
  const detached = project.documents.filter((cell) => !reachable.has(cell.id));
  const roots = [
    project.topDocumentId,
    ...detached
      .filter(
        (cell) =>
          !(parents.get(cell.id) ?? []).some(
            (frame) => !reachable.has(frame.parentDocumentId),
          ),
      )
      .map((cell) => cell.id),
  ];
  const rootIds = new Set(roots);
  const counts = new Map<string, number>();
  function count(id: string, visiting = new Set<string>()): number {
    if (!documents.has(id) || visiting.has(id)) return 0;
    const cached = counts.get(id);
    if (cached !== undefined) return cached;
    visiting.add(id);
    let total = rootIds.has(id) ? 1 : 0;
    for (const frame of parents.get(id) ?? [])
      total = Math.min(
        COUNT_LIMIT,
        total + count(frame.parentDocumentId, visiting),
      );
    visiting.delete(id);
    counts.set(id, total);
    return total;
  }
  function usage(documentId: string, limit = 50) {
    const total = Math.max(
      0,
      count(documentId) -
        (rootIds.has(documentId) && documentId !== project.topDocumentId
          ? 1
          : 0),
    );
    const occurrences: CellOccurrence[] = [];
    const canReach = new Set<string>();
    const ancestors = [documentId];
    while (ancestors.length) {
      const id = ancestors.pop()!;
      if (canReach.has(id)) continue;
      canReach.add(id);
      for (const frame of parents.get(id) ?? [])
        ancestors.push(frame.parentDocumentId);
    }
    const bound = Number.isFinite(limit)
      ? Math.max(0, Math.min(500, Math.floor(limit)))
      : 50;
    function visit(
      id: string,
      rootDocumentId: string,
      path: HierarchyFrame[],
      ancestry: ReadonlySet<string>,
    ) {
      if (occurrences.length >= bound || !canReach.has(id)) return;
      if (id === documentId) {
        if (path.length || rootDocumentId === project.topDocumentId)
          occurrences.push({ rootDocumentId, documentId, path });
        return;
      }
      for (const frame of children.get(id) ?? []) {
        if (occurrences.length >= bound) break;
        if (!ancestry.has(frame.childDocumentId))
          visit(
            frame.childDocumentId,
            rootDocumentId,
            [...path, frame],
            new Set([...ancestry, frame.childDocumentId]),
          );
      }
    }
    for (const root of roots) visit(root, root, [], new Set([root]));
    return {
      total,
      atLeast: count(documentId) >= COUNT_LIMIT,
      occurrences,
      truncated: total > occurrences.length,
    };
  }
  return {
    roots,
    document: (id: string) => documents.get(id),
    children: (id: string): readonly HierarchyFrame[] => children.get(id) ?? [],
    usage,
  };
}

export type ProjectHierarchy = ReturnType<typeof buildProjectHierarchy>;

/** A removed call returns to its surviving parent, even if its Cell still exists. */
export function reconcileHierarchyPath(
  project: CircuitProject,
  activeDocumentId: string,
  path: readonly HierarchyFrame[],
) {
  const documents = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  let documentId = path[0]?.parentDocumentId ?? activeDocumentId;
  if (!documents.has(documentId))
    return { documentId: project.topDocumentId, path: [] };
  const valid: HierarchyFrame[] = [];
  for (const frame of path) {
    const binding = documents
      .get(documentId)
      ?.instances.find((instance) => instance.id === frame.instanceId)
      ?.netlist?.binding;
    if (
      frame.parentDocumentId !== documentId ||
      binding?.kind !== "subcircuit" ||
      binding.childDocumentId !== frame.childDocumentId ||
      !documents.has(frame.childDocumentId)
    )
      break;
    valid.push(frame);
    documentId = frame.childDocumentId;
  }
  return { documentId, path: valid };
}

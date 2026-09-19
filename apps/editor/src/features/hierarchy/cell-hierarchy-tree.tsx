import { useState } from "react";
import type { CircuitProject, HierarchyFrame } from "@icm/model";

type TreeProps = {
  project: CircuitProject;
  calls: readonly HierarchyFrame[];
  onOpen(documentId: string, path: readonly HierarchyFrame[]): void;
};

/** Expand occurrences lazily; repeated masters never imply a shared path. */
function Branch({
  project,
  calls,
  onOpen,
  documentId,
  path,
  label,
}: TreeProps & {
  documentId: string;
  path: readonly HierarchyFrame[];
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = calls.filter((call) => call.parentDocumentId === documentId);
  const cyclic = path.some((frame) => frame.parentDocumentId === documentId);
  const expandable = children.length > 0 && !cyclic && path.length < 32;
  return (
    <li>
      <div className="cell-hierarchy-row">
        {expandable ? (
          <button
            type="button"
            aria-label={`Expand ${label}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "−" : "+"}
          </button>
        ) : (
          <span aria-hidden="true">·</span>
        )}
        <button
          type="button"
          disabled={cyclic}
          onClick={() => onOpen(documentId, path)}
        >
          {label}
        </button>
        {cyclic ? <small>Cycle</small> : null}
      </div>
      {expanded && expandable ? (
        <ul>
          {children.map((frame) => {
            const parent = project.documents.find(
              (item) => item.id === documentId,
            );
            const instance = parent?.instances.find(
              (item) => item.id === frame.instanceId,
            );
            const child = project.documents.find(
              (item) => item.id === frame.childDocumentId,
            );
            return (
              <Branch
                key={frame.instanceId}
                project={project}
                calls={calls}
                onOpen={onOpen}
                documentId={frame.childDocumentId}
                path={[...path, frame]}
                label={`${instance?.reference ?? frame.instanceId} · ${child?.name ?? frame.childDocumentId}`}
              />
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function CellHierarchyTree(props: TreeProps) {
  const top = props.project.documents.find(
    (item) => item.id === props.project.topDocumentId,
  );
  return top ? (
    <details className="cell-hierarchy-tree">
      <summary>Hierarchy</summary>
      <ul>
        <Branch
          key={top.id}
          {...props}
          documentId={top.id}
          path={[]}
          label={top.name}
        />
      </ul>
    </details>
  ) : null;
}

export function documentsReachableFromTop(
  topId: string,
  calls: readonly HierarchyFrame[],
): Set<string> {
  const reached = new Set([topId]);
  const pending = [topId];
  while (pending.length) {
    const parentId = pending.pop()!;
    for (const call of calls)
      if (
        call.parentDocumentId === parentId &&
        !reached.has(call.childDocumentId)
      ) {
        reached.add(call.childDocumentId);
        pending.push(call.childDocumentId);
      }
  }
  return reached;
}

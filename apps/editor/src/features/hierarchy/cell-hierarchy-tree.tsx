import { useMemo, useState } from "react";
import type { CircuitProject, HierarchyFrame } from "@icm/model";
import { buildProjectHierarchy, type ProjectHierarchy } from "@icm/derived";
import { hierarchyPathKey, occurrenceLabel } from "./project-hierarchy";
import { cellPlacementIssue } from "./project-structure-commands";

type TreeProps = {
  project: CircuitProject;
  activeDocumentId: string;
  path: readonly HierarchyFrame[];
  expandedKeys: readonly string[];
  onExpandedKeysChange(keys: string[]): void;
  onOpen(documentId: string, path: readonly HierarchyFrame[]): void;
  onDefinition(documentId: string): void;
  onProperties(documentId: string): void;
  onPlace(documentId: string): void;
};

function Branch(
  props: TreeProps & {
    hierarchy: ProjectHierarchy;
    rootId: string;
    documentId: string;
    branchPath: readonly HierarchyFrame[];
    onUses(id: string): void;
  },
) {
  const { project, hierarchy, rootId, documentId, branchPath } = props;
  const cell = hierarchy.document(documentId);
  if (!cell) return null;
  const key = hierarchyPathKey(rootId, branchPath);
  const expanded = props.expandedKeys.includes(key);
  const activeKey = hierarchyPathKey(
    props.path[0]?.parentDocumentId ?? props.activeDocumentId,
    props.path,
  );
  const children = hierarchy.children(documentId);
  const cycle = branchPath.some(
    (frame) => frame.parentDocumentId === documentId,
  );
  const frame = branchPath.at(-1);
  const instance =
    frame &&
    hierarchy
      .document(frame.parentDocumentId)
      ?.instances.find((item) => item.id === frame.instanceId);
  const label = frame
    ? `${instance?.reference ?? frame.instanceId}: ${cell.name}`
    : documentId === project.topDocumentId
      ? `Top · ${cell.name}`
      : cell.name;
  const issue = cellPlacementIssue(project, props.activeDocumentId, documentId);
  return (
    <li>
      <div
        className="hierarchy-node"
        data-active={key === activeKey || undefined}
      >
        {children.length && !cycle ? (
          <button
            type="button"
            className="hierarchy-expand"
            aria-label={`Expand ${label}`}
            aria-expanded={expanded}
            onClick={() =>
              props.onExpandedKeysChange(
                expanded
                  ? props.expandedKeys.filter((item) => item !== key)
                  : [...props.expandedKeys, key],
              )
            }
          >
            {expanded ? "−" : "+"}
          </button>
        ) : (
          <span className="hierarchy-expand" aria-hidden="true">
            ·
          </span>
        )}
        <button
          type="button"
          className="hierarchy-node-label"
          title={occurrenceLabel(project, rootId, branchPath)}
          aria-current={key === activeKey ? "page" : undefined}
          disabled={cycle}
          onClick={() => props.onOpen(documentId, branchPath)}
        >
          {label}
        </button>
        <details
          className="hierarchy-node-menu"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button")
            )
              event.currentTarget.open = false;
          }}
        >
          <summary aria-label={`Actions for ${label}`}>⋯</summary>
          <div>
            <button
              type="button"
              onClick={() => props.onDefinition(documentId)}
            >
              Open definition
            </button>
            <button
              type="button"
              onClick={() => props.onProperties(documentId)}
            >
              Cell properties…
            </button>
            <button type="button" onClick={() => props.onUses(documentId)}>
              Show uses
            </button>
            <button
              type="button"
              disabled={Boolean(issue)}
              title={issue ?? undefined}
              onClick={() => props.onPlace(documentId)}
            >
              Place in current Cell
            </button>
          </div>
        </details>
      </div>
      {expanded && !cycle ? (
        <ul>
          {children.map((child) => (
            <Branch
              {...props}
              key={child.instanceId}
              documentId={child.childDocumentId}
              branchPath={[...branchPath, child]}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function CellHierarchyTree(
  props: TreeProps & { open: boolean; onNewChild(): void; onExternal(): void },
) {
  const hierarchy = useMemo(
    () => buildProjectHierarchy(props.project),
    [props.project],
  );
  const [usesId, setUsesId] = useState<string | null>(null);
  const usage = hierarchy.usage(usesId ?? props.activeDocumentId);
  const rootProps = { ...props, hierarchy, onUses: setUsesId };
  return (
    <aside
      className={`shapes-panel hierarchy-panel${props.open ? "" : " collapsed"}`}
      aria-label="Circuit hierarchy"
      hidden={!props.open}
    >
      <header>
        <h2>Circuit hierarchy</h2>
        <button type="button" onClick={props.onNewChild}>
          New child
        </button>
      </header>
      <ul className="hierarchy-tree" aria-label="Cell occurrences">
        <Branch
          {...rootProps}
          rootId={props.project.topDocumentId}
          documentId={props.project.topDocumentId}
          branchPath={[]}
        />
      </ul>
      {hierarchy.roots.length > 1 ? (
        <section aria-label="Not connected to Top">
          <h3>Not connected to Top</h3>
          <ul className="hierarchy-tree">
            {hierarchy.roots.slice(1).map((id) => (
              <Branch
                {...rootProps}
                key={id}
                rootId={id}
                documentId={id}
                branchPath={[]}
              />
            ))}
          </ul>
        </section>
      ) : null}
      <section className="hierarchy-scope" aria-label="Shared Cell definition">
        <strong>
          {hierarchy.document(usesId ?? props.activeDocumentId)?.name}
        </strong>
        <p>Editing this definition changes all its uses.</p>
        <button
          type="button"
          onClick={() => setUsesId(usesId ? null : props.activeDocumentId)}
        >
          {usesId
            ? "Close uses"
            : `Show uses (${usage.total}${usage.atLeast ? "+" : ""})`}
        </button>
        {usesId ? (
          <ul aria-label="Cell uses">
            {usage.occurrences.map((use) => (
              <li key={hierarchyPathKey(use.rootDocumentId, use.path)}>
                <button
                  type="button"
                  onClick={() => props.onOpen(use.documentId, use.path)}
                >
                  {occurrenceLabel(props.project, use.rootDocumentId, use.path)}
                </button>
              </li>
            ))}
            {!usage.total ? (
              <li>
                No callers. This definition can be placed in another Cell.
              </li>
            ) : null}
            {usage.truncated ? (
              <li>
                Showing the first {usage.occurrences.length} uses. Expand the
                tree to navigate others.
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>
      <footer>
        <button type="button" onClick={props.onExternal}>
          External Circuits…
        </button>
      </footer>
    </aside>
  );
}

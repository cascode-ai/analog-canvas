import { useEffect, useMemo, useState } from "react";
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
    useCounts: ReadonlyMap<string, number>;
    rootId: string;
    documentId: string;
    branchPath: readonly HierarchyFrame[];
    onUses(id: string): void;
  },
) {
  const { project, hierarchy, rootId, documentId, branchPath } = props;
  const [menuOpen, setMenuOpen] = useState(false);
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
  const uses = props.useCounts.get(documentId) ?? 0;
  // Placement is checked only when the menu that offers it is open.
  const issue = menuOpen
    ? cellPlacementIssue(project, props.activeDocumentId, documentId)
    : undefined;
  const run = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };
  return (
    <li>
      <div
        className="hierarchy-node"
        data-active={key === activeKey || undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(true);
        }}
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
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="hierarchy-expand" aria-hidden="true" />
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
        {uses > 1 ? (
          <span
            className="hierarchy-uses"
            title={`${cell.name} has ${uses} uses; editing it changes all of them`}
          >
            ×{uses}
          </span>
        ) : null}
        <details
          className="hierarchy-node-menu"
          open={menuOpen}
          onToggle={(event) => setMenuOpen(event.currentTarget.open)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setMenuOpen(false);
          }}
        >
          <summary aria-label={`Actions for ${label}`}>⋯</summary>
          {menuOpen ? (
            <div>
              <button
                type="button"
                onClick={run(() => props.onDefinition(documentId))}
              >
                Open definition
              </button>
              <button
                type="button"
                onClick={run(() => props.onProperties(documentId))}
              >
                Cell properties…
              </button>
              <button
                type="button"
                onClick={run(() => props.onUses(documentId))}
              >
                Show uses
              </button>
              <button
                type="button"
                disabled={Boolean(issue)}
                title={issue ?? undefined}
                onClick={run(() => props.onPlace(documentId))}
              >
                Place in current Cell
              </button>
            </div>
          ) : null}
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
  const useCounts = useMemo(
    () =>
      new Map(
        props.project.documents.map((cell) => [
          cell.id,
          hierarchy.usage(cell.id, 0).total,
        ]),
      ),
    [hierarchy, props.project],
  );
  const [usesId, setUsesId] = useState<string | null>(null);
  const otherRoots = hierarchy.roots.slice(1);
  const activeRoot = props.path[0]?.parentDocumentId ?? props.activeDocumentId;
  const activeInOtherRoots = otherRoots.includes(activeRoot);
  const [otherRootsOpen, setOtherRootsOpen] = useState(activeInOtherRoots);
  useEffect(() => {
    if (activeInOtherRoots) setOtherRootsOpen(true);
  }, [activeInOtherRoots]);
  const rootProps = { ...props, hierarchy, useCounts, onUses: setUsesId };
  const usage = usesId ? hierarchy.usage(usesId) : null;
  return (
    <aside
      id="hierarchy-panel"
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
      {otherRoots.length ? (
        <details
          className="hierarchy-other-roots"
          open={otherRootsOpen}
          onToggle={(event) => setOtherRootsOpen(event.currentTarget.open)}
        >
          <summary title="Cells that Top does not use, such as testbenches or drafts">
            Other roots ({otherRoots.length})
          </summary>
          <ul className="hierarchy-tree">
            {otherRoots.map((id) => (
              <Branch
                {...rootProps}
                key={id}
                rootId={id}
                documentId={id}
                branchPath={[]}
              />
            ))}
          </ul>
        </details>
      ) : null}
      {usesId && usage ? (
        <section className="hierarchy-uses-list" aria-label="Cell uses">
          <header>
            <strong>
              Uses of {hierarchy.document(usesId)?.name ?? usesId} (
              {usage.total}
              {usage.atLeast ? "+" : ""})
            </strong>
            <button
              type="button"
              aria-label="Close uses"
              onClick={() => setUsesId(null)}
            >
              ×
            </button>
          </header>
          <ul>
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
        </section>
      ) : null}
      <footer>
        <button type="button" onClick={props.onExternal}>
          External Circuits…
        </button>
      </footer>
    </aside>
  );
}

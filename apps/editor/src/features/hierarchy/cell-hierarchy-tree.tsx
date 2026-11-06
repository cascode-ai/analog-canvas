import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CircuitProject, HierarchyFrame } from "@icm/model";
import { buildProjectHierarchy, type ProjectHierarchy } from "@icm/derived";
import { hierarchyPathKey, occurrenceLabel } from "./project-hierarchy";
import { cellPlacementIssue } from "./project-structure-commands";
import type { CellUse } from "./hierarchy-refactor";

/** What the tree asks of the editor; the editor owns every edit and refusal. */
export interface HierarchyTreeActions {
  open(documentId: string, path: readonly HierarchyFrame[]): void;
  openDefinition(documentId: string): void;
  properties(documentId: string): void;
  rename(documentId: string, name: string): void;
  newChild(documentId: string, path: readonly HierarchyFrame[]): void;
  /** Start placing a Cell in the open Cell; false when it is refused. */
  place(documentId: string): boolean;
  /** End a drag from the tree: place under the pointer, or cancel off canvas. */
  drop(clientX: number, clientY: number): void;
  setTop(documentId: string): void;
  remove(documentId: string): void;
  external(): void;
  /** Create an unplaced Cell and open it. */
  newCell(): void;
  /** Copy a Cell from another Cloud Project; absent where Cloud is not. */
  importCell?(): void;
  /** Give an occurrence's instance its own copy of its Cell. */
  makeUnique(use: CellUse): void;
  /** Switch an occurrence's instance to another Cell with the same Pins. */
  replace(use: CellUse): void;
  /** Put an occurrence's parts into its parent instead of the instance; the
   * parent then opens at `parentPath`. */
  flatten(use: CellUse, parentPath: readonly HierarchyFrame[]): void;
  notice(message: string): void;
}

export interface CellHierarchyTreeProps {
  project: CircuitProject;
  activeDocumentId: string;
  path: readonly HierarchyFrame[];
  expandedKeys: readonly string[];
  onExpandedKeysChange(keys: string[]): void;
  /** Instances selected on the canvas of the open Cell. */
  selectedInstanceIds: readonly string[];
  /** The row whose uses are listed under it, if any. */
  usesKey: string | null;
  onUsesKeyChange(key: string | null): void;
  open: boolean;
  actions: HierarchyTreeActions;
}

interface Row {
  key: string;
  rootId: string;
  documentId: string;
  path: readonly HierarchyFrame[];
  hasChildren: boolean;
  cycle: boolean;
}

interface Match {
  key: string;
  rootId: string;
  documentId: string;
  path: readonly HierarchyFrame[];
}

type IconName = "add" | "child" | "place" | "properties" | "collapse";

const DRAG_THRESHOLD = 5;
const INDENT = 14;

/** Occurrence rows in display order; collapsed rows hide their subtree. */
function visibleRows(
  hierarchy: ProjectHierarchy,
  rootId: string,
  expanded: ReadonlySet<string>,
): Row[] {
  const rows: Row[] = [];
  const visit = (documentId: string, path: readonly HierarchyFrame[]) => {
    const key = hierarchyPathKey(rootId, path);
    const cycle = path.some((frame) => frame.parentDocumentId === documentId);
    const children = cycle ? [] : hierarchy.children(documentId);
    rows.push({
      key,
      rootId,
      documentId,
      path,
      hasChildren: children.length > 0,
      cycle,
    });
    if (expanded.has(key))
      for (const child of children)
        visit(child.childDocumentId, [...path, child]);
  };
  visit(rootId, []);
  return rows;
}

function Icon({ name }: { name: IconName }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {name === "child" ? (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" {...stroke} />
          <path d="M8 5.5v5M5.5 8h5" {...stroke} />
        </>
      ) : null}
      {name === "place" ? (
        <path d="M8 2.5v7M5 6.5l3 3 3-3M3 10.5v3h10v-3" {...stroke} />
      ) : null}
      {name === "properties" ? (
        <>
          <path d="M2.5 5h11M2.5 11h11" {...stroke} />
          <circle cx="6" cy="5" r="1.7" {...stroke} fill="var(--icm-surface)" />
          <circle
            cx="10"
            cy="11"
            r="1.7"
            {...stroke}
            fill="var(--icm-surface)"
          />
        </>
      ) : null}
      {name === "add" ? <path d="M8 3v10M3 8h10" {...stroke} /> : null}
      {name === "collapse" ? (
        <>
          <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" {...stroke} />
          <path
            d="M2.5 10.5V4a1.5 1.5 0 0 1 1.5-1.5h6.5M7.2 9.25h4"
            {...stroke}
          />
        </>
      ) : null}
    </svg>
  );
}

/**
 * The hierarchy's one working surface. Every occurrence is a row: click opens
 * it, double-click or F2 renames its Cell, dragging it onto the canvas places
 * the Cell, and its row actions appear only where the pointer or focus is.
 */
export function CellHierarchyTree(props: CellHierarchyTreeProps) {
  const { project, actions } = props;
  const hierarchy = useMemo(() => buildProjectHierarchy(project), [project]);
  const useCounts = useMemo(
    () =>
      new Map(
        project.documents.map((cell) => [
          cell.id,
          hierarchy.usage(cell.id, 0).total,
        ]),
      ),
    [hierarchy, project],
  );
  const expanded = useMemo(
    () => new Set(props.expandedKeys),
    [props.expandedKeys],
  );
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number } | null>(
    null,
  );
  const treeRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const suppressClick = useRef(false);
  // A drag outlives the render that started it; it must reach the editor's
  // latest actions, which see the placement the drag itself began.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const topId = project.topDocumentId;
  // Every Cell nothing calls is a root. Top is only a badge on its Cell, and
  // roots keep the order they were first listed in, Top first: a Cell that
  // becomes a root later, as one a refactor leaves unused, joins at the end.
  // So switching Top or reshaping the hierarchy moves none of your rows.
  const rootOrder = useRef<string[]>([]);
  const roots = useMemo(() => {
    const called = new Set(
      project.documents.flatMap((cell) =>
        hierarchy.children(cell.id).map((frame) => frame.childDocumentId),
      ),
    );
    const listed = project.documents
      .map((cell) => cell.id)
      .filter((id) => hierarchy.roots.includes(id) && !called.has(id));
    if (!listed.length) return [topId];
    const kept = rootOrder.current.filter((id) => listed.includes(id));
    const added = listed.filter((id) => !kept.includes(id));
    if (!kept.length)
      added.sort((a, b) => Number(b === topId) - Number(a === topId));
    rootOrder.current = [...kept, ...added];
    return rootOrder.current;
  }, [hierarchy, project, topId]);
  const activeRoot = props.path[0]?.parentDocumentId ?? props.activeDocumentId;
  const activeKey = hierarchyPathKey(activeRoot, props.path);

  // A Cell instance selected on the canvas lights its row under the open one.
  const selectedFrames = hierarchy
    .children(props.activeDocumentId)
    .filter((frame) => props.selectedInstanceIds.includes(frame.instanceId));
  const selectedKeys = new Set(
    selectedFrames.map((frame) =>
      hierarchyPathKey(activeRoot, [...props.path, frame]),
    ),
  );
  useEffect(() => {
    if (selectedFrames.length && !expanded.has(activeKey))
      props.onExpandedKeysChange([...props.expandedKeys, activeKey]);
  }, [selectedFrames.length, activeKey]);

  useEffect(() => {
    treeRef.current
      ?.querySelector(`[data-key="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey, props.open]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".hierarchy-context-menu")
      )
        setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menu]);

  const name = (id: string) => hierarchy.document(id)?.name ?? id;
  const reference = (frame: HierarchyFrame) =>
    hierarchy
      .document(frame.parentDocumentId)
      ?.instances.find((item) => item.id === frame.instanceId)?.reference ??
    frame.instanceId;
  const usesOf = (documentId: string) => useCounts.get(documentId) ?? 0;
  const rowLabel = (row: Row) => {
    const frame = row.path.at(-1);
    if (frame) return `${reference(frame)}: ${name(row.documentId)}`;
    return row.documentId === topId
      ? `Top · ${name(row.documentId)}`
      : name(row.documentId);
  };

  const rows = roots.flatMap((id) => visibleRows(hierarchy, id, expanded));
  const tabKey = rows.some((row) => row.key === focusKey)
    ? focusKey
    : rows.some((row) => row.key === activeKey)
      ? activeKey
      : rows[0]?.key;

  const query = filter.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    const found: Match[] = [];
    const seen = new Set<string>();
    for (const cell of project.documents) {
      const cellMatch = cell.name.toLowerCase().includes(query);
      const occurrences = [
        ...(hierarchy.roots.includes(cell.id)
          ? [{ rootDocumentId: cell.id, path: [] as readonly HierarchyFrame[] }]
          : []),
        ...hierarchy.usage(cell.id, 50).occurrences,
      ];
      for (const use of occurrences) {
        const key = hierarchyPathKey(use.rootDocumentId, use.path);
        const last = use.path.at(-1);
        const referenceMatch =
          last && reference(last).toLowerCase().includes(query);
        if (seen.has(key) || !(cellMatch || referenceMatch)) continue;
        seen.add(key);
        found.push({
          key,
          rootId: use.rootDocumentId,
          documentId: cell.id,
          path: use.path,
        });
      }
    }
    return found.slice(0, 100);
  }, [query, hierarchy, project]);

  const focusRow = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() =>
      treeRef.current
        ?.querySelector<HTMLElement>(
          `[data-key="${CSS.escape(key)}"] .hierarchy-node-label`,
        )
        ?.focus(),
    );
  };
  const setRowExpanded = (row: Row, open: boolean) =>
    props.onExpandedKeysChange(
      open
        ? [...new Set([...props.expandedKeys, row.key])]
        : props.expandedKeys.filter((key) => key !== row.key),
    );
  const cellUseOf = (row: Row): CellUse => {
    const frame = row.path.at(-1)!;
    return { documentId: frame.parentDocumentId, instanceId: frame.instanceId };
  };
  const deleteRefusal = (row: Row) => {
    if (row.documentId === topId)
      return "Top cannot be deleted; set another Cell as Top first";
    const uses = usesOf(row.documentId);
    return uses > 0
      ? `${name(row.documentId)} has ${uses} use${uses === 1 ? "" : "s"}; delete those instances first`
      : undefined;
  };
  const remove = (row: Row) => {
    const refusal = deleteRefusal(row);
    if (refusal) actions.notice(refusal);
    else actions.remove(row.documentId);
  };
  const placementRefusal = (row: Row) =>
    cellPlacementIssue(project, props.activeDocumentId, row.documentId);
  const place = (row: Row) => {
    const issue = placementRefusal(row);
    if (issue) {
      actionsRef.current.notice(issue);
      return false;
    }
    return actionsRef.current.place(row.documentId);
  };
  const commitRename = (row: Row, value: string) => {
    setRenaming(null);
    const next = value.trim();
    if (next && next !== name(row.documentId))
      actions.rename(row.documentId, next);
    focusRow(row.key);
  };
  const collapseAll = () =>
    props.onExpandedKeysChange(
      props.path.map((_, index) =>
        hierarchyPathKey(activeRoot, props.path.slice(0, index)),
      ),
    );

  // Dragging a row past a few pixels starts placing its Cell; the canvas shows
  // the preview under the pointer and releasing there places it.
  const startDrag = (row: Row, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || row.cycle) return;
    const origin = { x: event.clientX, y: event.clientY };
    let dragging = false;
    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up, true);
      window.document.body.classList.remove("hierarchy-dragging");
    }
    function move(moveEvent: PointerEvent) {
      if (
        dragging ||
        Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) <
          DRAG_THRESHOLD
      )
        return;
      dragging = place(row);
      if (dragging) window.document.body.classList.add("hierarchy-dragging");
      else stop();
    }
    function up(upEvent: PointerEvent) {
      stop();
      if (!dragging) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      actionsRef.current.drop(upEvent.clientX, upEvent.clientY);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, true);
  };

  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("hierarchy-node-label")) return;
    const key = target.closest<HTMLElement>("[data-key]")?.dataset.key;
    const index = rows.findIndex((row) => row.key === key);
    const row = rows[index];
    if (!row) return;
    const goTo = (next: Row | undefined) => {
      if (next) focusRow(next.key);
    };
    switch (event.key) {
      case "ArrowDown":
        goTo(rows[index + 1]);
        break;
      case "ArrowUp":
        goTo(rows[index - 1]);
        break;
      case "Home":
        goTo(rows[0]);
        break;
      case "End":
        goTo(rows.at(-1));
        break;
      case "ArrowRight":
        if (row.hasChildren && !expanded.has(row.key))
          setRowExpanded(row, true);
        else if (row.hasChildren) goTo(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (row.hasChildren && expanded.has(row.key))
          setRowExpanded(row, false);
        else if (row.path.length)
          focusRow(hierarchyPathKey(row.rootId, row.path.slice(0, -1)));
        break;
      case "F2":
        setRenaming(row.key);
        break;
      case "Delete":
      case "Backspace":
        remove(row);
        break;
      case "ContextMenu": {
        const box = target.getBoundingClientRect();
        setMenu({ row, x: box.left + 24, y: box.bottom });
        break;
      }
      default:
        // Typing on a row starts filtering, as in a file explorer.
        if (
          event.key.length === 1 &&
          event.key !== " " &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          setFilter(event.key);
          filterRef.current?.focus();
          break;
        }
        return;
    }
    event.preventDefault();
  };

  const onFilterKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const first = event.currentTarget
      .closest(".hierarchy-panel")
      ?.querySelector<HTMLElement>(".hierarchy-match");
    if (event.key === "ArrowDown" && first) {
      event.preventDefault();
      first.focus();
    } else if (event.key === "Enter" && matches[0]) {
      event.preventDefault();
      actions.open(matches[0].documentId, matches[0].path);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFilter("");
      if (tabKey) focusRow(tabKey);
    }
  };
  const onMatchKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (event.key === "Escape") {
      event.preventDefault();
      filterRef.current?.focus();
      return;
    }
    if (!step) return;
    event.preventDefault();
    const sibling =
      step > 0
        ? event.currentTarget.nextElementSibling
        : event.currentTarget.previousElementSibling;
    if (sibling instanceof HTMLElement && sibling.matches(".hierarchy-match"))
      sibling.focus();
    else if (step < 0) filterRef.current?.focus();
  };

  const renderRow = (row: Row) => {
    const cellName = name(row.documentId);
    const frame = row.path.at(-1);
    const uses = usesOf(row.documentId);
    const isExpanded = expanded.has(row.key);
    const active = row.key === activeKey;
    const label = rowLabel(row);
    const usage =
      props.usesKey === row.key ? hierarchy.usage(row.documentId) : null;
    return (
      <Fragment key={row.key}>
        <div
          role="treeitem"
          aria-level={row.path.length + 1}
          aria-expanded={row.hasChildren ? isExpanded : undefined}
          aria-selected={active}
          className="hierarchy-node"
          data-key={row.key}
          data-active={active || undefined}
          data-selected={selectedKeys.has(row.key) || undefined}
          style={{ paddingLeft: 2 + row.path.length * INDENT }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ row, x: event.clientX, y: event.clientY });
          }}
        >
          {row.hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              className="hierarchy-expand"
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`}
              aria-expanded={isExpanded}
              onClick={() => setRowExpanded(row, !isExpanded)}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="hierarchy-expand" aria-hidden="true" />
          )}
          {renaming === row.key ? (
            <input
              className="hierarchy-rename"
              aria-label={`Rename ${cellName}`}
              defaultValue={cellName}
              title={
                uses > 1
                  ? `Renames the definition for all ${uses} uses`
                  : undefined
              }
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  commitRename(row, event.currentTarget.value);
                else if (event.key === "Escape") {
                  setRenaming(null);
                  focusRow(row.key);
                }
              }}
              onBlur={(event) => {
                if (renaming === row.key)
                  commitRename(row, event.currentTarget.value);
              }}
            />
          ) : (
            <button
              type="button"
              className="hierarchy-node-label"
              aria-label={label}
              tabIndex={row.key === tabKey ? 0 : -1}
              title={`${occurrenceLabel(project, row.rootId, row.path)}\nDouble-click to rename · drag onto the canvas to place`}
              aria-current={active ? "page" : undefined}
              disabled={row.cycle}
              onFocus={() => setFocusKey(row.key)}
              onPointerDown={(event) => startDrag(row, event)}
              onClick={() => {
                if (!suppressClick.current)
                  actions.open(row.documentId, row.path);
              }}
              onDoubleClick={() => setRenaming(row.key)}
            >
              {frame ? (
                <>
                  <span className="hierarchy-ref">{reference(frame)}</span>
                  <span className="hierarchy-cell">{cellName}</span>
                </>
              ) : (
                <span className="hierarchy-ref">{cellName}</span>
              )}
            </button>
          )}
          {/* Top is a state shown on its Cell: the badge marks the root the
              tree starts from, and every other Cell's row offers the same
              badge to move it there. */}
          {row.documentId !== topId ? (
            <button
              type="button"
              tabIndex={-1}
              className="hierarchy-top hierarchy-set-top"
              aria-label={`Set ${cellName} as Top`}
              title={`Make ${cellName} the Top (default entry); Undo restores ${name(topId)}`}
              onClick={() => actions.setTop(row.documentId)}
            >
              Top
            </button>
          ) : (
            <span
              className="hierarchy-top"
              title="Top: the Project's default entry. Click TOP on another Cell to move it."
            >
              Top
            </span>
          )}
          {uses > 1 ? (
            <button
              type="button"
              tabIndex={-1}
              className="hierarchy-uses"
              aria-expanded={Boolean(usage)}
              aria-label={`${uses} uses of ${cellName}`}
              title={`${cellName} has ${uses} uses; editing it changes all of them`}
              onClick={() => props.onUsesKeyChange(usage ? null : row.key)}
            >
              ×{uses}
            </button>
          ) : null}
          <span className="hierarchy-row-actions">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`New child Cell in ${cellName}`}
              title={`New child Cell in ${cellName}`}
              onClick={() => actions.newChild(row.documentId, row.path)}
            >
              <Icon name="child" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Place ${cellName}`}
              title={`Place ${cellName} in ${name(props.activeDocumentId)}, or drag the row onto the canvas`}
              onClick={() => place(row)}
            >
              <Icon name="place" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${cellName} properties`}
              title={`${cellName} properties: Pins, parameters and symbol`}
              onClick={() => actions.properties(row.documentId)}
            >
              <Icon name="properties" />
            </button>
          </span>
        </div>
        {usage ? (
          <div
            className="hierarchy-inline-uses"
            role="group"
            aria-label={`Uses of ${cellName}`}
            style={{ paddingLeft: 24 + row.path.length * INDENT }}
          >
            {usage.occurrences.map((use) => {
              const key = hierarchyPathKey(use.rootDocumentId, use.path);
              return (
                <button
                  key={key}
                  type="button"
                  className="hierarchy-use"
                  aria-current={key === activeKey ? "true" : undefined}
                  onClick={() => actions.open(use.documentId, use.path)}
                >
                  {occurrenceLabel(project, use.rootDocumentId, use.path)}
                </button>
              );
            })}
            {usage.truncated ? (
              <small>Showing the first {usage.occurrences.length} uses.</small>
            ) : null}
          </div>
        ) : null}
      </Fragment>
    );
  };

  const menuItem = (
    label: string,
    run: () => void,
    shortcut?: string,
    refusal?: string,
  ) => (
    <button
      type="button"
      role="menuitem"
      disabled={Boolean(refusal)}
      title={refusal}
      onClick={() => {
        setMenu(null);
        run();
      }}
    >
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );

  return (
    <aside
      id="hierarchy-panel"
      className={`shapes-panel hierarchy-panel${props.open ? "" : " collapsed"}`}
      aria-label="Circuit hierarchy"
      hidden={!props.open}
    >
      <div className="hierarchy-header">
        <input
          ref={filterRef}
          type="search"
          className="hierarchy-filter"
          placeholder="Filter Cells and instances"
          aria-label="Filter the hierarchy"
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
          onKeyDown={onFilterKeyDown}
        />
        <button
          type="button"
          className="hierarchy-icon-button"
          aria-label="New Cell"
          title="New Cell: create an unplaced Cell and open it"
          onClick={actions.newCell}
        >
          <Icon name="add" />
        </button>
        <button
          type="button"
          className="hierarchy-icon-button"
          aria-label="Collapse all"
          title="Collapse all but the open path"
          onClick={collapseAll}
        >
          <Icon name="collapse" />
        </button>
      </div>
      {query ? (
        <div
          className="hierarchy-matches"
          role="group"
          aria-label="Matching occurrences"
        >
          {matches.map((match) => {
            const last = match.path.at(-1);
            return (
              <button
                key={match.key}
                type="button"
                className="hierarchy-match"
                aria-current={match.key === activeKey ? "true" : undefined}
                onClick={() => actions.open(match.documentId, match.path)}
                onKeyDown={onMatchKeyDown}
              >
                <span className="hierarchy-match-name">
                  {last ? `${reference(last)} · ` : ""}
                  {name(match.documentId)}
                </span>
                <span className="hierarchy-match-path">
                  {occurrenceLabel(project, match.rootId, match.path)}
                </span>
              </button>
            );
          })}
          {!matches.length ? (
            <p className="hierarchy-hint">Nothing matches “{filter.trim()}”.</p>
          ) : null}
        </div>
      ) : (
        <div
          ref={treeRef}
          role="tree"
          aria-label="Cell occurrences"
          className="hierarchy-tree"
          onKeyDown={onTreeKeyDown}
        >
          {rows.map(renderRow)}
          {!roots.some((id) => hierarchy.children(id).length) ? (
            <p className="hierarchy-hint">
              Hover a row and use + to add a child Cell.
            </p>
          ) : null}
        </div>
      )}
      <footer className="hierarchy-footer">
        {actions.importCell ? (
          <button type="button" onClick={actions.importCell}>
            Import Cell…
          </button>
        ) : null}
        <button type="button" onClick={actions.external}>
          External Circuits…
        </button>
      </footer>
      {menu ? (
        <div
          className="hierarchy-context-menu"
          role="menu"
          aria-label={`Actions for ${rowLabel(menu.row)}`}
          style={{ left: menu.x, top: menu.y }}
        >
          {menuItem("Open definition", () =>
            actions.openDefinition(menu.row.documentId),
          )}
          {menuItem("Rename", () => setRenaming(menu.row.key), "F2")}
          {menuItem("New child Cell…", () =>
            actions.newChild(menu.row.documentId, menu.row.path),
          )}
          {menuItem(
            `Place in ${name(props.activeDocumentId)}`,
            () => place(menu.row),
            undefined,
            placementRefusal(menu.row),
          )}
          {menuItem("Cell properties…", () =>
            actions.properties(menu.row.documentId),
          )}
          {usesOf(menu.row.documentId) > 1
            ? menuItem(`Show ${usesOf(menu.row.documentId)} uses`, () =>
                props.onUsesKeyChange(menu.row.key),
              )
            : null}
          {menu.row.path.length ? (
            <>
              <div className="hierarchy-context-divider" role="separator" />
              {menuItem("Make unique copy", () =>
                actions.makeUnique(cellUseOf(menu.row)),
              )}
              {menuItem("Replace Cell…", () =>
                actions.replace(cellUseOf(menu.row)),
              )}
              {menuItem(
                `Flatten into ${name(menu.row.path.at(-1)!.parentDocumentId)}`,
                () =>
                  actions.flatten(
                    cellUseOf(menu.row),
                    menu.row.path.slice(0, -1),
                  ),
              )}
            </>
          ) : null}
          <div className="hierarchy-context-divider" role="separator" />
          {menu.row.documentId !== topId
            ? menuItem("Set as Top", () => actions.setTop(menu.row.documentId))
            : null}
          {menuItem(
            "Delete Cell",
            () => remove(menu.row),
            "Del",
            deleteRefusal(menu.row),
          )}
        </div>
      ) : null}
    </aside>
  );
}

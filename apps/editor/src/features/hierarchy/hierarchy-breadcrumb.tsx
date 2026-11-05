import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { CircuitProject, HierarchyFrame } from "@icm/model";
import { buildProjectHierarchy } from "@icm/derived";
import { hierarchyPathKey, occurrenceLabel } from "./project-hierarchy";

export interface HierarchyBreadcrumbProps {
  project: CircuitProject;
  activeDocumentId: string;
  path: readonly HierarchyFrame[];
  /** `fromInstanceId` is the instance the user came out of; it is selected. */
  onOpen(
    documentId: string,
    path: readonly HierarchyFrame[],
    fromInstanceId?: string,
  ): void;
  onUp(): void;
  onTop(): void;
  onShowTree(): void;
}

interface Crumb {
  documentId: string;
  path: readonly HierarchyFrame[];
  label: string;
}

interface MenuItem {
  key: string;
  label: string;
  current?: boolean;
  disabled?: boolean;
  run(): void;
}

type MenuKind = "children" | "hidden" | "uses";

interface OpenMenu {
  kind: MenuKind;
  index: number;
  left: number;
}

/** Longer paths keep the root and the last two levels in view. */
const VISIBLE_LEVELS = 5;

/**
 * The instance path, floating over the canvas while a child Cell is open.
 * At Top it renders nothing, so a flat Project gives up no space to hierarchy.
 */
export function HierarchyBreadcrumb(props: HierarchyBreadcrumbProps) {
  const { project, activeDocumentId, path } = props;
  const hierarchy = useMemo(() => buildProjectHierarchy(project), [project]);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMenu(null), [activeDocumentId, path]);
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menu]);

  const topId = project.topDocumentId;
  if (!path.length && activeDocumentId === topId) return null;

  const name = (id: string) => hierarchy.document(id)?.name ?? id;
  const frameLabel = (frame: HierarchyFrame) => {
    const reference =
      hierarchy
        .document(frame.parentDocumentId)
        ?.instances.find((item) => item.id === frame.instanceId)?.reference ??
      frame.instanceId;
    return `${reference}: ${name(frame.childDocumentId)}`;
  };
  const rootId = path[0]?.parentDocumentId ?? activeDocumentId;
  const crumbs: Crumb[] = [
    {
      documentId: rootId,
      path: [],
      label:
        rootId === topId
          ? "Top"
          : path.length
            ? name(rootId)
            : `${name(rootId)} (definition)`,
    },
    ...path.map((frame, index) => ({
      documentId: frame.childDocumentId,
      path: path.slice(0, index + 1),
      label: frameLabel(frame),
    })),
  ];
  const last = crumbs.length - 1;
  const shown: (number | "hidden")[] =
    crumbs.length > VISIBLE_LEVELS
      ? [0, "hidden", last - 1, last]
      : crumbs.map((_, index) => index);
  const usage = hierarchy.usage(activeDocumentId);
  const currentKey = hierarchyPathKey(rootId, path);

  const openCrumb = (index: number) => {
    const crumb = crumbs[index]!;
    props.onOpen(crumb.documentId, crumb.path, path[index]?.instanceId);
  };
  const toggle = (
    kind: MenuKind,
    index: number,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const left = event.currentTarget.offsetLeft;
    setMenu((open) =>
      open?.kind === kind && open.index === index
        ? null
        : { kind, index, left },
    );
  };
  const childItems = (index: number): MenuItem[] => {
    const crumb = crumbs[index]!;
    const ancestors = new Set([
      rootId,
      ...crumb.path.map((frame) => frame.childDocumentId),
    ]);
    return hierarchy.children(crumb.documentId).map((frame) => ({
      key: frame.instanceId,
      label: frameLabel(frame),
      current: path[crumb.path.length]?.instanceId === frame.instanceId,
      disabled: ancestors.has(frame.childDocumentId),
      run: () => props.onOpen(frame.childDocumentId, [...crumb.path, frame]),
    }));
  };
  const menuItems = (open: OpenMenu): MenuItem[] => {
    if (open.kind === "children") return childItems(open.index);
    if (open.kind === "hidden")
      return crumbs.slice(1, last - 1).map((crumb, offset) => ({
        key: hierarchyPathKey(rootId, crumb.path),
        label: crumb.label,
        run: () => openCrumb(offset + 1),
      }));
    return usage.occurrences.map((use) => {
      const key = hierarchyPathKey(use.rootDocumentId, use.path);
      return {
        key,
        label: occurrenceLabel(project, use.rootDocumentId, use.path),
        current: key === currentKey,
        run: () => props.onOpen(use.documentId, use.path),
      };
    });
  };
  const separator = (index: number) => (
    <button
      type="button"
      className="hierarchy-breadcrumb-separator"
      aria-label={`Cells inside ${crumbs[index]!.label}`}
      aria-haspopup="menu"
      aria-expanded={menu?.kind === "children" && menu.index === index}
      onClick={(event) => toggle("children", index, event)}
    >
      ›
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="hierarchy-breadcrumb-overlay"
      data-canvas-overlay="hierarchy-breadcrumb"
    >
      <nav
        className="hierarchy-breadcrumb"
        aria-label="Instance path"
        data-testid="hierarchy-breadcrumb"
      >
        <button
          type="button"
          className="hierarchy-breadcrumb-up"
          aria-label="Up to the caller"
          title="Up to the caller (Shift+E)"
          disabled={!path.length}
          onClick={props.onUp}
        >
          ↑
        </button>
        {rootId !== topId ? (
          <>
            <button
              type="button"
              title="Open the default Top"
              onClick={props.onTop}
            >
              Top
            </button>
            <span className="hierarchy-breadcrumb-divider" aria-hidden="true" />
          </>
        ) : null}
        {shown.map((item, position) => (
          <span
            key={
              item === "hidden"
                ? "hidden"
                : hierarchyPathKey(rootId, crumbs[item]!.path)
            }
            className="hierarchy-breadcrumb-step"
          >
            {position > 0 ? separator(item === "hidden" ? 0 : item - 1) : null}
            {item === "hidden" ? (
              <button
                type="button"
                aria-label="Show hidden levels"
                aria-haspopup="menu"
                aria-expanded={menu?.kind === "hidden"}
                onClick={(event) => toggle("hidden", 0, event)}
              >
                …
              </button>
            ) : item === last ? (
              <span
                className="hierarchy-breadcrumb-current"
                aria-current="page"
              >
                {crumbs[item]!.label}
              </span>
            ) : (
              <button type="button" onClick={() => openCrumb(item)}>
                {crumbs[item]!.label}
              </button>
            )}
          </span>
        ))}
        {hierarchy.children(activeDocumentId).length ? separator(last) : null}
        {usage.total > 1 ? (
          <button
            type="button"
            className="hierarchy-breadcrumb-uses"
            aria-haspopup="menu"
            aria-expanded={menu?.kind === "uses"}
            title={`Editing ${name(activeDocumentId)} changes all ${usage.total} uses`}
            onClick={(event) => toggle("uses", 0, event)}
          >
            {usage.total}
            {usage.atLeast ? "+" : ""} uses
          </button>
        ) : null}
      </nav>
      {menu ? (
        <div
          className="hierarchy-breadcrumb-menu"
          role="menu"
          style={{ left: menu.left }}
        >
          {menuItems(menu).map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-current={item.current || undefined}
              disabled={item.disabled}
              onClick={() => {
                setMenu(null);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
          {menu.kind === "uses" && usage.truncated ? (
            <small>Showing the first {usage.occurrences.length} uses.</small>
          ) : null}
          <div className="hierarchy-breadcrumb-menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              props.onShowTree();
            }}
          >
            Show hierarchy tree
          </button>
        </div>
      ) : null}
    </div>
  );
}

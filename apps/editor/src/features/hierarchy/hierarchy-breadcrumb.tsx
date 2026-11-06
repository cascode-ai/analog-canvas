import { useMemo } from "react";
import type { CircuitProject, HierarchyFrame } from "@icm/model";
import { buildProjectHierarchy } from "@icm/derived";

import { frameReference } from "./project-hierarchy";

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
  /** Reveal the hierarchy tree at the open occurrence. */
  onShowTree(): void;
  /** Reveal the open Cell's uses in the hierarchy tree. */
  onShowUses(): void;
}

interface Crumb {
  documentId: string;
  path: readonly HierarchyFrame[];
  label: string;
}

/** Longer paths keep the root and the last two levels in view. */
const VISIBLE_LEVELS = 5;

/**
 * Where the open Cell sits, floating over the canvas while a child Cell is
 * open. It only says where you are and goes back; the tree does the rest.
 * At Top it renders nothing, so a flat Project gives up no space to hierarchy.
 */
export function HierarchyBreadcrumb(props: HierarchyBreadcrumbProps) {
  const { project, activeDocumentId, path } = props;
  const hierarchy = useMemo(() => buildProjectHierarchy(project), [project]);
  const topId = project.topDocumentId;
  // At a root, Top or any Cell nothing calls, there is no path to show.
  if (!path.length && hierarchy.roots.includes(activeDocumentId)) return null;

  const name = (id: string) => hierarchy.document(id)?.name ?? id;
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
      label: `${frameReference(project, frame)}: ${name(frame.childDocumentId)}`,
    })),
  ];
  const last = crumbs.length - 1;
  const shown: (number | "hidden")[] =
    crumbs.length > VISIBLE_LEVELS
      ? [0, "hidden", last - 1, last]
      : crumbs.map((_, index) => index);
  const usage = hierarchy.usage(activeDocumentId, 0);

  return (
    <div
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
            key={item === "hidden" ? "hidden" : item}
            className="hierarchy-breadcrumb-step"
          >
            {position > 0 ? (
              <span
                className="hierarchy-breadcrumb-separator"
                aria-hidden="true"
              >
                ›
              </span>
            ) : null}
            {item === "hidden" ? (
              <button
                type="button"
                aria-label="Show the whole path in the hierarchy tree"
                title={crumbs
                  .slice(1, last - 1)
                  .map((crumb) => crumb.label)
                  .join(" › ")}
                onClick={props.onShowTree}
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
              <button
                type="button"
                onClick={() =>
                  props.onOpen(
                    crumbs[item]!.documentId,
                    crumbs[item]!.path,
                    path[item]?.instanceId,
                  )
                }
              >
                {crumbs[item]!.label}
              </button>
            )}
          </span>
        ))}
        {usage.total > 1 ? (
          <button
            type="button"
            className="hierarchy-breadcrumb-uses"
            title={`Editing ${name(activeDocumentId)} changes all ${usage.total} uses; show them in the hierarchy tree`}
            onClick={props.onShowUses}
          >
            {usage.total}
            {usage.atLeast ? "+" : ""} uses
          </button>
        ) : null}
      </nav>
    </div>
  );
}

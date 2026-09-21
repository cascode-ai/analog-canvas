import { useEffect, useRef } from "react";
import type { CloudProjectSummary } from "./cloud-projects";
import "./project-tabs.css";

export function ProjectTabs({
  tabs,
  activeId,
  busy,
  onSelect,
  onClose,
  onNew,
  onOpenFile,
  cloudProjects,
  onRefreshShelf,
  onOpenShelf,
}: {
  tabs: { id: string; name: string; dirty: boolean }[];
  activeId: string;
  busy: boolean;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onOpenFile(): void;
  cloudProjects: readonly CloudProjectSummary[];
  onRefreshShelf(): void;
  onOpenShelf(id: string): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const keyboardFocus = useRef(false);
  useEffect(() => {
    if (busy) return;
    const focused =
      keyboardFocus.current || list.current?.contains(document.activeElement);
    keyboardFocus.current = false;
    if (focused)
      list.current
        ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.focus({ preventScroll: true });
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length, busy]);
  return (
    <div className="project-tabs" data-testid="project-tabs">
      <div role="tablist" aria-label="Open projects" ref={list}>
        {tabs.map((tab) => (
          <div
            className="project-tab"
            key={tab.id}
            data-active={tab.id === activeId}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              tabIndex={tab.id === activeId ? 0 : -1}
              disabled={busy}
              title={tab.name}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => {
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  event.stopPropagation();
                  keyboardFocus.current = true;
                  onSelect(tabs[next]!.id);
                }
              }}
            >
              {tab.dirty ? <span aria-label="Unsaved">● </span> : null}
              {tab.name}
            </button>
            <button
              type="button"
              aria-label={`Close tab ${tab.name}`}
              disabled={busy}
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        title="New project tab"
        aria-label="New project tab"
        disabled={busy}
        onClick={onNew}
      >
        ＋
      </button>
      <button
        type="button"
        title="Open file in new tab"
        aria-label="Open file in new tab"
        disabled={busy}
        onClick={onOpenFile}
      >
        ↗
      </button>
      <details
        className="project-tabs-shelf"
        onToggle={(event) => {
          if (event.currentTarget.open) onRefreshShelf();
        }}
      >
        <summary
          title="Open Shelf project in tab"
          aria-label="Open Shelf project in tab"
        >
          ▾
        </summary>
        <div>
          {cloudProjects.length ? (
            cloudProjects.map((project) => (
              <button
                type="button"
                key={project.id}
                disabled={busy}
                onClick={(event) => {
                  event.currentTarget.closest("details")!.open = false;
                  onOpenShelf(project.id);
                }}
              >
                {project.name}
              </button>
            ))
          ) : (
            <span>No saved Shelf projects. Sign in to load your shelf.</span>
          )}
        </div>
      </details>
    </div>
  );
}

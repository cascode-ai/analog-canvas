import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CloudProjectSummary } from "./cloud-projects";
import "./project-tabs.css";

const InlineConfirm = lazy(() =>
  import("../../components/inline-confirm").then((module) => ({
    default: module.InlineConfirm,
  })),
);

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
  const [closing, setClosing] = useState<string | null>(null);
  const closeTrigger = useRef<HTMLButtonElement | null>(null);
  const closeTarget = tabs.find((tab) => tab.id === closing);
  useEffect(() => setClosing(null), [activeId]);
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
    <div className="project-tabs-workspace">
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
                onClick={() => {
                  setClosing(null);
                  onSelect(tab.id);
                }}
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
                onClick={(event) => {
                  if (tab.dirty) {
                    closeTrigger.current = event.currentTarget;
                    setClosing(tab.id);
                  } else onClose(tab.id);
                }}
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
      {closeTarget ? (
        <div
          className="project-tab-close-decision"
          data-testid="project-tab-close-decision"
        >
          <Suspense fallback={null}>
            <InlineConfirm
              key={closeTarget.id}
              open
              disabled={busy}
              aria-label={`Close tab ${closeTarget.name}`}
              confirmLabel="Close without saving"
              cancelLabel="Keep open"
              onOpenChange={(next) => {
                if (!next) {
                  setClosing(null);
                  requestAnimationFrame(() => closeTrigger.current?.focus());
                }
              }}
              onConfirm={() => {
                onClose(closeTarget.id);
                setClosing(null);
              }}
            >
              Close tab
            </InlineConfirm>
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

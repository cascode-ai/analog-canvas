import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CloudProjectSummary } from "./cloud-projects";
import "./project-tabs.css";

const InlineConfirm = lazy(() =>
  import("../../components/inline-confirm").then((module) => ({
    default: module.InlineConfirm,
  })),
);

export function ProjectTabs({
  cloudEnabled = true,
  tabs,
  activeId,
  busy,
  onSelect,
  onRename,
  onEditingChange,
  onClose,
  onSaveClose,
  onNew,
  onOpenFile,
  cloudProjects,
  onRefreshShelf,
  onOpenShelf,
}: {
  cloudEnabled?: boolean;
  tabs: { id: string; name: string; dirty: boolean }[];
  activeId: string;
  busy: boolean;
  onSelect(id: string): Promise<boolean>;
  onRename(id: string, name: string): void;
  onEditingChange(editing: boolean): void;
  onClose(id: string): void;
  onSaveClose?(id: string): Promise<boolean>;
  onNew(): void;
  onOpenFile(): void;
  cloudProjects: readonly CloudProjectSummary[];
  onRefreshShelf(): void;
  onOpenShelf(id: string): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{
    id: string;
    original: string;
    width: number;
  } | null>(null);
  const renameSession = useRef(editing);
  const nameInput = useRef<HTMLInputElement>(null);
  const renamedByClick = useRef<string | null>(null);
  const finishRename = (value: string | null) => {
    const session = renameSession.current;
    if (!session) return false;
    renameSession.current = null;
    setEditing(null);
    onEditingChange(false);
    if (value === session.original) return false;
    const name = value?.trim();
    if (name && name !== session.original && name.length <= 120) {
      onRename(session.id, name);
      return true;
    }
    return false;
  };
  useEffect(() => {
    if (editing) {
      nameInput.current?.focus({ preventScroll: true });
      nameInput.current?.select();
    }
  }, [editing]);
  const [closing, setClosing] = useState<string | null>(null);
  const selecting = useRef<{ id: string; promise: Promise<boolean> } | null>(
    null,
  );
  const selectTab = (id: string) => {
    if (busy) return;
    finishRename(nameInput.current?.value ?? null);
    setClosing(null);
    const request = { id, promise: onSelect(id) };
    selecting.current = request;
    void request.promise.finally(() => {
      if (selecting.current === request) selecting.current = null;
    });
  };
  const closeTrigger = useRef<HTMLButtonElement | null>(null);
  const closeTarget = tabs.find((tab) => tab.id === closing);
  useEffect(() => setClosing(null), [activeId]);
  const keyboardFocus = useRef(false);
  useEffect(() => {
    if (busy || renameSession.current) return;
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
    <div
      className="project-tabs-workspace"
      onPointerDownCapture={(event) => {
        // Keep the click target stable: focus-induced blur must not resize a
        // tab between pointer down and click. Outside the bar blur is normal.
        if (
          event.button === 0 &&
          renameSession.current &&
          event.target !== nameInput.current
        )
          event.preventDefault();
      }}
      onClickCapture={(event) => {
        const owner = renameSession.current?.id;
        renamedByClick.current =
          event.target !== nameInput.current &&
          finishRename(nameInput.current?.value ?? null)
            ? (owner ?? null)
            : null;
      }}
    >
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
                disabled={busy && selecting.current?.id !== tab.id}
                title={tab.name}
                aria-description="Double-click to rename"
                data-editing={editing?.id === tab.id}
                onClick={() => selectTab(tab.id)}
                onDoubleClick={(event) => {
                  const button = event.currentTarget;
                  const selected =
                    selecting.current?.id === tab.id
                      ? selecting.current.promise
                      : Promise.resolve(!busy && tab.id === activeId);
                  const session = {
                    id: tab.id,
                    original: tab.name,
                    width: button.getBoundingClientRect().width,
                  };
                  void selected.then((applied) => {
                    if (!applied || !button.isConnected) return;
                    setClosing(null);
                    renameSession.current = session;
                    onEditingChange(true);
                    setEditing(session);
                  });
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
                    selectTab(tabs[next]!.id);
                  }
                }}
              >
                {tab.dirty ? <span aria-label="Unsaved">● </span> : null}
                {tab.name}
              </button>
              {editing?.id === tab.id ? (
                <input
                  ref={nameInput}
                  className="project-tab-name-input"
                  aria-label="Project name"
                  autoComplete="off"
                  maxLength={120}
                  defaultValue={editing.original}
                  style={{ width: editing.width }}
                  onBlur={(event) => finishRename(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter" || event.key === "Escape") {
                      event.preventDefault();
                      finishRename(
                        event.key === "Enter"
                          ? event.currentTarget.value
                          : null,
                      );
                      list.current
                        ?.querySelector<HTMLButtonElement>(
                          '[aria-selected="true"]',
                        )
                        ?.focus({ preventScroll: true });
                    }
                  }}
                />
              ) : null}
              <button
                type="button"
                aria-label={`Close tab ${tab.name}`}
                disabled={busy}
                onClick={(event) => {
                  if (tab.dirty || renamedByClick.current === tab.id) {
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
        {cloudEnabled ? (
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
                <span>
                  No saved Shelf projects. Sign in to load your shelf.
                </span>
              )}
            </div>
          </details>
        ) : null}
      </div>
      {closeTarget ? (
        <div
          className="project-tab-close-decision"
          data-testid="project-tab-close-decision"
        >
          {onSaveClose ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void onSaveClose(closeTarget.id).then((closed) => {
                  if (closed) setClosing(null);
                });
              }}
            >
              Save and close
            </button>
          ) : null}
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

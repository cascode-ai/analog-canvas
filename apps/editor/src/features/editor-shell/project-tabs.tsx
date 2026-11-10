import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ContextMenu } from "../../components/context-menu";
import type { CloudProjectSummary } from "./cloud-projects";
import "./project-tabs.css";
import { ProjectShelf } from "./project-shelf";

const InlineConfirm = lazy(() =>
  import("../../components/inline-confirm").then((module) => ({
    default: module.InlineConfirm,
  })),
);

/** A draft holding the Project that the tab strip can drop (#2180). */
export interface TabSwitchHold {
  /** Why the Project is held, as a sentence without its full stop. */
  reason: string;
  /** Drops the draft, synchronously, so the tab change can follow. */
  discard(): void;
  /** Returns the person to the draft. */
  resume(): void;
}

export function ProjectTabs({
  cloudEnabled = true,
  tabs,
  activeId,
  busy,
  onSelect,
  onRename,
  onEditingChange,
  onClose,
  onCloseMany,
  onSaveClose,
  onNew,
  onOpenFile,
  cloudProjects,
  onShelfOpened,
  onOpenShelf,
  onRenameShelf,
  onDeleteShelf,
  heldBy,
}: {
  cloudEnabled?: boolean;
  tabs: { id: string; name: string; dirty: boolean }[];
  activeId: string;
  busy: boolean;
  onSelect(id: string): Promise<boolean>;
  onRename(id: string, name: string): void;
  onEditingChange(editing: boolean): void;
  onClose(id: string): void;
  /** Close Others and Close All, after any unsaved tab is confirmed. */
  onCloseMany(ids: readonly string[]): void;
  onSaveClose?(id: string): Promise<boolean>;
  onNew(): void;
  onOpenFile(): void;
  cloudProjects: readonly CloudProjectSummary[];
  onShelfOpened(): void;
  onOpenShelf(id: string): void;
  onRenameShelf(id: string, name: string): Promise<void>;
  onDeleteShelf(id: string): Promise<void>;
  /**
   * A draft that holds the Project and that the person can drop here, or
   * null (#2180). A tab change it holds asks beside the strip first.
   */
  heldBy?(): TabSwitchHold | null;
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
  // A rename ends with its tab, or with the strip: a name field removed while
  // focused never blurs, and the editor kept refusing every Project switch
  // for an edit nobody could see (#1462).
  const editedTabGone =
    editing !== null && !tabs.some((tab) => tab.id === editing.id);
  useEffect(() => {
    if (editedTabGone) finishRename(null);
  }, [editedTabGone]);
  // The strip's own lifetime; the callback only clears the editor's flag.
  useEffect(
    () => () => {
      if (renameSession.current) onEditingChange(false);
    },
    [],
  );
  const [held, setHeld] = useState<
    (TabSwitchHold & { proceed(): void }) | null
  >(null);
  /** Runs a tab change, or asks first while a draft holds the Project. */
  const unlessHeld = (proceed: () => void) => {
    const hold = heldBy?.();
    if (!hold) {
      setHeld(null);
      proceed();
      return;
    }
    setClosing(null);
    setClosingMany(null);
    setHeld({ ...hold, proceed });
  };
  const [closing, setClosing] = useState<string | null>(null);
  const selecting = useRef<{ id: string; promise: Promise<boolean> } | null>(
    null,
  );
  const selectTab = (id: string): void => {
    if (busy) return;
    finishRename(nameInput.current?.value ?? null);
    setClosing(null);
    if (id !== activeId && heldBy?.()) return unlessHeld(() => selectTab(id));
    const request = { id, promise: onSelect(id) };
    selecting.current = request;
    void request.promise.finally(() => {
      if (selecting.current === request) selecting.current = null;
    });
  };
  const closeTrigger = useRef<HTMLButtonElement | null>(null);
  const closeTarget = tabs.find((tab) => tab.id === closing);
  useEffect(() => {
    setClosing(null);
    setHeld(null);
  }, [activeId]);
  // A tab's right-click menu, and several tabs it closes once confirmed.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [closingMany, setClosingMany] = useState<readonly string[] | null>(
    null,
  );
  /** Unsaved edits, or a rename the click just committed (not yet in `tabs`). */
  const unsaved = (id: string) =>
    tabs.find((tab) => tab.id === id)?.dirty === true ||
    renamedByClick.current === id;
  const unsavedClosing = (closingMany ?? []).filter(unsaved).length;
  /** Closes one tab, asking first when it holds unsaved edits. */
  const closeOne = (id: string, trigger: HTMLButtonElement | null) => {
    if (!tabs.some((item) => item.id === id)) return;
    setHeld(null);
    if (unsaved(id)) {
      closeTrigger.current = trigger;
      setClosingMany(null);
      setClosing(id);
    } else closeNow([id], () => onClose(id));
  };
  /** Closing the open tab changes the Project; closing another does not. */
  const closeNow = (ids: readonly string[], close: () => void) =>
    ids.includes(activeId) ? unlessHeld(close) : close();
  const closeMany = (ids: readonly string[]) => {
    if (!ids.length) return;
    setClosing(null);
    setHeld(null);
    if (ids.some(unsaved)) setClosingMany(ids);
    else closeNow(ids, () => onCloseMany(ids));
  };
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
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ id: tab.id, x: event.clientX, y: event.clientY });
                }}
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
                data-tab-close={tab.id}
                disabled={busy}
                onClick={(event) => closeOne(tab.id, event.currentTarget)}
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
          onClick={() => unlessHeld(onNew)}
        >
          ＋
        </button>
        <button
          type="button"
          title="Open file in new tab"
          aria-label="Open file in new tab"
          disabled={busy}
          onClick={() => unlessHeld(onOpenFile)}
        >
          ↗
        </button>
        {cloudEnabled ? (
          <details
            className="project-tabs-shelf"
            onToggle={(event) => {
              if (event.currentTarget.open) onShelfOpened();
            }}
          >
            <summary
              title="Open Shelf project in tab"
              aria-label="Open Shelf project in tab"
            >
              ▾
            </summary>
            <div>
              <ProjectShelf
                projects={cloudProjects}
                busy={busy}
                onOpen={(id) => unlessHeld(() => onOpenShelf(id))}
                onRename={onRenameShelf}
                onDelete={onDeleteShelf}
              />
            </div>
          </details>
        ) : null}
      </div>
      {menu ? (
        <ContextMenu
          position={menu}
          label="Tab"
          testId="project-tab-menu"
          onClose={() => setMenu(null)}
        >
          {(
            [
              ["Close", [menu.id]],
              [
                "Close Others",
                tabs.map(({ id }) => id).filter((id) => id !== menu.id),
              ],
              ["Close All", tabs.map(({ id }) => id)],
            ] as const
          ).map(([label, ids]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="context-menu-item"
              disabled={busy || !ids.length}
              onClick={() => {
                setMenu(null);
                if (label === "Close")
                  closeOne(
                    menu.id,
                    list.current?.querySelector<HTMLButtonElement>(
                      `[data-tab-close="${CSS.escape(menu.id)}"]`,
                    ) ?? null,
                  );
                else closeMany(ids);
              }}
            >
              {label}
            </button>
          ))}
        </ContextMenu>
      ) : null}
      {held ? (
        <div
          className="project-tab-close-decision"
          role="alertdialog"
          aria-label="Draft holds this Project"
          data-testid="project-tab-held-decision"
        >
          <span>{held.reason}. </span>
          <button
            type="button"
            onClick={() => {
              setHeld(null);
              held.discard();
              held.proceed();
            }}
          >
            Discard draft and continue
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              setHeld(null);
              held.resume();
            }}
          >
            Keep editing
          </button>
        </div>
      ) : null}
      {closingMany && !closeTarget ? (
        <div
          className="project-tab-close-decision"
          data-testid="project-tab-close-decision"
        >
          <span>
            Close{" "}
            {closingMany.length === 1 ? "1 tab" : `${closingMany.length} tabs`}?{" "}
            {unsavedClosing === 1
              ? "1 has unsaved changes."
              : `${unsavedClosing} have unsaved changes.`}{" "}
          </span>
          <Suspense fallback={null}>
            <InlineConfirm
              open
              disabled={busy}
              aria-label={`Close ${closingMany.length === 1 ? "1 tab" : `${closingMany.length} tabs`}`}
              confirmLabel="Close without saving"
              cancelLabel="Keep open"
              onOpenChange={(next) => {
                if (!next) setClosingMany(null);
              }}
              onConfirm={() => {
                const ids = closingMany;
                setClosingMany(null);
                closeNow(ids, () => onCloseMany(ids));
              }}
            >
              Close tabs
            </InlineConfirm>
          </Suspense>
        </div>
      ) : null}
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
                const id = closeTarget.id;
                setClosing(null);
                closeNow([id], () => onClose(id));
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

import { parseSharedComponentEntry } from "./component-library-entry";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { readSessionUser, type SessionUser } from "../../components/account";
import { ContextMenu } from "../../components/context-menu";
import { InlineConfirm } from "../../components/inline-confirm";
import { startCanvasDrag } from "../editor-shell/canvas-drag";
import type { ComponentCatalogQuery } from "./component-library-contract";
import type { SharedComponent } from "./component-library-contract";
import {
  readSharedComponentRecord,
  ComponentLibraryError,
  checkSharedComponentRevision,
  changeComponentLifecycle,
} from "./component-library-client";
import { LibraryCache } from "./library-cache";
import { ComponentLibraryRow } from "./component-library-row";
import { ComponentPreviewCard } from "./component-preview-card";
import { ComponentDraftList } from "./component-draft-list";
import { ComponentPopover } from "./component-popover";
import type {
  ComponentDraftCatalog,
  ComponentDraftTarget,
} from "@icm/edit-engine";
import { ComponentCatalogControls } from "./component-catalog-controls";
import { groupCatalogEntries } from "./component-catalog-groups";
import { useComponentCatalog } from "./use-component-catalog";

type CatalogList = ReturnType<typeof useComponentCatalog>;
type RecordAction = "details" | "place" | "new" | "update" | "raw";
const PREVIEW_DELAY_MS = 300;
const PREVIEW_SWITCH_MS = 60;
const PREVIEW_LINGER_MS = 150;

/** Filters and folds outlive the panel when the left slot changes mode. */
const remembered: {
  catalog: ComponentCatalogQuery;
  mine: boolean;
  removed: boolean;
} = {
  catalog: { version: 1, type: "all", order: "circuit-first" },
  mine: false,
  removed: false,
};

/**
 * The Library's Community fold: every public record on one list of rows, with
 * the signed-in member's own records, drafts and withdrawals folded inside it.
 */
export default function UserComponentsLibrary({
  open,
  query = "",
  toolsSlot,
  onEdit,
  onInsert,
  onDropPlacement,
  refresh,
  drafts,
  onDeleteDrafts,
  previewDraftDeletion,
  onOpenDraft,
}: {
  open: boolean;
  /** The panel's search, which Official components share. */
  query?: string;
  /** Where the fold's header keeps this list's count and filter. */
  toolsSlot?: HTMLElement | null;
  /** Closes the desktop host's dialog; the panel stays where it is. */
  onClose(): void;
  onCreate(): void;
  onEdit(
    entry: SharedComponent,
    intent: "new" | "update",
  ): void | Promise<void>;
  /** Resolves false when placement could not start. */
  onInsert(entry: SharedComponent): void | boolean | Promise<void | boolean>;
  onDropPlacement?(clientX: number, clientY: number): void;
  refresh: number;
  drafts?: ComponentDraftCatalog;
  onOpenDraft?(target: ComponentDraftTarget): void;
  onDeleteDrafts?(targets: ComponentDraftTarget[]): string | null;
  previewDraftDeletion?(targets: ComponentDraftTarget[]): number;
}) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const accountIdentity = useRef<string | null>(null);
  accountIdentity.current = user?.id ?? null;
  const accountId = user?.id ?? null;
  const [authReady, setAuthReady] = useState(false);
  const [catalog, setCatalogState] = useState(remembered.catalog);
  const setCatalog = (value: ComponentCatalogQuery) => {
    remembered.catalog = value;
    setCatalogState(value);
  };
  const [mineOpen, setMineOpen] = useState(remembered.mine);
  const [removedOpen, setRemovedOpen] = useState(remembered.removed);
  const community = useComponentCatalog({
    active: open && authReady,
    accountId,
    query,
    catalog,
    refresh,
  });
  const mine = useComponentCatalog({
    active: open && authReady && !!user && mineOpen,
    accountId,
    query,
    catalog: user ? { ...catalog, authorId: user.id } : catalog,
    refresh,
  });
  const removed = useComponentCatalog({
    active: open && authReady && !!user && mineOpen && removedOpen,
    accountId,
    query,
    catalog,
    deleted: true,
    refresh,
  });
  const lists = useRef<CatalogList[]>([]);
  lists.current = [community, mine, removed];
  const [notice, setNotice] = useState<{
    text: string;
    transient: boolean;
  } | null>(null);
  function showNotice(text: string | null, transient = false) {
    setNotice(text === null ? null : { text, transient });
  }
  const [restorable, setRestorable] = useState<
    Awaited<ReturnType<typeof changeComponentLifecycle>>["entry"] | null
  >(null);
  useEffect(() => {
    if (!notice?.transient) return;
    const timer = setTimeout(() => {
      showNotice(null);
      setRestorable(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notice, restorable]);
  const [card, setCard] = useState<{
    summary: ComponentLibrarySummary;
    row: HTMLElement;
    entry?: SharedComponent;
  } | null>(null);
  const [menu, setMenu] = useState<{
    entry: ComponentLibrarySummary;
    list: CatalogList;
    x: number;
    y: number;
    fromKeyboard?: boolean;
  } | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const details = useRef(
    new LibraryCache<SharedComponent>(30, 2 * 1024 * 1024),
  );
  const selection = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const suppressClick = useRef(false);
  useEffect(() => {
    details.current.clear();
    setCard(null);
  }, [refresh]);
  useEffect(() => {
    details.current.clear();
    selection.current?.abort();
    setCard(null);
    setMenu(null);
    setRestorable(null);
    showNotice(null);
  }, [user?.id]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const refreshVisible = () => {
      if (document.visibilityState !== "visible") return;
      void readSessionUser(fetch, true).then((result) => {
        if (!active) return;
        if (result.available) setUser(result.user);
        for (const list of lists.current) list.refreshIfIdle();
      });
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void readSessionUser(fetch, true).then((result) => {
      if (!active) return;
      if (result.available) setUser(result.user);
      setAuthReady(true);
    });
    return () => {
      active = false;
      selection.current?.abort();
    };
  }, [open, refresh]);
  useEffect(() => () => clearTimeout(previewTimer.current), []);

  /** Resolves true once placement or editing has started. */
  async function choose(
    summary: ComponentLibrarySummary,
    action: RecordAction,
    list: CatalogList,
  ): Promise<boolean> {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setBusy(true);
    showNotice(null);
    setRestorable(null);
    const deleted = summary.status === "deleted";
    const pin = (entry: SharedComponent) => {
      const row = root.current?.querySelector<HTMLElement>(
        `[data-component-id="${CSS.escape(summary.id)}"]`,
      );
      if (row) setCard({ summary, row, entry });
    };
    try {
      const detailKey = `${summary.id}:${summary.revision}`;
      const cached =
        action === "details" && !deleted
          ? details.current.get(detailKey)
          : undefined;
      if (cached) {
        await checkSharedComponentRevision(summary, controller.signal);
        if (!controller.signal.aborted) pin(cached);
        return false;
      }
      const record = await readSharedComponentRecord(
        summary,
        controller.signal,
      );
      if (controller.signal.aborted) return false;
      if (action === "raw") {
        await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
        showNotice(
          "Copied raw record. Repair the source before creating a component.",
        );
        return false;
      }
      const entry = parseSharedComponentEntry(record);
      if (!deleted) details.current.set(detailKey, entry);
      if (action === "details") {
        pin(entry);
        return false;
      }
      if (action === "place") return (await onInsert(entry)) !== false;
      await onEdit(entry, action);
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        showNotice(error instanceof Error ? error.message : String(error));
        setCard(null);
        if (error instanceof ComponentLibraryError && error.status === 409) {
          details.current.clear();
          // Refresh only this immutable selection; never silently place a newer revision.
          await list.reload(controller.signal);
        }
      }
      return false;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function manage(
    entry: ComponentLibrarySummary,
    action: "delete" | "restore",
  ) {
    const account = accountIdentity.current;
    const result = await changeComponentLifecycle(entry, action);
    if (accountIdentity.current !== account) return;
    details.current.clear();
    for (const list of lists.current) list.forget(entry.id);
    showNotice(
      action === "delete" ? "Removed from library." : "Restored to library.",
      true,
    );
    setRestorable(action === "delete" ? result.entry : null);
  }
  const previewRow =
    (summary: ComponentLibrarySummary) => (row: HTMLElement) => {
      clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(
        () =>
          setCard((current) => (current?.entry ? current : { summary, row })),
        card ? PREVIEW_SWITCH_MS : PREVIEW_DELAY_MS,
      );
    };
  const endPreview = () => {
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(
      () => setCard((current) => (current?.entry ? current : null)),
      PREVIEW_LINGER_MS,
    );
  };
  const closeCard = () => {
    clearTimeout(previewTimer.current);
    setCard(null);
  };
  const filterAuthor = (authorId: string) => {
    closeCard();
    setCatalog({ ...catalog, authorId });
  };

  const renderRows = (list: CatalogList, scope: string) => {
    const rows: ReactNode[] = [];
    const row = (
      entry: ComponentLibrarySummary,
      extra: {
        variant?: boolean;
        count?: number;
        expanded?: boolean;
        onToggleGroup?(): void;
      },
    ) => (
      <ComponentLibraryRow
        key={`${entry.id}:${entry.revision}`}
        entry={entry}
        busy={busy}
        tabbable={rows.length === 0}
        own={scope === "mine"}
        {...extra}
        onToggleGroup={extra.onToggleGroup ?? (() => {})}
        onPlace={() => {
          closeCard();
          if (!suppressClick.current) void choose(entry, "place", list);
        }}
        onDragStart={(event) => {
          closeCard();
          startCanvasDrag(event, {
            begin: () => choose(entry, "place", list),
            drop: (x, y) => onDropPlacement?.(x, y),
            dragged: () => {
              suppressClick.current = true;
              window.setTimeout(() => {
                suppressClick.current = false;
              }, 0);
            },
          });
        }}
        onMenu={(anchor) => {
          closeCard();
          setMenu({ entry, list, ...anchor });
        }}
        onPreview={previewRow(entry)}
        onPreviewEnd={endPreview}
      />
    );
    for (const group of groupCatalogEntries(list.page.entries)) {
      const groupKey = `${scope}:${group.key}`;
      const expanded = openGroups.has(groupKey);
      rows.push(
        row(group.head, {
          count: group.others.length,
          expanded,
          onToggleGroup: () =>
            setOpenGroups((current) => {
              const next = new Set(current);
              if (!next.delete(groupKey)) next.add(groupKey);
              return next;
            }),
        }),
      );
      if (expanded)
        for (const other of group.others)
          rows.push(row(other, { variant: true }));
    }
    return rows;
  };
  const listState = (
    list: CatalogList,
    empty: string,
    failure: string,
  ): ReactNode =>
    list.error ? (
      <p className="community-message" role="status">
        <span>
          {list.page.entries.length
            ? "Couldn’t refresh components. Loaded components are still available."
            : failure}
        </span>
        <button type="button" onClick={list.retry}>
          Try Again
        </button>
      </p>
    ) : list.loading ? (
      <p className="community-message" role="status">
        Loading components…
      </p>
    ) : !list.page.entries.length ? (
      <p className="community-message">{empty}</p>
    ) : null;

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("component-row-main")) return;
    const rows = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        ".component-row-main",
      ),
    ];
    const at = rows.indexOf(target);
    const id = target.closest<HTMLElement>("[data-component-id]")?.dataset
      .componentId;
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      const list = lists.current.find((candidate) =>
        candidate.page.entries.some((entry) => entry.id === id),
      );
      const entry = list?.page.entries.find((item) => item.id === id);
      if (list && entry) {
        const box = target.getBoundingClientRect();
        closeCard();
        setMenu({
          entry,
          list,
          x: box.left + 24,
          y: box.bottom,
          fromKeyboard: true,
        });
      }
    } else if (event.key === "ArrowDown") rows[at + 1]?.focus();
    else if (event.key === "ArrowUp") rows[at - 1]?.focus();
    else if (event.key === "Home") rows[0]?.focus();
    else if (event.key === "End") rows.at(-1)?.focus();
    else {
      // Typing on a row continues the panel's search, as in a file explorer.
      if (
        event.key.length === 1 &&
        event.key !== " " &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      )
        event.currentTarget
          .closest(".shapes-panel")
          ?.querySelector<HTMLElement>('input[type="search"]')
          ?.focus();
      return;
    }
    event.preventDefault();
  };

  const menuItem = (label: string, run: () => void, note?: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setMenu(null);
        run();
      }}
    >
      <span>
        {label}
        {note ? <small className="hierarchy-menu-note">{note}</small> : null}
      </span>
    </button>
  );
  const renderMenu = () => {
    if (!menu) return null;
    const { entry, list } = menu;
    const invalid = entry.capability === "needs-repair";
    const deleted = entry.status === "deleted";
    const canManage = !!user && (user.isAdmin || user.id === entry.authorId);
    const canRestore =
      canManage && (user?.isAdmin || entry.deletion?.by === "author");
    const canEdit =
      !invalid &&
      !deleted &&
      ((user?.id === entry.authorId && entry.status === "shared") ||
        user?.isAdmin);
    return (
      <ContextMenu
        position={menu}
        label={`Actions for ${entry.name}`}
        testId="component-context-menu"
        className="hierarchy-context-menu"
        takeFocus={menu.fromKeyboard ?? false}
        onClose={() => setMenu(null)}
      >
        {invalid
          ? menuItem("Copy raw record", () => void choose(entry, "raw", list))
          : menuItem("Details", () => void choose(entry, "details", list))}
        {!invalid && !deleted
          ? menuItem("Create from…", () => void choose(entry, "new", list))
          : null}
        {canEdit
          ? menuItem(
              user?.isAdmin ? "Manage" : "Edit",
              () => void choose(entry, "update", list),
            )
          : null}
        {catalog.authorId !== entry.authorId && entry.authorId !== accountId
          ? menuItem(`Only ${entry.author.trim() || "this author"}`, () =>
              filterAuthor(entry.authorId),
            )
          : null}
        {deleted && canRestore
          ? menuItem("Restore", () => void manage(entry, "restore"))
          : null}
        {canManage && !deleted ? (
          <>
            <div className="hierarchy-context-divider" role="separator" />
            <InlineConfirm
              aria-label={`Delete ${entry.name} from library`}
              onConfirm={async () => {
                await manage(entry, "delete");
                setMenu(null);
              }}
            >
              Delete from library
            </InlineConfirm>
          </>
        ) : null}
      </ContextMenu>
    );
  };

  const filtered = catalog.type !== "all" || !!catalog.authorId;
  const mineCount = community.page.authors?.find(
    (author) => author.authorId === accountId,
  )?.count;
  const showMine = !!user || !!drafts?.entries.length;
  return (
    <div
      ref={root}
      className="community-library"
      data-plain-keys="local"
      onKeyDown={onRowKeyDown}
    >
      {toolsSlot
        ? createPortal(
            <>
              <button
                type="button"
                className="shapes-fold-tool"
                aria-label="Filter components"
                title="Filter components"
                aria-expanded={!!filterAnchor}
                data-active={filtered || undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setFilterAnchor(filterAnchor ? null : event.currentTarget);
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2.5 3.5h11L9.3 8.6v3.9l-2.6 1.2V8.6Z" />
                </svg>
              </button>
              {community.page.entries.length ? (
                <span className="shapes-fold-count">
                  {community.page.entries.length}
                </span>
              ) : null}
            </>,
            toolsSlot,
          )
        : null}
      {filterAnchor ? (
        <ComponentPopover
          anchor={filterAnchor}
          label="Filter components"
          onClose={() => setFilterAnchor(null)}
        >
          <ComponentCatalogControls
            value={catalog}
            authors={community.page.authors}
            onChange={setCatalog}
          />
          {filtered ? (
            <button
              type="button"
              onClick={() =>
                setCatalog({ version: 1, type: "all", order: catalog.order })
              }
            >
              Clear filters
            </button>
          ) : null}
        </ComponentPopover>
      ) : null}
      {notice ? (
        <div role="status" className="component-library-feedback">
          <span>{notice.text}</span>
          {restorable ? (
            <button
              type="button"
              onClick={() => {
                void changeComponentLifecycle(restorable, "restore")
                  .then(() => {
                    setRestorable(null);
                    showNotice("Restored to library.", true);
                    for (const list of lists.current)
                      list.forget(restorable.id);
                  })
                  .catch((error) => showNotice(String(error)));
              }}
            >
              Restore
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss message"
            title="Dismiss"
            onClick={() => {
              showNotice(null);
              setRestorable(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}
      {showMine ? (
        <details
          className="community-nested"
          data-testid="community-mine"
          open={mineOpen}
          onToggle={(event) => {
            remembered.mine = event.currentTarget.open;
            setMineOpen(event.currentTarget.open);
          }}
        >
          <summary>
            <span>My components</span>
            {mineCount ? <small>{mineCount}</small> : null}
          </summary>
          {user && mineOpen ? (
            <>
              {renderRows(mine, "mine")}
              {listState(
                mine,
                query ? "Nothing of yours matches." : "Nothing published yet.",
                "Couldn’t load your components.",
              )}
            </>
          ) : null}
          {drafts ? (
            <ComponentDraftList
              catalog={drafts}
              onOpen={(target) => onOpenDraft?.(target)}
              onDelete={onDeleteDrafts}
              previewDeletion={previewDraftDeletion}
            />
          ) : null}
          {user ? (
            <details
              className="community-nested"
              open={removedOpen}
              onToggle={(event) => {
                remembered.removed = event.currentTarget.open;
                setRemovedOpen(event.currentTarget.open);
              }}
            >
              <summary>
                <span>{user.isAdmin ? "Deleted (all)" : "Deleted"}</span>
              </summary>
              {removedOpen ? (
                <>
                  {renderRows(removed, "removed")}
                  {listState(
                    removed,
                    "No deleted components.",
                    "Couldn’t load deleted components.",
                  )}
                </>
              ) : null}
            </details>
          ) : null}
        </details>
      ) : null}
      {renderRows(community, "community")}
      {listState(
        community,
        query
          ? `Nothing in Community matches “${query.trim()}”.`
          : filtered
            ? "No components match these filters."
            : "No community components yet.",
        "Couldn’t load community components.",
      )}
      {renderMenu()}
      {card ? (
        <ComponentPreviewCard
          summary={card.summary}
          row={card.row}
          entry={card.entry}
          onHold={() => clearTimeout(previewTimer.current)}
          onRelease={endPreview}
          onClose={closeCard}
          onFilterAuthor={() => filterAuthor(card.summary.authorId)}
        />
      ) : null}
    </div>
  );
}

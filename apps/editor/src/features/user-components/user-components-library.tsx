import { parseSharedComponentEntry } from "./component-library-entry";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { readSessionUser, type SessionUser } from "../../components/account";
import { ContextMenu } from "../../components/context-menu";
import { InlineConfirm } from "../../components/inline-confirm";
import type {
  ComponentCatalogQuery,
  SharedComponent,
} from "./component-library-contract";
import {
  readSharedComponentRecord,
  ComponentLibraryError,
  checkSharedComponentRevision,
  changeComponentLifecycle,
} from "./component-library-client";
import { LibraryCache } from "./library-cache";
import { LibraryPreview } from "./library-preview";
import {
  ComponentMenuItem,
  ComponentRows,
  useComponentRowSurface,
} from "./component-row-surface";
import { ComponentPreviewCard } from "./component-preview-card";
import { ComponentDraftList } from "./component-draft-list";
import { ComponentPopover } from "./component-popover";
import type {
  ComponentDraftCatalog,
  ComponentDraftTarget,
} from "@icm/edit-engine";
import { ComponentCatalogControls } from "./component-catalog-controls";
import { useComponentCatalog } from "./use-component-catalog";
import type { LibraryFold } from "../editor-shell/shapes-panel";

type CatalogList = ReturnType<typeof useComponentCatalog>;
type RecordAction = "details" | "place" | "new" | "update" | "raw";

/** Filters and folds outlive the panel when the left slot changes mode. */
const remembered: {
  catalog: ComponentCatalogQuery;
  mine: boolean;
  removed: boolean;
  scrollTop: number;
} = {
  catalog: { version: 1, type: "all", order: "circuit-first" },
  mine: false,
  removed: false,
  scrollTop: 0,
};

/**
 * The Library's Community fold: every public record on one list of rows, with
 * the signed-in member's own records, drafts and withdrawals folded inside it.
 * The desktop host has its own `native-components-library`.
 */
export default function UserComponentsLibrary({
  fold,
  onEdit,
  onInsert,
  onDropPlacement,
  refresh,
  drafts,
  onDeleteDrafts,
  previewDraftDeletion,
  onOpenDraft,
}: {
  fold: LibraryFold;
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
  const { open, query, toolsSlot } = fold;
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
  const surface = useComponentRowSurface(fold.focusSearch);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const details = useRef(
    new LibraryCache<SharedComponent>(30, 2 * 1024 * 1024),
  );
  const selection = useRef<AbortController | null>(null);
  const abandonSelection = () => {
    selection.current?.abort();
    setBusy(false);
  };
  /** A deleted last draft keeps its fold and Undo hint where they were. */
  const [keepMine, setKeepMine] = useState(false);
  useEffect(() => {
    details.current.clear();
    surface.closeCard();
  }, [refresh]);
  useEffect(() => {
    details.current.clear();
    abandonSelection();
    surface.closeCard();
    surface.setMenu(null);
    setRestorable(null);
    setKeepMine(false);
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
      abandonSelection();
    };
  }, [open, refresh]);
  // The panel remounts when the left slot changes mode; the list comes back
  // from cache after that first render, and only then can it be scrolled.
  const hasRows = community.page.entries.length > 0;
  useEffect(() => {
    const body = surface.root.current?.closest(".shapes-panel-body");
    if (!body || !hasRows) return;
    body.scrollTop = remembered.scrollTop;
    const keep = () => {
      remembered.scrollTop = body.scrollTop;
    };
    body.addEventListener("scroll", keep);
    return () => body.removeEventListener("scroll", keep);
  }, [hasRows]);

  /** Resolves true once placement or editing has started. */
  async function choose(
    summary: ComponentLibrarySummary,
    action: RecordAction,
  ): Promise<boolean> {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setBusy(true);
    showNotice(null);
    setRestorable(null);
    const deleted = summary.status === "deleted";
    try {
      const detailKey = `${summary.id}:${summary.revision}`;
      const cached =
        action === "details" && !deleted
          ? details.current.get(detailKey)
          : undefined;
      if (cached) {
        await checkSharedComponentRevision(summary, controller.signal);
        if (!controller.signal.aborted) surface.pin(summary, cached);
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
        surface.pin(summary, entry);
        return false;
      }
      if (action === "place") return (await onInsert(entry)) !== false;
      await onEdit(entry, action);
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        showNotice(error instanceof Error ? error.message : String(error));
        surface.closeCard();
        if (error instanceof ComponentLibraryError && error.status === 409) {
          details.current.clear();
          // Refresh only this immutable selection; never silently place a newer revision.
          await lists.current
            .find((list) =>
              list.page.entries.some((entry) => entry.id === summary.id),
            )
            ?.reload(controller.signal);
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
  const artwork = (entry: ComponentLibrarySummary) => (
    <LibraryPreview entry={entry} />
  );
  const listState = (
    list: CatalogList,
    empty: string,
    failure: string,
  ): ReactNode =>
    list.error ? (
      <p className="user-components-message" role="status">
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
      <p className="user-components-message" role="status">
        Loading components…
      </p>
    ) : !list.page.entries.length ? (
      <p className="user-components-message">{empty}</p>
    ) : null;

  const closeMenu = () => surface.setMenu(null);
  const menuItem = (label: string, run: () => void) => (
    <ComponentMenuItem label={label} onClose={closeMenu} onSelect={run} />
  );
  const renderMenu = () => {
    if (!surface.menu) return null;
    const { entry } = surface.menu;
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
        position={surface.menu}
        label={`Actions for ${entry.name}`}
        testId="component-context-menu"
        className="hierarchy-context-menu"
        takeFocus={surface.menu.fromKeyboard ?? false}
        onClose={closeMenu}
      >
        {invalid
          ? menuItem("Copy raw record", () => void choose(entry, "raw"))
          : menuItem("Details", () => void choose(entry, "details"))}
        {!invalid && !deleted
          ? menuItem("Create from…", () => void choose(entry, "new"))
          : null}
        {canEdit
          ? menuItem(
              user?.isAdmin ? "Manage" : "Edit",
              () => void choose(entry, "update"),
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
                closeMenu();
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
  const showMine = !!user || !!drafts?.entries.length || keepMine;
  return (
    <div
      ref={surface.root}
      className="user-components-panel"
      data-plain-keys="local"
      onKeyDown={(event) =>
        surface.onKeyDown(
          event,
          lists.current.flatMap((list) => list.page.entries),
        )
      }
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
          <div className="component-catalog-controls">
            <ComponentCatalogControls
              value={catalog}
              authors={community.page.authors}
              onChange={setCatalog}
            />
          </div>
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
          className="user-components-nested"
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
              <ComponentRows
                surface={surface}
                entries={mine.page.entries}
                scope="mine"
                busy={busy}
                authorImplied
                artwork={artwork}
                onPlace={(entry) => choose(entry, "place")}
                onDropPlacement={onDropPlacement}
              />
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
              onDelete={
                onDeleteDrafts &&
                ((targets) => {
                  const error = onDeleteDrafts(targets);
                  if (!error) setKeepMine(true);
                  return error;
                })
              }
              previewDeletion={previewDraftDeletion}
            />
          ) : null}
          {user ? (
            <details
              className="user-components-nested"
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
                  <ComponentRows
                    surface={surface}
                    entries={removed.page.entries}
                    scope="removed"
                    busy={busy}
                    authorImplied={!user.isAdmin}
                    artwork={artwork}
                  />
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
      <ComponentRows
        surface={surface}
        entries={community.page.entries}
        scope="community"
        busy={busy}
        artwork={artwork}
        onPlace={(entry) => choose(entry, "place")}
        onDropPlacement={onDropPlacement}
      />
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
      {surface.card ? (
        <ComponentPreviewCard
          summary={surface.card.summary}
          row={surface.card.row}
          artwork={artwork(surface.card.summary)}
          entry={surface.card.entry}
          onHold={surface.holdPreview}
          onRelease={surface.endPreview}
          onClose={surface.closeCard}
        />
      ) : null}
    </div>
  );
}

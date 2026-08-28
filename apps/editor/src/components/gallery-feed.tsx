import { useEffect, useRef, useState } from "react";
import "../styles/gallery-entry.css";

import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { libraryProjectExamples } from "../examples/library-examples";
import {
  announceGalleryChange,
  galleryPreviewUrl,
  subscribeGalleryRefresh,
} from "../gallery-client";
import { fetchSessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";
import { Masonry } from "./masonry";

export interface GalleryFeedEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  /** Absent only while a newer client is rolling out against an older API. */
  previewRevision?: string;
  schemaVersion: number;
  tags?: string[];
  /**
   * Whether the circuit extracts to a design netlist. A mark of extra
   * completeness, never a gate — a schematic is allowed to be abbreviated,
   * and one without this is listed exactly like one with it.
   */
  netlistable?: boolean;
  likes?: number;
  likedByViewer?: boolean;
}

export interface GalleryFeedPage {
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
}

export interface GalleryFeedState {
  status: "loading" | "ready" | "unavailable";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
}

const resolver = new InMemorySymbolResolver(builtInSymbols);
const OWNER_REJECT_REASONS = [
  "too ugly",
  "circuit incorrect",
  "too simple",
  "duplicate",
] as const;

function joinedRejectReason(reasons: readonly string[], note: string): string {
  const selected = reasons.join("; ");
  const detail = note.trim();
  if (selected && detail) return `${selected} — Note: ${detail}`;
  return selected || detail;
}

function GalleryOwnerMenu({
  entry,
  busy,
  onWithdraw,
}: {
  entry: GalleryFeedEntry;
  busy: boolean;
  onWithdraw: () => void;
}) {
  return (
    <details
      className="gallery-owner-menu"
      data-testid={`gallery-owner-menu-${entry.id}`}
    >
      <summary
        aria-label={`Manage ${entry.name}`}
        title={`Manage ${entry.name}`}
      >
        ⋯
      </summary>
      <div className="gallery-owner-popover">
        <a
          href={`/g/${entry.id}`}
          data-testid={`gallery-owner-edit-${entry.id}`}
        >
          Edit and replace
        </a>
        <button
          type="button"
          disabled={busy}
          data-testid={`gallery-owner-withdraw-${entry.id}`}
          onClick={onWithdraw}
        >
          Withdraw
        </button>
      </div>
    </details>
  );
}

function GalleryOwnerRejectButton({
  entry,
  busy,
  onReject,
}: {
  entry: GalleryFeedEntry;
  busy: boolean;
  onReject: () => void;
}) {
  return (
    <button
      type="button"
      className="gallery-owner-reject-shortcut"
      aria-label={`Reject ${entry.name}`}
      title={`Reject ${entry.name}`}
      disabled={busy}
      data-testid={`gallery-owner-reject-${entry.id}`}
      onClick={onReject}
    >
      ×
    </button>
  );
}

function RejectEntryDialog({
  entry,
  busy,
  onSubmit,
  onClose,
}: {
  entry: GalleryFeedEntry;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const reason = joinedRejectReason(selectedReasons, note);

  function toggleReason(candidate: string): void {
    setSelectedReasons((previous) =>
      previous.includes(candidate)
        ? previous.filter((reason) => reason !== candidate)
        : [...previous, candidate],
    );
  }

  return (
    <div
      className="gallery-owner-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="gallery-owner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gallery-reject-title"
        data-testid="gallery-owner-reject-dialog"
      >
        <h2 id="gallery-reject-title">Reject “{entry.name}”</h2>
        <p>
          The circuit will leave the Gallery immediately. The submitter will see
          this reason in My submissions.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason) onSubmit(reason);
          }}
        >
          <fieldset className="gallery-owner-reason-options">
            <legend>Common reasons (choose all that apply)</legend>
            <div>
              {OWNER_REJECT_REASONS.map((candidate, index) => (
                <label key={candidate}>
                  <input
                    type="checkbox"
                    checked={selectedReasons.includes(candidate)}
                    autoFocus={index === 0}
                    data-testid={`gallery-owner-reject-option-${candidate.replace(/\s/gu, "-")}`}
                    onChange={() => toggleReason(candidate)}
                  />
                  <span>{candidate}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="gallery-reject-note">
            Additional note or other reason <span>(optional)</span>
          </label>
          <textarea
            id="gallery-reject-note"
            value={note}
            maxLength={360}
            placeholder="Add context for the submitter…"
            data-testid="gallery-owner-reject-note"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <div className="gallery-owner-dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="gallery-owner-danger"
              disabled={busy || !reason}
              data-testid="gallery-owner-reject-confirm"
            >
              {busy ? "Rejecting…" : "Reject entry"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

/**
 * The like mark, drawn rather than typed.
 *
 * An emoji is a different picture on every platform and carries its own
 * colour, which on a wall of circuit drawings reads as a sticker. This is one
 * path that inherits the button's colour: outlined until the circuit is
 * liked, filled once it is, so the state is legible without reading a count.
 */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13Z" />
    </svg>
  );
}

function savedAtLabel(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? createdAt
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

/** Bundled examples double as never-empty starter tiles for the feed. */
function bundledTiles() {
  return libraryProjectExamples.map((example) => {
    const topDocument = example.project.documents.find(
      (document) => document.id === example.project.topDocumentId,
    )!;
    return {
      id: example.id,
      name: example.name,
      description: example.description,
      svg: renderDocumentSvg(topDocument, resolver),
    };
  });
}

/** One feed page; the plain first request stays exactly `/api/gallery`. */
export async function loadGalleryFeed(
  fetchLike: typeof fetch = fetch,
  options: {
    cursor?: string | null;
    author?: string | null;
    tags?: readonly string[];
  } = {},
): Promise<GalleryFeedPage | null> {
  const params = new URLSearchParams();
  if (options.author) params.set("author", options.author);
  if (options.tags && options.tags.length > 0) {
    params.set("tags", options.tags.join(","));
  }
  if (options.cursor) params.set("cursor", options.cursor);
  const query = params.toString();
  try {
    const response = await fetchLike(
      `/api/gallery${query ? `?${query}` : ""}`,
      { credentials: "same-origin" },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      entries?: GalleryFeedEntry[];
      nextCursor?: unknown;
    };
    return {
      entries: payload.entries ?? [],
      nextCursor:
        typeof payload.nextCursor === "string" ? payload.nextCursor : null,
    };
  } catch {
    return null;
  }
}

/**
 * Full-screen landing feed: every tile is one published circuit that opens
 * in the editor at `/g/<id>`. Bundled Library examples fill the wall while
 * the community gallery is empty or unreachable (development hosts have no
 * worker), so the landing page is never blank.
 */
export function GalleryFeed({
  visitStats,
}: {
  visitStats?: { pv: number; uv: number } | null | undefined;
}) {
  const [isOwner, setIsOwner] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState<string | null>(null);
  const [ownerNotice, setOwnerNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<GalleryFeedEntry | null>(null);
  const [author, setAuthor] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("author"),
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    typeof window === "undefined"
      ? []
      : (new URLSearchParams(window.location.search).get("tags") ?? "")
          .split(",")
          .filter((tag) => tag.length > 0),
  );
  const [tagOptions, setTagOptions] = useState<
    { tag: string; count: number }[]
  >([]);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser().then((user) => {
      if (!cancelled) setIsOwner(user?.isAdmin === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/gallery/tags", {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          tags?: { tag: string; count: number }[];
        };
        if (!cancelled) setTagOptions(payload.tags ?? []);
      } catch {
        // No menu without the worker; the wall itself still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);
  const [state, setState] = useState<GalleryFeedState>({
    status: "loading",
    entries: [],
    nextCursor: null,
  });
  const loadingMoreRef = useRef(false);
  const firstPageLoadingRef = useRef(true);
  const feedGenerationRef = useRef(0);
  const loadedQueryRef = useRef<string | null>(null);

  useEffect(
    () =>
      subscribeGalleryRefresh((change) => {
        // Invalidate an older first-page or cursor request immediately. The
        // effect triggered below will claim a fresh generation.
        feedGenerationRef.current += 1;
        firstPageLoadingRef.current = true;
        loadingMoreRef.current = false;
        const previewRevision = change?.previewRevision;
        if (change && previewRevision !== undefined) {
          setState((previous) => ({
            ...previous,
            entries: previous.entries.map((entry) =>
              entry.id === change.entryId
                ? { ...entry, previewRevision }
                : entry,
            ),
          }));
        }
        setRefreshSignal((previous) => previous + 1);
      }),
    [],
  );

  /**
   * One thumb per account, taken back by pressing again. The server owns the
   * count; this applies what it returns rather than guessing, so two tabs
   * cannot drift apart.
   */
  async function toggleLike(entryId: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`/api/gallery/${entryId}/like`, {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      return;
    }
    if (response.status === 401) {
      window.location.href = "/api/auth/github/start";
      return;
    }
    if (!response.ok) return;
    const result = (await response.json().catch(() => null)) as {
      likes?: number;
      likedByViewer?: boolean;
    } | null;
    if (!result) return;
    setState((previous) => ({
      ...previous,
      entries: previous.entries.map((entry): GalleryFeedEntry =>
        entry.id === entryId
          ? {
              ...entry,
              likes: result.likes ?? entry.likes ?? 0,
              likedByViewer: result.likedByViewer === true,
            }
          : entry,
      ),
    }));
  }

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const generation = ++feedGenerationRef.current;
    firstPageLoadingRef.current = true;
    loadingMoreRef.current = false;
    const queryKey = `${author ?? ""}\u0000${selectedTags.join(",")}`;
    const changingQuery = loadedQueryRef.current !== queryKey;
    if (changingQuery) {
      setState({
        status: "loading",
        entries: [],
        nextCursor: null,
      });
    }
    void loadGalleryFeed(fetch, { author, tags: selectedTags }).then((page) => {
      if (cancelled || generation !== feedGenerationRef.current) return;
      firstPageLoadingRef.current = false;
      if (page) {
        loadedQueryRef.current = queryKey;
        setState({ status: "ready", ...page });
      } else if (changingQuery) {
        loadedQueryRef.current = queryKey;
        setState({
          status: "unavailable",
          entries: [],
          nextCursor: null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [author, selectedTags, refreshSignal]);

  // The sentinel appends the next newest-first page as it comes into view.
  // Once the server returns no cursor, the wall is complete and stops.
  const { nextCursor } = state;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (nextCursor === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      if (!observed.some((entry) => entry.isIntersecting)) return;
      if (firstPageLoadingRef.current) return;
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      const generation = feedGenerationRef.current;
      void loadGalleryFeed(fetch, {
        author,
        tags: selectedTags,
        cursor: nextCursor,
      }).then((page) => {
        if (generation !== feedGenerationRef.current) return;
        loadingMoreRef.current = false;
        if (!page) return;
        setState((previous) =>
          previous.status === "ready" && previous.nextCursor === nextCursor
            ? {
                ...previous,
                entries: [...previous.entries, ...page.entries],
                nextCursor: page.nextCursor,
              }
            : previous,
        );
      });
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, author, selectedTags]);

  function syncQuery(nextAuthor: string | null, nextTags: string[]): void {
    const url = new URL(window.location.href);
    if (nextAuthor) url.searchParams.set("author", nextAuthor);
    else url.searchParams.delete("author");
    if (nextTags.length > 0) url.searchParams.set("tags", nextTags.join(","));
    else url.searchParams.delete("tags");
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  function selectAuthor(next: string | null): void {
    setAuthor(next);
    syncQuery(next, selectedTags);
  }

  function toggleTag(tag: string): void {
    setSelectedTags((previous) => {
      const next = previous.includes(tag)
        ? previous.filter((candidate) => candidate !== tag)
        : [...previous, tag];
      syncQuery(author, next);
      return next;
    });
  }

  function removeManagedEntry(entry: GalleryFeedEntry): void {
    setState((previous) => ({
      ...previous,
      entries: previous.entries.filter(
        (candidate) => candidate.id !== entry.id,
      ),
    }));
    const removedTags = new Set(entry.tags ?? []);
    if (removedTags.size > 0) {
      setTagOptions((previous) =>
        previous
          .map((option) =>
            removedTags.has(option.tag)
              ? { ...option, count: option.count - 1 }
              : option,
          )
          .filter((option) => option.count > 0),
      );
    }
  }

  async function withdrawEntry(entry: GalleryFeedEntry): Promise<void> {
    if (!window.confirm(`Withdraw “${entry.name}” from the Gallery?`)) return;
    setOwnerBusy(entry.id);
    setOwnerNotice(null);
    try {
      const response = await fetch(`/api/gallery/${entry.id}/recycle`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      removeManagedEntry(entry);
      announceGalleryChange({ entryId: entry.id });
      setOwnerNotice(`“${entry.name}” was moved to the recycle bin.`);
    } catch {
      setOwnerNotice(`Could not withdraw “${entry.name}”.`);
    } finally {
      setOwnerBusy(null);
    }
  }

  async function rejectEntry(reason: string): Promise<void> {
    if (!rejecting || !reason.trim()) return;
    setOwnerBusy(rejecting.id);
    setOwnerNotice(null);
    try {
      const response = await fetch(`/api/gallery/${rejecting.id}/reject`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) throw new Error();
      removeManagedEntry(rejecting);
      announceGalleryChange({ entryId: rejecting.id });
      setOwnerNotice(
        `“${rejecting.name}” was rejected and hidden from the Gallery.`,
      );
      setRejecting(null);
    } catch {
      setOwnerNotice(`Could not reject “${rejecting.name}”.`);
    } finally {
      setOwnerBusy(null);
    }
  }

  const entries = state.entries;

  return (
    <main className="gallery-shell" data-testid="gallery-feed">
      <GalleryChrome subtitle="Community gallery" visitStats={visitStats} />

      {tagOptions.length > 0 ? (
        <div className="gallery-tag-bar" data-testid="gallery-tag-bar">
          {tagOptions.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={
                selectedTags.includes(tag)
                  ? "gallery-tag-option gallery-tag-selected"
                  : "gallery-tag-option"
              }
              data-testid={`gallery-tag-option-${tag.replace(/\s/gu, "-")}`}
              aria-pressed={selectedTags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag} <span>{count}</span>
            </button>
          ))}
          {selectedTags.length > 0 ? (
            <button
              type="button"
              className="gallery-tag-option gallery-tag-clear"
              data-testid="gallery-tags-clear"
              onClick={() => {
                setSelectedTags([]);
                syncQuery(author, []);
              }}
            >
              Clear tags
            </button>
          ) : null}
        </div>
      ) : null}
      {author ? (
        <div className="gallery-filter" data-testid="gallery-filter">
          <span>Circuits by {author}</span>
          <button
            type="button"
            data-testid="gallery-filter-clear"
            onClick={() => selectAuthor(null)}
          >
            Show everyone
          </button>
        </div>
      ) : null}
      {ownerNotice ? (
        <p className="gallery-status" data-testid="gallery-owner-notice">
          {ownerNotice}
        </p>
      ) : null}
      {state.status === "loading" ? (
        <p className="gallery-status" data-testid="gallery-loading">
          Loading gallery…
        </p>
      ) : (
        <section className="gallery-wall">
          <Masonry
            aria-label="Published circuits"
            items={[
              ...entries.map((entry) => ({
                key: entry.id,
                node: (
                  <div className="gallery-tile-wrap">
                    <a
                      className="gallery-tile"
                      href={`/g/${entry.id}`}
                      data-testid={`gallery-tile-${entry.id}`}
                    >
                      <span className="gallery-tile-preview">
                        <img
                          src={galleryPreviewUrl(
                            entry.id,
                            entry.previewRevision,
                          )}
                          alt={`Preview of ${entry.name}`}
                          loading="lazy"
                        />
                      </span>
                      <span className="gallery-tile-copy">
                        <span className="gallery-tile-name">
                          {entry.name}
                          {entry.netlistable ? (
                            <span
                              className="gallery-tile-star"
                              data-testid={`gallery-star-${entry.id}`}
                              title="Extracts to a SPICE netlist"
                              aria-label="Extracts to a SPICE netlist"
                            >
                              ★
                            </span>
                          ) : null}
                        </span>
                        <span className="gallery-tile-meta">
                          {entry.author ? (
                            <>
                              <button
                                type="button"
                                className="gallery-tile-author"
                                data-testid={`gallery-author-${entry.id}`}
                                title={`Show circuits by ${entry.author}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  selectAuthor(entry.author);
                                }}
                              >
                                {entry.author}
                              </button>
                              {" · "}
                            </>
                          ) : null}
                          {savedAtLabel(entry.createdAt)}
                          {" · "}
                          <button
                            type="button"
                            className="gallery-tile-like"
                            data-testid={`gallery-like-${entry.id}`}
                            aria-pressed={entry.likedByViewer === true}
                            title={
                              entry.likedByViewer
                                ? "Remove your like"
                                : "Like this circuit"
                            }
                            aria-label={
                              entry.likedByViewer
                                ? `Remove your like from ${entry.name}`
                                : `Like ${entry.name}`
                            }
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void toggleLike(entry.id);
                            }}
                          >
                            <HeartIcon filled={entry.likedByViewer === true} />
                            {entry.likes ?? 0}
                          </button>
                        </span>
                        {entry.description ? (
                          <span className="gallery-tile-description">
                            {entry.description}
                          </span>
                        ) : null}
                        {entry.tags && entry.tags.length > 0 ? (
                          <span className="gallery-tile-tags">
                            {entry.tags.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                className="gallery-tile-tag"
                                data-testid={`gallery-tile-tag-${entry.id}-${tag.replace(/\s/gu, "-")}`}
                                title={`Filter by ${tag}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (!selectedTags.includes(tag))
                                    toggleTag(tag);
                                }}
                              >
                                {tag}
                              </button>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </a>
                    {isOwner ? (
                      <>
                        <GalleryOwnerRejectButton
                          entry={entry}
                          busy={ownerBusy === entry.id}
                          onReject={() => setRejecting(entry)}
                        />
                        <GalleryOwnerMenu
                          entry={entry}
                          busy={ownerBusy === entry.id}
                          onWithdraw={() => void withdrawEntry(entry)}
                        />
                      </>
                    ) : null}
                  </div>
                ),
              })),
              ...(entries.length === 0 && author === null
                ? bundledTiles().map((tile) => ({
                    key: `bundled-${tile.id}`,
                    node: (
                      <a
                        className="gallery-tile gallery-tile-bundled"
                        href={`/editor?example=${tile.id}`}
                        data-testid={`gallery-bundled-${tile.id}`}
                      >
                        <span
                          className="gallery-tile-preview"
                          // Server-free preview: our own renderer's escaped SVG output.
                          dangerouslySetInnerHTML={{ __html: tile.svg }}
                        />
                        <span className="gallery-tile-copy">
                          <span className="gallery-tile-kicker">
                            Built-in example
                          </span>
                          <span className="gallery-tile-name">{tile.name}</span>
                          <span className="gallery-tile-description">
                            {tile.description}
                          </span>
                        </span>
                      </a>
                    ),
                  }))
                : []),
            ]}
          />
          {entries.length === 0 && author !== null ? (
            <p className="gallery-status" data-testid="gallery-filter-empty">
              No public circuits by {author} yet.
            </p>
          ) : null}
        </section>
      )}
      <div
        ref={sentinelRef}
        className="gallery-sentinel"
        data-testid="gallery-sentinel"
        aria-hidden="true"
      />
      <footer className="gallery-footnote">
        Browse freely; open any circuit and edit your own copy. Publishing joins
        in a later release with sign-in.
      </footer>
      {rejecting ? (
        <RejectEntryDialog
          entry={rejecting}
          busy={ownerBusy === rejecting.id}
          onSubmit={(reason) => void rejectEntry(reason)}
          onClose={() => setRejecting(null)}
        />
      ) : null}
    </main>
  );
}

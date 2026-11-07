import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import "../styles/gallery-entry.css";
import "../styles/datasets-page.css";
import "../styles/review-page.css";
import "./gallery-tag-groups.css";
import { galleryPreviewUrl } from "../gallery-client";
import { COMPARISON_SOURCES, gallerySourceByKey } from "../gallery-sources";
import { verdictOf, type ComparisonVerdict } from "../dataset-comparisons";
import {
  flagLabel,
  flagsFor,
  hasReference,
  nextUnreviewed,
  referencesOnlyFromSearch,
  reviewProgress,
  reviewed,
  REVIEW_STORES,
  scopeFromSearch,
  shuffledQueue,
  withReview,
  type EntryFix,
  type ReviewCard,
  type ReviewMark,
  type ShownReview,
} from "../review-queue";
import { fetchSessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";
import { GalleryReviewTabs, ReviewModeSwitch } from "./review-tabs";
import { SidebarFoldButton, useCollapsedSidebar } from "./gallery-tag-sidebar";
import { HeartIcon } from "./gallery-feed-tile";
import { MarkablePicture, useInstanceBoxes, ZoomView } from "./review-picture";
import { NetlistPair, useNetlistText } from "./review-netlists";

type Load =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "failed" }
  | {
      status: "ready";
      /** Each store's queue, in the server's order. */
      lists: Record<string, ReviewCard[]>;
      /** Random's order: every store's drawings shuffled, by id. */
      mixed: string[];
    };

const scopeName = (scope: string) =>
  scope === "community"
    ? "Community"
    : (gallerySourceByKey(scope)?.name ?? scope);
const num = (value: number) => value.toLocaleString("en-US");

/** /review: one drawing at a time beside its reference; Pass or flag it. */
export function ReviewPage({
  visitStats,
  fetchLike = fetch,
}: {
  visitStats?: { pv: number; uv: number } | null;
  fetchLike?: typeof fetch;
}) {
  const [scope, setScope] = useState(() =>
    scopeFromSearch(window.location.search),
  );
  const [referencesOnly, setReferencesOnly] = useState(() =>
    referencesOnlyFromSearch(window.location.search),
  );
  // A link from Statistics names the drawing to open.
  const focusId = useRef(new URLSearchParams(window.location.search).get("id"));
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [index, setIndex] = useState(0);
  const [flags, setFlags] = useState<string[]>([]);
  // Not pass chosen: the reasons show, and at least one must be picked.
  const [failing, setFailing] = useState(false);
  const [note, setNote] = useState("");
  // Boxes the reviewer drew on the pictures, numbered in this order.
  const [marks, setMarks] = useState<ReviewMark[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarCollapsed, toggleSidebar] = useCollapsedSidebar(
    "icm.review.sidebarCollapsed",
  );
  // The Owner sees everyone's verdicts at once and resolves issues.
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    void fetchSessionUser().then((user) => setOwner(user?.isOwner === true));
  }, []);

  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `/review?scope=${scope}${referencesOnly ? "&refs=1" : ""}`,
    );
  }, [scope, referencesOnly]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    void Promise.all(
      REVIEW_STORES.map(async (store) => {
        const response = await fetchLike(`/api/gallery/review/${store}/queue`, {
          credentials: "same-origin",
        });
        if (response.status === 401) return null;
        if (!response.ok) throw new Error(String(response.status));
        const { entries } = (await response.json()) as {
          entries: Omit<ReviewCard, "scope">[];
        };
        return entries.map((entry) => ({ ...entry, scope: store }));
      }),
    )
      .then((lists): Load => {
        if (lists.some((list) => list === null))
          return { status: "signed-out" };
        const ready = lists as ReviewCard[][];
        return {
          status: "ready",
          lists: Object.fromEntries(
            REVIEW_STORES.map((store, at) => [store, ready[at]!]),
          ),
          mixed: shuffledQueue(ready.flat()).map((each) => each.id),
        };
      })
      .catch((): Load => ({ status: "failed" }))
      .then((next) => {
        if (cancelled) return;
        setLoad(next);
        setIndex(0);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchLike]);

  // Every store's queue loads once; the sidebar's rows only filter them.
  const byScope = useMemo((): Record<string, ReviewCard[]> => {
    if (load.status !== "ready") return {};
    const byId = new Map(
      Object.values(load.lists)
        .flat()
        .map((each) => [each.id, each]),
    );
    return { random: load.mixed.map((id) => byId.get(id)!), ...load.lists };
  }, [load]);
  const all = useMemo(() => byScope[scope] ?? [], [byScope, scope]);
  // Each row's count, under the reference filter when it is on.
  const counts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(byScope).map(([key, list]) => [
          key,
          (referencesOnly ? list.filter(hasReference) : list).length,
        ]),
      ),
    [byScope, referencesOnly],
  );
  const cards = useMemo(
    () => (referencesOnly ? all.filter(hasReference) : all),
    [all, referencesOnly],
  );
  const card = cards[index];
  const progress = useMemo(() => reviewProgress(cards), [cards]);
  useEffect(() => {
    if (!focusId.current || cards.length === 0) return;
    const found = cards.findIndex((each) => each.id === focusId.current);
    focusId.current = null;
    if (found >= 0) setIndex(found);
  }, [cards]);
  const replaceCard = useCallback(
    (id: string, change: (card: ReviewCard) => ReviewCard) =>
      setLoad((current) =>
        current.status === "ready"
          ? {
              ...current,
              lists: Object.fromEntries(
                Object.entries(current.lists).map(([store, list]) => [
                  store,
                  list.map((each) => (each.id === id ? change(each) : each)),
                ]),
              ),
            }
          : current,
      ),
    [],
  );

  const choose = useCallback(
    (next: string) => {
      // Random again shuffles anew, as the Gallery's Random does.
      if (next === "random" && scope === "random")
        setLoad((current) =>
          current.status === "ready"
            ? {
                ...current,
                mixed: shuffledQueue(Object.values(current.lists).flat()).map(
                  (each) => each.id,
                ),
              }
            : current,
        );
      setScope(next);
      setIndex(0);
    },
    [scope],
  );

  // Back from the editor (Open in editor opens a tab): a drawing changed
  // there shows its new version here; reviews of the old one no longer count.
  useEffect(() => {
    if (!card) return;
    const id = card.id;
    const revision = card.previewRevision;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void fetchLike(`/api/gallery/${encodeURIComponent(id)}?summary=1`, {
        credentials: "same-origin",
      })
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            payload: {
              entry?: { previewRevision?: string; fixedBy?: string[] };
            } | null,
          ) => {
            const entry = payload?.entry;
            if (!entry?.previewRevision || entry.previewRevision === revision)
              return;
            replaceCard(id, (each) => ({
              ...each,
              previewRevision: entry.previewRevision!,
              ...(entry.fixedBy ? { fixedBy: entry.fixedBy } : {}),
              mine: each.mine ? { ...each.mine, current: false } : null,
              reviews: 0,
            }));
            setMessage("This drawing just changed: here is its new version.");
          },
        )
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [card?.id, card?.previewRevision, fetchLike, replaceCard]);

  // A new card starts clean, or with the reviewer's own current review.
  useEffect(() => {
    const own = card?.mine?.current ? card.mine : null;
    setFlags(own?.verdict === "issue" ? own.flags : []);
    setFailing(own?.verdict === "issue");
    setNote(own?.note ?? "");
    setMarks(own?.marks ?? []);
  }, [card?.id, card?.mine]);
  useEffect(() => setMessage(""), [card?.id]);

  const go = useCallback(
    (next: number | null) => {
      if (next === null) setMessage("Every drawing here has your review.");
      else setIndex(Math.max(0, Math.min(cards.length - 1, next)));
    },
    [cards.length],
  );

  // Pass, or an issue: its flags, else Other when only a comment or boxes
  // say what is wrong.
  const submit = useCallback(
    async (verdict: "pass" | "issue") => {
      if (!card || busy) return;
      setBusy(true);
      try {
        const response = await fetchLike(
          `/api/gallery/${encodeURIComponent(card.id)}/reviews`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              revision: card.previewRevision,
              verdict,
              flags: verdict === "pass" ? [] : flags,
              note,
              marks,
            }),
          },
        );
        const payload = (await response.json()) as {
          review?: ShownReview;
          error?: string;
        };
        if (!response.ok || !payload.review) {
          setMessage(
            payload.error === "stale"
              ? "This drawing changed since it loaded. Reload to review the new version."
              : payload.error === "daily-review-limit"
                ? "That is today's limit of reviews here. Thank you!"
                : "The review could not be saved.",
          );
          return;
        }
        const review = payload.review;
        replaceCard(card.id, (each) => withReview(each, review));
        go(
          nextUnreviewed(
            cards.map((each) =>
              each.id === card.id ? withReview(each, review) : each,
            ),
            index,
          ),
        );
      } catch {
        setMessage("The review could not be saved.");
      } finally {
        setBusy(false);
      }
    },
    [card, busy, fetchLike, flags, note, marks, cards, go, index, replaceCard],
  );

  // A like is the reader's own mark, apart from the review.
  const toggleLike = useCallback(async () => {
    if (!card) return;
    const response = await fetchLike(
      `/api/gallery/${encodeURIComponent(card.id)}/like`,
      { method: "POST", credentials: "same-origin" },
    ).catch(() => null);
    if (!response?.ok) {
      setMessage("The like could not be saved.");
      return;
    }
    const { likedByViewer, likes } = (await response.json()) as {
      likedByViewer: boolean;
      likes: number;
    };
    replaceCard(card.id, (each) => ({ ...each, likedByViewer, likes }));
  }, [card, fetchLike, replaceCard]);

  const toggleFlag = useCallback((key: string) => {
    setFailing(true);
    setFlags((current) =>
      current.includes(key)
        ? current.filter((flag) => flag !== key)
        : [...current, key],
    );
  }, []);

  // Not pass opens the reasons; with one chosen it sends the issue.
  const notPass = useCallback(() => {
    if (!failing) setFailing(true);
    else if (flags.length) void submit("issue");
    else setMessage("Choose at least one reason.");
  }, [failing, flags.length, submit]);
  const passIt = useCallback(() => {
    setFailing(false);
    void submit("pass");
  }, [submit]);

  // Enter submits, digits flag, ← → step, N jumps to the next unreviewed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof Element &&
        event.target.closest("textarea, input, select");
      if (typing) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (failing) notPass();
          else passIt();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const flag = flagsFor(card?.scope ?? scope).find(
        (each) => each.hotkey === event.key,
      );
      if (flag) toggleFlag(flag.key);
      else if (event.key === "Enter") {
        if (failing) notPass();
        else passIt();
      } else if (event.key.toLowerCase() === "x") notPass();
      else if (event.key === "Escape" && failing) {
        setFailing(false);
        setFlags([]);
      } else if (event.key.toLowerCase() === "l") void toggleLike();
      else if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key.toLowerCase() === "n")
        go(nextUnreviewed(cards, index));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    scope,
    card,
    failing,
    toggleFlag,
    toggleLike,
    notPass,
    passIt,
    go,
    index,
    cards,
  ]);

  return (
    <main
      className="gallery-shell datasets-shell review-page"
      data-testid="review-page"
    >
      <GalleryChrome subtitle="Review" visitStats={visitStats} />
      <GalleryReviewTabs>
        <ReviewModeSwitch mode="review" scope={scope} />
      </GalleryReviewTabs>
      {/* The Gallery's own frame: its sidebar at the left, the work beside. */}
      <div className="gallery-browser">
        <ScopeSidebar
          scope={scope}
          choose={choose}
          counts={counts}
          referencesOnly={referencesOnly}
          references={
            load.status === "ready" ? all.filter(hasReference).length : null
          }
          onReferencesOnly={() => {
            setReferencesOnly((current) => !current);
            setIndex(0);
          }}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
        />
        <div className="gallery-main">
          <div className="page-body review-body">
            {load.status === "loading" ? (
              <p className="gallery-status">Loading the drawings…</p>
            ) : load.status === "signed-out" ? (
              <p className="gallery-status" data-testid="review-signed-out">
                Sign in (top right) to review.
              </p>
            ) : load.status === "failed" ? (
              <p className="gallery-status">
                The drawings could not be loaded. Reload to try again.
              </p>
            ) : !card ? (
              <p className="gallery-status">
                {referencesOnly
                  ? "No drawing here has a reference figure yet."
                  : "Nothing to review here yet."}
              </p>
            ) : (
              <>
                <div className="review-toolbar">
                  <Progress {...progress} total={cards.length} />
                  <span className="review-steps">
                    <button
                      type="button"
                      title="Previous (←)"
                      aria-label="Previous"
                      onClick={() => go(index - 1)}
                    >
                      ←
                    </button>
                    <span className="position">
                      {num(index + 1)} / {num(cards.length)}
                    </span>
                    <button
                      type="button"
                      title="Next (→)"
                      aria-label="Next"
                      onClick={() => go(index + 1)}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      onClick={() => go(nextUnreviewed(cards, index))}
                    >
                      Next unreviewed <kbd>N</kbd>
                    </button>
                  </span>
                </div>
                <ReviewItem
                  key={card.id}
                  card={card}
                  fetchLike={fetchLike}
                  owner={owner}
                  marks={marks}
                  onAddMark={(mark) =>
                    setMarks((current) =>
                      current.length >= 12 ? current : [...current, mark],
                    )
                  }
                >
                  <div className="review-actions">
                    <textarea
                      className="review-note"
                      rows={1}
                      placeholder={
                        flags.length
                          ? "What is wrong, and where (optional)"
                          : "Comment (optional)"
                      }
                      title={
                        flags.length
                          ? "Such as: M3's drain on VOUT instead of X. ⌘/Ctrl+Enter submits."
                          : "⌘/Ctrl+Enter submits."
                      }
                      value={note}
                      maxLength={1000}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <button
                      type="button"
                      className={`review-like${card.likedByViewer ? " on" : ""}`}
                      aria-pressed={card.likedByViewer}
                      title={
                        card.likedByViewer
                          ? "Remove your like (L)"
                          : "Like this circuit (L)"
                      }
                      onClick={() => void toggleLike()}
                    >
                      <HeartIcon filled={card.likedByViewer} />{" "}
                      {num(card.likes)}
                    </button>
                    <button
                      type="button"
                      className="review-pass"
                      disabled={busy}
                      title="Nothing wrong with it"
                      data-testid="review-pass"
                      onClick={passIt}
                    >
                      <span aria-hidden="true">✓</span> Pass
                      {failing ? null : <kbd>Enter</kbd>}
                    </button>
                    <button
                      type="button"
                      className={`review-issue${flags.length ? " ready" : ""}`}
                      disabled={busy || (failing && flags.length === 0)}
                      title={
                        !failing
                          ? "Something is wrong: choose the reasons (X)"
                          : flags.length
                            ? "Send the reasons with your comment and boxes"
                            : "Choose at least one reason below"
                      }
                      data-testid="review-not-pass"
                      onClick={notPass}
                    >
                      <span aria-hidden="true">✕</span>{" "}
                      {failing ? "Submit issue" : "Not pass"}
                      {failing ? (
                        flags.length ? (
                          <kbd>Enter</kbd>
                        ) : null
                      ) : (
                        <kbd>X</kbd>
                      )}
                    </button>
                  </div>
                  {failing ? (
                    <div
                      className="review-flags"
                      role="group"
                      aria-label="Reasons"
                    >
                      {flagsFor(card.scope).map((flag) => (
                        <button
                          key={flag.key}
                          type="button"
                          className={`review-flag${flags.includes(flag.key) ? " on" : ""}`}
                          aria-pressed={flags.includes(flag.key)}
                          onClick={() => toggleFlag(flag.key)}
                        >
                          <kbd>{flag.hotkey}</kbd>
                          {flag.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {marks.length ? (
                    <div className="review-marks-row">
                      {marks.map((mark, number) => (
                        <button
                          key={number}
                          type="button"
                          className="review-mark-chip"
                          title="Remove this box"
                          onClick={() =>
                            setMarks((current) =>
                              current.filter((_, at) => at !== number),
                            )
                          }
                        >
                          <b>{number + 1}</b>
                          {mark.side === "original" ? "Original" : "Redraw"} ×
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message ? <p className="review-message">{message}</p> : null}
                </ReviewItem>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Progress({
  passed,
  flagged,
  left,
  total,
}: {
  passed: number;
  flagged: number;
  left: number;
  total: number;
}) {
  const width = (part: number) => `${(100 * part) / Math.max(1, total)}%`;
  return (
    <div className="review-progress">
      <div className="bar" aria-hidden="true">
        <span className="v-match" style={{ width: width(passed) }} />
        <span className="v-error" style={{ width: width(flagged) }} />
      </div>
      <span>
        <b>{num(passed)}</b> passed · <b>{num(flagged)}</b> flagged ·{" "}
        <b>{num(left)}</b> to review
      </span>
    </div>
  );
}

/**
 * One drawing: its name, the verdict controls and others' reviews, the two
 * pictures, what comparing the netlists found, then both netlists in full.
 */
function ReviewItem({
  card,
  fetchLike,
  owner,
  marks,
  onAddMark,
  children,
}: {
  card: ReviewCard;
  fetchLike: typeof fetch;
  owner: boolean;
  marks: readonly ReviewMark[];
  onAddMark: (mark: ReviewMark) => void;
  children: ReactNode;
}) {
  const comparison = card.comparison;
  const store = card.scope;
  const [zoomed, setZoomed] = useState(false);
  // The device lit in the netlists, by its instance in our drawing.
  const [lit, setLit] = useState<string | null>(null);
  // Another review's boxes, while the reader points at it.
  const [shownMarks, setShownMarks] = useState<ReviewMark[] | null>(null);
  const theirs = useNetlistText(
    comparison
      ? `/api/gallery/sources/${store}/comparisons/${encodeURIComponent(card.id)}`
      : null,
    (payload) => payload.sourceNetlist,
    "The dataset gives no netlist.",
    fetchLike,
  );
  const ours = useNetlistText(
    `/api/gallery/${encodeURIComponent(card.id)}?netlist=spice&v=${encodeURIComponent(card.previewRevision)}`,
    (payload) => payload.netlist?.text,
    "This drawing exports no netlist.",
    fetchLike,
  );
  const original = comparison
    ? {
        src: `/api/gallery/sources/${store}/comparisons/${encodeURIComponent(card.id)}/figure?v=${encodeURIComponent(comparison.figureRevision)}`,
        alt: "Original figure",
        label: `Original · ${scopeName(store)}`,
      }
    : card.reference
      ? {
          src: `/api/gallery/${encodeURIComponent(card.id)}/reference?v=${encodeURIComponent(card.reference.revision)}`,
          alt: "Reference image",
          label: "Reference · uploaded by its author",
        }
      : null;
  const redraw = {
    src: galleryPreviewUrl(card.id, card.previewRevision),
    alt: "The drawing under review",
    label: "Redraw · Analog Canvas",
  };
  const boxes = useInstanceBoxes(redraw.src, fetchLike);
  const highlight = lit ? (boxes.get(lit) ?? null) : null;
  const picture = (
    shownPicture: { src: string; alt: string },
    side: ReviewMark["side"],
  ) => (
    <MarkablePicture
      src={shownPicture.src}
      alt={shownPicture.alt}
      side={side}
      marks={marks}
      shown={shownMarks}
      highlight={side === "redraw" ? highlight : null}
      onAdd={onAddMark}
      onOpen={() => setZoomed(true)}
    />
  );
  return (
    <article className="review-item">
      <div className="head">
        <span className="id">{card.id}</span>
        <span className="name" title={card.name}>
          {card.name}
        </span>
        <span className="meta">
          {comparison ? scopeName(store) : card.author}
          {card.fixedBy?.length
            ? ` · fixed by ${card.fixedBy.join(", ")}`
            : ""}{" "}
          · {card.components} devices
        </span>
        <a
          className="open"
          href={`/g/${encodeURIComponent(card.id)}`}
          target="_blank"
          rel="noopener"
          title="Opens in a new tab; come back here and the drawing refreshes"
        >
          Open in editor
        </a>
      </div>
      {children}
      <OthersReviews
        card={card}
        fetchLike={fetchLike}
        owner={owner}
        onShowMarks={setShownMarks}
      />
      <div className="review-cols">
        <div>
          <h4>
            {comparison ? "Original" : "Reference"}{" "}
            <span>
              ·{" "}
              {comparison
                ? scopeName(store)
                : card.reference
                  ? "uploaded by its author"
                  : "none yet"}
            </span>
          </h4>
          {original ? (
            picture(original, "original")
          ) : (
            <div className="review-pic">
              <span className="none">No reference figure</span>
            </div>
          )}
        </div>
        <div>
          <h4>
            Redraw <span>· Analog Canvas</span>
          </h4>
          {picture(redraw, "redraw")}
        </div>
        {comparison ? <VerdictNote comparison={comparison} /> : null}
        <NetlistPair
          theirs={comparison ? theirs : null}
          ours={ours}
          onLight={setLit}
        />
      </div>
      {zoomed ? (
        <ZoomView
          title={`${card.id} · ${card.name}`}
          pictures={[
            ...(original ? [{ ...original, side: "original" as const }] : []),
            { ...redraw, side: "redraw" as const, highlight },
          ]}
          marks={marks}
          shown={shownMarks}
          onAdd={onAddMark}
          onClose={() => setZoomed(false)}
        />
      ) : null}
    </article>
  );
}

/**
 * Between the pictures and the netlists, what comparing the two netlists
 * found: the verdict and its kind, then where the dataset differs.
 */
function VerdictNote({
  comparison,
}: {
  comparison: NonNullable<ReviewCard["comparison"]>;
}) {
  const verdict = verdictOf(comparison.verdict as ComparisonVerdict);
  const sentence =
    comparison.verdict === "match"
      ? "Both netlists describe the same circuit."
      : comparison.reason || comparison.detail;
  const kind =
    comparison.verdict !== "match" && comparison.category
      ? ` · ${comparison.category}`
      : "";
  return (
    <div className="review-verdict" data-testid="review-verdict">
      <span
        className={`datasets-icon v-${comparison.verdict}`}
        aria-hidden="true"
      >
        {verdict.icon}
      </span>
      <p>
        <b>{verdict.label}</b> ({verdict.what}){kind ? <b>{kind}</b> : null}
        {sentence && sentence !== comparison.category ? ` — ${sentence}` : ""}
      </p>
    </div>
  );
}

/** Everyone's current reviews, once the reviewer's own is in (the Owner: always). */
function OthersReviews({
  card,
  fetchLike,
  owner,
  onShowMarks,
}: {
  card: ReviewCard;
  fetchLike: typeof fetch;
  owner: boolean;
  /** Pointing at a review shows its boxes on the pictures. */
  onShowMarks: (marks: ReviewMark[] | null) => void;
}) {
  const [shown, setShown] = useState<ShownReview[] | null>(null);
  const [fixes, setFixes] = useState<EntryFix[]>([]);
  const [round, setRound] = useState(0);
  const unblinded = reviewed(card) || owner;
  const key = `${card.mine?.id ?? ""}:${owner}:${round}`;
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!unblinded || loaded.current === key) return;
    loaded.current = key;
    void fetchLike(`/api/gallery/${encodeURIComponent(card.id)}/reviews`, {
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (payload: { current?: ShownReview[]; fixes?: EntryFix[] } | null) => {
          setShown(payload?.current ?? []);
          setFixes(payload?.fixes ?? []);
        },
      )
      .catch(() => setShown([]));
  }, [card.id, unblinded, key, fetchLike]);
  const resolve = async (review: ShownReview) => {
    await fetchLike(
      `/api/gallery/${encodeURIComponent(card.id)}/reviews/${review.id}`,
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      },
    );
    setRound((value) => value + 1);
  };
  if (!unblinded)
    return card.reviews ? (
      <p className="review-others muted">
        {card.reviews} other review{card.reviews === 1 ? "" : "s"}, shown once
        yours is in.
      </p>
    ) : null;
  return (
    <ul className="review-others">
      {fixes.slice(0, 3).map((fix) => (
        <li key={fix.id} className="fix">
          <span className="datasets-icon v-notation" aria-hidden="true">
            ✎
          </span>
          <b>{fix.editor}</b> fixed it: {fix.devices} devices, {fix.wires}{" "}
          wires, {fix.labels} labels changed
          {fix.addressed ? ` · answered ${fix.addressed} issue(s)` : ""}
          <span className="meta"> · {fix.at.slice(0, 10)}</span>
        </li>
      ))}
      {(shown ?? []).map((review) => (
        <li
          key={review.id}
          className={review.marks?.length ? "with-marks" : undefined}
          onMouseEnter={() => review.marks?.length && onShowMarks(review.marks)}
          onMouseLeave={() => onShowMarks(null)}
        >
          <span
            className={`datasets-icon ${review.verdict === "pass" ? "v-match" : "v-error"}`}
            aria-hidden="true"
          >
            {review.verdict === "pass" ? "✓" : "✕"}
          </span>
          <b>{review.reviewer}</b>
          {review.verdict === "pass"
            ? " passed"
            : ` flagged ${review.flags.map(flagLabel).join(", ")}`}
          {review.note ? <span className="note"> — {review.note}</span> : null}
          {review.marks?.length ? (
            <span
              className="review-mark-count"
              title="Point here to show this review's boxes on the pictures"
            >
              ▭ {review.marks.length}
            </span>
          ) : null}
          {review.resolved ? <span className="meta"> · resolved</span> : null}
          {owner && review.verdict === "issue" && !review.resolved ? (
            <button type="button" onClick={() => void resolve(review)}>
              Resolve
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The left column, in the Gallery sidebar's own markup and look: one list
 * of filters. Where the drawings come from (Random mixes them all; Random
 * again shuffles anew), then only those with a reference figure; each row
 * counts what it would show. It folds to a strip as that one does.
 */
function ScopeSidebar({
  scope,
  choose,
  counts,
  referencesOnly,
  references,
  onReferencesOnly,
  collapsed,
  onToggle,
}: {
  scope: string;
  choose: (scope: string) => void;
  counts: Record<string, number>;
  referencesOnly: boolean;
  references: number | null;
  onReferencesOnly: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed)
    return (
      <div className="gallery-sidebar-slot" data-collapsed="true">
        <SidebarFoldButton
          collapsed
          onToggle={onToggle}
          testId="review-sidebar-fold"
        />
      </div>
    );
  const item = (key: string, label: string) => (
    <button
      key={key}
      type="button"
      className="gallery-sidebar-option"
      aria-pressed={scope === key}
      data-testid={`review-scope-${key}`}
      title={
        key === "random" && scope === "random" ? "Shuffle again" : undefined
      }
      onClick={() => choose(key)}
    >
      <span>{label}</span>
      <span className="gallery-sidebar-count">
        {counts[key] === undefined ? "" : num(counts[key])}
      </span>
    </button>
  );
  return (
    <div className="gallery-sidebar-slot">
      <div className="gallery-sidebar-search review-sidebar-top">
        <h2>Filter</h2>
        <SidebarFoldButton
          collapsed={false}
          onToggle={onToggle}
          testId="review-sidebar-fold"
        />
      </div>
      <aside className="gallery-tag-sidebar" aria-label="Filter">
        <div className="review-sidebar-list">
          {item("random", "Random")}
          {item("community", "Community")}
          {COMPARISON_SOURCES.map((source) => item(source.key, source.name))}
        </div>
        <div className="review-sidebar-list">
          <button
            type="button"
            className="gallery-sidebar-option"
            aria-pressed={referencesOnly}
            data-testid="review-references-only"
            title="Only drawings with an original figure or a reference image"
            onClick={onReferencesOnly}
          >
            <span>With a reference figure</span>
            <span className="gallery-sidebar-count">
              {references === null ? "" : num(references)}
            </span>
          </button>
        </div>
      </aside>
    </div>
  );
}

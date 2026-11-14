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
import { galleryLikeRequest } from "../gallery-like-request";
import { galleryPublicationRequest } from "../gallery-publication-request";
import { gallerySourceByKey } from "../gallery-sources";
import { verdictOf, type ComparisonVerdict } from "../dataset-comparisons";
import {
  authorFromSearch,
  entryIdOf,
  flagLabel,
  flagsFor,
  hasReference,
  matchesMine,
  matchesReviewSearch,
  mineFromSearch,
  mineProgress,
  MINE_FILTERS,
  nextUnreviewed,
  referencesOnlyByDefault,
  referencesOnlyFromSearch,
  reviewAuthors,
  reviewProgress,
  reviewed,
  settled,
  REVIEW_STORES,
  scopeFromSearch,
  shuffledQueue,
  withReview,
  type EntryFix,
  type MineFilter,
  type ReviewCard,
  type ReviewMark,
  type ShownReview,
} from "../review-queue";
import { fetchSessionUser, readSessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";
import { GalleryReviewTabs, ReviewModeSwitch } from "./review-tabs";
import { useCollapsedSidebar } from "./gallery-tag-sidebar";
import { HeartIcon } from "./gallery-feed-tile";
import { MarkablePicture, useInstanceBoxes, ZoomView } from "./review-picture";
import { NetlistPair, useNetlistText } from "./review-netlists";
import { AutoCheck } from "./review-auto-check";
import { ScopeSidebar } from "./review-sidebar";
import { ReviewReferenceDrop } from "./review-reference-drop";
import type { LayoutCheckKind, LayoutFinding } from "../layout-check";

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

/** /review: one drawing at a time beside its reference; → passes it, a reason flags it. */
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
  // One author's drawings, and a search over names, authors and ids.
  const [author, setAuthor] = useState(() =>
    authorFromSearch(window.location.search),
  );
  const [search, setSearch] = useState("");
  // The reader's own drawings: all, flagged, passed or without a reference.
  const [mine, setMine] = useState<MineFilter | null>(() =>
    mineFromSearch(window.location.search),
  );
  // A link from Statistics names the drawing to open.
  const focusId = useRef(new URLSearchParams(window.location.search).get("id"));
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [index, setIndex] = useState(0);
  // The reasons chosen: with any, Enter sends an issue; with none, a pass.
  const [flags, setFlags] = useState<string[]>([]);
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
      `/review?scope=${scope}${
        referencesOnly === referencesOnlyByDefault(scope)
          ? ""
          : `&refs=${referencesOnly ? 1 : 0}`
      }${author ? `&author=${encodeURIComponent(author)}` : ""}${
        mine ? `&mine=${mine}` : ""
      }`,
    );
  }, [scope, referencesOnly, author, mine]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    const queue = async (store: string) => {
      const response = await fetchLike(`/api/gallery/review/${store}/queue`, {
        credentials: "same-origin",
      });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error(String(response.status));
      const { entries } = (await response.json()) as {
        entries: Omit<ReviewCard, "scope">[];
      };
      return entries.map((entry) => ({ ...entry, scope: store }));
    };
    // Review takes an account: a page that knows its reader is signed out
    // asks for no queue and says so at once (#2163).
    void readSessionUser(fetchLike)
      .then((session) =>
        session.available && !session.user
          ? [null]
          : Promise.all(REVIEW_STORES.map(queue)),
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
  // The author, one's own drawings and the search narrow every list alike;
  // the reference filter is each list's own: the one chosen has it as set,
  // any other as choosing it would set it.
  const narrowed = useCallback(
    (
      list: readonly ReviewCard[],
      references: boolean,
      own: MineFilter | null = mine,
    ) =>
      list.filter(
        (each) =>
          (!references || hasReference(each)) &&
          (!author || each.author === author) &&
          (!own || matchesMine(each, own)) &&
          matchesReviewSearch(each, search),
      ),
    [author, search, mine],
  );
  // Each row's count: what choosing it would show.
  const counts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(byScope).map(([key, list]) => [
          key,
          narrowed(
            list,
            key === scope
              ? referencesOnly
              : !mine && referencesOnlyByDefault(key),
          ).length,
        ]),
      ),
    [byScope, scope, referencesOnly, mine, narrowed],
  );
  const cards = useMemo(
    () => narrowed(all, referencesOnly),
    [all, referencesOnly, narrowed],
  );
  // The authors of this list as the other filters leave it.
  const authors = useMemo(
    () =>
      reviewAuthors(
        all.filter(
          (each) =>
            (!referencesOnly || hasReference(each)) &&
            matchesReviewSearch(each, search),
        ),
      ),
    [all, referencesOnly, search],
  );
  // The rows of one's own drawings, when this list holds any: each counts
  // what choosing it shows, every one of them whatever the reference filter
  // (the one chosen, as that filter now stands).
  const mineCounts = useMemo(() => {
    if (!all.some((each) => each.own)) return null;
    const searched = all.filter((each) => matchesReviewSearch(each, search));
    return Object.fromEntries(
      MINE_FILTERS.map(({ key }) => [
        key,
        searched.filter(
          (each) =>
            matchesMine(each, key) &&
            (key !== mine || !referencesOnly || hasReference(each)),
        ).length,
      ]),
    ) as Record<MineFilter, number>;
  }, [all, search, mine, referencesOnly]);
  // A drawing that leaves the list (given its reference, say) lets the next
  // one take its place, the last one included.
  useEffect(() => {
    if (cards.length > 0 && index >= cards.length) setIndex(cards.length - 1);
  }, [cards.length, index]);
  const card = cards[index];
  // Over one's own drawings the bar says what others' reviews of them come
  // to; anywhere else, the reader's own progress.
  const progress = useMemo(
    () => (mine ? mineProgress(cards) : reviewProgress(cards)),
    [cards, mine],
  );
  useEffect(() => {
    if (!focusId.current || all.length === 0) return;
    const found = cards.findIndex((each) => each.id === focusId.current);
    // A link to a drawing a filter hides turns that filter off.
    const target =
      found < 0 ? all.find((each) => each.id === focusId.current) : undefined;
    if (target) {
      if (referencesOnly && !hasReference(target)) setReferencesOnly(false);
      if (author && target.author !== author) setAuthor(null);
      if (mine && !matchesMine(target, mine)) setMine(null);
      if (!matchesReviewSearch(target, search)) setSearch("");
      return;
    }
    focusId.current = null;
    if (found >= 0) setIndex(found);
  }, [cards, all, referencesOnly, author, mine, search]);
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

  // A drawing named by its link or id: here if it is in this list, else in
  // its own store, with the reference filter off when it has no reference.
  const jumpTo = useCallback(
    (text: string) => {
      const id = entryIdOf(text);
      if (!id) {
        setMessage("Paste a drawing's link or id.");
        return false;
      }
      const here = cards.findIndex((each) => each.id === id);
      if (here >= 0) {
        setIndex(here);
        return true;
      }
      const store = Object.keys(byScope).find(
        (key) =>
          key !== "random" && byScope[key]!.some((each) => each.id === id),
      );
      if (!store) {
        setMessage(`${id} is not here to review.`);
        return false;
      }
      const target = byScope[store]!.find((each) => each.id === id)!;
      focusId.current = id;
      // Another store opens with its own reference filter, off when it
      // would hide the drawing.
      if (store !== scope)
        setReferencesOnly(
          referencesOnlyByDefault(store) && hasReference(target),
        );
      else if (referencesOnly && !hasReference(target))
        setReferencesOnly(false);
      if (author && target.author !== author) setAuthor(null);
      if (mine && !matchesMine(target, mine)) setMine(null);
      setSearch("");
      setScope(store);
      return true;
    },
    [cards, byScope, scope, referencesOnly, author, mine],
  );
  // A random drawing of this list not yet reviewed (any, once all are).
  const jumpRandom = useCallback(() => {
    const others = cards
      .map((each, at) => ({ each, at }))
      .filter(({ at }) => at !== index);
    const open = others.filter(({ each }) => !settled(each));
    const pool = open.length ? open : others;
    if (pool.length)
      setIndex(pool[Math.floor(Math.random() * pool.length)]!.at);
  }, [cards, index]);

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
      // Another list starts with its own reference filter: Community with
      // every drawing, a dataset with its figures; one's own drawings, every
      // one of them.
      if (next !== scope)
        setReferencesOnly(mine ? false : referencesOnlyByDefault(next));
      setScope(next);
      setIndex(0);
    },
    [scope, mine],
  );

  // Back from the editor (Open puts it in a tab): a drawing changed
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
    async (verdict: "pass" | "issue", after?: number) => {
      if (!card || busy) return;
      setBusy(true);
      try {
        const response = await galleryPublicationRequest(
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
          fetchLike,
        );
        const payload = (await response.json()) as {
          review?: ShownReview;
          error?: string;
        };
        // One's own drawing takes no review: step past it.
        if (payload.error === "own-entry") {
          go(after ?? index + 1);
          return;
        }
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
          after ??
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

  // A like is the reader's own mark, apart from the review. The Owner's
  // accounts add a heart each press, and ⌥-click takes one back.
  const toggleLike = useCallback(
    async (take = false) => {
      if (!card) return;
      const response = await galleryLikeRequest(card.id, take, fetchLike).catch(
        () => null,
      );
      if (!response?.ok) {
        setMessage("The like could not be saved.");
        return;
      }
      const { likedByViewer, likes } = (await response.json()) as {
        likedByViewer: boolean;
        likes: number;
      };
      replaceCard(card.id, (each) => ({ ...each, likedByViewer, likes }));
    },
    [card, fetchLike, replaceCard],
  );

  const toggleFlag = useCallback((key: string) => {
    setFlags((current) =>
      current.includes(key)
        ? current.filter((flag) => flag !== key)
        : [...current, key],
    );
  }, []);

  // Enter sends what is there: the reasons as an issue, else a pass; a
  // comment and boxes go with either. One's own drawing takes no review:
  // Enter moves on.
  const commit = useCallback(
    (after?: number) =>
      card?.own
        ? go(index + 1)
        : void submit(flags.length ? "issue" : "pass", after),
    [card, go, index, flags.length, submit],
  );
  const sendIssue = useCallback(() => {
    if (flags.length) void submit("issue");
    else setMessage("Choose at least one reason above.");
  }, [flags.length, submit]);
  // → moves on. Looking at a drawing and moving on passes it: one not yet
  // reviewed (or changed since) is sent as Enter would send it first.
  const advance = useCallback(() => {
    if (!card) return;
    const own = card.mine?.current ? card.mine : null;
    const unchanged =
      own !== null &&
      JSON.stringify([own.flags, own.note, own.marks ?? []]) ===
        JSON.stringify([flags, note.trim(), marks]);
    if (unchanged) go(index + 1);
    else commit(index + 1);
  }, [card, flags, note, marks, go, index, commit]);

  // Enter submits, digits flag, ← → step, N jumps to the next unreviewed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof Element &&
        event.target.closest("textarea, input, select");
      if (typing) {
        if (event.target.closest(".review-search")) return;
        const inNote =
          event.target instanceof Element &&
          event.target.closest(".review-note");
        if (
          event.key === "Enter" &&
          !event.isComposing &&
          event.keyCode !== 229 &&
          ((inNote && !event.shiftKey) || event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          commit();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const flag = flagsFor(card?.scope ?? scope).find(
        (each) => each.hotkey === event.key,
      );
      if (flag) toggleFlag(flag.key);
      else if (event.key === "Enter") commit();
      else if (event.key === "Escape" && flags.length) setFlags([]);
      else if (event.key.toLowerCase() === "l") void toggleLike();
      else if (event.key === "ArrowRight") advance();
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key.toLowerCase() === "r") jumpRandom();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    scope,
    card,
    flags.length,
    toggleFlag,
    toggleLike,
    commit,
    advance,
    go,
    index,
    jumpRandom,
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
            load.status === "ready" ? narrowed(all, true).length : null
          }
          onReferencesOnly={() => {
            // Only those with a figure leaves none of those without one.
            if (!referencesOnly && mine === "no-reference") setMine("all");
            setReferencesOnly((current) => !current);
            setIndex(0);
          }}
          search={search}
          onSearch={(text) => {
            setSearch(text);
            setIndex(0);
          }}
          onSearchEnter={(text) => {
            // A link or id opens its drawing wherever it is; a word only
            // filters, as typing does.
            const id = entryIdOf(text);
            if (
              id &&
              Object.values(byScope).some((list) =>
                list.some((each) => each.id === id),
              )
            )
              jumpTo(text);
          }}
          authors={load.status === "ready" ? authors : []}
          author={author}
          onAuthor={(next) => {
            setAuthor(next);
            if (next) setMine(null);
            setIndex(0);
          }}
          mine={mine}
          mineCounts={load.status === "ready" ? mineCounts : null}
          onMine={(next) => {
            // One's own drawings, each whatever its figure: choosing them
            // leaves another author and the reference filter.
            setMine(next);
            if (next) {
              setAuthor(null);
              setReferencesOnly(false);
            }
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
                {search.trim()
                  ? `No drawing here matches “${search.trim()}”.`
                  : mine
                    ? {
                        all: "You have no drawing here.",
                        flagged: "None of your drawings here is flagged.",
                        passed: "None of your drawings here has passed yet.",
                        "no-reference":
                          "Every drawing of yours here has a reference figure.",
                      }[mine]
                    : author
                      ? `No drawing by ${author} here.`
                      : referencesOnly
                        ? "No drawing here has a reference figure yet."
                        : "Nothing to review here yet."}
              </p>
            ) : (
              <>
                <div className="review-toolbar">
                  <Progress
                    {...progress}
                    total={cards.length}
                    waiting={mine !== null}
                  />
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
                      title="Next (→): a drawing you leave without a reason is passed"
                      aria-label="Next"
                      onClick={advance}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      title="A random drawing here you have not reviewed (R)"
                      onClick={jumpRandom}
                    >
                      Random <kbd>R</kbd>
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
                  onReference={(revision) =>
                    replaceCard(card.id, (each) => ({
                      ...each,
                      reference: { revision },
                    }))
                  }
                >
                  {card.own ? (
                    <p className="review-own" data-testid="review-own">
                      Your drawing: others review it here, and their reviews
                      show below. → moves on.
                    </p>
                  ) : (
                    <>
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
                              ? "Such as: M3's drain on VOUT instead of X. Enter submits; Shift+Enter starts a new line."
                              : "Enter submits; Shift+Enter starts a new line."
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
                            owner
                              ? "Add a heart (L; ⌥-click takes one back)"
                              : card.likedByViewer
                                ? "Remove your like (L)"
                                : "Like this circuit (L)"
                          }
                          onClick={(event) =>
                            void toggleLike(owner && event.altKey)
                          }
                        >
                          <HeartIcon filled={card.likedByViewer} />{" "}
                          {num(card.likes)}
                        </button>
                        <button
                          type="button"
                          className={`review-issue${flags.length || (card.mine?.current && card.mine.verdict === "issue") ? " on" : ""}`}
                          disabled={busy}
                          title={
                            flags.length
                              ? "Send the reasons with your comment and boxes"
                              : "Choose a reason below first"
                          }
                          data-testid="review-not-pass"
                          onClick={sendIssue}
                        >
                          <span aria-hidden="true">✕</span> Submit issue
                          {flags.length ? <kbd>Enter</kbd> : null}
                        </button>
                      </div>
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
                              {mark.side === "original"
                                ? "Original"
                                : "Redraw"}{" "}
                              ×
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {message ? (
                        <p className="review-message">{message}</p>
                      ) : null}
                    </>
                  )}
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
  waiting,
}: {
  passed: number;
  flagged: number;
  left: number;
  total: number;
  /** Over one's own drawings: the rest wait for others to review them. */
  waiting: boolean;
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
        <b>{num(left)}</b> {waiting ? "awaiting review" : "to review"}
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
  onReference,
  children,
}: {
  card: ReviewCard;
  fetchLike: typeof fetch;
  owner: boolean;
  marks: readonly ReviewMark[];
  onAddMark: (mark: ReviewMark) => void;
  /** A reference image just given to the drawing, by its revision. */
  onReference: (revision: string) => void;
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
  const { boxes, view } = useInstanceBoxes(redraw.src, fetchLike);
  const highlight = lit ? (boxes.get(lit) ?? null) : null;
  // What the layout checks find in our drawing; the checks load with it.
  const [findings, setFindings] = useState<LayoutFinding[] | null>(null);
  useEffect(() => {
    const project = ours.project;
    if (!project) return;
    let cancelled = false;
    void import("../layout-check").then(({ checkLayoutText }) => {
      if (!cancelled) setFindings(checkLayoutText(project));
    });
    return () => {
      cancelled = true;
    };
  }, [ours.project]);
  const [hintKind, setHintKind] = useState<LayoutCheckKind | null>(null);
  const hints =
    view && findings && hintKind
      ? findings
          .filter((finding) => finding.kind === hintKind)
          .map(({ box }) => ({
            x: (box.x - view.x) / view.w,
            y: (box.y - view.y) / view.h,
            w: box.w / view.w,
            h: box.h / view.h,
          }))
      : [];
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
      hints={side === "redraw" ? hints : []}
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
          ) : (owner || card.own) && !comparison ? (
            <ReviewReferenceDrop
              entryId={card.id}
              onAttached={onReference}
              fetchLike={fetchLike}
            />
          ) : (
            <div className="review-pic">
              <span className="none">No reference figure</span>
            </div>
          )}
        </div>
        <div>
          <h4>
            Redraw <span>· Analog Canvas</span>
            {/* Fixing the drawing happens in the editor, beside it. */}
            <a
              className="review-edit"
              data-testid="review-edit"
              href={`/g/${encodeURIComponent(card.id)}`}
              target="_blank"
              rel="noopener"
              title="Open this drawing in the editor (a new tab) to fix it; come back here and it refreshes"
            >
              Open ↗
            </a>
          </h4>
          {picture(redraw, "redraw")}
        </div>
        <AutoCheck findings={findings} onShow={setHintKind} />
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
            { ...redraw, side: "redraw" as const, highlight, hints },
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
 * found: a callout tinted by its verdict, the verdict and its kind as tags,
 * then where the dataset differs (two lines, the rest on request).
 */
function VerdictNote({
  comparison,
}: {
  comparison: NonNullable<ReviewCard["comparison"]>;
}) {
  const [open, setOpen] = useState(false);
  const verdict = verdictOf(comparison.verdict as ComparisonVerdict);
  const kind = comparison.verdict === "match" ? "" : comparison.category;
  const sentence =
    comparison.verdict === "match"
      ? ""
      : comparison.reason || comparison.detail || "";
  const said = sentence && sentence !== kind ? sentence : "";
  return (
    <div
      className={`review-verdict is-${comparison.verdict}`}
      data-testid="review-verdict"
    >
      <div className="review-verdict-head">
        <span className="review-verdict-pill">
          <span
            className={`datasets-icon v-${comparison.verdict}`}
            aria-hidden="true"
          >
            {verdict.icon}
          </span>
          {verdict.label}
        </span>
        {kind ? <span className="review-verdict-kind">{kind}</span> : null}
      </div>
      {said ? <p className={open ? "" : "clamped"}>{said}</p> : null}
      {said.length > 180 ? (
        <button
          type="button"
          className="review-verdict-more"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
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
  const [resolveError, setResolveError] = useState("");
  const unblinded = reviewed(card) || owner || card.own === true;
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
    setResolveError("");
    try {
      const response = await fetchLike(
        `/api/gallery/${encodeURIComponent(card.id)}/reviews/${review.id}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolved: true }),
        },
      );
      if (!response.ok) throw new Error("Resolution was not confirmed");
      setRound((value) => value + 1);
    } catch {
      setResolveError("This issue could not be resolved. Please try again.");
    }
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
      {resolveError ? <li role="alert">{resolveError}</li> : null}
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

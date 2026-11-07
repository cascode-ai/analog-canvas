import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "../styles/gallery-entry.css";
import "../styles/datasets-page.css";
import "../styles/review-page.css";
import { galleryPreviewUrl } from "../gallery-client";
import { COMPARISON_SOURCES, gallerySourceByKey } from "../gallery-sources";
import { verdictOf, type ComparisonVerdict } from "../dataset-comparisons";
import {
  flagLabel,
  flagsFor,
  nextUnreviewed,
  reviewProgress,
  reviewed,
  scopeFromSearch,
  withReview,
  type EntryFix,
  type ReviewCard,
  type ShownReview,
} from "../review-queue";
import { GalleryChrome } from "./gallery-chrome";
import { GalleryReviewTabs, ReviewModeSwitch } from "./review-tabs";
import { HeartIcon } from "./gallery-feed-tile";

type Load =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "failed" }
  | { status: "ready"; cards: ReviewCard[] };

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
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [index, setIndex] = useState(0);
  const [flags, setFlags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // The Owner's lists; null for anyone else (the route answers 403).
  const [owner, setOwner] = useState<{
    issues: ShownReview[];
    disputed: string[];
  } | null>(null);
  const [ownerRound, setOwnerRound] = useState(0);

  useEffect(() => {
    window.history.replaceState(null, "", `/review?scope=${scope}`);
    let cancelled = false;
    setLoad({ status: "loading" });
    void fetchLike(`/api/gallery/review/${scope}/queue`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (response.status === 401) return { status: "signed-out" } as const;
        if (!response.ok) return { status: "failed" } as const;
        const { entries } = (await response.json()) as {
          entries: ReviewCard[];
        };
        return { status: "ready", cards: entries } as const;
      })
      .catch(() => ({ status: "failed" }) as const)
      .then((next) => {
        if (cancelled) return;
        setLoad(next);
        setIndex(0);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, fetchLike]);

  useEffect(() => {
    let cancelled = false;
    void fetchLike(`/api/gallery/review/${scope}/issues`, {
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => !cancelled && setOwner(payload))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope, fetchLike, ownerRound]);

  const cards = load.status === "ready" ? load.cards : [];
  const card = cards[index];
  const progress = useMemo(() => reviewProgress(cards), [cards]);

  // A new card starts clean, or with the reviewer's own current review.
  useEffect(() => {
    const own = card?.mine?.current ? card.mine : null;
    setFlags(own?.verdict === "issue" ? own.flags : []);
    setNote(own?.note ?? "");
    setMessage("");
  }, [card?.id, card?.mine]);

  const go = useCallback(
    (next: number | null) => {
      if (next === null) setMessage("Every drawing here has your review.");
      else setIndex(Math.max(0, Math.min(cards.length - 1, next)));
    },
    [cards.length],
  );

  const submit = useCallback(async () => {
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
            verdict: flags.length ? "issue" : "pass",
            flags,
            note,
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
      const updated = cards.map((each) =>
        each.id === card.id ? withReview(each, payload.review!) : each,
      );
      setLoad({ status: "ready", cards: updated });
      go(nextUnreviewed(updated, index));
    } catch {
      setMessage("The review could not be saved.");
    } finally {
      setBusy(false);
    }
  }, [card, busy, fetchLike, flags, note, cards, go, index]);

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
    setLoad((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            cards: current.cards.map((each) =>
              each.id === card.id ? { ...each, likedByViewer, likes } : each,
            ),
          }
        : current,
    );
  }, [card, fetchLike]);

  const toggleFlag = useCallback(
    (key: string) =>
      setFlags((current) =>
        current.includes(key)
          ? current.filter((flag) => flag !== key)
          : [...current, key],
      ),
    [],
  );

  // Enter submits, digits flag, ← → step, N jumps to the next unreviewed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof Element &&
        event.target.closest("textarea, input, select");
      if (typing) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const flag = flagsFor(scope).find((each) => each.hotkey === event.key);
      if (flag) toggleFlag(flag.key);
      else if (event.key === "Enter") void submit();
      else if (event.key.toLowerCase() === "l") void toggleLike();
      else if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key.toLowerCase() === "n")
        go(nextUnreviewed(cards, index));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scope, toggleFlag, toggleLike, submit, go, index, cards]);

  return (
    <main className="review-shell datasets-shell" data-testid="review-page">
      <GalleryChrome subtitle="Review" visitStats={visitStats} />
      <GalleryReviewTabs />
      <div className="page-body review-body">
        <section className="datasets-intro">
          <div>
            <h2>Review</h2>
            <p>
              Pass each drawing, or flag what is wrong with it. Others&apos;
              verdicts show once yours is in.
            </p>
          </div>
          <div className="review-intro-side">
            <ReviewModeSwitch mode="review" scope={scope} />
          </div>
        </section>
        <div className="review-layout">
          <ScopeSidebar scope={scope} choose={setScope} />
          <div className="review-main">
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
              <p className="gallery-status">Nothing to review here yet.</p>
            ) : (
              <>
                <Progress {...progress} total={cards.length} />
                <PeoplePanel scope={scope} fetchLike={fetchLike} />
                {owner ? (
                  <OwnerPanel
                    scope={scope}
                    lists={owner}
                    cards={cards}
                    open={(id) => go(cards.findIndex((each) => each.id === id))}
                  />
                ) : null}
                <ReviewItem
                  key={card.id}
                  card={card}
                  scope={scope}
                  position={`${num(index + 1)} / ${num(cards.length)}`}
                  fetchLike={fetchLike}
                  owner={owner !== null}
                  onResolved={() => setOwnerRound((round) => round + 1)}
                />
                <div className="review-actions">
                  <button
                    type="button"
                    className={`review-submit${flags.length ? " issue" : ""}`}
                    disabled={busy}
                    onClick={() => void submit()}
                  >
                    {flags.length ? "Submit issue" : "Pass"}
                    <kbd>Enter</kbd>
                  </button>
                  <button
                    type="button"
                    className={`review-like${card.likedByViewer ? " on" : ""}`}
                    aria-pressed={card.likedByViewer}
                    title={
                      card.likedByViewer
                        ? "Remove your like"
                        : "Like this circuit"
                    }
                    onClick={() => void toggleLike()}
                  >
                    <HeartIcon filled={card.likedByViewer} /> {num(card.likes)}
                    <kbd>L</kbd>
                  </button>
                  {flagsFor(scope).map((flag) => (
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
                <textarea
                  className="review-note"
                  placeholder={
                    flags.length
                      ? "What is wrong, and where (optional; ⌘/Ctrl+Enter submits)"
                      : "Comment (optional; ⌘/Ctrl+Enter submits)"
                  }
                  value={note}
                  maxLength={1000}
                  onChange={(event) => setNote(event.target.value)}
                />
                <div className="review-nav">
                  <button type="button" onClick={() => go(index - 1)}>
                    ← Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => go(nextUnreviewed(cards, index))}
                  >
                    Next unreviewed <kbd>N</kbd>
                  </button>
                  <button type="button" onClick={() => go(index + 1)}>
                    Next →
                  </button>
                  {message ? (
                    <span className="review-message">{message}</span>
                  ) : null}
                </div>
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

function ReviewItem({
  card,
  scope,
  position,
  fetchLike,
  owner,
  onResolved,
}: {
  card: ReviewCard;
  scope: string;
  position: string;
  fetchLike: typeof fetch;
  owner: boolean;
  onResolved: () => void;
}) {
  const comparison = card.comparison;
  return (
    <article className="review-item">
      <div className="head">
        <span className="id">{card.id}</span>
        <span className="name">{card.name}</span>
        {comparison ? (
          <span className="datasets-badge">
            <span
              className={`datasets-icon v-${comparison.verdict}`}
              aria-hidden="true"
            >
              {verdictOf(comparison.verdict as ComparisonVerdict).icon}
            </span>
            {verdictOf(comparison.verdict as ComparisonVerdict).label}
          </span>
        ) : (
          <span className="meta">{card.author}</span>
        )}
        <span className="meta">
          {card.components} devices · {position}
        </span>
        <a className="open" href={`/g/${encodeURIComponent(card.id)}`}>
          Open in editor
        </a>
      </div>
      {comparison && comparison.verdict !== "match" ? (
        <p className="review-reason">
          <b>{comparison.category}</b>
          {comparison.detail && comparison.detail !== comparison.category
            ? ` — ${comparison.detail}`
            : ""}
          {comparison.reason ? <span> {comparison.reason}</span> : null}
        </p>
      ) : null}
      <div className="review-cols">
        <div>
          <h4>
            {comparison ? "Original" : "Reference"}{" "}
            <span>
              ·{" "}
              {comparison
                ? scopeName(scope)
                : card.reference
                  ? "uploaded by its author"
                  : "none yet"}
            </span>
          </h4>
          <div className="review-pic">
            {comparison ? (
              <img
                src={`/api/gallery/sources/${scope}/comparisons/${encodeURIComponent(card.id)}/figure?v=${encodeURIComponent(comparison.figureRevision)}`}
                alt="Original figure"
              />
            ) : card.reference ? (
              <img
                src={`/api/gallery/${encodeURIComponent(card.id)}/reference?v=${encodeURIComponent(card.reference.revision)}`}
                alt="Reference image"
              />
            ) : (
              <span className="none">No reference figure</span>
            )}
          </div>
          {comparison ? (
            <NetlistPane
              key={`theirs-${card.id}`}
              url={`/api/gallery/sources/${scope}/comparisons/${encodeURIComponent(card.id)}`}
              read={(payload) => payload.sourceNetlist}
              empty="The dataset gives no netlist."
              fetchLike={fetchLike}
            />
          ) : null}
        </div>
        <div>
          <h4>
            Redraw <span>· Analog Canvas</span>
          </h4>
          <div className="review-pic">
            <img
              src={galleryPreviewUrl(card.id, card.previewRevision)}
              alt="The drawing under review"
            />
          </div>
          <NetlistPane
            key={`ours-${card.id}`}
            url={`/api/gallery/${encodeURIComponent(card.id)}?netlist=spice`}
            read={(payload) => payload.netlist?.text}
            empty="This drawing exports no netlist."
            fetchLike={fetchLike}
          />
        </div>
      </div>
      <OthersReviews
        card={card}
        fetchLike={fetchLike}
        owner={owner}
        onResolved={onResolved}
      />
    </article>
  );
}

/** Everyone's current reviews, once the reviewer's own is in (the Owner: always). */
function OthersReviews({
  card,
  fetchLike,
  owner,
  onResolved,
}: {
  card: ReviewCard;
  fetchLike: typeof fetch;
  owner: boolean;
  onResolved: () => void;
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
    onResolved();
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
        <li key={review.id}>
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

/** The Owner's lists: open issues and disputed drawings, each a jump. */
function OwnerPanel({
  scope,
  lists,
  cards,
  open,
}: {
  scope: string;
  lists: { issues: ShownReview[]; disputed: string[] };
  cards: readonly ReviewCard[];
  open: (id: string) => void;
}) {
  const listed = new Set(cards.map((card) => card.id));
  const issueIds = [...new Set(lists.issues.map((issue) => issue.entryId))];
  const jump = (ids: string[]) =>
    ids
      .filter((id) => listed.has(id))
      .slice(0, 40)
      .map((id) => (
        <button key={id} type="button" onClick={() => open(id)}>
          {id}
        </button>
      ));
  return (
    <details className="review-owner">
      <summary>
        Owner · {issueIds.length} with open issues · {lists.disputed.length}{" "}
        disputed
      </summary>
      <div>
        <b>Open issues</b> {jump(issueIds)}
      </div>
      <div>
        <b>Disputed</b> {jump(lists.disputed)}
      </div>
      <div>
        <button
          type="button"
          className="review-export"
          onClick={() => {
            // Every open issue with its flags and comment, for whoever fixes
            // the drawings.
            const file = new Blob(
              [
                JSON.stringify(
                  {
                    scope,
                    exportedAt: new Date().toISOString(),
                    issues: lists.issues,
                    disputed: lists.disputed,
                  },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            );
            const link = Object.assign(document.createElement("a"), {
              href: URL.createObjectURL(file),
              download: `review-issues-${scope}.json`,
            });
            link.click();
            URL.revokeObjectURL(link.href);
          }}
        >
          Export issues (JSON)
        </button>
      </div>
    </details>
  );
}

interface PersonWork {
  person: string;
  reviews: number;
  passes: number;
  issues: number;
  fixes: number;
  circuits: number;
  changes: number;
  addressed: number;
}

/** Everyone's work here: reviews written and fixes made. */
function PeoplePanel({
  scope,
  fetchLike,
}: {
  scope: string;
  fetchLike: typeof fetch;
}) {
  const [people, setPeople] = useState<PersonWork[] | null>(null);
  const load = () => {
    if (people) return;
    void fetchLike(`/api/gallery/review/${scope}/people`, {
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { people?: PersonWork[] } | null) =>
        setPeople(payload?.people ?? []),
      )
      .catch(() => setPeople([]));
  };
  useEffect(() => setPeople(null), [scope]);
  return (
    <details className="review-people" onToggle={load}>
      <summary>People · reviews and fixes</summary>
      {people === null ? null : people.length === 0 ? (
        <p className="meta">No reviews or fixes here yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Reviews</th>
              <th>Passed</th>
              <th>Flagged</th>
              <th>Fixes</th>
              <th>Circuits fixed</th>
              <th>Objects changed</th>
              <th>Issues answered</th>
            </tr>
          </thead>
          <tbody>
            {people.map((row) => (
              <tr key={row.person}>
                <td>{row.person}</td>
                <td>{num(row.reviews)}</td>
                <td>{num(row.passes)}</td>
                <td>{num(row.issues)}</td>
                <td>{num(row.fixes)}</td>
                <td>{num(row.circuits)}</td>
                <td>{num(row.changes)}</td>
                <td>{num(row.addressed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

/**
 * One side's SPICE netlist under its picture. Ours is the entry's, read as
 * opening it is: it spends one of the day's circuit opens.
 */
function NetlistPane({
  url,
  read,
  empty,
  fetchLike,
}: {
  url: string;
  read: (payload: {
    sourceNetlist?: string;
    netlist?: { text?: string } | null;
  }) => string | undefined;
  empty: string;
  fetchLike: typeof fetch;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchLike(url, { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 429)
          return "Today's circuit opens are used up; the netlist returns tomorrow.";
        if (!response.ok) return "The netlist could not be loaded.";
        return read(await response.json())?.trim() || empty;
      })
      .catch(() => "The netlist could not be loaded.")
      .then((next) => !cancelled && setText(next));
    return () => {
      cancelled = true;
    };
    // `read` and `empty` belong to the caller's one call site per side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, fetchLike]);
  return <pre className="review-netlist">{text ?? "Loading the netlist…"}</pre>;
}

/** The left column: the community first, then each dataset. */
function ScopeSidebar({
  scope,
  choose,
}: {
  scope: string;
  choose: (scope: string) => void;
}) {
  const item = (key: string, label: string) => (
    <button
      key={key}
      type="button"
      className={scope === key ? "on" : ""}
      aria-pressed={scope === key}
      data-testid={`review-scope-${key}`}
      onClick={() => choose(key)}
    >
      {label}
    </button>
  );
  return (
    <aside className="review-sidebar" aria-label="What to review">
      {item("community", "Community")}
      <h5>Datasets</h5>
      {COMPARISON_SOURCES.map((source) => item(source.key, source.name))}
    </aside>
  );
}

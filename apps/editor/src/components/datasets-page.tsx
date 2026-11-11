import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import "../styles/gallery-entry.css";
import "../styles/datasets-page.css";
import { galleryPreviewUrl } from "../gallery-client";
import { bookmarkRequest } from "../bookmark-request";
import { COMPARISON_SOURCES, gallerySourceByKey } from "../gallery-sources";
import {
  FAMILIES,
  NO_FILTERS,
  SIZE_BINS,
  SORTS,
  VERDICTS,
  VIEWS,
  accuracyOf,
  comparisonFigureUrl,
  comparisonLink,
  countBy,
  filtersFromSearch,
  percent,
  rowsWithout,
  searchOfFilters,
  sizeBinLabel,
  sizeBinOf,
  sortedComparisons,
  toggleCategory,
  toggleVerdict,
  verdictOf,
  type ComparisonFilters,
  type ComparisonSort,
  type ComparisonVerdict,
  type ComparisonView,
  type DatasetComparison,
} from "../dataset-comparisons";
import { GalleryChrome } from "./gallery-chrome";
import { GalleryReviewTabs, ReviewModeSwitch } from "./review-tabs";
import { ReviewSummary } from "./review-summary";
import { fetchSessionUser, readSessionUser } from "./account";
import { MarkablePicture } from "./review-picture";

type Load =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "failed" }
  | { status: "ready"; rows: DatasetComparison[] };

async function loadComparisons(fetchLike: typeof fetch): Promise<Load> {
  try {
    const answers = await Promise.all(
      COMPARISON_SOURCES.map(async (source) => {
        const response = await fetchLike(
          `/api/gallery/sources/${source.key}/comparisons`,
          { credentials: "same-origin" },
        );
        if (response.status === 401) return "signed-out" as const;
        if (!response.ok) throw new Error(String(response.status));
        const { comparisons } = (await response.json()) as {
          comparisons: Omit<DatasetComparison, "source">[];
        };
        return comparisons.map((row) => ({ ...row, source: source.key }));
      }),
    );
    if (answers.includes("signed-out")) return { status: "signed-out" };
    return {
      status: "ready",
      rows: answers.flat() as DatasetComparison[],
    };
  } catch {
    return { status: "failed" };
  }
}

const num = (value: number) => value.toLocaleString("en-US");
const PAGE = { pair: 12, netlists: 12, grid: 36 } as const;

/** /datasets: each dataset circuit's original figure beside our redraw. */
export function DatasetsPage({
  visitStats,
  fetchLike = fetch,
}: {
  visitStats?: { pv: number; uv: number } | null;
  fetchLike?: typeof fetch;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [filters, setFilters] = useState<ComparisonFilters>(() =>
    filtersFromSearch(window.location.search),
  );
  const [shown, setShown] = useState<number>(PAGE[filters.view]);
  const [viewer, setViewer] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );
  // Who reviewed and fixed what, and the open issues: the Owner's to see.
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    void fetchSessionUser()
      .then((user) => setOwner(user?.isOwner === true))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadComparisons(fetchLike).then((next) => {
      if (!cancelled) setLoad(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLike]);

  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `/datasets${searchOfFilters(filters)}`,
    );
    setShown(PAGE[filters.view]);
  }, [filters]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The circuits this reader keeps for reference, from each dataset.
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const bookmarkAccount = useRef("");
  const bookmarkVersions = useRef<Record<string, string>>({});
  useEffect(() => {
    if (load.status !== "ready") return;
    let cancelled = false;
    // A reader the page knows is signed out keeps none: none is asked for
    // (#2163).
    void readSessionUser(fetchLike)
      .then((session) => {
        bookmarkAccount.current = session.available
          ? (session.user?.id ?? "")
          : "";
        return session.available && !session.user
          ? []
          : Promise.all(
              COMPARISON_SOURCES.map((source) =>
                fetchLike(`/api/gallery/sources/${source.key}/bookmarks`, {
                  credentials: "same-origin",
                })
                  .then((response) =>
                    response.ok
                      ? (response.json() as Promise<{
                          ids: string[];
                          versions?: Record<string, string>;
                        }>)
                      : null,
                  )
                  .catch(() => null),
              ),
            );
      })
      .then((lists) => {
        if (!cancelled) {
          bookmarkVersions.current = Object.assign(
            {},
            ...lists.map((list) => list?.versions ?? {}),
          );
          setSaved(new Set(lists.flatMap((list) => list?.ids ?? [])));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load.status, fetchLike]);
  const toggleSaved = useCallback(
    async (id: string) => {
      const response = await bookmarkRequest(
        id,
        bookmarkAccount.current,
        !saved.has(id),
        bookmarkVersions.current[id] ?? null,
        fetchLike,
      ).catch(() => null);
      if (!response?.ok) {
        setToast("It could not be saved.");
        return;
      }
      const { saved: kept, version } = (await response.json()) as {
        saved: boolean;
        version?: string | null;
      };
      if (version) bookmarkVersions.current[id] = version;
      setSaved((current) => {
        const next = new Set(current);
        if (kept) next.add(id);
        else next.delete(id);
        return next;
      });
      setToast(kept ? "Saved for reference" : "Removed from Saved");
    },
    [fetchLike, saved],
  );
  const loaded = load.status === "ready" ? load.rows : null;
  const rows = useMemo(
    () =>
      (loaded ?? []).map((row) =>
        saved.has(row.id) ? { ...row, saved: true } : row,
      ),
    [loaded, saved],
  );
  const visible = useMemo(
    () => sortedComparisons(rowsWithout(rows, filters), filters.sort),
    [rows, filters],
  );
  const set = (change: Partial<ComparisonFilters>) =>
    setFilters((current) => ({ ...current, ...change }));

  // Every element naming a tip shows it under the pointer.
  const tipHandlers = {
    onMouseMove: (event: ReactMouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-tip]",
      );
      setTip(
        target
          ? {
              x: event.clientX,
              y: event.clientY,
              text: target.dataset.tip ?? "",
            }
          : null,
      );
    },
    onMouseLeave: () => setTip(null),
  };

  return (
    <main className="review-shell datasets-shell" data-testid="datasets-page">
      <GalleryChrome subtitle="Datasets" visitStats={visitStats} />
      <GalleryReviewTabs>
        <ReviewModeSwitch mode="statistics" scope={filters.source} />
      </GalleryReviewTabs>
      <div className="page-body datasets-body" {...tipHandlers}>
        {load.status === "loading" ? (
          <p className="gallery-status">Loading the datasets…</p>
        ) : load.status === "signed-out" ? (
          <p className="gallery-status" data-testid="datasets-signed-out">
            Sign in (top right) to compare the datasets.
          </p>
        ) : load.status === "failed" ? (
          <p className="gallery-status">
            The datasets could not be loaded. Reload to try again.
          </p>
        ) : (
          <>
            <Hero rows={rows} />
            <DatasetBoard
              rows={rows}
              filters={filters}
              set={set}
              setFilters={setFilters}
            />
            <h2 className="ds-heading">Why the datasets differ</h2>
            <WhyCard rows={rows} filters={filters} setFilters={setFilters} />
            <h2 className="ds-heading">Circuit size</h2>
            <SizeCard rows={rows} filters={filters} set={set} />
            {owner ? (
              <>
                <h2 className="ds-heading">Reviews</h2>
                <ReviewSummary fetchLike={fetchLike} />
              </>
            ) : null}
            <h2 className="ds-heading">Circuits</h2>
            <Toolbar
              filters={filters}
              set={set}
              setFilters={setFilters}
              count={visible.length}
              savedCount={saved.size}
            />
            <section
              className={`datasets-list datasets-view-${filters.view}`}
              data-testid="datasets-list"
            >
              {visible.length === 0 ? (
                <p className="gallery-status">
                  No circuits match these filters.
                </p>
              ) : (
                visible
                  .slice(0, shown)
                  .map((row, index) =>
                    filters.view === "grid" ? (
                      <GridCard
                        key={row.id}
                        row={row}
                        open={() => setViewer(index)}
                      />
                    ) : (
                      <ComparisonRow
                        key={row.id}
                        row={row}
                        netlists={filters.view === "netlists"}
                        showSource={!filters.source}
                        open={() => setViewer(index)}
                        say={setToast}
                        toggleSaved={() => void toggleSaved(row.id)}
                        fetchLike={fetchLike}
                      />
                    ),
                  )
              )}
              {shown < visible.length ? (
                <MoreSentinel
                  key={shown}
                  onVisible={() =>
                    setShown((count) => count + PAGE[filters.view])
                  }
                />
              ) : null}
            </section>
          </>
        )}
      </div>
      {viewer !== null && visible[viewer] ? (
        <Viewer
          rows={visible}
          index={viewer}
          go={setViewer}
          close={() => setViewer(null)}
          toggleSaved={(id) => void toggleSaved(id)}
        />
      ) : null}
      {tip ? (
        <div
          className="datasets-tip"
          style={{
            left: Math.min(tip.x + 12, window.innerWidth - 240),
            top: tip.y + 14,
          }}
        >
          {tip.text}
        </div>
      ) : null}
      {toast ? (
        <div className="datasets-toast" role="status">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function VerdictIcon({ verdict }: { verdict: ComparisonVerdict }) {
  return (
    <span className={`datasets-icon v-${verdict}`} aria-hidden="true">
      {verdictOf(verdict).icon}
    </span>
  );
}

/** The page's opening: its title and its numbers over every dataset. */
function Hero({ rows }: { rows: DatasetComparison[] }) {
  const stats: [string, string][] = [
    ["circuits", num(rows.length)],
    ["datasets", String(COMPARISON_SOURCES.length)],
    ["accuracy", `${accuracyOf(rows).accuracy}%`],
  ];
  return (
    <header className="ds-hero">
      <h1>Dataset audit</h1>
      <dl className="ds-hero-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/** What a dataset's own page is, by its address. */
function homeLabel(url: string): string {
  const host = new URL(url).hostname;
  return host === "github.com"
    ? "GitHub"
    : host.endsWith("huggingface.co")
      ? "Hugging Face"
      : "Website";
}

/** One line of the board: a set of circuits' verdicts and what they make. */
function boardLine(rows: DatasetComparison[]) {
  const of = (key: ComparisonVerdict) =>
    rows.filter((row) => row.verdict === key).length;
  return {
    total: rows.length,
    of,
    ...accuracyOf(rows),
  };
}

/**
 * The page's chart: each dataset's verdicts as one bar, best accuracy
 * first, every dataset together at the foot. A line narrows the page to
 * its dataset; a verdict in the legend narrows it to that verdict.
 */
function DatasetBoard({
  rows,
  filters,
  set,
  setFilters,
}: {
  rows: DatasetComparison[];
  filters: ComparisonFilters;
  set: (change: Partial<ComparisonFilters>) => void;
  setFilters: (filters: ComparisonFilters) => void;
}) {
  const base = rowsWithout(rows, filters, "source", "verdict", "category");
  const lines = COMPARISON_SOURCES.map((source) => ({
    key: source.key as string | null,
    name: source.name,
    note: source.license,
    source: source as (typeof COMPARISON_SOURCES)[number] | null,
    ...boardLine(base.filter((row) => row.source === source.key)),
  })).sort((a, b) => b.total - a.total);
  const all = {
    key: null as string | null,
    name: "All datasets",
    note: `${COMPARISON_SOURCES.length} datasets`,
    source: null as (typeof COMPARISON_SOURCES)[number] | null,
    ...boardLine(base),
  };
  const chosen = rowsWithout(rows, filters, "verdict", "category");
  const ofChosen = (key: ComparisonVerdict) =>
    chosen.filter((row) => row.verdict === key).length;
  const choose = (key: string | null) =>
    set({ source: filters.source === key ? null : key });
  // A link in a line opens its page and leaves the selection alone.
  const away = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();
  const line = (item: typeof all, total: boolean) => (
    <div
      key={item.key ?? "all"}
      role="button"
      tabIndex={0}
      className={`ds-board-row${total ? " total" : ""}${filters.source === item.key ? " on" : ""}`}
      aria-pressed={filters.source === item.key}
      onClick={() => choose(item.key)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose(item.key);
      }}
    >
      <span className="name">
        {item.source ? (
          <a
            href={item.source.homepage}
            target="_blank"
            rel="noreferrer"
            title={`${item.name}: ${item.source.homepage}`}
            onClick={away}
          >
            <b>{item.name}</b>
          </a>
        ) : (
          <b>{item.name}</b>
        )}
        <small>
          {item.source ? (
            <>
              <a
                href={item.source.homepage}
                target="_blank"
                rel="noreferrer"
                onClick={away}
              >
                {homeLabel(item.source.homepage)} ↗
              </a>
              {item.source.paper ? (
                <>
                  {" · "}
                  <a
                    href={item.source.paper}
                    target="_blank"
                    rel="noreferrer"
                    onClick={away}
                  >
                    Paper ↗
                  </a>
                </>
              ) : null}
              {" · "}
              {item.note}
            </>
          ) : (
            item.note
          )}
        </small>
      </span>
      <span className="ds-bar">
        {VERDICTS.map((verdict) =>
          item.of(verdict.key) ? (
            <span
              key={verdict.key}
              className={`v-${verdict.key}${filters.verdict && filters.verdict !== verdict.key ? " dim" : ""}`}
              style={{ flexGrow: item.of(verdict.key) }}
              data-tip={`${item.name} · ${verdict.label} · ${num(item.of(verdict.key))} (${percent(item.of(verdict.key), item.total)}%)`}
            />
          ) : null,
        )}
      </span>
      <span className="circuits">{num(item.total)}</span>
      <span className="num">{num(item.of("error"))}</span>
      <span
        className="num"
        data-tip={`${item.accuracy}% counting Match and Notation · ${item.strict}% exact Match`}
      >
        {item.accuracy}%
      </span>
    </div>
  );
  return (
    <section className="ds-board-card">
      <div className={`ds-board${filters.source ? " sel" : ""}`}>
        <div className="ds-board-row head" aria-hidden="true">
          <span>Dataset</span>
          <span>Verdicts</span>
          <span>Circuits</span>
          <span>Errors</span>
          <span>Accuracy</span>
        </div>
        {lines.map((item) => line(item, false))}
        {line(all, true)}
      </div>
      <div className="datasets-legend">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict.key}
            type="button"
            className={filters.verdict === verdict.key ? "on" : ""}
            aria-pressed={filters.verdict === verdict.key}
            title="Click to show only these"
            onClick={() =>
              setFilters(toggleVerdict(filters, verdict.key, rows))
            }
          >
            <VerdictIcon verdict={verdict.key} />
            <span>{verdict.label}</span>
            <span className="n">{num(ofChosen(verdict.key))}</span>
            <span className="p">
              · {percent(ofChosen(verdict.key), chosen.length)}%
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function WhyCard({
  rows,
  filters,
  setFilters,
}: {
  rows: DatasetComparison[];
  filters: ComparisonFilters;
  setFilters: (filters: ComparisonFilters) => void;
}) {
  // Each kind of difference counts every circuit the other filters leave.
  const base = rowsWithout(rows, filters, "verdict", "category");
  const column = (mode: "error" | "notation", title: string) => {
    const mine = base.filter((row) => row.verdict === mode);
    const items = countBy(mine, (row) => row.category);
    const max = items[0]?.[1] ?? 1;
    const chosen = filters.verdict === mode ? filters.category : null;
    return (
      <div className="datasets-why-col">
        <h4>
          <VerdictIcon verdict={mode} /> {title}
          <span className="n">{num(mine.length)}</span>
        </h4>
        {items.length === 0 ? (
          <p className="datasets-empty">None in this selection</p>
        ) : (
          <div className={`datasets-bars${chosen ? " sel" : ""}`}>
            {items.map(([category, count]) => (
              <button
                key={category}
                type="button"
                className={chosen === category ? "on" : ""}
                aria-pressed={chosen === category}
                data-tip={`${category} · ${num(count)} (${percent(count, mine.length)}%) · click to filter`}
                onClick={() =>
                  setFilters(toggleCategory(filters, category, mode))
                }
              >
                <span className="lab">{category}</span>
                <span className="track">
                  <span
                    className="fill"
                    style={{ width: `${(100 * count) / max}%` }}
                  />
                </span>
                <span className="n">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="datasets-card datasets-why">
      {column("error", "Dataset errors")}
      {column("notation", "Written differently")}
    </div>
  );
}

function SizeCard({
  rows,
  filters,
  set,
}: {
  rows: DatasetComparison[];
  filters: ComparisonFilters;
  set: (change: Partial<ComparisonFilters>) => void;
}) {
  const base = rowsWithout(rows, filters, "size");
  const counts = SIZE_BINS.map(
    (_, index) =>
      base.filter((row) => sizeBinOf(row.components) === index).length,
  );
  const max = Math.max(1, ...counts);
  const familyBase = rowsWithout(rows, filters, "family");
  return (
    <div className="datasets-card">
      <div className={`datasets-hist${filters.size !== null ? " sel" : ""}`}>
        {counts.map((count, index) => (
          <button
            key={index}
            type="button"
            className={filters.size === index ? "on" : ""}
            aria-pressed={filters.size === index}
            aria-label={`${sizeBinLabel(index)} devices: ${count}`}
            data-tip={`${sizeBinLabel(index)} devices · ${num(count)} circuits · click to filter`}
            onClick={() => set({ size: filters.size === index ? null : index })}
          >
            <span className="n">{count}</span>
            <span
              className="fill"
              style={{ height: `${(82 * count) / max}%` }}
            />
          </button>
        ))}
      </div>
      <div className="datasets-ticks">
        {SIZE_BINS.map((_, index) => (
          <span key={index}>{sizeBinLabel(index)}</span>
        ))}
      </div>
      <div className="datasets-axis">devices per circuit</div>
      <div className="datasets-chips">
        <span>Contains</span>
        {FAMILIES.map((family) => {
          const count = familyBase.filter((row) =>
            row.families.includes(family),
          ).length;
          return (
            <button
              key={family}
              type="button"
              className={`${filters.family === family ? "on" : ""}${count ? "" : " zero"}`}
              aria-pressed={filters.family === family}
              onClick={() =>
                set({ family: filters.family === family ? null : family })
              }
            >
              {family}
              <b>{num(count)}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toolbar({
  filters,
  set,
  setFilters,
  count,
  savedCount,
}: {
  filters: ComparisonFilters;
  set: (change: Partial<ComparisonFilters>) => void;
  setFilters: (filters: ComparisonFilters) => void;
  count: number;
  savedCount: number;
}) {
  const [query, setQuery] = useState(filters.query);
  useEffect(() => setQuery(filters.query), [filters.query]);
  useEffect(() => {
    if (query === filters.query) return;
    const timer = window.setTimeout(() => set({ query }), 150);
    return () => window.clearTimeout(timer);
  });
  const pills: [keyof ComparisonFilters, string][] = [];
  if (filters.verdict)
    pills.push(["verdict", verdictOf(filters.verdict).label]);
  if (filters.category) pills.push(["category", filters.category]);
  if (filters.size !== null)
    pills.push(["size", `${sizeBinLabel(filters.size)} devices`]);
  if (filters.family) pills.push(["family", `Contains ${filters.family}`]);
  if (filters.query) pills.push(["query", `“${filters.query}”`]);
  return (
    <div className="datasets-toolbar">
      <input
        type="search"
        placeholder="Search id or name"
        aria-label="Search id or name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        aria-label="Sort"
        value={filters.sort}
        onChange={(event) =>
          set({ sort: event.target.value as ComparisonSort })
        }
      >
        {Object.entries(SORTS).map(([key, label]) => (
          <option key={key} value={key}>
            Sort: {label}
          </option>
        ))}
      </select>
      <span className="datasets-seg" role="group" aria-label="View">
        {Object.entries(VIEWS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filters.view === key ? "on" : ""}
            aria-pressed={filters.view === key}
            onClick={() => set({ view: key as ComparisonView })}
          >
            {label}
          </button>
        ))}
      </span>
      <button
        type="button"
        className={`datasets-saved-filter${filters.saved ? " on" : ""}`}
        aria-pressed={filters.saved}
        data-testid="datasets-saved-filter"
        title="Only the circuits you saved for reference"
        onClick={() => set({ saved: !filters.saved })}
      >
        {filters.saved ? "★" : "☆"} Saved · {num(savedCount)}
      </button>
      {pills.map(([key, label]) => (
        <span key={key} className="datasets-pill">
          {label}
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={() =>
              set({
                [key]: key === "query" ? "" : null,
              } as Partial<ComparisonFilters>)
            }
          >
            ×
          </button>
        </span>
      ))}
      {pills.length ? (
        <button
          type="button"
          className="datasets-clear"
          onClick={() =>
            setFilters({
              ...NO_FILTERS,
              source: filters.source,
              sort: filters.sort,
              view: filters.view,
            })
          }
        >
          Clear all
        </button>
      ) : null}
      <span className="datasets-count">
        {num(count)} circuit{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: ComparisonVerdict }) {
  return (
    <span className="datasets-badge">
      <VerdictIcon verdict={verdict} />
      {verdictOf(verdict).label}
    </span>
  );
}

function Picture({
  src,
  alt,
  open,
}: {
  src: string;
  alt: string;
  open: () => void;
}) {
  return (
    <button
      type="button"
      className="datasets-pic"
      onClick={open}
      title="Enlarge"
    >
      <img loading="lazy" src={src} alt={alt} />
    </button>
  );
}

function ComparisonRow({
  row,
  netlists,
  showSource,
  open,
  say,
  toggleSaved,
  fetchLike,
}: {
  row: DatasetComparison;
  netlists: boolean;
  showSource: boolean;
  open: () => void;
  say: (text: string) => void;
  toggleSaved: () => void;
  fetchLike: typeof fetch;
}) {
  const [why, setWhy] = useState(false);
  const source = gallerySourceByKey(row.source);
  const copyLink = () => {
    const link = comparisonLink(window.location.origin, row);
    void navigator.clipboard
      ?.writeText(link)
      .then(() => say("Link copied"))
      .catch(() => say(link));
  };
  return (
    <article className="datasets-row" data-testid={`datasets-row-${row.id}`}>
      <div className="head">
        <span className="id">{row.id}</span>
        <span className="name">{row.name}</span>
        <VerdictBadge verdict={row.verdict} />
        <span className="meta">
          {row.components} device{row.components === 1 ? "" : "s"}
          {showSource && source ? ` · ${source.name}` : ""}
        </span>
        <span className="acts">
          <SaveButton saved={row.saved === true} toggle={toggleSaved} />
          <button type="button" onClick={copyLink}>
            Copy link
          </button>
          <a href={comparisonFigureUrl(row)} target="_blank" rel="noreferrer">
            Original ↗
          </a>
          <a className="primary" href={`/g/${encodeURIComponent(row.id)}`}>
            Open in editor
          </a>
        </span>
      </div>
      {!row.category ? null : (
        <div className="reason">
          <b>{row.category}</b>
          {row.detail && row.detail !== row.category ? ` — ${row.detail}` : ""}
          {row.reason ? (
            <button type="button" onClick={() => setWhy((open) => !open)}>
              {why ? "Hide" : "Details"}
            </button>
          ) : null}
          {why ? <p>{row.reason}</p> : null}
        </div>
      )}
      <div className="cols">
        <Pane title="Original" note={source?.name}>
          <Picture
            src={comparisonFigureUrl(row)}
            alt="Original figure"
            open={open}
          />
        </Pane>
        <Pane title="Redraw" note="Analog Canvas">
          <Picture
            src={galleryPreviewUrl(row.id, row.previewRevision)}
            alt="Our redraw"
            open={open}
          />
        </Pane>
        {netlists ? (
          <Pane title="Netlists">
            <Netlists row={row} fetchLike={fetchLike} />
          </Pane>
        ) : null}
      </div>
    </article>
  );
}

function Pane({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="pane">
      <h4>
        {title}
        {note ? <span> · {note}</span> : null}
      </h4>
      {children}
    </div>
  );
}

/**
 * The dataset's netlist loads with the row; ours is the entry's, which
 * spends one of the day's opens as opening it would, so it waits for a click.
 */
function Netlists({
  row,
  fetchLike,
}: {
  row: DatasetComparison;
  fetchLike: typeof fetch;
}) {
  const [theirs, setTheirs] = useState<string | null>(null);
  const [ours, setOurs] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchLike(
      `/api/gallery/sources/${row.source}/comparisons/${encodeURIComponent(row.id)}`,
      { credentials: "same-origin" },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { sourceNetlist?: string } | null) => {
        if (!cancelled)
          setTheirs(
            payload?.sourceNetlist?.trim() || "(The dataset gives none.)",
          );
      })
      .catch(() => !cancelled && setTheirs("(Could not load.)"));
    return () => {
      cancelled = true;
    };
  }, [row.source, row.id, fetchLike]);
  // Ours: the netlist alone.
  useEffect(() => {
    let cancelled = false;
    void fetchLike(
      `/api/gallery/${encodeURIComponent(row.id)}?summary=1&netlist=spice`,
      { credentials: "same-origin" },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { netlist?: { text?: string } | null } | null) => {
        if (!cancelled)
          setOurs(payload?.netlist?.text?.trim() || "(No netlist.)");
      })
      .catch(() => !cancelled && setOurs("(Could not load.)"));
    return () => {
      cancelled = true;
    };
  }, [row.id, fetchLike]);
  return (
    <>
      <div className="pre-h">{gallerySourceByKey(row.source)?.name}</div>
      <pre>{theirs ?? "Loading…"}</pre>
      <div className="pre-h">Ours</div>
      <pre>{ours ?? "Loading…"}</pre>
    </>
  );
}

function GridCard({ row, open }: { row: DatasetComparison; open: () => void }) {
  return (
    <button
      type="button"
      className="datasets-card-g"
      onClick={open}
      data-testid={`datasets-card-${row.id}`}
    >
      <span className="thumbs">
        <span>
          <img
            loading="lazy"
            src={comparisonFigureUrl(row)}
            alt="Original figure"
          />
        </span>
        <span>
          <img
            loading="lazy"
            src={galleryPreviewUrl(row.id, row.previewRevision)}
            alt="Our redraw"
          />
        </span>
      </span>
      <span className="cap">
        <span className="id">{row.id}</span>
        <span className="name" title={row.name}>
          {row.name}
        </span>
        <span title={verdictOf(row.verdict).label}>
          <VerdictIcon verdict={row.verdict} />
        </span>
        {row.saved ? (
          <span className="datasets-saved-mark" title="Saved for reference">
            ★
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Keep a circuit for reference, or let it go: the reader's own list. */
function SaveButton({ saved, toggle }: { saved: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      className={`datasets-save${saved ? " on" : ""}`}
      aria-pressed={saved}
      title={saved ? "Remove from Saved" : "Save for reference"}
      onClick={toggle}
    >
      {saved ? "★ Saved" : "☆ Save"}
    </button>
  );
}

function Viewer({
  rows,
  index,
  go,
  close,
  toggleSaved,
}: {
  rows: DatasetComparison[];
  index: number;
  go: (index: number) => void;
  close: () => void;
  toggleSaved: (id: string) => void;
}) {
  const row = rows[index]!;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight" && index < rows.length - 1) go(index + 1);
      if (event.key === "ArrowLeft" && index > 0) go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, rows.length, go, close]);
  return (
    <div
      className="datasets-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${row.id} compared`}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <div className="vh">
        <span className="id">{row.id}</span>
        <span>{row.name}</span>
        <VerdictBadge verdict={row.verdict} />
        <span className="hint">
          ← → next · wheel zooms, drag pans · Esc close
        </span>
        <SaveButton
          saved={row.saved === true}
          toggle={() => toggleSaved(row.id)}
        />
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
      <div className="vb">
        <div>
          <h4>Original · {gallerySourceByKey(row.source)?.name}</h4>
          <MarkablePicture
            key={`original-${row.id}`}
            src={comparisonFigureUrl(row)}
            alt="Original figure"
            side="original"
            marks={[]}
            zoomed
          />
        </div>
        <div>
          <h4>Redraw · Analog Canvas</h4>
          <MarkablePicture
            key={`redraw-${row.id}`}
            src={galleryPreviewUrl(row.id, row.previewRevision)}
            alt="Our redraw"
            side="redraw"
            marks={[]}
            zoomed
          />
        </div>
      </div>
    </div>
  );
}

function MoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onVisible);
  latest.current = onVisible;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: "800px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="datasets-sentinel" />;
}

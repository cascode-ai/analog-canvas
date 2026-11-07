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
import { COMPARISON_SOURCES, gallerySourceByKey } from "../gallery-sources";
import {
  FAMILIES,
  NO_FILTERS,
  SIZE_BINS,
  SORTS,
  VERDICTS,
  VIEWS,
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
  useEffect(() => {
    if (load.status !== "ready") return;
    let cancelled = false;
    void Promise.all(
      COMPARISON_SOURCES.map((source) =>
        fetchLike(`/api/gallery/sources/${source.key}/bookmarks`, {
          credentials: "same-origin",
        })
          .then((response) =>
            response.ok
              ? (response.json() as Promise<{ ids: string[] }>)
              : null,
          )
          .catch(() => null),
      ),
    ).then((lists) => {
      if (!cancelled)
        setSaved(new Set(lists.flatMap((list) => list?.ids ?? [])));
    });
    return () => {
      cancelled = true;
    };
  }, [load.status, fetchLike]);
  const toggleSaved = useCallback(
    async (id: string) => {
      const response = await fetchLike(
        `/api/gallery/${encodeURIComponent(id)}/bookmark`,
        { method: "POST", credentials: "same-origin" },
      ).catch(() => null);
      if (!response?.ok) {
        setToast("It could not be saved.");
        return;
      }
      const { saved: kept } = (await response.json()) as { saved: boolean };
      setSaved((current) => {
        const next = new Set(current);
        if (kept) next.add(id);
        else next.delete(id);
        return next;
      });
      setToast(kept ? "Saved for reference" : "Removed from Saved");
    },
    [fetchLike],
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
            <h2 className="ds-heading">Accuracy by dataset</h2>
            <DatasetBoard
              rows={rows}
              filters={filters}
              set={set}
              setFilters={setFilters}
            />
            <h2 className="ds-heading">Breakdown</h2>
            <section className="datasets-stats">
              <WhyCard rows={rows} filters={filters} setFilters={setFilters} />
              <SizeCard rows={rows} filters={filters} set={set} />
            </section>
            <h2 className="ds-heading">Reviews</h2>
            <ReviewSummary fetchLike={fetchLike} />
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

/** The page's opening: what it is, and its numbers over every dataset. */
function Hero({ rows }: { rows: DatasetComparison[] }) {
  const of = (key: ComparisonVerdict) =>
    rows.filter((row) => row.verdict === key).length;
  const stats: [string, string][] = [
    ["circuits", num(rows.length)],
    ["datasets", String(COMPARISON_SOURCES.length)],
    ["dataset errors", num(of("error"))],
    ["accuracy", `${percent(of("match") + of("notation"), rows.length)}%`],
  ];
  return (
    <header className="ds-hero">
      <div>
        <h1>Dataset audit</h1>
        <p>
          Public analog-circuit datasets, each figure redrawn in Analog Canvas
          and its netlist checked against the dataset&apos;s.
        </p>
      </div>
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

/** One line of the board: a set of circuits' verdicts and what they make. */
function boardLine(rows: DatasetComparison[]) {
  const of = (key: ComparisonVerdict) =>
    rows.filter((row) => row.verdict === key).length;
  return {
    total: rows.length,
    of,
    accuracy: percent(of("match") + of("notation"), rows.length),
    strict: percent(of("match"), rows.length),
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
    ...boardLine(base.filter((row) => row.source === source.key)),
  })).sort((a, b) => b.accuracy - a.accuracy);
  const all = {
    key: null as string | null,
    name: "All datasets",
    note: `${COMPARISON_SOURCES.length} datasets`,
    ...boardLine(base),
  };
  const chosen = rowsWithout(rows, filters, "verdict", "category");
  const ofChosen = (key: ComparisonVerdict) =>
    chosen.filter((row) => row.verdict === key).length;
  const named = gallerySourceByKey(filters.source);
  const line = (item: typeof all, rank: number | null) => (
    <button
      key={item.key ?? "all"}
      type="button"
      className={`ds-board-row${rank === null ? " total" : ""}${filters.source === item.key ? " on" : ""}`}
      aria-pressed={filters.source === item.key}
      onClick={() =>
        set({ source: filters.source === item.key ? null : item.key })
      }
    >
      <span className="rank">{rank ?? ""}</span>
      <span className="name">
        <b>{item.name}</b>
        <small>{item.note}</small>
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
      <span className="acc">{item.accuracy}%</span>
      <span className="num">{item.strict}%</span>
      <span className="num">{num(item.of("error"))}</span>
      <span className="num">{num(item.total)}</span>
    </button>
  );
  return (
    <section className="ds-board-card">
      <div className={`ds-board${filters.source ? " sel" : ""}`}>
        <div className="ds-board-row head" aria-hidden="true">
          <span>#</span>
          <span>Dataset</span>
          <span>Verdicts</span>
          <span>Accuracy</span>
          <span>Strict</span>
          <span>Errors</span>
          <span>Circuits</span>
        </div>
        {lines.map((item, index) => line(item, index + 1))}
        {line(all, null)}
      </div>
      <div className="datasets-legend">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict.key}
            type="button"
            className={filters.verdict === verdict.key ? "on" : ""}
            aria-pressed={filters.verdict === verdict.key}
            onClick={() =>
              setFilters(toggleVerdict(filters, verdict.key, rows))
            }
          >
            <VerdictIcon verdict={verdict.key} />
            <span>
              {verdict.label}
              <span className="what">{verdict.what}</span>
            </span>
            <span className="n">{num(ofChosen(verdict.key))}</span>
            <span className="p">
              {percent(ofChosen(verdict.key), chosen.length)}%
            </span>
          </button>
        ))}
      </div>
      <p className="ds-note">
        Accuracy counts Match and Notation; strict counts Match alone. Click a
        dataset or a verdict to narrow the charts and circuits below.{" "}
        {named ? (
          <>
            {named.name}:{" "}
            <a href={named.homepage} target="_blank" rel="noreferrer">
              dataset ↗
            </a>
            {named.paper ? (
              <>
                {" · "}
                <a href={named.paper} target="_blank" rel="noreferrer">
                  paper ↗
                </a>
              </>
            ) : null}
          </>
        ) : (
          <>
            Licences:{" "}
            {COMPARISON_SOURCES.map(
              (item) => `${item.name} ${item.license}`,
            ).join(" · ")}
          </>
        )}
      </p>
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
  const [chosen, setChosen] = useState<"error" | "notation">("error");
  const mode =
    filters.verdict === "error" || filters.verdict === "notation"
      ? filters.verdict
      : chosen;
  const base = rowsWithout(rows, filters, "category").filter(
    (row) => row.verdict === mode,
  );
  const items = countBy(base, (row) => row.category);
  const max = items[0]?.[1] ?? 1;
  const switchTo = (next: "error" | "notation") => {
    setChosen(next);
    if (filters.verdict === "error" || filters.verdict === "notation")
      setFilters({ ...filters, verdict: next, category: null });
  };
  return (
    <div className="datasets-card">
      <h3>
        Why they differ
        <span className="datasets-seg">
          {(["error", "notation"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={mode === key ? "on" : ""}
              onClick={() => switchTo(key)}
            >
              {key === "error" ? "Errors" : "Notation"}
            </button>
          ))}
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="datasets-empty">
          No {mode === "error" ? "dataset errors" : "notation differences"} in
          this selection
        </p>
      ) : (
        <div className={`datasets-bars${filters.category ? " sel" : ""}`}>
          {items.map(([category, count]) => (
            <button
              key={category}
              type="button"
              className={filters.category === category ? "on" : ""}
              aria-pressed={filters.category === category}
              data-tip={`${category} · ${num(count)} (${percent(count, base.length)}%) · click to filter`}
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
      <h3>Circuit size</h3>
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
      {row.verdict === "match" ? null : (
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
  const loadOurs = async () => {
    setOurs("Loading…");
    try {
      const response = await fetchLike(
        `/api/gallery/${encodeURIComponent(row.id)}?netlist=spice`,
        { credentials: "same-origin" },
      );
      if (response.status === 429) {
        setOurs("(Today's opens are used up.)");
        return;
      }
      const payload = (await response.json()) as {
        netlist?: { text?: string } | null;
      };
      setOurs(payload.netlist?.text?.trim() || "(No netlist.)");
    } catch {
      setOurs("(Could not load.)");
    }
  };
  return (
    <>
      <div className="pre-h">{gallerySourceByKey(row.source)?.name}</div>
      <pre>{theirs ?? "Loading…"}</pre>
      <div className="pre-h">Ours</div>
      {ours === null ? (
        <button
          type="button"
          className="datasets-load"
          onClick={() => void loadOurs()}
          title="Uses one of today's circuit opens"
        >
          Show our netlist
        </button>
      ) : (
        <pre>{ours}</pre>
      )}
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

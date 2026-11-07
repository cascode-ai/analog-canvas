import {
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

  const rows = load.status === "ready" ? load.rows : [];
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
      <div className="page-body datasets-body" {...tipHandlers}>
        <section className="datasets-intro">
          <div>
            <a className="datasets-back" href="/">
              ← Gallery
            </a>
            <h2>Reference datasets</h2>
            <p>
              Each circuit&apos;s original figure beside our redraw, with both
              netlists compared.
            </p>
          </div>
          {load.status === "ready" ? (
            <SourceTabs rows={rows} filters={filters} set={set} />
          ) : null}
        </section>
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
            <SourceNote source={filters.source} />
            <section className="datasets-stats">
              <VerdictCard
                rows={rows}
                filters={filters}
                setFilters={setFilters}
              />
              <WhyCard rows={rows} filters={filters} setFilters={setFilters} />
              <SizeCard rows={rows} filters={filters} set={set} />
            </section>
            <Toolbar
              filters={filters}
              set={set}
              setFilters={setFilters}
              count={visible.length}
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

function SourceTabs({
  rows,
  filters,
  set,
}: {
  rows: DatasetComparison[];
  filters: ComparisonFilters;
  set: (change: Partial<ComparisonFilters>) => void;
}) {
  const base = rowsWithout(rows, filters, "source");
  const count = (key: string | null) =>
    base.filter((row) => !key || row.source === key).length;
  const tabs: [string | null, string, string][] = [
    [null, "All datasets", `${num(count(null))} circuits`],
    ...COMPARISON_SOURCES.map(
      (source) =>
        [
          source.key,
          source.name,
          `${num(count(source.key))} · ${source.license}`,
        ] as [string, string, string],
    ),
  ];
  return (
    <nav className="datasets-tabs" aria-label="Dataset">
      {tabs.map(([key, name, sub]) => (
        <button
          key={key ?? "all"}
          type="button"
          className={filters.source === key ? "on" : ""}
          aria-pressed={filters.source === key}
          onClick={() => set({ source: key })}
        >
          <b>{name}</b>
          <small>{sub}</small>
        </button>
      ))}
    </nav>
  );
}

function SourceNote({ source }: { source: string | null }) {
  const named = gallerySourceByKey(source);
  return (
    <p className="datasets-source">
      {named ? (
        <>
          {named.name} · {named.license} licence ·{" "}
          <a href={named.homepage} target="_blank" rel="noreferrer">
            Dataset ↗
          </a>
          {named.paper ? (
            <>
              {" · "}
              <a href={named.paper} target="_blank" rel="noreferrer">
                Paper ↗
              </a>
            </>
          ) : null}
          {" · "}original figures shown under its licence
        </>
      ) : (
        <>
          {COMPARISON_SOURCES.map(
            (item) => `${item.name} (${item.license})`,
          ).join(" and ")}
          . Original figures are shown under each dataset&apos;s licence.
        </>
      )}
    </p>
  );
}

function VerdictIcon({ verdict }: { verdict: ComparisonVerdict }) {
  return (
    <span className={`datasets-icon v-${verdict}`} aria-hidden="true">
      {verdictOf(verdict).icon}
    </span>
  );
}

function VerdictCard({
  rows,
  filters,
  setFilters,
}: {
  rows: DatasetComparison[];
  filters: ComparisonFilters;
  setFilters: (filters: ComparisonFilters) => void;
}) {
  const base = rowsWithout(rows, filters, "verdict", "category");
  const counts = Object.fromEntries(countBy(base, (row) => row.verdict));
  const of = (key: ComparisonVerdict) => counts[key] ?? 0;
  const pick = (key: ComparisonVerdict) =>
    setFilters(toggleVerdict(filters, key, rows));
  return (
    <div className="datasets-card">
      <h3>Verdict</h3>
      <div className={`datasets-stack${filters.verdict ? " sel" : ""}`}>
        {VERDICTS.filter((verdict) => of(verdict.key)).map((verdict) => (
          <button
            key={verdict.key}
            type="button"
            className={`v-${verdict.key}${filters.verdict === verdict.key ? " on" : ""}`}
            style={{ flexGrow: of(verdict.key) }}
            aria-label={`${verdict.label}: ${of(verdict.key)}`}
            data-tip={`${verdict.label} · ${num(of(verdict.key))} (${percent(of(verdict.key), base.length)}%) · click to filter`}
            onClick={() => pick(verdict.key)}
          />
        ))}
      </div>
      <div className="datasets-legend">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict.key}
            type="button"
            className={filters.verdict === verdict.key ? "on" : ""}
            aria-pressed={filters.verdict === verdict.key}
            onClick={() => pick(verdict.key)}
          >
            <VerdictIcon verdict={verdict.key} />
            <span>
              {verdict.label}
              <span className="what">{verdict.what}</span>
            </span>
            <span className="n">{num(of(verdict.key))}</span>
            <span className="p">{percent(of(verdict.key), base.length)}%</span>
          </button>
        ))}
      </div>
      <div className="datasets-kpis">
        <div data-tip="Match and Notation, over all circuits">
          <b>{percent(of("match") + of("notation"), base.length)}%</b>
          <span>dataset accuracy</span>
        </div>
        <div data-tip="Match only">
          <b>{percent(of("match"), base.length)}%</b>
          <span>strict accuracy</span>
        </div>
        <div data-tip="Circuits whose dataset netlist is wrong">
          <b>{num(of("error"))}</b>
          <span>dataset errors</span>
        </div>
      </div>
    </div>
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
}: {
  filters: ComparisonFilters;
  set: (change: Partial<ComparisonFilters>) => void;
  setFilters: (filters: ComparisonFilters) => void;
  count: number;
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
      <a
        className="datasets-review-link"
        href={`/review?scope=${filters.source ?? "analoggenie"}`}
        data-testid="datasets-review-link"
      >
        Review mode
      </a>
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
  fetchLike,
}: {
  row: DatasetComparison;
  netlists: boolean;
  showSource: boolean;
  open: () => void;
  say: (text: string) => void;
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
      </span>
    </button>
  );
}

function Viewer({
  rows,
  index,
  go,
  close,
}: {
  rows: DatasetComparison[];
  index: number;
  go: (index: number) => void;
  close: () => void;
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
        <span className="hint">← → next · Esc close</span>
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
      <div className="vb">
        <div>
          <h4>Original · {gallerySourceByKey(row.source)?.name}</h4>
          <span>
            <img src={comparisonFigureUrl(row)} alt="Original figure" />
          </span>
        </div>
        <div>
          <h4>Redraw · Analog Canvas</h4>
          <span>
            <img
              src={galleryPreviewUrl(row.id, row.previewRevision)}
              alt="Our redraw"
            />
          </span>
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

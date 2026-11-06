import { useEffect, useRef, useState } from "react";

import {
  CircuitStatsTable,
  type CircuitStatsColumn,
  type CircuitStatsRow,
} from "./circuit-stats";
import {
  BarList,
  ChartCard,
  ColumnChart,
  DonutChart,
  formatted,
  NEUTRAL,
  type Part,
  SegmentedChart,
  SERIES,
  share,
  StatTile,
} from "./stats-charts";

/**
 * The distributions the server counts (`GET /api/gallery/stats`, and with an
 * author's own circuits `GET /api/gallery/mine/stats`): every figure counts
 * public circuits, or their parts, likes and devices.
 */
export interface GalleryStatsSummary {
  circuits: number;
  /** Of them, the reference datasets' (absent from an author's own). */
  datasets?: number;
  authors: number;
  components: number;
  transistors: number;
  /** Circuits whose devices are counted; the rest are still to count. */
  counted: number;
  ai: number;
  netlist: number;
  likes: number;
  liked: number;
  types: { type: string | null; circuits: number }[];
  tags: { tag: string; circuits: number }[];
  devices: { kind: string; count: number }[];
  sizes: { key: string; circuits: number }[];
  transistorBins: { key: string; circuits: number }[];
  weeks: { week: string; human: number; ai: number; dataset?: number }[];
}

export interface AuthorRank {
  position: number;
  authors: number;
}

export interface GalleryStatsPayload {
  summary: GalleryStatsSummary;
  topAuthors: { author: string; circuits: number }[];
  /** How many circuits each store gave: the community's, each dataset's. */
  sources?: { key: string; name: string; circuits: number }[];
}

/** The stores the Gallery's figures count: all, the community's, the datasets'. */
export type GalleryStatsSource = "all" | "community" | "datasets";

export interface AuthorStatsPayload<Row> {
  circuits: Row[];
  summary: GalleryStatsSummary;
  rank: AuthorRank | null;
}

/**
 * The six circuit types the ring names, each with its own hue in every view;
 * the other types share one hue and untagged circuits the gray.
 */
const NAMED_TYPES = [
  "Amplifiers",
  "Bias & references",
  "Conversion",
  "Clock & timing",
  "Power",
  "Sampling",
] as const;

/** Device kinds as the bar shows them: the common ones apart, the rest as Other. */
const DEVICE_PARTS: readonly { key: string; label: string; kinds: string[] }[] =
  [
    { key: "nmos", label: "NMOS", kinds: ["nmos"] },
    { key: "pmos", label: "PMOS", kinds: ["pmos"] },
    { key: "bjt", label: "BJT", kinds: ["bjt"] },
    { key: "resistor", label: "Resistors", kinds: ["resistor"] },
    { key: "capacitor", label: "Capacitors", kinds: ["capacitor"] },
    { key: "source", label: "Sources", kinds: ["source"] },
    { key: "block", label: "Blocks", kinds: ["block"] },
    {
      key: "other",
      label: "Other",
      kinds: ["inductor", "diode", "switch", "other"],
    },
  ];

const KIND_LABELS: Record<string, string> = {
  nmos: "NMOS",
  pmos: "PMOS",
  bjt: "BJT",
  resistor: "Resistors",
  capacitor: "Capacitors",
  inductor: "Inductors",
  diode: "Diodes",
  source: "Sources",
  switch: "Switches",
  block: "Blocks",
  other: "Other",
};

const average = (total: number, count: number) =>
  count ? (Math.round((total / count) * 10) / 10).toLocaleString("en-US") : "0";

/** A bin's key as its label: `6-10` reads 6–10 and an open `26-` 26+. */
const range = (key: string) =>
  key.endsWith("-") ? `${key.slice(0, -1)}+` : key.replace("-", "–");

const weekLabel = (week: string) =>
  new Date(`${week}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function typeParts(summary: GalleryStatsSummary): Part[] {
  const count = new Map(
    summary.types.map((item) => [item.type, item.circuits]),
  );
  const folded = summary.types.filter(
    (item): item is { type: string; circuits: number } =>
      item.type !== null &&
      !(NAMED_TYPES as readonly string[]).includes(item.type),
  );
  return [
    ...NAMED_TYPES.map((type, index) => ({
      key: type,
      label: type,
      value: count.get(type) ?? 0,
      color: SERIES[index]!,
    })),
    {
      key: "other",
      label: "Other types",
      value: folded.reduce((sum, item) => sum + item.circuits, 0),
      color: SERIES[6],
      detail:
        folded
          .slice(0, 3)
          .map((item) => `${item.type} ${formatted(item.circuits)}`)
          .join(" · ") + (folded.length > 3 ? " …" : ""),
    },
    {
      key: "untagged",
      label: "Untagged",
      value: count.get(null) ?? 0,
      color: NEUTRAL,
    },
  ];
}

function deviceParts(summary: GalleryStatsSummary): Part[] {
  const count = new Map(summary.devices.map((item) => [item.kind, item.count]));
  return DEVICE_PARTS.map((part, index) => ({
    key: part.key,
    label: part.label,
    value: part.kinds.reduce((sum, kind) => sum + (count.get(kind) ?? 0), 0),
    color: SERIES[index] ?? NEUTRAL,
    detail:
      part.key === "other"
        ? part.kinds
            .filter((kind) => (count.get(kind) ?? 0) > 0)
            .map(
              (kind) => `${KIND_LABELS[kind]} ${formatted(count.get(kind)!)}`,
            )
            .join(" · ") || undefined
        : undefined,
  }));
}

const typeTable = (summary: GalleryStatsSummary) => ({
  columns: ["Type", "Circuits", "Share"],
  rows: summary.types.map((item) => [
    item.type ?? "Untagged",
    item.circuits,
    share(item.circuits, summary.circuits),
  ]),
});

const deviceTable = (summary: GalleryStatsSummary) => {
  const total = summary.devices.reduce((sum, item) => sum + item.count, 0);
  return {
    columns: ["Device", "Count", "Share"],
    rows: summary.devices
      .filter((item) => item.count > 0)
      .map((item) => [
        KIND_LABELS[item.kind] ?? item.kind,
        item.count,
        share(item.count, total),
      ]),
  };
};

const weekTable = (summary: GalleryStatsSummary) => {
  const makers = makersOf(summary);
  return {
    columns: ["Week of", ...makers.map((maker) => maker.label), "Total"],
    rows: summary.weeks.map((item) => [
      weekLabel(item.week),
      ...makers.map((maker) => item[maker.key] ?? 0),
      makers.reduce((sum, maker) => sum + (item[maker.key] ?? 0), 0),
    ]),
  };
};

/** The transistor tile's note: the average, or how many are still to count. */
function transistorNote(summary: GalleryStatsSummary, library?: string) {
  const pending = summary.circuits - summary.counted;
  if (pending > 0) return `${formatted(pending)} circuits still being counted`;
  return `${average(summary.transistors, summary.counted)} per circuit${library ?? ""}`;
}

/** Who published a week's circuits; each keeps its hue in every view. */
const MAKERS = [
  { key: "human", label: "People", phrase: "people", color: SERIES[0] },
  { key: "ai", label: "AI", phrase: "AI", color: SERIES[1] },
  { key: "dataset", label: "Datasets", phrase: "datasets", color: SERIES[2] },
] as const;

/** Words in a sentence: `a and b`, `a, b and c`. */
const listed = (words: readonly string[]) =>
  words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
    : (words[0] ?? "");

/** The makers a summary's weeks hold any circuit of. */
const makersOf = (summary: GalleryStatsSummary) =>
  MAKERS.filter((maker) =>
    summary.weeks.some((item) => (item[maker.key] ?? 0) > 0),
  );

function PublishedChart({ summary }: { summary: GalleryStatsSummary }) {
  const makers = makersOf(summary);
  const shown = makers.length > 0 ? makers : [MAKERS[0]];
  return (
    <ChartCard
      wide
      title="Published per week"
      subtitle={`The last ${summary.weeks.length} weeks${
        shown.length > 1
          ? `, by ${listed(shown.map((maker) => maker.phrase))}`
          : ""
      }`}
      table={weekTable(summary)}
      testId="stats-weeks"
    >
      <ColumnChart
        label="Circuits published per week"
        stacked
        caps="extremes"
        axisEvery={2}
        series={shown}
        columns={summary.weeks.map((item) => ({
          key: item.week,
          label: weekLabel(item.week),
          values: shown.map((maker) => item[maker.key] ?? 0),
        }))}
      />
    </ChartCard>
  );
}

const SOURCE_NOTES: Record<GalleryStatsSource, string> = {
  all: "Public circuits of the community and of the reference datasets; withdrawn circuits are not counted.",
  community:
    "Public circuits of the community Gallery; withdrawn circuits and the reference datasets are not counted.",
  datasets:
    "The reference datasets' circuits, redrawn as Analog Canvas schematics.",
};

/** The Gallery, from the stores chosen: how big it is and how its circuits spread. */
export function GalleryStatsView({
  stats,
  source = "community",
}: {
  stats: GalleryStatsPayload;
  source?: GalleryStatsSource;
}) {
  const { summary, topAuthors } = stats;
  const datasets = summary.datasets ?? 0;
  const community = summary.circuits - datasets;
  const datasetNames = (stats.sources ?? [])
    .filter((item) => item.key !== "community" && item.circuits > 0)
    .map((item) => item.name);
  if (summary.circuits === 0)
    return (
      <div className="stats-view">
        <p className="stats-empty" data-testid="gallery-stats-empty">
          No public circuits in the Gallery yet.
        </p>
      </div>
    );
  return (
    <div className="stats-view" data-testid="gallery-stats">
      <div className="stats-tiles">
        <StatTile
          accent
          label="Circuits"
          value={formatted(summary.circuits)}
          testId="gallery-stats-circuits"
          note={
            source === "all"
              ? `${formatted(community)} community · ${formatted(datasets)} from datasets`
              : source === "datasets"
                ? `${share(summary.netlist, summary.circuits)} with a netlist`
                : `${share(summary.netlist, summary.circuits)} with a netlist · ${share(summary.ai, summary.circuits)} by AI`
          }
        />
        {source === "datasets" ? (
          <StatTile
            label="Datasets"
            value={formatted(datasetNames.length)}
            note={datasetNames.join(" · ")}
          />
        ) : (
          <StatTile
            label="Authors"
            value={formatted(summary.authors)}
            note={`${average(summary.circuits, summary.authors)} circuits each`}
          />
        )}
        <StatTile
          label="Components"
          value={formatted(summary.components)}
          note={`${average(summary.components, summary.circuits)} per circuit`}
        />
        <StatTile
          label="Transistors"
          value={formatted(summary.transistors)}
          testId="gallery-stats-transistors"
          note={transistorNote(summary)}
        />
      </div>
      <div className="stats-grid">
        <ChartCard
          title="Circuit types"
          subtitle="Each circuit by its first function tag"
          table={typeTable(summary)}
          testId="stats-types"
        >
          <DonutChart parts={typeParts(summary)} caption="circuits" />
        </ChartCard>
        <ChartCard
          title="Devices"
          subtitle="Every part drawn; a called Cell's once per call"
          table={deviceTable(summary)}
          testId="stats-devices"
        >
          <SegmentedChart parts={deviceParts(summary)} caption="devices" />
        </ChartCard>
        <ChartCard
          title="Circuit size"
          subtitle="Circuits by their number of components"
          testId="stats-sizes"
        >
          <ColumnChart
            label="Circuits by number of components"
            series={[{ key: "circuits", label: "Circuits", color: SERIES[0] }]}
            columns={summary.sizes.map((item) => ({
              key: item.key,
              label: range(item.key),
              values: [item.circuits],
            }))}
          />
        </ChartCard>
        <ChartCard
          title="Transistors per circuit"
          subtitle="Circuits by their number of transistors"
          testId="stats-transistors"
        >
          <ColumnChart
            label="Circuits by number of transistors"
            series={[{ key: "circuits", label: "Circuits", color: SERIES[0] }]}
            columns={summary.transistorBins.map((item) => ({
              key: item.key,
              label: range(item.key),
              values: [item.circuits],
            }))}
          />
        </ChartCard>
        <PublishedChart summary={summary} />
        <ChartCard
          title="Popular tags"
          subtitle="Circuits carrying each tag"
          testId="stats-tags"
        >
          <BarList
            rows={summary.tags.slice(0, 10).map((item) => ({
              key: item.tag,
              label: item.tag,
              value: item.circuits,
            }))}
          />
        </ChartCard>
        <ChartCard
          title="Most circuits"
          subtitle={
            source === "datasets"
              ? "Circuits of each dataset"
              : "Authors with the most public circuits"
          }
          testId="stats-authors"
        >
          <BarList
            rows={topAuthors.map((item, index) => ({
              key: `${index}`,
              label: item.author,
              value: item.circuits,
            }))}
          />
        </ChartCard>
      </div>
      <p className="stats-footnote">{SOURCE_NOTES[source]}</p>
    </div>
  );
}

/** Shares of a distribution, in whole percents, for comparing two of them. */
const percents = (bins: readonly { circuits: number }[]) => {
  const total = bins.reduce((sum, bin) => sum + bin.circuits, 0);
  return bins.map((bin) => (total ? (bin.circuits / total) * 100 : 0));
};

const percent = (value: number) =>
  value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;

/** One distribution of an author's, beside the whole Gallery's when known. */
function CompareChart({
  title,
  subtitle,
  testId,
  who,
  mine,
  library,
}: {
  title: string;
  subtitle: string;
  testId: string;
  who: string;
  mine: readonly { key: string; circuits: number }[];
  library?: readonly { key: string; circuits: number }[] | undefined;
}) {
  if (!library)
    return (
      <ChartCard title={title} subtitle={subtitle} testId={testId}>
        <ColumnChart
          label={title}
          series={[{ key: "mine", label: who, color: SERIES[0] }]}
          columns={mine.map((item) => ({
            key: item.key,
            label: range(item.key),
            values: [item.circuits],
          }))}
        />
      </ChartCard>
    );
  const own = percents(mine);
  const all = percents(library);
  return (
    <ChartCard
      title={title}
      subtitle={`${subtitle}, as a share of each`}
      testId={testId}
      table={{
        columns: ["Range", who, "Share", "Gallery share"],
        rows: mine.map((item, index) => [
          range(item.key),
          item.circuits,
          percent(own[index]!),
          percent(all[index]!),
        ]),
      }}
    >
      <ColumnChart
        label={`${title}: ${who} beside the Gallery`}
        format={percent}
        series={[
          { key: "mine", label: who, color: SERIES[0] },
          { key: "gallery", label: "Gallery", color: NEUTRAL },
        ]}
        columns={mine.map((item, index) => ({
          key: item.key,
          label: range(item.key),
          values: [own[index]!, all[index]!],
        }))}
      />
    </ChartCard>
  );
}

/**
 * One author's statistics: their circuits' spread beside the Gallery's, and
 * every circuit in a table. Each account sees its own; the Owner sees any
 * author's on the Data tab, with further columns.
 */
export function AuthorStatsView<Row extends CircuitStatsRow>({
  stats,
  library,
  who = "You",
  columns,
  badges,
  onRefresh,
  refreshing,
}: {
  stats: AuthorStatsPayload<Row>;
  library?: GalleryStatsSummary | undefined;
  /** How the comparisons name the author. */
  who?: string;
  columns?: readonly CircuitStatsColumn<Row>[] | undefined;
  badges?: ((row: Row) => readonly string[]) | undefined;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean | undefined;
}) {
  const { summary, rank, circuits } = stats;
  if (summary.circuits === 0)
    return (
      <div className="stats-view">
        <div className="stats-empty" data-testid="author-stats-empty">
          <p>No public circuits yet.</p>
          <p className="stats-empty-hint">
            Circuits published to the Gallery are counted here.
          </p>
        </div>
      </div>
    );
  const libraryAverage = (total: number, count: number) =>
    library ? ` · Gallery ${average(total, count)}` : "";
  return (
    <div className="stats-view" data-testid="author-stats">
      <div className="stats-tiles">
        <StatTile
          accent
          label="Circuits"
          value={formatted(summary.circuits)}
          testId="author-stats-circuits"
          note={[
            rank
              ? `#${rank.position} of ${formatted(rank.authors)} authors`
              : "",
            library
              ? `${share(summary.circuits, library.circuits)} of the Gallery`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <StatTile
          label="Components"
          value={formatted(summary.components)}
          note={`${average(summary.components, summary.circuits)} per circuit${
            library ? libraryAverage(library.components, library.circuits) : ""
          }`}
        />
        <StatTile
          label="Transistors"
          value={formatted(summary.transistors)}
          testId="author-stats-transistors"
          note={transistorNote(
            summary,
            library
              ? libraryAverage(library.transistors, library.counted)
              : undefined,
          )}
        />
        <StatTile
          label="Likes received"
          value={formatted(summary.likes)}
          note={`${formatted(summary.liked)} of ${formatted(summary.circuits)} circuits liked`}
        />
      </div>
      <div className="stats-grid">
        <ChartCard
          title="Circuit types"
          subtitle="Each circuit by its first function tag"
          table={typeTable(summary)}
          testId="stats-types"
        >
          <DonutChart parts={typeParts(summary)} caption="circuits" />
        </ChartCard>
        <ChartCard
          title="Devices"
          subtitle="Every part drawn; a called Cell's once per call"
          table={deviceTable(summary)}
          testId="stats-devices"
        >
          <SegmentedChart parts={deviceParts(summary)} caption="devices" />
        </ChartCard>
        <CompareChart
          title="Circuit size"
          subtitle="Circuits by their number of components"
          testId="stats-sizes"
          who={who}
          mine={summary.sizes}
          library={library?.sizes}
        />
        <CompareChart
          title="Transistors per circuit"
          subtitle="Circuits by their number of transistors"
          testId="stats-transistors"
          who={who}
          mine={summary.transistorBins}
          library={library?.transistorBins}
        />
        <PublishedChart summary={summary} />
        <ChartCard
          wide
          title="Tags"
          subtitle="The tags on most of these circuits"
          testId="stats-tags"
        >
          <BarList
            empty="None of these circuits has a tag yet."
            rows={summary.tags.slice(0, 8).map((item) => ({
              key: item.tag,
              label: item.tag,
              value: item.circuits,
            }))}
          />
        </ChartCard>
      </div>
      <CircuitStatsTable
        circuits={circuits}
        columns={columns}
        badges={badges}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    </div>
  );
}

type Load<T> =
  { status: "loading" } | { status: "failed" } | { status: "ready"; data: T };

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The Gallery's statistics from the stores chosen, all by default. */
export const readGalleryStats = (source: GalleryStatsSource = "all") =>
  readJson<GalleryStatsPayload>(`/api/gallery/stats?source=${source}`);

type StatsView = "gallery" | "mine";

const VIEW_LABELS: Record<StatsView, string> = {
  gallery: "Whole Gallery",
  mine: "My circuits",
};

const SOURCE_LABELS: Record<GalleryStatsSource, string> = {
  all: "All",
  community: "Community",
  datasets: "Datasets",
};

const SCOPE_NOTES: Record<GalleryStatsSource | "mine", string> = {
  all: "The community's public circuits and the reference datasets'",
  community: "Every public circuit in the community Gallery",
  datasets: "The reference datasets' redrawn circuits",
  mine: "Your public circuits, beside the community Gallery",
};

/** The view a link names (`?view=mine`), or the whole Gallery. */
export const statsViewFromSearch = (search: string): StatsView =>
  new URLSearchParams(search).get("view") === "mine" ? "mine" : "gallery";

/** The stores a link names (`?source=community` or `datasets`), or all. */
export const statsSourceFromSearch = (search: string): GalleryStatsSource => {
  const source = new URLSearchParams(search).get("source");
  return source === "community" || source === "datasets" ? source : "all";
};

/** The address with one search parameter set, or removed at its default. */
function remember(name: string, value: string | null) {
  // A reload or a link returns to the same view.
  try {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // A sandboxed frame may refuse; the view is open either way.
  }
}

const kept =
  <T,>(read: T | null) =>
  (current: Load<T> | undefined): Load<T> =>
    read
      ? { status: "ready", data: read }
      : current?.status === "ready"
        ? current
        : { status: "failed" };

/**
 * The account page's Statistics tab: the Gallery's statistics, from all its
 * stores, the community's or the datasets', and the account's own beside the
 * community's. Each is read when first shown and again on Refresh; a failed
 * refresh keeps the numbers already shown.
 */
export function StatisticsContent() {
  const [view, setView] = useState<StatsView>(() =>
    statsViewFromSearch(window.location.search),
  );
  const [source, setSource] = useState<GalleryStatsSource>(() =>
    statsSourceFromSearch(window.location.search),
  );
  const [reads, setReads] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [galleries, setGalleries] = useState<
    Partial<Record<GalleryStatsSource, Load<GalleryStatsPayload>>>
  >({});
  const [mine, setMine] = useState<Load<AuthorStatsPayload<CircuitStatsRow>>>({
    status: "loading",
  });
  // The account's own sit beside the community's, whatever the Gallery view shows.
  const needed: GalleryStatsSource = view === "gallery" ? source : "community";
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const round = `${needed}:${reads}`;
    if (requested.current.has(round)) return;
    requested.current.add(round);
    void readGalleryStats(needed).then((read) => {
      setGalleries((known) => ({
        ...known,
        [needed]: kept(read)(known[needed]),
      }));
      setRefreshing(false);
    });
  }, [needed, reads]);
  useEffect(() => {
    let cancelled = false;
    void readJson<AuthorStatsPayload<CircuitStatsRow>>(
      "/api/gallery/mine/stats",
    ).then((read) => {
      if (!cancelled) setMine(kept(read));
    });
    return () => {
      cancelled = true;
    };
  }, [reads]);
  const library = galleries[needed] ?? { status: "loading" };
  const shown = view === "gallery" ? library : mine;
  const community = galleries.community;
  return (
    <div className="stats-page" data-testid="statistics">
      <div className="stats-toolbar">
        <div className="stats-switch" role="tablist" aria-label="Statistics">
          {(["gallery", "mine"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              data-testid={`statistics-view-${item}`}
              onClick={() => {
                setView(item);
                remember("view", item === "mine" ? "mine" : null);
              }}
            >
              {VIEW_LABELS[item]}
            </button>
          ))}
        </div>
        {view === "gallery" ? (
          <div
            className="stats-switch stats-switch-small"
            role="group"
            aria-label="Circuits counted"
          >
            {(["all", "community", "datasets"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={source === item}
                data-testid={`statistics-source-${item}`}
                onClick={() => {
                  setSource(item);
                  remember("source", item === "all" ? null : item);
                }}
              >
                {SOURCE_LABELS[item]}
              </button>
            ))}
          </div>
        ) : null}
        <span className="stats-scope">
          {SCOPE_NOTES[view === "gallery" ? source : "mine"]}
        </span>
        <button
          type="button"
          className="stats-refresh"
          data-testid="statistics-refresh"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            setReads((count) => count + 1);
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {shown.status === "loading" ? (
        <p className="gallery-status">Counting circuits…</p>
      ) : shown.status === "failed" ? (
        <p className="gallery-status" data-testid="statistics-failed">
          Could not load the statistics — try again later.
        </p>
      ) : view === "gallery" ? (
        <GalleryStatsView
          stats={shown.data as GalleryStatsPayload}
          source={source}
        />
      ) : (
        <AuthorStatsView
          stats={shown.data as AuthorStatsPayload<CircuitStatsRow>}
          library={
            community?.status === "ready" ? community.data.summary : undefined
          }
        />
      )}
    </div>
  );
}

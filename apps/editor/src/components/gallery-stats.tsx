import { useEffect, useState } from "react";

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
  weeks: { week: string; human: number; ai: number }[];
}

export interface AuthorRank {
  position: number;
  authors: number;
}

export interface GalleryStatsPayload {
  summary: GalleryStatsSummary;
  topAuthors: { author: string; circuits: number }[];
}

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

const weekTable = (summary: GalleryStatsSummary) => ({
  columns: ["Week of", "People", "AI", "Total"],
  rows: summary.weeks.map((item) => [
    weekLabel(item.week),
    item.human,
    item.ai,
    item.human + item.ai,
  ]),
});

/** The transistor tile's note: the average, or how many are still to count. */
function transistorNote(summary: GalleryStatsSummary, library?: string) {
  const pending = summary.circuits - summary.counted;
  if (pending > 0) return `${formatted(pending)} circuits still being counted`;
  return `${average(summary.transistors, summary.counted)} per circuit${library ?? ""}`;
}

function PublishedChart({ summary }: { summary: GalleryStatsSummary }) {
  const withAi = summary.weeks.some((item) => item.ai > 0);
  return (
    <ChartCard
      wide
      title="Published per week"
      subtitle={`The last ${summary.weeks.length} weeks${withAi ? ", by people and by AI" : ""}`}
      table={weekTable(summary)}
      testId="stats-weeks"
    >
      <ColumnChart
        label="Circuits published per week"
        stacked
        caps="extremes"
        axisEvery={2}
        series={[
          { key: "human", label: "People", color: SERIES[0] },
          ...(withAi ? [{ key: "ai", label: "AI", color: SERIES[1] }] : []),
        ]}
        columns={summary.weeks.map((item) => ({
          key: item.week,
          label: weekLabel(item.week),
          values: withAi ? [item.human, item.ai] : [item.human],
        }))}
      />
    </ChartCard>
  );
}

/** The whole community Gallery: how big it is and how its circuits spread. */
export function GalleryStatsView({ stats }: { stats: GalleryStatsPayload }) {
  const { summary, topAuthors } = stats;
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
          note={`${share(summary.netlist, summary.circuits)} with a netlist · ${share(summary.ai, summary.circuits)} by AI`}
        />
        <StatTile
          label="Authors"
          value={formatted(summary.authors)}
          note={`${average(summary.circuits, summary.authors)} circuits each`}
        />
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
          subtitle="Authors with the most public circuits"
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
      <p className="stats-footnote">
        Public circuits of the community Gallery; withdrawn circuits and the
        reference datasets are not counted.
      </p>
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

/** The whole Gallery's statistics, read once per caller and on each refresh. */
export const readGalleryStats = () =>
  readJson<GalleryStatsPayload>("/api/gallery/stats");

type StatsView = "gallery" | "mine";

const VIEW_LABELS: Record<StatsView, string> = {
  gallery: "Whole Gallery",
  mine: "My circuits",
};

const VIEW_NOTES: Record<StatsView, string> = {
  gallery: "Every public circuit in the community Gallery",
  mine: "Your public circuits, beside the whole Gallery",
};

/** The view a link names (`?view=mine`), or the whole Gallery. */
export const statsViewFromSearch = (search: string): StatsView =>
  new URLSearchParams(search).get("view") === "mine" ? "mine" : "gallery";

/**
 * The account page's Statistics tab: the whole Gallery's statistics and the
 * account's own, one view at a time, both read together and refreshed
 * together; a failed refresh keeps the numbers already shown.
 */
export function StatisticsContent() {
  const [view, setView] = useState<StatsView>(() =>
    statsViewFromSearch(window.location.search),
  );
  const [reads, setReads] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [gallery, setGallery] = useState<Load<GalleryStatsPayload>>({
    status: "loading",
  });
  const [mine, setMine] = useState<Load<AuthorStatsPayload<CircuitStatsRow>>>({
    status: "loading",
  });
  useEffect(() => {
    let cancelled = false;
    const keep =
      <T,>(read: T | null) =>
      (current: Load<T>): Load<T> =>
        read
          ? { status: "ready", data: read }
          : current.status === "ready"
            ? current
            : { status: "failed" };
    void Promise.all([
      readGalleryStats(),
      readJson<AuthorStatsPayload<CircuitStatsRow>>("/api/gallery/mine/stats"),
    ]).then(([library, own]) => {
      if (cancelled) return;
      setGallery(keep(library));
      setMine(keep(own));
      setRefreshing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reads]);
  const choose = (next: StatsView) => {
    setView(next);
    // The address names the view, so a reload or a link returns to it.
    try {
      const url = new URL(window.location.href);
      if (next === "mine") url.searchParams.set("view", "mine");
      else url.searchParams.delete("view");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // A sandboxed frame may refuse; the view is open either way.
    }
  };
  const shown = view === "gallery" ? gallery : mine;
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
              onClick={() => choose(item)}
            >
              {VIEW_LABELS[item]}
            </button>
          ))}
        </div>
        <span className="stats-scope">{VIEW_NOTES[view]}</span>
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
        <GalleryStatsView stats={shown.data as GalleryStatsPayload} />
      ) : (
        <AuthorStatsView
          stats={shown.data as AuthorStatsPayload<CircuitStatsRow>}
          library={
            gallery.status === "ready" ? gallery.data.summary : undefined
          }
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";

import land from "../data/land-110m.json";
import {
  landPathsForWorld,
  WORLD_BOUNDS,
  type FeatureCollection,
} from "../lib/world-map";

type DayRow = { date: string; pv: number; uv: number };
type MetricRow = { pv: number; uv: number };
type Summary = {
  generatedAt: string;
  totals: MetricRow;
  today: DayRow;
  days: DayRow[];
  countries: ({ code: string } & MetricRow)[];
  points: { lat: number; lng: number; count: number }[];
  paths: ({ path: string } & MetricRow)[];
  sources: ({ source: string } & MetricRow)[];
  breakdownStartedAt: string;
  breakdownTotals: {
    countries: MetricRow;
    sources: MetricRow;
    pages: MetricRow;
  };
};

const MAP_W = 1800;
const MAP_H = Math.round(
  MAP_W *
    ((WORLD_BOUNDS.north - WORLD_BOUNDS.south) /
      (WORLD_BOUNDS.east - WORLD_BOUNDS.west)),
);
const LAND_PATHS = landPathsForWorld(
  land as unknown as FeatureCollection,
  MAP_W,
  MAP_H,
);
const number = new Intl.NumberFormat("en");

const SOURCE_LABELS: Record<string, string> = {
  "direct-or-unknown": "Direct / unknown",
  "search:google": "Google Search",
  "search:bing": "Bing Search",
  "search:baidu": "Baidu Search",
  "search:duckduckgo": "DuckDuckGo Search",
  "search:yahoo": "Yahoo Search",
  "search:yandex": "Yandex Search",
  "search:ecosia": "Ecosia Search",
  "search:naver": "Naver Search",
  "search:sogou": "Sogou Search",
  "search:360": "360 Search",
  "social:wechat": "WeChat",
  "social:linkedin": "LinkedIn",
  "social:x": "X / Twitter",
  "social:facebook": "Facebook",
  "social:instagram": "Instagram",
  "social:reddit": "Reddit",
  "social:github": "GitHub",
  "social:zhihu": "Zhihu",
  "social:bilibili": "Bilibili",
  "social:xiaohongshu": "Xiaohongshu",
  "campaign:email": "Email / newsletter",
  "campaign:qr": "QR code",
  "campaign:rss": "RSS",
  "campaign:other": "Other campaign",
  "ref:other": "Other website",
  __other__: "Other sources",
};

export function AnalyticsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Analytics — Analog Canvas";
    document.body.classList.add("analytics-body");
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = robots?.content;
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex, follow";
    return () => {
      document.title = previousTitle;
      document.body.classList.remove("analytics-body");
      if (previousRobots == null) robots?.remove();
      else if (robots) robots.content = previousRobots;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const key = new URLSearchParams(window.location.search).get("key");
    const endpoint = key
      ? `/api/analytics?key=${encodeURIComponent(key)}`
      : "/api/analytics";
    void fetch(endpoint, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<Summary>;
      })
      .then(setSummary)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(true);
        }
      });
    return () => controller.abort();
  }, []);

  const visibleDays = useMemo(
    () =>
      summary?.days.filter((day) => day.pv > 0 || day.uv > 0).slice(-90) ?? [],
    [summary],
  );
  const generated = summary
    ? new Date(summary.generatedAt).toLocaleString("en", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <div className="analytics-shell">
      <header className="analytics-topbar">
        <a href="/">← Back to editor</a>
        <span>Analog Canvas</span>
      </header>
      <main className="analytics-page">
        <header className="analytics-head">
          <p className="analytics-kicker">First-party, privacy-friendly</p>
          <h1>Visitor analytics</h1>
          <p>
            UTC days · updated{" "}
            <time dateTime={summary?.generatedAt}>{generated}</time>
          </p>
        </header>

        {error ? (
          <p className="analytics-error">
            Analytics are temporarily unavailable. If a dashboard key is
            configured, append it as
            <code>?key=…</code>.
          </p>
        ) : null}

        <dl className="analytics-metrics" aria-label="Traffic totals">
          <Metric label="Unique visitors" value={summary?.totals.uv} />
          <Metric label="Page views" value={summary?.totals.pv} />
          <Metric label="Visitors today" value={summary?.today.uv} />
          <Metric label="Views today" value={summary?.today.pv} />
        </dl>

        <Section title="Daily traffic" aside="Last 90 active days">
          <DailyChart days={visibleDays} />
        </Section>

        <Section title="Visitor origins" aside="≈1° request buckets">
          <WorldHeatmap points={summary?.points ?? []} />
        </Section>

        <div className="analytics-columns">
          <Section title="Countries and regions" aside="Top">
            <BreakdownTable
              heading="Region"
              rows={summary?.countries ?? []}
              total={summary?.breakdownTotals.countries ?? { pv: 0, uv: 0 }}
              label={(row) => countryName(row.code)}
              loading={!summary && !error}
            />
          </Section>
          <Section title="Acquisition sources" aside="Top">
            <BreakdownTable
              heading="Source"
              rows={summary?.sources ?? []}
              total={summary?.breakdownTotals.sources ?? { pv: 0, uv: 0 }}
              label={(row) => sourceName(row.source)}
              loading={!summary && !error}
            />
          </Section>
          <section className="analytics-section analytics-section-wide">
            <SectionHead title="Pages" aside="Top" />
            <BreakdownTable
              heading="Path"
              rows={summary?.paths ?? []}
              total={summary?.breakdownTotals.pages ?? { pv: 0, uv: 0 }}
              label={(row) =>
                row.path === "__other__" ? "Other pages" : row.path
              }
              loading={!summary && !error}
            />
          </section>
        </div>

        <p className="analytics-privacy">
          No IP addresses, full referrer URLs, search terms, or canvas documents
          are stored. Location comes from Cloudflare and is rounded to
          approximately one degree. Do Not Track is honored.
        </p>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value == null ? "—" : number.format(value)}</dd>
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside: string;
  children: ReactNode;
}) {
  return (
    <section className="analytics-section">
      <SectionHead title={title} aside={aside} />
      {children}
    </section>
  );
}

function SectionHead({ title, aside }: { title: string; aside: string }) {
  return (
    <div className="analytics-section-head">
      <h2>{title}</h2>
      <span>{aside}</span>
    </div>
  );
}

function DailyChart({ days }: { days: DayRow[] }) {
  const width = 900;
  const height = 220;
  const bottom = 24;
  if (!days.length) {
    return (
      <div className="analytics-empty">No traffic has been recorded yet.</div>
    );
  }
  const max = Math.max(1, ...days.map((day) => day.pv));
  const slot = width / days.length;
  return (
    <svg
      className="analytics-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Daily page views and visitors"
    >
      {days.map((day, index) => {
        const pvHeight = (day.pv / max) * (height - bottom - 18);
        const uvHeight = (day.uv / max) * (height - bottom - 18);
        const title = `${day.date}: ${number.format(day.pv)} views, ${number.format(day.uv)} visitors`;
        return (
          <g key={day.date}>
            <rect
              className="analytics-bar-pv"
              x={index * slot + slot * 0.15}
              y={height - bottom - pvHeight}
              width={slot * 0.7}
              height={Math.max(pvHeight, day.pv ? 1 : 0)}
            >
              <title>{title}</title>
            </rect>
            <rect
              className="analytics-bar-uv"
              x={index * slot + slot * 0.35}
              y={height - bottom - uvHeight}
              width={slot * 0.3}
              height={Math.max(uvHeight, day.uv ? 1 : 0)}
            >
              <title>{title}</title>
            </rect>
          </g>
        );
      })}
      <line
        className="analytics-axis"
        x1="0"
        x2={width}
        y1={height - bottom}
        y2={height - bottom}
      />
      <text className="analytics-tick" x="0" y="12">
        {number.format(max)}
      </text>
      <text className="analytics-tick" x="0" y={height - 5}>
        {days[0]!.date.slice(5)}
      </text>
      <text
        className="analytics-tick"
        x={width}
        y={height - 5}
        textAnchor="end"
      >
        {days.at(-1)!.date.slice(5)}
      </text>
    </svg>
  );
}

function WorldHeatmap({ points }: { points: Summary["points"] }) {
  const max = Math.max(1, ...points.map((point) => point.count));
  return (
    <div className="analytics-map-frame">
      <svg
        className="analytics-map"
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        role="img"
        aria-label="World heatmap of visitor origins"
      >
        <defs>
          <radialGradient id="canvas-heat">
            <stop offset="0%" stopOpacity="0.9" />
            <stop offset="60%" stopOpacity="0.3" />
            <stop offset="100%" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect className="analytics-ocean" width={MAP_W} height={MAP_H} />
        <g className="analytics-land">
          {LAND_PATHS.map((path, index) => (
            <path d={path} key={index} />
          ))}
        </g>
        <g>
          {points.map((point) => {
            const x =
              ((point.lng - WORLD_BOUNDS.west) /
                (WORLD_BOUNDS.east - WORLD_BOUNDS.west)) *
              MAP_W;
            const y =
              ((WORLD_BOUNDS.north - point.lat) /
                (WORLD_BOUNDS.north - WORLD_BOUNDS.south)) *
              MAP_H;
            const radius = 10 + 34 * Math.sqrt(point.count / max);
            const title = `${number.format(point.count)} views near ${point.lat}, ${point.lng}`;
            return (
              <g key={`${point.lat},${point.lng}`}>
                <circle className="analytics-heat" cx={x} cy={y} r={radius}>
                  <title>{title}</title>
                </circle>
                <circle className="analytics-heat-core" cx={x} cy={y} r={3}>
                  <title>{title}</title>
                </circle>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function BreakdownTable<T extends MetricRow>({
  heading,
  rows,
  total,
  label,
  loading,
}: {
  heading: string;
  rows: T[];
  total: MetricRow;
  label: (row: T) => string;
  loading: boolean;
}) {
  return (
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <thead>
          <tr>
            <th>{heading}</th>
            <th>Visitors</th>
            <th>Views</th>
          </tr>
        </thead>
        <tbody>
          {loading || rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="analytics-empty">
                {loading ? "Loading…" : "No data yet."}
              </td>
            </tr>
          ) : (
            rows.slice(0, 12).map((row, index) => (
              <tr key={`${label(row)}-${index}`}>
                <td>{label(row)}</td>
                <MetricCell value={row.uv} total={total.uv} />
                <MetricCell value={row.pv} total={total.pv} />
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MetricCell({ value, total }: { value: number; total: number }) {
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <td className="analytics-number">
      {number.format(value)} <small>{share.toFixed(1)}%</small>
    </td>
  );
}

function countryName(code: string): string {
  if (code === "__other__") return "Other regions";
  if (code === "T1") return "Tor network";
  if (code === "XX") return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function sourceName(source: string): string {
  return (
    SOURCE_LABELS[source] ??
    (source.startsWith("ref:") ? source.slice(4) : source)
  );
}

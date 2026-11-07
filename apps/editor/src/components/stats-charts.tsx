import { useState, type ReactNode } from "react";
import "./stats-charts.css";

/**
 * The Statistics tab's charts, drawn in plain SVG and CSS: stat tiles, a
 * donut and a segmented bar for part-to-whole, columns for distributions and
 * time, and ranked bars. Categorical hues come in this fixed order, which
 * keeps neighbours apart for colour-blind readers; each entity keeps its hue
 * in every view, and a gray holds the rest. Every chart's numbers are also in
 * its legend or its table view, never in colour alone.
 */
export const SERIES = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
] as const;
export const NEUTRAL = "#c3c2b7";

const numberFormat = new Intl.NumberFormat("en-US");
export const formatted = (value: number) => numberFormat.format(value);

/** `part` of `whole` as a whole percentage; a sliver reads "<1%". */
export function share(part: number, whole: number): string {
  if (!whole || !part) return "0%";
  const percent = (part / whole) * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

export function StatTile({
  label,
  value,
  note,
  accent = false,
  testId,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  accent?: boolean;
  testId?: string;
}) {
  return (
    <div className={`stats-tile${accent ? " stats-tile-accent" : ""}`}>
      <span className="stats-tile-label">{label}</span>
      <span className="stats-tile-value" data-testid={testId}>
        {value}
      </span>
      {note ? <span className="stats-tile-note">{note}</span> : null}
    </div>
  );
}

/** A chart's numbers as rows, the view a reader can switch to. */
export interface ChartTable {
  columns: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}

export function ChartCard({
  title,
  subtitle,
  table,
  wide = false,
  testId,
  children,
}: {
  title: string;
  subtitle?: string;
  table?: ChartTable;
  wide?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section
      className={`stats-card${wide ? " stats-card-wide" : ""}`}
      data-testid={testId}
    >
      <header className="stats-card-header">
        <div className="stats-card-heading">
          <h3 className="stats-card-title">{title}</h3>
          {subtitle ? <p className="stats-card-subtitle">{subtitle}</p> : null}
        </div>
        {table ? (
          <button
            type="button"
            className="stats-card-toggle"
            aria-pressed={asTable}
            onClick={() => setAsTable((shown) => !shown)}
          >
            {asTable ? "Chart" : "Table"}
          </button>
        ) : null}
      </header>
      {asTable && table ? (
        <div className="stats-table-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                {table.columns.map((column, index) => (
                  <th
                    key={column}
                    scope="col"
                    className={index > 0 ? "stats-numeric" : undefined}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className={index > 0 ? "stats-numeric" : undefined}
                    >
                      {typeof cell === "number" ? formatted(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** One part of a whole: its hue, and what the legend says of it. */
export interface Part {
  key: string;
  label: string;
  value: number;
  color: string;
  /** A muted line under the label, as what a folded part holds. */
  detail?: string | undefined;
}

/** The legend of a whole: each part's swatch, name, amount and share. */
function ShareList({
  parts,
  total,
  active,
  onActive,
}: {
  parts: readonly Part[];
  total: number;
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  return (
    <ul className="stats-share-list">
      {parts.map((part) => (
        <li
          key={part.key}
          tabIndex={0}
          data-active={active === part.key || undefined}
          data-dimmed={(active !== null && active !== part.key) || undefined}
          onMouseEnter={() => onActive(part.key)}
          onMouseLeave={() => onActive(null)}
          onFocus={() => onActive(part.key)}
          onBlur={() => onActive(null)}
        >
          <span
            className="stats-swatch"
            style={{ background: part.color }}
            aria-hidden="true"
          />
          <span className="stats-share-label">
            {part.label}
            {part.detail ? (
              <span className="stats-share-detail">{part.detail}</span>
            ) : null}
          </span>
          <span className="stats-share-value">{formatted(part.value)}</span>
          <span className="stats-share-percent">
            {share(part.value, total)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A whole as a ring beside its legend. Pointing at a slice or a legend row
 * shows that part in the ring's centre; otherwise the centre gives the whole.
 */
export function DonutChart({
  parts,
  caption,
}: {
  parts: readonly Part[];
  /** What the whole counts, under its total in the centre. */
  caption: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const size = 164;
  const stroke = 22;
  const radius = (size - stroke) / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const drawn = parts.filter((part) => part.value > 0);
  const focus = drawn.find((part) => part.key === active);
  let start = 0;
  return (
    <div className="stats-donut">
      <div className="stats-donut-figure">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${caption}: ${drawn
            .map((part) => `${part.label} ${formatted(part.value)}`)
            .join(", ")}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--stats-track)"
            strokeWidth={stroke}
          />
          {drawn.map((part) => {
            const length = total ? (part.value / total) * circumference : 0;
            // The surface shows through a 2px gap between neighbours.
            const gap = drawn.length > 1 ? Math.min(2, length / 2) : 0;
            const arc = (
              <circle
                key={part.key}
                className="stats-donut-slice"
                data-dimmed={
                  (active !== null && active !== part.key) || undefined
                }
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={part.color}
                strokeWidth={active === part.key ? stroke + 6 : stroke}
                strokeDasharray={`${Math.max(length - gap, 0.01)} ${circumference}`}
                strokeDashoffset={-start}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                onMouseEnter={() => setActive(part.key)}
                onMouseLeave={() => setActive(null)}
              >
                <title>{`${part.label}: ${formatted(part.value)} (${share(part.value, total)})`}</title>
              </circle>
            );
            start += length;
            return arc;
          })}
        </svg>
        <div className="stats-donut-center" aria-hidden="true">
          <span className="stats-donut-value">
            {formatted(focus ? focus.value : total)}
          </span>
          <span className="stats-donut-caption">
            {focus ? `${focus.label} · ${share(focus.value, total)}` : caption}
          </span>
        </div>
      </div>
      <ShareList
        parts={parts.filter((part) => part.value > 0)}
        total={total}
        active={active}
        onActive={setActive}
      />
    </div>
  );
}

/** A whole as one thin bar of parts over its legend. */
export function SegmentedChart({
  parts,
  caption,
}: {
  parts: readonly Part[];
  caption: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="stats-segmented">
      <div className="stats-segmented-total">
        <span className="stats-segmented-value">{formatted(total)}</span>
        <span className="stats-segmented-caption">{caption}</span>
      </div>
      <div
        className="stats-segmented-bar"
        role="img"
        aria-label={`${caption}: ${parts
          .filter((part) => part.value > 0)
          .map((part) => `${part.label} ${formatted(part.value)}`)
          .join(", ")}`}
      >
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.key}
              className="stats-segment"
              data-dimmed={
                (active !== null && active !== part.key) || undefined
              }
              style={{
                flexGrow: part.value,
                background: part.color,
              }}
              title={`${part.label}: ${formatted(part.value)} (${share(part.value, total)})`}
              onMouseEnter={() => setActive(part.key)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
      </div>
      <ShareList
        parts={parts.filter((part) => part.value > 0)}
        total={total}
        active={active}
        onActive={setActive}
      />
    </div>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
}

export interface Column {
  key: string;
  label: string;
  /** One value per series, in the series' order. */
  values: readonly number[];
}

/** The smallest round number that holds `value`, halving to a whole tick. */
function niceCeiling(value: number): number {
  if (value < 10) return Math.max(2, 2 * Math.ceil(value / 2));
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10].find(
    (factor) => factor * power >= value,
  )!;
  return Math.round(step * power);
}

/**
 * Columns from one baseline: one series, several side by side, or several
 * stacked. Values sit on the caps the chart names (`caps`), the axis and each
 * column's tooltip carry the rest.
 */
export function ColumnChart({
  series,
  columns,
  stacked = false,
  caps = "all",
  capSeries = 0,
  axisEvery = 1,
  format = formatted,
  label,
}: {
  series: readonly Series[];
  columns: readonly Column[];
  stacked?: boolean;
  /** Which columns print their value on the cap: all, the tallest and last, or none. */
  caps?: "all" | "extremes" | "none";
  /** Unstacked, the series whose values the caps print. */
  capSeries?: number;
  /** Name every nth column under the axis, counted back from the last; a narrow chart names half of them. */
  axisEvery?: number;
  format?: (value: number) => string;
  label: string;
}) {
  const heights = columns.map((column) =>
    stacked
      ? column.values.reduce((sum, value) => sum + value, 0)
      : Math.max(0, ...column.values),
  );
  const top = niceCeiling(Math.max(0, ...heights));
  const ticks = [top, top / 2, 0];
  const tallest = heights.indexOf(Math.max(...heights));
  const percent = (value: number) => `${(value / top) * 100}%`;
  const capOf = (index: number): number | null => {
    if (caps === "none") return null;
    if (
      caps === "extremes" &&
      index !== tallest &&
      index !== columns.length - 1
    )
      return null;
    return stacked
      ? heights[index]!
      : (columns[index]!.values[capSeries] ?? null);
  };
  return (
    <div className="stats-columns" role="img" aria-label={label}>
      {series.length > 1 ? (
        <ul className="stats-legend">
          {series.map((item) => (
            <li key={item.key}>
              <span
                className="stats-swatch"
                style={{ background: item.color }}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="stats-columns-frame">
        <div className="stats-columns-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{format(tick)}</span>
          ))}
        </div>
        <div className="stats-columns-plot">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="stats-gridline"
              data-baseline={tick === 0 || undefined}
              style={{ bottom: percent(tick) }}
            />
          ))}
          {columns.map((column, index) => {
            const cap = capOf(index);
            return (
              <div
                key={column.key}
                className="stats-column"
                tabIndex={0}
                aria-label={`${column.label}: ${series
                  .map(
                    (item, at) =>
                      `${item.label} ${format(column.values[at] ?? 0)}`,
                  )
                  .join(", ")}`}
              >
                {stacked ? (
                  <div
                    className="stats-stack"
                    style={{ height: percent(heights[index]!) }}
                  >
                    {series.map((item, at) =>
                      (column.values[at] ?? 0) > 0 ? (
                        <span
                          key={item.key}
                          className="stats-stack-part"
                          style={{
                            flexGrow: column.values[at],
                            background: item.color,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                ) : (
                  <div className="stats-group">
                    {series.map((item, at) => (
                      <span key={item.key} className="stats-bar-slot">
                        <span
                          className="stats-bar"
                          data-empty={!column.values[at] || undefined}
                          style={{
                            height: percent(column.values[at] ?? 0),
                            background: item.color,
                          }}
                        />
                        {at === capSeries && cap !== null && cap > 0 ? (
                          <span
                            className="stats-cap"
                            style={{ bottom: `calc(${percent(cap)} + 4px)` }}
                          >
                            {format(cap)}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                )}
                {stacked && cap !== null && cap > 0 ? (
                  <span
                    className="stats-cap"
                    style={{ bottom: `calc(${percent(cap)} + 4px)` }}
                  >
                    {format(cap)}
                  </span>
                ) : null}
                <span className="stats-tip" role="tooltip">
                  <strong>{column.label}</strong>
                  {series.map((item, at) => (
                    <span key={item.key} className="stats-tip-row">
                      <span
                        className="stats-swatch"
                        style={{ background: item.color }}
                        aria-hidden="true"
                      />
                      {item.label}
                      <b>{format(column.values[at] ?? 0)}</b>
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        <div className="stats-columns-labels" aria-hidden="true">
          {columns.map((column, index) => {
            const back = columns.length - 1 - index;
            return (
              <span
                key={column.key}
                data-minor={
                  (axisEvery > 1 && back % (2 * axisEvery) !== 0) || undefined
                }
              >
                {back % axisEvery === 0 ? column.label : ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface Ranked {
  key: string;
  label: string;
  value: number;
}

/** Ranked horizontal bars of one series, each value at its bar's tip. */
export function BarList({
  rows,
  color = SERIES[0],
  empty = "Nothing to show yet.",
}: {
  rows: readonly Ranked[];
  color?: string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="stats-empty-note">{empty}</p>;
  const largest = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ol className="stats-bar-list">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="stats-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="stats-bar-track">
            <span
              className="stats-bar-fill"
              style={{
                // The value at the tip keeps its room at the longest bar.
                width: `calc((100% - 4rem) * ${row.value / largest})`,
                background: color,
              }}
            />
            <span className="stats-bar-value">{formatted(row.value)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

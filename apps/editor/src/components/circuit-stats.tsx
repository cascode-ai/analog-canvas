import { Fragment, useMemo, useState } from "react";
import "./circuit-stats.css";

/**
 * One public circuit of an account, as its statistics count it: the parts
 * its top Cell draws (the Gallery's part count) and the transistors it holds,
 * each Cell it calls counted once per call. Null while not yet counted.
 */
export interface CircuitStatsRow {
  id: string;
  name: string;
  createdAt: string;
  components: number | null;
  transistors: number | null;
  aiGenerated?: boolean;
  netlistable?: boolean;
  /** It carries a testbench, so it can be simulated. */
  simulatable?: boolean;
}

/** A circuit's marks in its row: made by AI, exports a netlist, simulates. */
const circuitBadges = (circuit: CircuitStatsRow): string[] => [
  ...(circuit.aiGenerated ? ["AI"] : []),
  ...(circuit.netlistable ? ["Netlist"] : []),
  ...(circuit.simulatable ? ["Sim"] : []),
];

/** A further number column, as the Owner's Data tab adds likes and opens. */
export interface CircuitStatsColumn<Row> {
  key: string;
  label: string;
  value: (row: Row) => number;
}

type SortKey = "name" | "date" | "components" | "transistors" | string;

const numberFormat = new Intl.NumberFormat("en-US");
const formatted = (value: number) => numberFormat.format(value);
const day = (iso: string) => iso.slice(0, 10);

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** A number and a bar of its share of the column's largest. */
function Measure({
  value,
  largest,
  tone,
}: {
  value: number | null;
  largest: number;
  tone: "components" | "transistors";
}) {
  if (value === null)
    return (
      <span
        className="circuit-stats-unknown"
        title="Not counted yet"
        aria-label="Not counted yet"
      >
        —
      </span>
    );
  return (
    <span className="circuit-stats-measure">
      <span className="circuit-stats-bar" aria-hidden="true">
        <span
          className={`circuit-stats-bar-fill circuit-stats-bar-${tone}`}
          style={{
            width: `${largest > 0 ? Math.max((value / largest) * 100, value ? 4 : 0) : 0}%`,
          }}
        />
      </span>
      <span className="circuit-stats-value">{formatted(value)}</span>
    </span>
  );
}

/**
 * An account's public circuits, one sortable row each with its components
 * and transistors and a Total row (each account on its own Statistics tab,
 * every author on the Owner's Data tab).
 */
export function CircuitStatsTable<Row extends CircuitStatsRow>({
  circuits,
  columns = [],
  badges = circuitBadges,
  onRefresh,
  refreshing = false,
}: {
  circuits: readonly Row[];
  columns?: readonly CircuitStatsColumn<Row>[] | undefined;
  badges?: ((row: Row) => readonly string[]) | undefined;
  /** Read the numbers again; the table keeps showing the old ones meanwhile. */
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean | undefined;
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "date",
    descending: true,
  });
  const [query, setQuery] = useState("");
  const components = sum(circuits.map((row) => row.components));
  const transistors = sum(circuits.map((row) => row.transistors));
  const uncounted = circuits.filter(
    (row) => row.components === null || row.transistors === null,
  ).length;
  const largest = {
    components: Math.max(0, ...circuits.map((row) => row.components ?? 0)),
    transistors: Math.max(0, ...circuits.map((row) => row.transistors ?? 0)),
  };
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? circuits.filter((row) => row.name.toLowerCase().includes(needle))
      : [...circuits];
    const extra = columns.find((column) => column.key === sort.key);
    const key = (row: Row): string | number =>
      sort.key === "name"
        ? row.name.toLowerCase()
        : sort.key === "date"
          ? row.createdAt
          : sort.key === "components"
            ? (row.components ?? -1)
            : sort.key === "transistors"
              ? (row.transistors ?? -1)
              : (extra?.value(row) ?? 0);
    return matching.sort((left, right) => {
      const [a, b] = [key(left), key(right)];
      const order = a < b ? -1 : a > b ? 1 : 0;
      return (
        (sort.descending ? -order : order) || (left.id < right.id ? -1 : 1)
      );
    });
  }, [circuits, columns, query, sort]);
  const header = (key: SortKey, label: string, numeric = false) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        className={numeric ? "circuit-stats-numeric" : undefined}
        aria-sort={
          active ? (sort.descending ? "descending" : "ascending") : "none"
        }
      >
        <button
          type="button"
          className="circuit-stats-sort"
          data-active={active || undefined}
          onClick={() =>
            setSort((current) => ({
              key,
              // A first click on a number puts the largest first.
              descending:
                current.key === key ? !current.descending : key !== "name",
            }))
          }
        >
          {label}
          <span className="circuit-stats-sort-mark" aria-hidden="true">
            {active ? (sort.descending ? "↓" : "↑") : "↕"}
          </span>
        </button>
      </th>
    );
  };
  return (
    <div className="circuit-stats" data-testid="circuit-stats">
      {circuits.length === 0 ? null : (
        <div className="circuit-stats-card">
          <div className="circuit-stats-toolbar">
            <span className="circuit-stats-caption">
              {query.trim()
                ? `${shown.length} of ${circuits.length} circuits`
                : `${circuits.length} ${circuits.length === 1 ? "circuit" : "circuits"}`}
            </span>
            <div className="circuit-stats-actions">
              {circuits.length > 8 ? (
                <input
                  className="circuit-stats-search"
                  type="search"
                  aria-label="Filter circuits"
                  placeholder="Filter circuits…"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              ) : null}
              {onRefresh ? (
                <button
                  type="button"
                  className="circuit-stats-action"
                  data-testid="circuit-stats-refresh"
                  disabled={refreshing}
                  onClick={onRefresh}
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="circuit-stats-scroll">
            <table className="circuit-stats-table">
              <thead>
                <tr>
                  {header("name", "Circuit")}
                  {header("date", "Published")}
                  {header("components", "Components", true)}
                  {header("transistors", "Transistors", true)}
                  {columns.map((column) => (
                    <Fragment key={column.key}>
                      {header(column.key, column.label, true)}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} data-testid="circuit-stats-row">
                    <td className="circuit-stats-name">
                      <a href={`/g/${row.id}`}>{row.name}</a>
                      {(badges?.(row) ?? []).map((badge) => (
                        <span key={badge} className="circuit-stats-badge">
                          {badge}
                        </span>
                      ))}
                    </td>
                    <td className="circuit-stats-date">{day(row.createdAt)}</td>
                    <td className="circuit-stats-numeric">
                      <Measure
                        value={row.components}
                        largest={largest.components}
                        tone="components"
                      />
                    </td>
                    <td className="circuit-stats-numeric">
                      <Measure
                        value={row.transistors}
                        largest={largest.transistors}
                        tone="transistors"
                      />
                    </td>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className="circuit-stats-numeric circuit-stats-plain"
                      >
                        {formatted(column.value(row))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="circuit-stats-total">
                  <th scope="row">Total</th>
                  <td className="circuit-stats-date">
                    {circuits.length}{" "}
                    {circuits.length === 1 ? "circuit" : "circuits"}
                  </td>
                  <td className="circuit-stats-numeric">
                    {formatted(components)}
                  </td>
                  <td className="circuit-stats-numeric">
                    {formatted(transistors)}
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="circuit-stats-numeric">
                      {formatted(sum(circuits.map(column.value)))}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          {uncounted ? (
            <p className="circuit-stats-footnote">
              {uncounted} {uncounted === 1 ? "circuit is" : "circuits are"} not
              counted yet (—); totals leave {uncounted === 1 ? "it" : "them"}{" "}
              out until the count finishes.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

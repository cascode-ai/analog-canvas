import type {
  Prepared,
  SimulationOutputData,
} from "@icm/simulation-service/contract";

type Measurement = NonNullable<SimulationOutputData["measurements"]>[number];

export interface SimulationComparisonRun {
  readonly id: string;
  readonly label: string;
  readonly inputRevision: string;
  readonly environment: Prepared["environment"];
  readonly measurements: readonly Measurement[];
  readonly current: boolean;
}

interface ComparisonColumn {
  readonly key: string;
  readonly label: string;
}

interface ComparisonSignal {
  readonly key: string;
  readonly label: string;
  readonly measurements: Map<string, Measurement>;
}

interface ComparisonSection {
  readonly key: string;
  readonly label: string;
  readonly columns: readonly ComparisonColumn[];
  readonly signals: readonly ComparisonSignal[];
}

const SUMMARY_COLUMNS: readonly ComparisonColumn[] = [
  { key: "automatic\u0000maximum", label: "Maximum" },
  { key: "automatic\u0000minimum", label: "Minimum" },
  { key: "automatic\u0000peak-to-peak", label: "Peak to peak" },
];

function condition(run: SimulationComparisonRun): string {
  return [
    run.environment.corner?.toUpperCase(),
    run.environment.temperatureC === undefined
      ? undefined
      : `${run.environment.temperatureC} °C`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function format(value: number, unit: string): string {
  return `${Number(value.toPrecision(6))}${unit === "1" ? "" : ` ${unit}`}`;
}

function columnKey(measurement: Measurement): string {
  return (measurement.origin ?? "automatic") === "authored"
    ? `authored\u0000${measurement.measurementId}`
    : `automatic\u0000${measurement.metric}`;
}

function analysisTitle(analysis: Measurement["analysis"]): string {
  if (analysis === "op") return "Operating Point";
  if (analysis === "tran") return "Transient";
  return analysis.toUpperCase();
}

function sectionsForRun(run: SimulationComparisonRun): ComparisonSection[] {
  const groups = new Map<string, Measurement[]>();
  for (const measurement of run.measurements) {
    const key = `${measurement.analysis}\u0000${measurement.plotName}`;
    const group = groups.get(key) ?? [];
    group.push(measurement);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, measurements]) => {
    const first = measurements[0]!;
    const automaticColumns: readonly ComparisonColumn[] =
      first.analysis === "op"
        ? [{ key: "automatic\u0000operating-point", label: "Value" }]
        : SUMMARY_COLUMNS;
    const authoredColumns = new Map<string, ComparisonColumn>();
    const signals = new Map<string, ComparisonSignal>();

    for (const measurement of measurements) {
      const metricKey = columnKey(measurement);
      if ((measurement.origin ?? "automatic") === "authored")
        authoredColumns.set(metricKey, {
          key: metricKey,
          label: measurement.label,
        });
      if (
        !automaticColumns.some((column) => column.key === metricKey) &&
        !authoredColumns.has(metricKey)
      )
        continue;

      const signalKey = `${measurement.outputId}\u0000${measurement.unit}`;
      const signal = signals.get(signalKey) ?? {
        key: signalKey,
        label: measurement.outputLabel,
        measurements: new Map<string, Measurement>(),
      };
      signal.measurements.set(metricKey, measurement);
      signals.set(signalKey, signal);
    }

    return {
      key,
      label:
        first.plotName === analysisTitle(first.analysis)
          ? first.plotName
          : `${analysisTitle(first.analysis)} · ${first.plotName}`,
      columns: [...automaticColumns, ...authoredColumns.values()],
      signals: [...signals.values()],
    };
  });
}

export function SimulationRunComparison({
  runs,
  onRemove,
}: {
  runs: readonly SimulationComparisonRun[];
  onRemove?(runId: string): void;
}) {
  if (!runs.length)
    return (
      <p className="simulation-empty-result">
        Complete a structured run to compare its measurements.
      </p>
    );

  return (
    <div className="simulation-comparison-runs">
      {runs.map((run, runIndex) => (
        <section className="simulation-comparison-run" key={run.id}>
          <header>
            <span>
              <strong>
                {run.current ? "Current" : `Previous ${runIndex + 1}`}
              </strong>
              <small>{condition(run) || run.environment.profileId}</small>
            </span>
            {!run.current && onRemove ? (
              <button
                type="button"
                aria-label={`Remove ${run.label} from comparison`}
                onClick={() => onRemove(run.id)}
              >
                ×
              </button>
            ) : null}
          </header>
          {sectionsForRun(run).map((section) => (
            <section
              className="simulation-comparison-analysis"
              key={section.key}
            >
              <h3>{section.label}</h3>
              <div className="simulation-run-comparison-table-wrap">
                <table
                  className="simulation-run-comparison-table"
                  aria-label={`${section.label} comparison for ${run.current ? "current run" : `previous run ${runIndex + 1}`}`}
                >
                  <thead>
                    <tr>
                      <th>Signal</th>
                      {section.columns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.signals.map((signal) => (
                      <tr key={signal.key}>
                        <th>{signal.label}</th>
                        {section.columns.map((column) => {
                          const item = signal.measurements.get(column.key);
                          return (
                            <td key={column.key}>
                              {!item ? (
                                <span className="simulation-comparison-missing">
                                  —
                                </span>
                              ) : item.status === "available" ? (
                                format(item.value, item.unit)
                              ) : (
                                <span
                                  className="simulation-comparison-unavailable"
                                  title={item.reason}
                                >
                                  Unavailable
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}

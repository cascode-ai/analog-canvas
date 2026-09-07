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

function measurementKey(measurement: Measurement): string {
  return (measurement.origin ?? "automatic") === "authored"
    ? `authored\u0000${measurement.measurementId}`
    : `automatic\u0000${measurement.analysis}\u0000${measurement.outputId}\u0000${measurement.metric}\u0000${measurement.unit}`;
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
  const rows = new Map<string, Measurement>();
  for (const run of runs)
    for (const measurement of run.measurements)
      rows.set(measurementKey(measurement), measurement);
  return (
    <div className="simulation-run-comparison-table-wrap">
      <table className="simulation-run-comparison-table">
        <thead>
          <tr>
            <th>Measurement</th>
            {runs.map((run) => (
              <th key={run.id}>
                <span>
                  <strong>{run.label}</strong>
                  <small>
                    {condition(run) || run.environment.profileId}
                    {run.current ? " · Current" : ""}
                  </small>
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
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows.entries()].map(([key, row]) => (
            <tr key={key}>
              <th>
                <strong>{row.outputLabel}</strong>
                <small>
                  {row.analysis.toUpperCase()} · {row.label}
                </small>
              </th>
              {runs.map((run) => {
                const item = run.measurements.find(
                  (candidate) => measurementKey(candidate) === key,
                );
                return (
                  <td key={run.id}>
                    {!item ? (
                      <span className="simulation-comparison-missing">—</span>
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
  );
}

import type { SimulationOutputData } from "@icm/simulation-service/contract";

type Measurement = NonNullable<SimulationOutputData["measurements"]>[number];

function formatMeasurement(value: number, unit: string): string {
  const magnitude = Math.abs(value);
  const scales = [
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
    [1e-12, "p"],
  ] as const;
  const scale =
    value === 0
      ? ([1, ""] as const)
      : (scales.find(([factor]) => magnitude >= factor) ??
        ([1e-15, "f"] as const));
  const number = Number((value / scale[0]).toPrecision(5));
  return `${number} ${scale[1]}${unit === "1" ? "" : unit}`.trim();
}

export function SimulationMeasurementResults({
  measurements,
}: {
  measurements: readonly Measurement[];
}) {
  if (!measurements.length) return null;
  const unavailable = measurements.filter(
    (measurement) => measurement.status === "unavailable",
  );
  const availableCount = measurements.length - unavailable.length;
  const groups = new Map<string, Measurement[]>();
  for (const measurement of measurements) {
    const key = `${measurement.analysisIndex}:${measurement.plotName}`;
    groups.set(key, [...(groups.get(key) ?? []), measurement]);
  }
  return (
    <details
      className="simulation-measurement-results"
      open={unavailable.length > 0}
    >
      <summary>
        <span>
          <strong>Measurements</strong>
          <small>Automatic summaries from complete result data</small>
        </span>
        <span data-status={unavailable.length ? "attention" : "ready"}>
          {availableCount} {availableCount === 1 ? "value" : "values"}
          {unavailable.length ? ` · ${unavailable.length} unavailable` : ""}
        </span>
      </summary>
      <div>
        {[...groups.entries()].map(([key, group]) => (
          <section key={key}>
            <header>
              <strong>{group[0]!.analysis.toUpperCase()}</strong>
              <span>{group[0]!.plotName}</span>
            </header>
            <table>
              <thead>
                <tr>
                  <th>Output</th>
                  <th>Measurement</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {group.map((measurement) => (
                  <tr key={measurement.id} data-status={measurement.status}>
                    <td>{measurement.outputLabel}</td>
                    <td>{measurement.label}</td>
                    <td>
                      {measurement.status === "available" ? (
                        formatMeasurement(measurement.value, measurement.unit)
                      ) : (
                        <span title={measurement.reason}>
                          Unavailable · {measurement.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </details>
  );
}

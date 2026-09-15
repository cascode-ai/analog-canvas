import {
  formatSimulationSpec,
  type SimulationSpecReport,
} from "@icm/simulation-service/contract";

export function SimulationSpecResults(props: {
  report: SimulationSpecReport | undefined;
  hasRun: boolean;
  stale: boolean;
  onSource(source: { path: string; line: number; text: string }): void;
}) {
  const rows = props.report?.results ?? [];
  const counts = { pass: 0, failed: 0, "not-evaluated": 0, unconstrained: 0 };
  for (const row of rows) counts[row.judgment]++;
  const labels = {
    pass: "Pass",
    failed: "Failed",
    "not-evaluated": "Not evaluated",
    unconstrained: "—",
  };
  return (
    <section
      className="simulation-spec-results"
      aria-label="Specification results"
    >
      {props.stale ? (
        <p className="simulation-spec-stale">
          Previous run · input has changed
        </p>
      ) : null}
      {rows.length ? (
        <>
          <p className="simulation-spec-summary">
            {counts.pass} Pass · {counts.failed} Failed ·{" "}
            {counts["not-evaluated"]} Not evaluated
            {counts.unconstrained
              ? ` · ${counts.unconstrained} without spec`
              : ""}
          </p>
          <table>
            <thead>
              <tr>
                <th>Spec</th>
                <th>Sim result</th>
                <th>Expected</th>
                <th>Judgment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-judgment={row.judgment}>
                  <th>
                    <button
                      type="button"
                      onClick={() => props.onSource(row.source)}
                      title={`${row.source.path}:${row.source.line} · occurrence ${row.occurrence}`}
                    >
                      {row.name}
                      {row.occurrence > 1 ? ` · #${row.occurrence}` : ""}
                    </button>
                  </th>
                  <td
                    title={row.value === null ? undefined : String(row.value)}
                  >
                    {row.value === null
                      ? "—"
                      : `${Number(row.value.toPrecision(7))}${row.unit ? ` ${row.unit}` : ""}`}
                  </td>
                  <td>
                    {formatSimulationSpec(row.expected)}
                    {row.expected && row.unit ? ` ${row.unit}` : ""}
                  </td>
                  <td>
                    <span title={row.detail}>{labels[row.judgment]}</span>
                    {row.judgment === "not-evaluated" ? (
                      <small>{row.detail}</small>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="simulation-empty-result">
          {props.hasRun
            ? "Results available in Explorer. No specification report or measurements were recorded."
            : "Run your code to evaluate specifications. Raw and CSV results will appear in Explorer."}
        </p>
      )}
    </section>
  );
}

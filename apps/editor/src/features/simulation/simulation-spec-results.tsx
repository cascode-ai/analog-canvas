import {
  formatSimulationSpec,
  type SimulationSpecReport,
} from "@icm/simulation-service/contract";
import { formatSpecValues } from "./simulation-spec-format";
import { SimulationSpecLabel } from "./simulation-spec-label";

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
    unconstrained: "Measured only",
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
          <div
            className="simulation-spec-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Measurement table"
          >
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
                {rows.map((row) => {
                  const formatted = formatSpecValues(
                    row.value,
                    row.expected,
                    row.unit,
                  );
                  return (
                    <tr key={row.id} data-judgment={row.judgment}>
                      <th scope="row">
                        <button
                          type="button"
                          onClick={() => props.onSource(row.source)}
                          title={`${row.name} · ${row.source.path}:${row.source.line} · occurrence ${row.occurrence}`}
                        >
                          {row.label ? (
                            <SimulationSpecLabel document={row.label} />
                          ) : (
                            row.name
                          )}
                          {row.occurrence > 1 ? ` · #${row.occurrence}` : ""}
                        </button>
                      </th>
                      <td
                        className="simulation-spec-number"
                        title={
                          row.value === null
                            ? undefined
                            : `${row.value} ${row.unit || "(unit not declared)"}`
                        }
                      >
                        {formatted.result}
                        {row.value !== null ? (
                          <>
                            {" "}
                            <span
                              className="simulation-spec-unit"
                              title={
                                row.unit
                                  ? undefined
                                  : "Unit not declared in captured source"
                              }
                            >
                              {formatted.unit}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td
                        className="simulation-spec-number"
                        title={
                          row.expected
                            ? `${formatSimulationSpec(row.expected)} ${row.unit || "(unit not declared)"}`
                            : "No acceptance condition"
                        }
                      >
                        {formatted.condition}
                        {row.expected ? (
                          <>
                            {" "}
                            <span className="simulation-spec-unit">
                              {formatted.unit}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <span title={row.detail}>{labels[row.judgment]}</span>
                        {row.judgment === "not-evaluated" ? (
                          <small>{row.detail}</small>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

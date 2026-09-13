import type { SimulationOutputData } from "@icm/simulation-service/contract";

export function NativeMeasurementResults({
  measurements,
}: {
  measurements: NonNullable<SimulationOutputData["nativeMeasurements"]>;
}) {
  if (!measurements.length) return null;
  return (
    <section
      className="simulation-measurement-results"
      aria-label="Native measurements"
    >
      <h4>Measurements</h4>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Report</th>
            <th>Value</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {measurements.map((measurement, index) => (
            <tr key={index}>
              <th>{measurement.name}</th>
              <td>{measurement.occurrence || "—"}</td>
              <td>
                {measurement.status === "available"
                  ? measurement.value.toPrecision(7)
                  : "Unavailable"}
              </td>
              <td title={measurement.detail}>
                {measurement.status === "available"
                  ? `Console line ${measurement.logLine}`
                  : measurement.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

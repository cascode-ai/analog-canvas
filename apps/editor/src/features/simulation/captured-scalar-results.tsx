import type { SimulationOutputData } from "@icm/simulation-service/contract";

export function CapturedScalarResults({
  scalars,
  record,
}: {
  scalars: NonNullable<SimulationOutputData["analyses"][number]["scalars"]>;
  record: number;
}) {
  if (!scalars.length) return null;
  return (
    <section
      aria-label={`Captured scalars record ${record}`}
      className="simulation-measurement-results"
    >
      <h4>Captured values · Record {record}</h4>
      <p>
        Single values stored in this raw plot. These are not samples along its
        sweep axis. Console measurement reports are listed separately.
      </p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {scalars.map((s) => (
            <tr key={s.id}>
              <th>{s.label}</th>
              <td>
                {s.value.toPrecision(7)}
                {s.imaginary !== undefined && s.imaginary !== 0
                  ? ` ${s.imaginary < 0 ? "−" : "+"} j${Math.abs(s.imaginary).toPrecision(7)}`
                  : ""}
              </td>
              <td>{s.unit === "1" ? "Dimensionless" : s.unit || "Unknown"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

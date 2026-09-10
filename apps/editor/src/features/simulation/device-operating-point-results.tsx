import type { SimulationOutputData } from "@icm/simulation-service/contract";

export function DeviceOperatingPointResults({
  devices,
}: {
  devices: NonNullable<SimulationOutputData["deviceOperatingPoints"]>;
}) {
  if (devices.length === 0) return null;
  const multipleRecords =
    new Set(devices.map((device) => device.analysisIndex)).size > 1;
  return (
    <section
      className="simulation-device-operating-points"
      aria-label="MOS operating-point details"
    >
      <header>
        <h3>MOS operating-point details</h3>
      </header>
      <div>
        {devices.map((device) => (
          <section
            key={`${device.analysisIndex ?? "none"}:${device.id}`}
            aria-label={`${device.reference} details`}
          >
            <header>
              <strong>{device.reference}</strong>
              <small>{device.polarity.toUpperCase()}</small>
              {multipleRecords ? (
                <small>
                  Record{" "}
                  {device.rawPlotOrdinals?.join(", ") ?? device.analysisIndex}
                </small>
              ) : null}
            </header>
            <table>
              <tbody>
                {device.values.map((value) => (
                  <tr key={value.parameter}>
                    <th>{value.label}</th>
                    <td>
                      {value.status === "available"
                        ? `${value.value.toPrecision(6)} ${value.unit}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </section>
  );
}

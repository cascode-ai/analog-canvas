import type { SimulationOutputData } from "@icm/simulation-service/contract";

export function DeviceOperatingPointResults({
  devices,
}: {
  devices: NonNullable<SimulationOutputData["deviceOperatingPoints"]>;
}) {
  if (devices.length === 0) return null;
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
          <section key={device.id} aria-label={`${device.reference} details`}>
            <header>
              <strong>{device.reference}</strong>
              <small>{device.polarity.toUpperCase()}</small>
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

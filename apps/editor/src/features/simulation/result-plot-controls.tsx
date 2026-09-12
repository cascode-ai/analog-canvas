import type { ReactNode } from "react";
import type { SimulationOutputData } from "@icm/simulation-service/contract";
import { useWaveformView, type WaveformController } from "./waveform-view";

export function ResultRecordView({
  resultKey,
  children,
}: {
  resultKey: string;
  children: (view: WaveformController) => ReactNode;
}) {
  return children(useWaveformView(resultKey));
}

/** These declarations are session-only presentation, never writes to native Code. */
export function ResultPlotControls({
  view,
  outputs,
}: {
  view: WaveformController;
  outputs: SimulationOutputData["analyses"][number]["outputs"];
}) {
  return (
    <details className="simulation-plot-controls">
      <summary>Plot layout and units</summary>
      <label>
        Layout{" "}
        <select
          aria-label="Plot layout"
          value={view.state.plotLayout}
          onChange={(event) =>
            view.set(
              "plotLayout",
              event.target.value === "separate" ? "separate" : "units",
            )
          }
        >
          <option value="units">Group compatible units</option>
          <option value="separate">Separate each trace</option>
        </select>
      </label>
      <p>
        Linked horizontal axis and cursors; independent vertical axes. Unknown
        units are kept separate.
      </p>
      {outputs
        .filter((o) => !o.unit)
        .map((output) => (
          <label key={output.id}>
            {output.label}{" "}
            <select
              aria-label={`${output.label} display unit`}
              value={view.state.unitOverrides[output.id] ?? ""}
              onChange={(event) =>
                view.set("unitOverrides", (previous) => {
                  const next = { ...previous };
                  if (event.target.value) next[output.id] = event.target.value;
                  else delete next[output.id];
                  return next;
                })
              }
            >
              <option value="">Unknown unit</option>
              <option value="1">Dimensionless</option>
              <option value="V">V</option>
              <option value="A">A</option>
              <option value="dB">dB</option>
              <option value="deg">Degrees</option>
              <option value="rad">Radians</option>
            </select>
          </label>
        ))}
      <p>
        Declaring a display unit labels existing numbers; it does not convert
        values or rerun the simulation.
      </p>
    </details>
  );
}

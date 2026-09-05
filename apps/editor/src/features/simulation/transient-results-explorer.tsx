import { useMemo, useState } from "react";
import type { SimulationProbeSpec } from "@icm/model";
import type { TransientResult } from "@icm/spice-run";
import type { Prepared } from "@icm/simulation-service/contract";

interface TransientTrace {
  readonly id: string;
  readonly label: string;
  readonly colorIndex: number;
  readonly quantity: "voltage" | "current";
  readonly unit: string | null;
  readonly values: readonly number[];
  readonly probe?: SimulationProbeSpec;
}

export interface TransientResultsExplorerProps {
  analysis: TransientResult;
  vectors: Prepared["vectors"];
  probes: readonly SimulationProbeSpec[];
  labels?: Readonly<Record<string, string>>;
  onFocusProbe?(probe: SimulationProbeSpec): void;
}

const PLOT = {
  width: 760,
  height: 230,
  left: 64,
  right: 14,
  top: 14,
  bottom: 32,
} as const;

function finiteExtent(values: readonly number[]): readonly [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
  if (min !== max) return [min, max];
  const margin = Math.max(Math.abs(min) * 0.05, 1e-12);
  return [min - margin, max + margin];
}

function compact(value: number): string {
  if (value === 0) return "0";
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
  const scale = scales.find(([factor]) => magnitude >= factor) ?? [1e-15, "f"];
  return `${(value / scale[0]).toPrecision(4).replace(/\.0+$/u, "")}${scale[1]}`;
}

export function transientPolylinePoints(
  timeSeconds: readonly number[],
  values: readonly number[],
  yExtent: readonly [number, number] = finiteExtent(values),
): string {
  const count = Math.min(timeSeconds.length, values.length);
  if (count === 0) return "";
  const [timeMin, timeMax] = finiteExtent(timeSeconds.slice(0, count));
  const timeSpan = timeMax - timeMin;
  const valueSpan = yExtent[1] - yExtent[0];
  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height - PLOT.top - PLOT.bottom;
  const points: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = timeSeconds[index]!;
    const value = values[index]!;
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    const x = PLOT.left + ((time - timeMin) / timeSpan) * plotWidth;
    const y = PLOT.top + ((yExtent[1] - value) / valueSpan) * plotHeight;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

function outputTraces(
  analysis: TransientResult,
  vectors: Prepared["vectors"],
  probes: readonly SimulationProbeSpec[],
  labels: Readonly<Record<string, string>>,
): TransientTrace[] {
  const vectorsByName = new Map(
    vectors.map((vector) => [vector.vector.toLowerCase(), vector]),
  );
  const probesById = new Map(probes.map((probe) => [probe.id, probe]));
  return analysis.probes.map((resultProbe, index) => {
    const binding = vectorsByName.get(resultProbe.name.toLowerCase());
    const authored = binding ? probesById.get(binding.probeId) : undefined;
    return {
      id: binding?.probeId ?? resultProbe.name,
      label: (binding && labels[binding.probeId]) || resultProbe.name,
      colorIndex: index,
      quantity:
        binding?.quantity ??
        (resultProbe.quantity === "current" ? "current" : "voltage"),
      unit: resultProbe.unit,
      values: resultProbe.value,
      ...(authored ? { probe: authored } : {}),
    };
  });
}

export function TransientResultsExplorer({
  analysis,
  vectors,
  probes,
  labels = {},
  onFocusProbe,
}: TransientResultsExplorerProps) {
  const traces = useMemo(
    () => outputTraces(analysis, vectors, probes, labels),
    [analysis, labels, probes, vectors],
  );
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const visible = traces.filter((trace) => !hidden.has(trace.id));
  const [timeMin, timeMax] = finiteExtent(analysis.timeSeconds);

  return (
    <div className="transient-results-explorer">
      <header>
        <div>
          <strong>{analysis.plotName}</strong>
          <small>
            {analysis.timeSeconds.length} solver points · {compact(timeMin)}s to{" "}
            {compact(timeMax)}s
          </small>
        </div>
      </header>
      <div className="simulation-output-browser" aria-label="Transient outputs">
        {traces.map((trace) => {
          const isVisible = !hidden.has(trace.id);
          return (
            <div
              key={trace.id}
              className={selected === trace.id ? "selected" : undefined}
            >
              <button
                type="button"
                className={`simulation-output-swatch ac-trace-${trace.colorIndex % 6}`}
                aria-label={`${isVisible ? "Hide" : "Show"} ${trace.label}`}
                aria-pressed={isVisible}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(trace.id)) next.delete(trace.id);
                    else next.add(trace.id);
                    return next;
                  })
                }
              />
              <button
                type="button"
                className="simulation-output-name"
                onClick={() => {
                  setSelected(trace.id);
                  if (trace.probe) onFocusProbe?.(trace.probe);
                }}
              >
                <strong>{trace.label}</strong>
                <small>
                  {trace.quantity} · {trace.probe ? "linked" : trace.id}
                </small>
              </button>
            </div>
          );
        })}
      </div>
      {(["voltage", "current"] as const).map((quantity) => {
        const quantityTraces = visible.filter(
          (trace) => trace.quantity === quantity,
        );
        if (quantityTraces.length === 0) return null;
        const extent = finiteExtent(
          quantityTraces.flatMap((trace) => trace.values),
        );
        const unit = quantityTraces.find((trace) => trace.unit)?.unit ?? "";
        return (
          <section key={quantity} className="transient-quantity-group">
            <h4>{quantity === "voltage" ? "Voltage" : "Current"}</h4>
            <svg
              role="img"
              aria-label={`Transient ${quantity}`}
              viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
            >
              <line
                className="transient-axis"
                x1={PLOT.left}
                y1={PLOT.top}
                x2={PLOT.left}
                y2={PLOT.height - PLOT.bottom}
              />
              <line
                className="transient-axis"
                x1={PLOT.left}
                y1={PLOT.height - PLOT.bottom}
                x2={PLOT.width - PLOT.right}
                y2={PLOT.height - PLOT.bottom}
              />
              <text x={PLOT.left} y={PLOT.height - 8}>
                {compact(timeMin)}s
              </text>
              <text
                textAnchor="end"
                x={PLOT.width - PLOT.right}
                y={PLOT.height - 8}
              >
                {compact(timeMax)}s
              </text>
              <text x={4} y={PLOT.top + 5}>
                {compact(extent[1])}
                {unit}
              </text>
              <text x={4} y={PLOT.height - PLOT.bottom}>
                {compact(extent[0])}
                {unit}
              </text>
              {quantityTraces.map((trace) => (
                <polyline
                  key={trace.id}
                  className={`transient-trace ac-trace-${trace.colorIndex % 6}`}
                  data-trace-index={trace.colorIndex}
                  points={transientPolylinePoints(
                    analysis.timeSeconds,
                    trace.values,
                    extent,
                  )}
                />
              ))}
            </svg>
          </section>
        );
      })}
    </div>
  );
}

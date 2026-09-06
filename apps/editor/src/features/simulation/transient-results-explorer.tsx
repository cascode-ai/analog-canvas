import {
  useEffect,
  useId,
  useMemo,
  useState,
  type SetStateAction,
} from "react";
import {
  WaveformInteraction,
  waveformTicks,
  waveformTickLabel,
  useWaveformWidth,
} from "./waveform-interaction";
import { useWaveformView } from "./waveform-view";
import { WaveformTools, WaveformMeasurements } from "./waveform-tools";
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
  resultKey?: string;
  analysis: TransientResult;
  vectors: Prepared["vectors"];
  probes: readonly SimulationProbeSpec[];
  labels?: Readonly<Record<string, string>>;
  onFocusProbe?(probe: SimulationProbeSpec): void;
}

const PLOT = {
  width: 760,
  height: 280,
  left: 64,
  right: 18,
  top: 16,
  bottom: 34,
} as const;
const EXPANDED_PLOT = { ...PLOT, width: 1400, height: 700 } as const;

type PlotGeometry = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};
type PlotQuantity = "voltage" | "current";

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

/**
 * Treat simulator round-off around a constant signal as a constant. Without
 * this tolerance, a few femtovolts of numerical noise consume the whole plot
 * height even though both axis labels round to the same value.
 */
export function transientValueExtent(
  values: readonly number[],
): readonly [number, number] {
  const extent = finiteExtent(values);
  const center = (extent[0] + extent[1]) / 2;
  const magnitude = Math.max(Math.abs(extent[0]), Math.abs(extent[1]));
  const tolerance = Math.max(magnitude * 1e-9, 1e-12);
  if (extent[1] - extent[0] > tolerance) return extent;
  const margin = Math.max(Math.abs(center) * 0.05, 1e-12);
  return [center - margin, center + margin];
}

/** Include line intersections at the viewport boundaries when it contains no solver sample. */
export function transientVisibleValues(
  times: readonly number[],
  values: readonly number[],
  range: readonly [number, number],
): number[] {
  const result: number[] = [];
  for (let i = 0; i < Math.min(times.length, values.length); i++) {
    const x = times[i]!,
      y = values[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x >= range[0] && x <= range[1]) result.push(y);
    if (i === 0) continue;
    const prevX = times[i - 1]!,
      prevY = values[i - 1]!;
    if (!Number.isFinite(prevY) || x <= prevX) continue;
    for (const edge of range)
      if (prevX < edge && x > edge)
        result.push(prevY + ((y - prevY) * (edge - prevX)) / (x - prevX));
  }
  return result;
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
  timeExtent: readonly [number, number] = finiteExtent(timeSeconds),
  plot: PlotGeometry = PLOT,
): string {
  const count = Math.min(timeSeconds.length, values.length);
  if (count === 0) return "";
  const timeSpan = timeExtent[1] - timeExtent[0];
  const valueSpan = yExtent[1] - yExtent[0];
  const plotWidth = plot.width - plot.left - plot.right;
  const plotHeight = plot.height - plot.top - plot.bottom;
  const points: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = timeSeconds[index]!;
    const value = values[index]!;
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(value) ||
      (time < timeExtent[0] &&
        (timeSeconds[index + 1] ?? time) < timeExtent[0]) ||
      (time > timeExtent[1] && (timeSeconds[index - 1] ?? time) > timeExtent[1])
    )
      continue;
    const x = plot.left + ((time - timeExtent[0]) / timeSpan) * plotWidth;
    const y = plot.top + ((yExtent[1] - value) / valueSpan) * plotHeight;
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
  resultKey,
}: TransientResultsExplorerProps) {
  const measured = useWaveformWidth();
  const clipPrefix = useId();
  const traces = useMemo(
    () => outputTraces(analysis, vectors, probes, labels),
    [analysis, labels, probes, vectors],
  );
  const controller = useWaveformView(resultKey);
  const { hidden, solo, selected, markers } = controller.state;
  const setHidden = (value: SetStateAction<ReadonlySet<string>>) =>
    controller.set("hidden", value);
  const setSolo = (value: React.SetStateAction<string | null>) =>
    controller.set("solo", value);
  const setSelected = (value: string) => controller.set("selected", value);
  const timeRange = controller.view.x;
  const valueRanges = controller.view.y;
  const [expandedQuantity, setExpandedQuantity] = useState<
    "voltage" | "current" | null
  >(null);
  const visible = traces.filter(
    (trace) => !hidden.has(trace.id) && (solo === null || solo === trace.id),
  );
  const fullRange = finiteExtent(analysis.timeSeconds);

  useEffect(() => {
    const cancelTransientPlotAction = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExpandedQuantity(null);
    };
    window.addEventListener("keydown", cancelTransientPlotAction);
    return () =>
      window.removeEventListener("keydown", cancelTransientPlotAction);
  }, []);

  const focusTrace = (traceId: string) => {
    const trace = traces.find((candidate) => candidate.id === traceId);
    if (!trace) return;
    setSelected(trace.id);
    if (trace.probe) onFocusProbe?.(trace.probe);
  };

  const plot = (
    quantity: PlotQuantity,
    quantityTraces: readonly TransientTrace[],
    expanded = false,
  ) => {
    const geometry = expanded
      ? EXPANDED_PLOT
      : { ...PLOT, width: measured.width };
    const range = timeRange ?? fullRange;
    const clipId = `${clipPrefix}-${quantity}-${expanded}`;
    const visibleValues = quantityTraces.flatMap((trace) =>
      transientVisibleValues(analysis.timeSeconds, trace.values, range),
    );
    const automaticExtent = transientValueExtent(visibleValues);
    const extent = valueRanges[quantity] ?? automaticExtent;
    const unit = quantityTraces.find((trace) => trace.unit)?.unit ?? "";
    return (
      <div className={`ac-plot-shell${expanded ? " expanded" : ""}`}>
        <WaveformInteraction
          axes={controller.state.axes}
          frame={{
            x: geometry.left,
            y: geometry.top,
            width: geometry.width - geometry.left - geometry.right,
            height: geometry.height - geometry.top - geometry.bottom,
          }}
          onZoom={(start, end) => {
            const x = [start.x, end.x].sort((a, b) => a - b);
            const y = [start.y, end.y].sort((a, b) => a - b);
            controller.commit({
              x:
                controller.state.axes === "y"
                  ? range
                  : [
                      range[0] + x[0]! * (range[1] - range[0]),
                      range[0] + x[1]! * (range[1] - range[0]),
                    ],
              y: {
                ...valueRanges,
                [quantity]:
                  controller.state.axes === "x"
                    ? extent
                    : [
                        extent[1] - y[1]! * (extent[1] - extent[0]),
                        extent[1] - y[0]! * (extent[1] - extent[0]),
                      ],
              },
            });
          }}
          onPan={(delta) => {
            const shift = -delta.x * (range[1] - range[0]),
              dy = delta.y * (extent[1] - extent[0]);
            controller.commit({
              x:
                controller.state.axes === "y"
                  ? range
                  : [range[0] + shift, range[1] + shift],
              y: {
                ...valueRanges,
                [quantity]:
                  controller.state.axes === "x"
                    ? extent
                    : [extent[0] + dy, extent[1] + dy],
              },
            });
          }}
          onPick={(point, id) => {
            if (id) focusTrace(id);
            const time = range[0] + point.x * (range[1] - range[0]);
            const nearest = analysis.timeSeconds.reduce(
              (best, value) =>
                Math.abs(value - time) < Math.abs(best - time) ? value : best,
              analysis.timeSeconds[0] ?? time,
            );
            controller.mark(nearest);
          }}
          onOpen={() => !expanded && setExpandedQuantity(quantity)}
        >
          <svg
            role="img"
            aria-label={`Transient ${quantity}`}
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          >
            <line
              className="transient-axis"
              x1={geometry.left}
              y1={geometry.top}
              x2={geometry.left}
              y2={geometry.height - geometry.bottom}
            />
            <line
              className="transient-axis"
              x1={geometry.left}
              y1={geometry.height - geometry.bottom}
              x2={geometry.width - geometry.right}
              y2={geometry.height - geometry.bottom}
            />
            {waveformTicks(
              range[0],
              range[1],
              Math.max(2, Math.floor(geometry.width / 110)),
            ).map((value) => {
              const x =
                geometry.left +
                ((value - range[0]) / (range[1] - range[0])) *
                  (geometry.width - geometry.left - geometry.right);
              return (
                <g key={value}>
                  <line
                    className="ac-grid"
                    x1={x}
                    x2={x}
                    y1={geometry.top}
                    y2={geometry.height - geometry.bottom}
                  />
                  <text
                    className="ac-axis-label"
                    textAnchor="middle"
                    x={x}
                    y={geometry.height - 8}
                  >
                    {waveformTickLabel(
                      value,
                      (range[1] - range[0]) /
                        Math.max(2, Math.floor(geometry.width / 110)),
                      "s",
                    )}
                  </text>
                </g>
              );
            })}
            {waveformTicks(
              extent[0],
              extent[1],
              Math.max(2, Math.floor(geometry.height / 55)),
            ).map((value) => {
              const y =
                geometry.top +
                ((extent[1] - value) / (extent[1] - extent[0])) *
                  (geometry.height - geometry.top - geometry.bottom);
              return (
                <g key={value}>
                  <line
                    className="ac-grid"
                    x1={geometry.left}
                    x2={geometry.width - geometry.right}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="ac-axis-label"
                    textAnchor="end"
                    x={geometry.left - 6}
                    y={y}
                    dominantBaseline="middle"
                  >
                    {waveformTickLabel(
                      value,
                      (extent[1] - extent[0]) /
                        Math.max(2, Math.floor(geometry.height / 55)),
                      unit,
                    )}
                  </text>
                </g>
              );
            })}
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={geometry.left}
                  y={geometry.top}
                  width={geometry.width - geometry.left - geometry.right}
                  height={geometry.height - geometry.top - geometry.bottom}
                />
              </clipPath>
            </defs>
            {quantityTraces.map((trace) => {
              const points = transientPolylinePoints(
                analysis.timeSeconds,
                trace.values,
                extent,
                range,
                geometry,
              );
              return (
                <g
                  key={trace.id}
                  clipPath={`url(#${clipId})`}
                  data-trace-id={trace.id}
                  data-trace-index={trace.colorIndex}
                >
                  <polyline
                    className="ac-trace-hit"
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    pointerEvents="stroke"
                    points={points}
                  />
                  <polyline
                    className={`transient-trace ac-trace-${trace.colorIndex % 6}${selected === trace.id ? " ac-trace-selected" : ""}`}
                    points={points}
                  />
                </g>
              );
            })}
            {(["A", "B"] as const).map((name) => {
              const time = markers[name];
              if (time === undefined || time < range[0] || time > range[1])
                return null;
              const x =
                geometry.left +
                ((time - range[0]) / (range[1] - range[0])) *
                  (geometry.width - geometry.left - geometry.right);
              return (
                <g key={name} pointerEvents="none">
                  <line
                    className="ac-cursor"
                    stroke={name === "A" ? "#175cd3" : "#c4320a"}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    x1={x}
                    x2={x}
                    y1={geometry.top}
                    y2={geometry.height - geometry.bottom}
                  />
                  <text x={x + 3} y={geometry.top + 12}>
                    {name}
                  </text>
                </g>
              );
            })}
          </svg>
        </WaveformInteraction>
        <WaveformTools
          controller={controller}
          plotKey={quantity}
          x={range}
          y={extent}
          xUnit="s"
          yUnit={unit}
          {...(!expanded
            ? { onOpen: () => setExpandedQuantity(quantity) }
            : {})}
        />
        {!expanded && measurement(quantity)}
      </div>
    );
  };

  const measurement = (quantity?: PlotQuantity) => (
    <WaveformMeasurements
      a={markers.A}
      b={markers.B}
      unit="s"
      time
      rows={visible
        .filter((trace) => !quantity || trace.quantity === quantity)
        .map((trace) => {
          const valueAt = (x: number | undefined) => {
            if (x === undefined) return undefined;
            const index = analysis.timeSeconds.reduce(
              (best, time, candidate) =>
                Math.abs(time - x) < Math.abs(analysis.timeSeconds[best]! - x)
                  ? candidate
                  : best,
              0,
            );
            return trace.values[index];
          };
          const a = valueAt(markers.A),
            b = valueAt(markers.B);
          return {
            label: trace.label,
            unit: trace.unit ?? "",
            ...(a === undefined ? {} : { a }),
            ...(b === undefined ? {} : { b }),
          };
        })}
    />
  );

  return (
    <div
      ref={measured.ref}
      className="transient-results-explorer ac-results-explorer"
    >
      <header>
        <div>
          <strong>{analysis.plotName}</strong>
          <small>
            {analysis.timeSeconds.length} solver points ·{" "}
            {compact(fullRange[0])}s to {compact(fullRange[1])}s
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
                onClick={() => focusTrace(trace.id)}
              >
                <strong>{trace.label}</strong>
                <small>
                  {trace.quantity} · {trace.probe ? "linked" : trace.id}
                </small>
              </button>
              <button
                type="button"
                aria-pressed={solo === trace.id}
                onClick={() =>
                  setSolo((current) => (current === trace.id ? null : trace.id))
                }
              >
                Solo
              </button>
            </div>
          );
        })}
      </div>
      {(["voltage", "current"] as const).map((quantity) => {
        const quantityTraces = visible.filter(
          (trace) => trace.quantity === quantity,
        );
        return quantityTraces.length ? (
          <section
            key={quantity}
            className="transient-quantity-group ac-quantity-group"
          >
            <h4>{quantity === "voltage" ? "Voltage" : "Current"}</h4>
            {plot(quantity, quantityTraces)}
          </section>
        ) : null;
      })}
      {visible.length === 0 ? (
        <p className="simulation-empty-result">All Outputs are hidden.</p>
      ) : null}
      {expandedQuantity ? (
        <div
          className="ac-plot-dialog-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setExpandedQuantity(null)
          }
        >
          <section
            className="ac-plot-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Transient ${expandedQuantity} plot`}
          >
            <header>
              <div>
                <strong>{analysis.plotName}</strong>
                <span>{expandedQuantity} · transient waveform</span>
              </div>
              <button
                type="button"
                aria-label="Close plot"
                onClick={() => setExpandedQuantity(null)}
              >
                ×
              </button>
            </header>
            {plot(
              expandedQuantity,
              visible.filter((trace) => trace.quantity === expandedQuantity),
              true,
            )}
            {measurement(expandedQuantity)}
          </section>
        </div>
      ) : null}
    </div>
  );
}

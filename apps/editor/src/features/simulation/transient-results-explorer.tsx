import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";
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
  height: 280,
  left: 64,
  right: 18,
  top: 16,
  bottom: 34,
} as const;
const EXPANDED_PLOT = { ...PLOT, width: 1400, height: 700 } as const;

type PlotGeometry = typeof PLOT | typeof EXPANDED_PLOT;
type PlotQuantity = "voltage" | "current";

interface PlotPoint {
  readonly x: number;
  readonly y: number;
}

interface ZoomBox {
  readonly quantity: PlotQuantity;
  readonly start: PlotPoint;
  readonly current: PlotPoint;
}

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

function clampPlotPoint(point: PlotPoint, plot: PlotGeometry): PlotPoint {
  return {
    x: Math.min(plot.width - plot.right, Math.max(plot.left, point.x)),
    y: Math.min(plot.height - plot.bottom, Math.max(plot.top, point.y)),
  };
}

export function transientBoxZoomRanges(
  start: PlotPoint,
  end: PlotPoint,
  timeRange: readonly [number, number],
  valueRange: readonly [number, number],
  plot: PlotGeometry = PLOT,
): {
  readonly time: readonly [number, number];
  readonly value: readonly [number, number];
} {
  const first = clampPlotPoint(start, plot);
  const last = clampPlotPoint(end, plot);
  const plotWidth = plot.width - plot.left - plot.right;
  const plotHeight = plot.height - plot.top - plot.bottom;
  const timeAt = (x: number) =>
    timeRange[0] +
    ((x - plot.left) / plotWidth) * (timeRange[1] - timeRange[0]);
  const valueAt = (y: number) =>
    valueRange[1] -
    ((y - plot.top) / plotHeight) * (valueRange[1] - valueRange[0]);
  const times = [timeAt(first.x), timeAt(last.x)].sort((a, b) => a - b);
  const values = [valueAt(first.y), valueAt(last.y)].sort((a, b) => a - b);
  return {
    time: [times[0]!, times[1]!],
    value: [values[0]!, values[1]!],
  };
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
  plot: typeof PLOT | typeof EXPANDED_PLOT = PLOT,
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
      time < timeExtent[0] ||
      time > timeExtent[1]
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

function clampRange(
  low: number,
  high: number,
  full: readonly [number, number],
): readonly [number, number] {
  const span = Math.min(high - low, full[1] - full[0]);
  if (low < full[0]) return [full[0], full[0] + span];
  if (high > full[1]) return [full[1] - span, full[1]];
  return [low, high];
}

export function changeTransientTimeRange(
  current: readonly [number, number],
  full: readonly [number, number],
  action: "zoom-in" | "zoom-out" | "pan-left" | "pan-right",
  center = (current[0] + current[1]) / 2,
): readonly [number, number] {
  const span = current[1] - current[0];
  if (action.startsWith("zoom")) {
    const nextSpan = Math.min(
      full[1] - full[0],
      span * (action === "zoom-in" ? 0.6 : 1.7),
    );
    const fraction = span ? (center - current[0]) / span : 0.5;
    return clampRange(
      center - nextSpan * fraction,
      center + nextSpan * (1 - fraction),
      full,
    );
  }
  const shift = span * 0.2 * (action === "pan-left" ? -1 : 1);
  return clampRange(current[0] + shift, current[1] + shift, full);
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
  const [solo, setSolo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number>();
  const [markerTime, setMarkerTime] = useState<number>();
  const [timeRange, setTimeRange] = useState<readonly [number, number]>();
  const [valueRanges, setValueRanges] = useState<
    Partial<Record<PlotQuantity, readonly [number, number]>>
  >({});
  const [interactionMode, setInteractionMode] = useState<
    "inspect" | "box-zoom"
  >("inspect");
  const [zoomBox, setZoomBox] = useState<ZoomBox>();
  const [expandedQuantity, setExpandedQuantity] = useState<
    "voltage" | "current" | null
  >(null);
  const visible = traces.filter(
    (trace) => !hidden.has(trace.id) && (solo === null || solo === trace.id),
  );
  const fullRange = finiteExtent(analysis.timeSeconds);
  const cursorTime = hoverTime ?? markerTime;

  useEffect(() => {
    const cancelTransientPlotAction = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExpandedQuantity(null);
      setZoomBox(undefined);
      setInteractionMode("inspect");
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

  const updateRange = (
    action: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "fit",
    quantity: PlotQuantity,
  ) => {
    if (action === "fit") {
      setTimeRange(undefined);
      setValueRanges((current) => ({ ...current, [quantity]: undefined }));
      setZoomBox(undefined);
      return;
    }
    const next = changeTransientTimeRange(
      timeRange ?? fullRange,
      fullRange,
      action,
      cursorTime,
    );
    setTimeRange(
      next[0] === fullRange[0] && next[1] === fullRange[1] ? undefined : next,
    );
  };

  const timeAtPointer = (
    event: PointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>,
    plot: PlotGeometry,
  ) => {
    const point = plotPointAtPointer(event, plot);
    const bounds = event.currentTarget.getBoundingClientRect();
    const range = timeRange ?? fullRange;
    if (bounds.width === 0) return range[0];
    return Math.min(
      range[1],
      Math.max(
        range[0],
        range[0] +
          ((point.x - plot.left) / (plot.width - plot.left - plot.right)) *
            (range[1] - range[0]),
      ),
    );
  };

  const plotPointAtPointer = (
    event: PointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>,
    plot: PlotGeometry,
  ): PlotPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return { x: plot.left, y: plot.top };
    }
    return clampPlotPoint(
      {
        x: ((event.clientX - bounds.left) / bounds.width) * plot.width,
        y: ((event.clientY - bounds.top) / bounds.height) * plot.height,
      },
      plot,
    );
  };

  const toolbar = (quantity: PlotQuantity, expanded: boolean) => (
    <div
      className={`ac-plot-toolbar${expanded ? " expanded" : ""}`}
      aria-label="Plot tools"
    >
      <button
        type="button"
        aria-label="Inspect plot"
        aria-pressed={interactionMode === "inspect"}
        title="Inspect and place a marker"
        onClick={() => {
          setInteractionMode("inspect");
          setZoomBox(undefined);
        }}
      >
        ⌖
      </button>
      <button
        type="button"
        aria-label="Box zoom"
        aria-pressed={interactionMode === "box-zoom"}
        title="Drag a rectangle to zoom"
        onClick={() => {
          setInteractionMode("box-zoom");
          setZoomBox(undefined);
        }}
      >
        ▧
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => updateRange("zoom-in", quantity)}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => updateRange("zoom-out", quantity)}
      >
        −
      </button>
      <button
        type="button"
        aria-label="Pan left"
        onClick={() => updateRange("pan-left", quantity)}
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Pan right"
        onClick={() => updateRange("pan-right", quantity)}
      >
        →
      </button>
      <button
        type="button"
        aria-label="Fit plot"
        onClick={() => updateRange("fit", quantity)}
      >
        Fit
      </button>
      {markerTime !== undefined ? (
        <button
          type="button"
          aria-label="Clear marker"
          onClick={() => setMarkerTime(undefined)}
        >
          ×│
        </button>
      ) : null}
      {!expanded ? (
        <button
          type="button"
          aria-label="Open plot"
          onClick={() => setExpandedQuantity(quantity)}
        >
          ⛶
        </button>
      ) : null}
    </div>
  );

  const plot = (
    quantity: PlotQuantity,
    quantityTraces: readonly TransientTrace[],
    expanded = false,
  ) => {
    const geometry = expanded ? EXPANDED_PLOT : PLOT;
    const range = timeRange ?? fullRange;
    const visibleValues = quantityTraces.flatMap((trace) =>
      trace.values.filter(
        (_value, index) =>
          analysis.timeSeconds[index]! >= range[0] &&
          analysis.timeSeconds[index]! <= range[1],
      ),
    );
    const automaticExtent = transientValueExtent(visibleValues);
    const extent = valueRanges[quantity] ?? automaticExtent;
    const unit = quantityTraces.find((trace) => trace.unit)?.unit ?? "";
    const cursorX =
      cursorTime === undefined
        ? undefined
        : geometry.left +
          ((cursorTime - range[0]) / (range[1] - range[0])) *
            (geometry.width - geometry.left - geometry.right);
    return (
      <div className={`ac-plot-shell${expanded ? " expanded" : ""}`}>
        <div
          className={`spice-ac-plot interactive ${interactionMode}`}
          onPointerDown={(event) => {
            if (interactionMode !== "box-zoom" || event.button !== 0) return;
            const point = plotPointAtPointer(event, geometry);
            event.currentTarget.setPointerCapture(event.pointerId);
            setZoomBox({ quantity, start: point, current: point });
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (
              interactionMode === "box-zoom" &&
              zoomBox?.quantity === quantity
            ) {
              const point = plotPointAtPointer(event, geometry);
              setZoomBox((current) =>
                current?.quantity === quantity
                  ? { ...current, current: point }
                  : current,
              );
              return;
            }
            if (interactionMode === "inspect") {
              setHoverTime(timeAtPointer(event, geometry));
            }
          }}
          onPointerUp={(event) => {
            if (
              interactionMode !== "box-zoom" ||
              zoomBox?.quantity !== quantity
            )
              return;
            const end = plotPointAtPointer(event, geometry);
            const width = Math.abs(end.x - zoomBox.start.x);
            const height = Math.abs(end.y - zoomBox.start.y);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            if (width >= 5 && height >= 5) {
              const next = transientBoxZoomRanges(
                zoomBox.start,
                end,
                range,
                extent,
                geometry,
              );
              setTimeRange(next.time);
              setValueRanges((current) => ({
                ...current,
                [quantity]: next.value,
              }));
              setInteractionMode("inspect");
            }
            setZoomBox(undefined);
            setHoverTime(undefined);
          }}
          onPointerCancel={() => setZoomBox(undefined)}
          onPointerLeave={() => setHoverTime(undefined)}
          onClick={(event) => {
            if (interactionMode !== "inspect") return;
            const id = (event.target as Element)
              .closest("[data-trace-id]")
              ?.getAttribute("data-trace-id");
            if (id) focusTrace(id);
            setMarkerTime(timeAtPointer(event, geometry));
          }}
          onDoubleClick={() =>
            interactionMode === "inspect" &&
            !expanded &&
            setExpandedQuantity(quantity)
          }
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
            <text x={geometry.left} y={geometry.height - 8}>
              {compact(range[0])}s
            </text>
            <text
              textAnchor="end"
              x={geometry.width - geometry.right}
              y={geometry.height - 8}
            >
              {compact(range[1])}s
            </text>
            <text x={4} y={geometry.top + 5}>
              {compact(extent[1])}
              {unit}
            </text>
            <text x={4} y={geometry.height - geometry.bottom}>
              {compact(extent[0])}
              {unit}
            </text>
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
            {cursorX === undefined ? null : (
              <line
                className="ac-cursor"
                stroke="#101828"
                strokeWidth={1}
                strokeDasharray="2 2"
                pointerEvents="none"
                x1={cursorX}
                y1={geometry.top}
                x2={cursorX}
                y2={geometry.height - geometry.bottom}
              />
            )}
            {zoomBox?.quantity === quantity ? (
              <rect
                className="ac-zoom-box"
                x={Math.min(zoomBox.start.x, zoomBox.current.x)}
                y={Math.min(zoomBox.start.y, zoomBox.current.y)}
                width={Math.abs(zoomBox.current.x - zoomBox.start.x)}
                height={Math.abs(zoomBox.current.y - zoomBox.start.y)}
              />
            ) : null}
          </svg>
        </div>
        {toolbar(quantity, expanded)}
      </div>
    );
  };

  const cursorRows =
    cursorTime === undefined
      ? []
      : visible.map((trace) => {
          const index = analysis.timeSeconds.reduce(
            (best, time, candidate) =>
              Math.abs(time - cursorTime) <
              Math.abs(analysis.timeSeconds[best]! - cursorTime)
                ? candidate
                : best,
            0,
          );
          return { trace, value: trace.values[index] ?? 0 };
        });

  return (
    <div className="transient-results-explorer ac-results-explorer">
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
      {cursorTime === undefined ? null : (
        <div className="ac-cursor-readout" role="status">
          <strong>{compact(cursorTime)}s</strong>
          {cursorRows.map(({ trace, value }) => (
            <span key={trace.id}>
              {trace.label}: {Number(value.toPrecision(6))} {trace.unit ?? ""}
            </span>
          ))}
        </div>
      )}
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
          </section>
        </div>
      ) : null}
    </div>
  );
}

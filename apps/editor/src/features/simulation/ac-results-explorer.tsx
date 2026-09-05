import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";
import type { SimulationProbeSpec } from "@icm/model";
import type { AcResult } from "@icm/spice-run";
import type { Prepared } from "@icm/simulation-service/contract";

import {
  acResponseSvg,
  formatFrequency,
  layoutAcPlot,
  type AcPlotKind,
  type AcPlotSize,
  type AcPoint,
  type AcTrace,
} from "./ac-response-plot";

interface OutputTrace extends AcTrace {
  id: string;
  quantity: "voltage" | "current";
  probe?: SimulationProbeSpec;
}

interface ExpandedPlot {
  quantity: OutputTrace["quantity"];
  kind: AcPlotKind;
}

export interface AcResultsExplorerProps {
  analysis: AcResult;
  vectors: Prepared["vectors"];
  probes: readonly SimulationProbeSpec[];
  labels?: Readonly<Record<string, string>>;
  onFocusProbe?(probe: SimulationProbeSpec): void;
}

const PLOT_SIZE = { width: 760, height: 280 } as const;
const EXPANDED_PLOT_SIZE = { width: 1400, height: 700 } as const;

/** Keep phase continuous instead of drawing artificial 360-degree jumps. */
export function unwrapPhaseDegrees(values: readonly number[]): number[] {
  const unwrapped: number[] = [];
  for (const value of values) {
    const previous = unwrapped.at(-1);
    if (previous === undefined) {
      unwrapped.push(value);
      continue;
    }
    let next = value;
    while (next - previous > 180) next -= 360;
    while (next - previous < -180) next += 360;
    unwrapped.push(next);
  }
  return unwrapped;
}

function closestPoint(points: readonly AcPoint[], frequency: number): AcPoint {
  return points.reduce((best, point) =>
    Math.abs(Math.log(point.frequency / frequency)) <
    Math.abs(Math.log(best.frequency / frequency))
      ? point
      : best,
  );
}

function outputTraces(
  analysis: AcResult,
  vectors: Prepared["vectors"],
  probes: readonly SimulationProbeSpec[],
  labels: Readonly<Record<string, string>>,
): OutputTrace[] {
  const vectorsByName = new Map(
    vectors.map((vector) => [vector.vector.toLowerCase(), vector]),
  );
  const probesById = new Map(probes.map((probe) => [probe.id, probe]));
  return analysis.probes.map((resultProbe, index) => {
    const binding = vectorsByName.get(resultProbe.name.toLowerCase());
    const authored = binding ? probesById.get(binding.probeId) : undefined;
    const phases = unwrapPhaseDegrees(
      resultProbe.real.map(
        (real, pointIndex) =>
          (Math.atan2(resultProbe.imag[pointIndex] ?? 0, real) * 180) / Math.PI,
      ),
    );
    return {
      id: binding?.probeId ?? resultProbe.name,
      label: (binding && labels[binding.probeId]) || resultProbe.name,
      colorIndex: index,
      quantity:
        binding?.quantity ??
        (resultProbe.quantity === "current" ? "current" : "voltage"),
      ...(authored ? { probe: authored } : {}),
      points: analysis.frequencyHz.map((frequency, pointIndex) => ({
        frequency,
        magnitudeDb:
          20 *
          Math.log10(
            Math.max(
              Math.hypot(
                resultProbe.real[pointIndex] ?? 0,
                resultProbe.imag[pointIndex] ?? 0,
              ),
              1e-30,
            ),
          ),
        phaseDeg: phases[pointIndex] ?? 0,
      })),
    };
  });
}

function normalizedLogRange(
  low: number,
  high: number,
  fullRange: readonly [number, number],
): readonly [number, number] {
  const fullLow = Math.log(fullRange[0]);
  const fullHigh = Math.log(fullRange[1]);
  if (high - low >= fullHigh - fullLow - 1e-12) return fullRange;
  const requestedSpan = Math.min(high - low, fullHigh - fullLow);
  let nextLow = low;
  let nextHigh = high;
  if (nextLow < fullLow) {
    nextLow = fullLow;
    nextHigh = fullLow + requestedSpan;
  }
  if (nextHigh > fullHigh) {
    nextHigh = fullHigh;
    nextLow = fullHigh - requestedSpan;
  }
  return [Math.exp(nextLow), Math.exp(nextHigh)];
}

/** Explicit axes-toolbar zoom; the document or panel wheel is never captured. */
export function zoomFrequencyRange(
  currentRange: readonly [number, number],
  fullRange: readonly [number, number],
  direction: "in" | "out",
  centerFrequency = Math.sqrt(currentRange[0] * currentRange[1]),
): readonly [number, number] {
  const low = Math.log(currentRange[0]);
  const high = Math.log(currentRange[1]);
  const center = Math.log(
    Math.min(currentRange[1], Math.max(currentRange[0], centerFrequency)),
  );
  const scale = direction === "in" ? 0.6 : 1.7;
  return normalizedLogRange(
    center - (center - low) * scale,
    center + (high - center) * scale,
    fullRange,
  );
}

/** Pan one fifth of the visible logarithmic span without leaving the sweep. */
export function panFrequencyRange(
  currentRange: readonly [number, number],
  fullRange: readonly [number, number],
  direction: "left" | "right",
): readonly [number, number] {
  const low = Math.log(currentRange[0]);
  const high = Math.log(currentRange[1]);
  const shift = (high - low) * 0.2 * (direction === "left" ? -1 : 1);
  return normalizedLogRange(low + shift, high + shift, fullRange);
}

function rangesEqual(
  left: readonly [number, number],
  right: readonly [number, number],
): boolean {
  return (
    Math.abs(Math.log(left[0] / right[0])) < 1e-9 &&
    Math.abs(Math.log(left[1] / right[1])) < 1e-9
  );
}

export function AcResultsExplorer({
  analysis,
  vectors,
  probes,
  labels = {},
  onFocusProbe,
}: AcResultsExplorerProps) {
  const traces = useMemo(
    () => outputTraces(analysis, vectors, probes, labels),
    [analysis, labels, probes, vectors],
  );
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [solo, setSolo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverFrequency, setHoverFrequency] = useState<number>();
  const [markerFrequency, setMarkerFrequency] = useState<number>();
  const [frequencyRange, setFrequencyRange] =
    useState<readonly [number, number]>();
  const [expandedPlot, setExpandedPlot] = useState<ExpandedPlot | null>(null);
  const fullRange = useMemo<readonly [number, number]>(() => {
    const frequencies = analysis.frequencyHz.filter(
      (frequency) => frequency > 0,
    );
    return [Math.min(...frequencies), Math.max(...frequencies)];
  }, [analysis.frequencyHz]);
  const visible = traces.filter(
    (trace) => !hidden.has(trace.id) && (solo === null || solo === trace.id),
  );
  const cursorFrequency = hoverFrequency ?? markerFrequency;
  const cursorRows =
    cursorFrequency === undefined
      ? []
      : visible.map((trace) => ({
          trace,
          point: closestPoint(trace.points, cursorFrequency),
        }));

  useEffect(() => {
    if (!expandedPlot) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedPlot(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expandedPlot]);

  const frequencyAtPointer = (
    event: PointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>,
    size: AcPlotSize,
    plotTraces: readonly OutputTrace[],
  ): number | undefined => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const layout = layoutAcPlot(plotTraces, size, frequencyRange);
    if (!layout) return undefined;
    const svgX = ((event.clientX - bounds.left) / bounds.width) * size.width;
    const frequency = layout.frequencyAt(svgX);
    return Math.min(
      layout.frequency.max,
      Math.max(layout.frequency.min, frequency),
    );
  };

  const focusTrace = (traceId: string): void => {
    const trace = traces.find((candidate) => candidate.id === traceId);
    if (!trace) return;
    setSelected(trace.id);
    if (trace.probe) onFocusProbe?.(trace.probe);
  };

  const updateRange = (
    action: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "fit",
  ): void => {
    if (action === "fit" || fullRange[0] === fullRange[1]) {
      setFrequencyRange(undefined);
      return;
    }
    const current = frequencyRange ?? fullRange;
    const next = action.startsWith("zoom")
      ? zoomFrequencyRange(
          current,
          fullRange,
          action === "zoom-in" ? "in" : "out",
          cursorFrequency,
        )
      : panFrequencyRange(
          current,
          fullRange,
          action === "pan-left" ? "left" : "right",
        );
    setFrequencyRange(rangesEqual(next, fullRange) ? undefined : next);
  };

  const plotToolbar = (plot: ExpandedPlot, expanded: boolean) => (
    <div
      className={`ac-plot-toolbar${expanded ? " expanded" : ""}`}
      aria-label="Plot tools"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => updateRange("zoom-in")}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => updateRange("zoom-out")}
      >
        −
      </button>
      <button
        type="button"
        aria-label="Pan left"
        onClick={() => updateRange("pan-left")}
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Pan right"
        onClick={() => updateRange("pan-right")}
      >
        →
      </button>
      <button
        type="button"
        aria-label="Fit plot"
        onClick={() => updateRange("fit")}
      >
        Fit
      </button>
      {markerFrequency !== undefined ? (
        <button
          type="button"
          aria-label="Clear marker"
          onClick={() => setMarkerFrequency(undefined)}
        >
          ×│
        </button>
      ) : null}
      {!expanded ? (
        <button
          type="button"
          aria-label="Open plot"
          onClick={() => setExpandedPlot(plot)}
        >
          ⛶
        </button>
      ) : null}
    </div>
  );

  const renderPlot = (
    plot: ExpandedPlot,
    plotTraces: readonly OutputTrace[],
    expanded = false,
  ) => {
    const size = expanded ? EXPANDED_PLOT_SIZE : PLOT_SIZE;
    const svg = acResponseSvg(plotTraces, size, {
      kind: plot.kind,
      showLegend: false,
      ...(frequencyRange === undefined ? {} : { frequencyRange }),
      ...(cursorFrequency === undefined ? {} : { cursorFrequency }),
      ...(selected === null ? {} : { selectedTraceId: selected }),
    });
    return (
      <div
        className={`ac-plot-shell${expanded ? " expanded" : ""}`}
        title={expanded ? undefined : "Double-click to open this plot"}
      >
        <div
          className="spice-ac-plot interactive"
          onPointerMove={(event) => {
            const frequency = frequencyAtPointer(event, size, plotTraces);
            if (frequency !== undefined) setHoverFrequency(frequency);
          }}
          onPointerLeave={() => setHoverFrequency(undefined)}
          onClick={(event) => {
            const traceElement = (event.target as Element).closest(
              "[data-trace-id]",
            );
            const traceId = traceElement?.getAttribute("data-trace-id");
            if (traceId) focusTrace(traceId);
            const frequency = frequencyAtPointer(event, size, plotTraces);
            if (frequency !== undefined) setMarkerFrequency(frequency);
          }}
          onDoubleClick={() => {
            if (!expanded) setExpandedPlot(plot);
          }}
          dangerouslySetInnerHTML={{ __html: svg ?? "" }}
        />
        {plotToolbar(plot, expanded)}
      </div>
    );
  };

  return (
    <div className="ac-results-explorer">
      <header>
        <strong>{analysis.plotName}</strong>
      </header>
      <div
        className="simulation-output-browser"
        aria-label="Simulation outputs"
      >
        {traces.map((trace) => {
          const isVisible = !hidden.has(trace.id);
          return (
            <div
              key={trace.id}
              className={selected === trace.id ? "selected" : undefined}
            >
              <button
                type="button"
                className={`simulation-output-swatch ac-trace-${(trace.colorIndex ?? 0) % 6}`}
                aria-label={`${isVisible ? "Hide" : "Show"} ${trace.label}`}
                aria-pressed={isVisible}
                onClick={() => {
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(trace.id)) next.delete(trace.id);
                    else next.add(trace.id);
                    return next;
                  });
                }}
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
        if (quantityTraces.length === 0) return null;
        return (
          <section key={quantity} className="ac-quantity-group">
            <h4>{quantity === "voltage" ? "Voltage" : "Current"}</h4>
            {(["magnitude", "phase"] as const).map((kind) => (
              <div key={kind} className="ac-plot-row">
                <strong>{kind === "magnitude" ? "Magnitude" : "Phase"}</strong>
                {renderPlot({ quantity, kind }, quantityTraces)}
              </div>
            ))}
          </section>
        );
      })}
      {visible.length === 0 ? (
        <p className="simulation-empty-result">All Outputs are hidden.</p>
      ) : null}
      {cursorFrequency !== undefined ? (
        <div className="ac-cursor-readout" role="status">
          <strong>{formatFrequency(cursorFrequency)}</strong>
          {cursorRows.map(({ trace, point }) => (
            <span key={trace.id}>
              {trace.label}: {point.magnitudeDb.toFixed(3)} dB ·{" "}
              {point.phaseDeg.toFixed(2)}°
            </span>
          ))}
        </div>
      ) : null}
      {expandedPlot ? (
        <div
          className="ac-plot-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setExpandedPlot(null);
          }}
        >
          <section
            className="ac-plot-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${expandedPlot.quantity} ${expandedPlot.kind} plot`}
          >
            <header>
              <div>
                <strong>{analysis.plotName}</strong>
                <span>
                  {expandedPlot.quantity === "voltage" ? "Voltage" : "Current"}{" "}
                  · {expandedPlot.kind === "magnitude" ? "Magnitude" : "Phase"}
                </span>
              </div>
              <button
                type="button"
                aria-label="Close plot"
                onClick={() => setExpandedPlot(null)}
              >
                ×
              </button>
            </header>
            {renderPlot(
              expandedPlot,
              visible.filter(
                (trace) => trace.quantity === expandedPlot.quantity,
              ),
              true,
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

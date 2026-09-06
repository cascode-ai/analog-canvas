import { useEffect, useMemo, useState, type SetStateAction } from "react";
import {
  WaveformInteraction,
  responsiveWaveformHeight,
  useWaveformWidth,
} from "./waveform-interaction";
import { useWaveformView } from "./waveform-view";
import { WaveformTools, WaveformMeasurements } from "./waveform-tools";
import { WaveformTraceList } from "./waveform-trace-list";
import type { SimulationProbeSpec } from "@icm/model";
import type { AcResult } from "@icm/spice-run";
import type { Prepared } from "@icm/simulation-service/contract";

import {
  acResponseSvg,
  layoutAcPlot,
  type AcPlotKind,
  type AcPoint,
  type AcTrace,
} from "./ac-response-plot";

interface OutputTrace extends AcTrace {
  id: string;
  quantity: string;
  probe?: SimulationProbeSpec;
}

interface ExpandedPlot {
  quantity: OutputTrace["quantity"];
  kind: AcPlotKind;
}

export interface AcResultsExplorerProps {
  resultKey?: string;
  analysis: AcResult;
  vectors: Prepared["vectors"];
  probes: readonly SimulationProbeSpec[];
  labels?: Readonly<Record<string, string>>;
  groups?: Readonly<Record<string, string>>;
  onFocusProbe?(probe: SimulationProbeSpec): void;
}

const PLOT_SIZE = { width: 760, height: 395 } as const;
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
  groups: Readonly<Record<string, string>>,
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
        (binding && groups[binding.probeId]) ??
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

function groupLabel(quantity: string): string {
  if (quantity === "voltage") return "Voltage";
  if (quantity === "current") return "Current";
  if (quantity === "ratio") return "Ratio";
  return quantity;
}

export function AcResultsExplorer({
  analysis,
  vectors,
  probes,
  labels = {},
  groups = {},
  onFocusProbe,
  resultKey,
}: AcResultsExplorerProps) {
  const measured = useWaveformWidth();
  const traces = useMemo(
    () => outputTraces(analysis, vectors, probes, labels, groups),
    [analysis, groups, labels, probes, vectors],
  );
  const controller = useWaveformView(resultKey);
  const { hidden, selected, markers } = controller.state;
  const setHidden = (value: SetStateAction<ReadonlySet<string>>) =>
    controller.set("hidden", value);
  const setSelected = (value: string) => controller.set("selected", value);
  const frequencyRange = controller.view.x;
  const valueRanges = controller.view.y;
  const [expandedPlot, setExpandedPlot] = useState<ExpandedPlot | null>(null);
  const visible = traces.filter((trace) => !hidden.has(trace.id));
  useEffect(() => {
    if (!expandedPlot) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedPlot(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expandedPlot]);

  const focusTrace = (traceId: string): void => {
    const trace = traces.find((candidate) => candidate.id === traceId);
    if (!trace) return;
    setSelected(trace.id);
    if (trace.probe) onFocusProbe?.(trace.probe);
  };

  const toggleTrace = (traceId: string): void => {
    const showing = hidden.has(traceId);
    setHidden((current) => {
      const next = new Set(current);
      if (showing) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
    if (showing) focusTrace(traceId);
  };

  const renderPlot = (
    plot: ExpandedPlot,
    plotTraces: readonly OutputTrace[],
    expanded = false,
  ) => {
    const size = expanded
      ? EXPANDED_PLOT_SIZE
      : {
          ...PLOT_SIZE,
          width: Math.max(280, measured.width - 116),
          height: responsiveWaveformHeight(Math.max(280, measured.width - 116)),
        };
    const valueRange = valueRanges[plot.quantity + plot.kind];
    const layout = layoutAcPlot(
      plotTraces,
      size,
      frequencyRange,
      valueRange ? { kind: plot.kind, range: valueRange } : undefined,
    );
    if (!layout) return null;
    const axis = layout[plot.kind];
    const frequencyAt = (x: number) =>
      layout.frequencyAt(layout.frame.x + x * layout.frame.width);
    const svg = acResponseSvg(plotTraces, size, {
      kind: plot.kind,
      ...(valueRange ? { valueRange } : {}),
      showLegend: false,
      ...(frequencyRange === undefined ? {} : { frequencyRange }),
      ...(markers.A === undefined ? {} : { cursorFrequency: markers.A }),
      ...(markers.B === undefined ? {} : { cursorFrequencyB: markers.B }),
      ...(selected === null ? {} : { selectedTraceId: selected }),
    });
    return (
      <div
        className={`ac-plot-shell${expanded ? " expanded" : ""}`}
        title={expanded ? undefined : "Double-click to open this plot"}
      >
        <WaveformInteraction
          axes={controller.state.axes}
          frame={layout.frame}
          onZoom={(start, end) =>
            controller.commit({
              x:
                controller.state.axes === "y"
                  ? [layout.frequency.min, layout.frequency.max]
                  : [
                      frequencyAt(Math.min(start.x, end.x)),
                      frequencyAt(Math.max(start.x, end.x)),
                    ],
              y: {
                ...valueRanges,
                [plot.quantity + plot.kind]:
                  controller.state.axes === "x"
                    ? [axis.min, axis.max]
                    : [
                        axis.max -
                          Math.max(start.y, end.y) * (axis.max - axis.min),
                        axis.max -
                          Math.min(start.y, end.y) * (axis.max - axis.min),
                      ],
              },
            })
          }
          onPan={(delta) => {
            const shift =
                -delta.x *
                Math.log(layout.frequency.max / layout.frequency.min),
              dy = delta.y * (axis.max - axis.min);
            controller.commit({
              x:
                controller.state.axes === "y"
                  ? [layout.frequency.min, layout.frequency.max]
                  : [
                      layout.frequency.min * Math.exp(shift),
                      layout.frequency.max * Math.exp(shift),
                    ],
              y: {
                ...valueRanges,
                [plot.quantity + plot.kind]:
                  controller.state.axes === "x"
                    ? [axis.min, axis.max]
                    : [axis.min + dy, axis.max + dy],
              },
            });
          }}
          onPick={(point, id) => {
            if (id) focusTrace(id);
            const frequency = frequencyAt(point.x);
            const trace =
              plotTraces.find((trace) => trace.id === id) ?? plotTraces[0];
            if (trace?.points.length)
              controller.mark(closestPoint(trace.points, frequency).frequency);
          }}
          onMoveMarker={(point, marker) => {
            const frequency = frequencyAt(point.x);
            const trace =
              plotTraces.find((candidate) => candidate.id === selected) ??
              plotTraces[0];
            if (trace?.points.length)
              controller.mark(
                closestPoint(trace.points, frequency).frequency,
                marker,
              );
          }}
          onOpen={() => !expanded && setExpandedPlot(plot)}
        >
          <div
            className="waveform-svg"
            dangerouslySetInnerHTML={{ __html: svg ?? "" }}
          />
        </WaveformInteraction>
        <WaveformTools
          controller={controller}
          plotKey={plot.quantity + plot.kind}
          x={[layout.frequency.min, layout.frequency.max]}
          y={[axis.min, axis.max]}
          xUnit="Hz"
          yUnit={plot.kind === "phase" ? "°" : "dB"}
          logarithmicX
          {...(!expanded ? { onOpen: () => setExpandedPlot(plot) } : {})}
        />
        {!expanded && measurement(plot)}
      </div>
    );
  };

  const measurement = (plot?: ExpandedPlot) => (
    <WaveformMeasurements
      a={markers.A}
      b={markers.B}
      unit="Hz"
      rows={visible
        .filter((trace) => !plot || trace.quantity === plot.quantity)
        .flatMap((trace) => {
          const a =
            markers.A === undefined || !trace.points.length
              ? undefined
              : closestPoint(trace.points, markers.A);
          const b =
            markers.B === undefined || !trace.points.length
              ? undefined
              : closestPoint(trace.points, markers.B);
          return (plot ? [plot.kind] : (["magnitude", "phase"] as const)).map(
            (kind) => {
              const property =
                kind === "magnitude" ? "magnitudeDb" : "phaseDeg";
              return {
                label: trace.label + " " + kind,
                unit: kind === "magnitude" ? "dB" : "°",
                ...(a ? { a: a[property] } : {}),
                ...(b ? { b: b[property] } : {}),
              };
            },
          );
        })}
    />
  );

  return (
    <div ref={measured.ref} className="ac-results-explorer">
      <header>
        <strong>{analysis.plotName}</strong>
      </header>
      {[...new Set(traces.map((trace) => trace.quantity))].map((quantity) => {
        const quantityTraces = traces.filter(
          (trace) => trace.quantity === quantity,
        );
        const visibleQuantityTraces = quantityTraces.filter(
          (trace) => !hidden.has(trace.id),
        );
        return (
          <section key={quantity} className="ac-quantity-group">
            <h4>{groupLabel(quantity)}</h4>
            <div className="simulation-plot-layout">
              <WaveformTraceList
                label={`${groupLabel(quantity)} outputs`}
                traces={quantityTraces.map((trace) => ({
                  id: trace.id,
                  label: trace.label,
                  colorIndex: trace.colorIndex ?? 0,
                  visible: !hidden.has(trace.id),
                }))}
                onToggle={toggleTrace}
              />
              <div className="simulation-plot-stack">
                {visibleQuantityTraces.length ? (
                  (["magnitude", "phase"] as const).map((kind) => (
                    <div key={kind} className="ac-plot-row">
                      <strong>
                        {kind === "magnitude" ? "Magnitude" : "Phase"}
                      </strong>
                      {renderPlot({ quantity, kind }, visibleQuantityTraces)}
                    </div>
                  ))
                ) : (
                  <p className="simulation-empty-plot">Outputs hidden</p>
                )}
              </div>
            </div>
          </section>
        );
      })}
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
                  {groupLabel(expandedPlot.quantity)} ·{" "}
                  {expandedPlot.kind === "magnitude" ? "Magnitude" : "Phase"}
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
            <div className="simulation-plot-layout expanded">
              <WaveformTraceList
                label={`${groupLabel(expandedPlot.quantity)} outputs`}
                traces={traces
                  .filter((trace) => trace.quantity === expandedPlot.quantity)
                  .map((trace) => ({
                    id: trace.id,
                    label: trace.label,
                    colorIndex: trace.colorIndex ?? 0,
                    visible: !hidden.has(trace.id),
                  }))}
                onToggle={toggleTrace}
              />
              <div className="simulation-plot-stack">
                {visible.some(
                  (trace) => trace.quantity === expandedPlot.quantity,
                ) ? (
                  renderPlot(
                    expandedPlot,
                    visible.filter(
                      (trace) => trace.quantity === expandedPlot.quantity,
                    ),
                    true,
                  )
                ) : (
                  <p className="simulation-empty-plot">Outputs hidden</p>
                )}
              </div>
            </div>
            {measurement(expandedPlot)}
          </section>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useState, type SetStateAction } from "react";
import {
  WaveformInteraction,
  responsiveWaveformHeight,
  useWaveformWidth,
} from "./waveform-interaction";
import { useWaveformView } from "./waveform-view";
import { WaveformTools, WaveformMeasurements } from "./waveform-tools";
import { WaveformTraceList } from "./waveform-trace-list";
import type { SimulationFocusTarget } from "./simulation-focus-target";
import type { AcResult } from "@icm/spice-run";
import type { Prepared } from "@icm/simulation-service/contract";

import {
  acPointValue,
  acResponseSvg,
  layoutAcPlot,
  type AcPlotKind,
  type AcPoint,
  type AcTrace,
} from "./ac-response-plot";

export interface OutputTrace extends AcTrace {
  id: string;
  quantity: string;
  probe?: SimulationFocusTarget;
}

interface ExpandedPlot {
  quantity: OutputTrace["quantity"];
  kind: AcPlotKind;
  referenced: boolean;
}

type AcViewMode = AcPlotKind | "bode";

const VIEW_MODES: readonly { mode: AcViewMode; label: string }[] = [
  { mode: "magnitude", label: "Magnitude" },
  { mode: "db20", label: "dB" },
  { mode: "phase", label: "Phase" },
  { mode: "real", label: "Real" },
  { mode: "imaginary", label: "Imag" },
  { mode: "bode", label: "Bode" },
];

export interface AcResultsExplorerProps {
  resultKey?: string;
  analysis: AcResult;
  vectors: Prepared["vectors"];
  probes: readonly SimulationFocusTarget[];
  labels?: Readonly<Record<string, string>>;
  groups?: Readonly<Record<string, string>>;
  onFocusProbe?(probe: SimulationFocusTarget): void;
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

export function complexAcPoint(
  frequency: number,
  real: number,
  imaginary: number,
): AcPoint {
  const magnitude = Math.hypot(real, imaginary);
  return {
    frequency,
    real,
    imaginary,
    magnitude,
    magnitudeDb: 20 * Math.log10(Math.max(magnitude, 1e-30)),
    phaseDeg: (Math.atan2(imaginary, real) * 180) / Math.PI,
  };
}

/** Divide one complex trace by another without changing authored result data. */
export function referenceAcTrace(
  trace: OutputTrace,
  reference: OutputTrace,
): OutputTrace {
  const points = trace.points.map((point, index) => {
    const divisor = reference.points[index];
    if (!divisor || divisor.frequency !== point.frequency)
      return complexAcPoint(point.frequency, Number.NaN, Number.NaN);
    const denominator =
      divisor.real * divisor.real + divisor.imaginary * divisor.imaginary;
    if (!Number.isFinite(denominator) || denominator === 0)
      return complexAcPoint(point.frequency, Number.NaN, Number.NaN);
    return complexAcPoint(
      point.frequency,
      (point.real * divisor.real + point.imaginary * divisor.imaginary) /
        denominator,
      (point.imaginary * divisor.real - point.real * divisor.imaginary) /
        denominator,
    );
  });
  const phases = unwrapPhaseDegrees(points.map((point) => point.phaseDeg));
  return {
    ...trace,
    unit:
      trace.unit === reference.unit ? "1" : `${trace.unit}/${reference.unit}`,
    points: points.map((point, index) => ({
      ...point,
      phaseDeg: phases[index] ?? point.phaseDeg,
    })),
  };
}

function outputTraces(
  analysis: AcResult,
  vectors: Prepared["vectors"],
  probes: readonly SimulationFocusTarget[],
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
      unit:
        resultProbe.unit ?? (resultProbe.quantity === "current" ? "A" : "V"),
      quantity:
        (binding && groups[binding.probeId]) ??
        binding?.quantity ??
        (resultProbe.quantity === "current" ? "current" : "voltage"),
      ...(authored ? { probe: authored } : {}),
      points: analysis.frequencyHz.map((frequency, pointIndex) => ({
        ...complexAcPoint(
          frequency,
          resultProbe.real[pointIndex] ?? 0,
          resultProbe.imag[pointIndex] ?? 0,
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

function displayKinds(mode: AcViewMode): readonly AcPlotKind[] {
  return mode === "bode" ? ["db20", "phase"] : [mode];
}

function plotKindLabel(kind: AcPlotKind): string {
  if (kind === "db20") return "dB";
  if (kind === "imaginary") return "Imaginary";
  return kind[0]!.toUpperCase() + kind.slice(1);
}

function unityReferenceLabel(unit: string): string {
  return unit === "1" ? "1" : `1 ${unit}`;
}

function plotUnit(
  kind: AcPlotKind,
  sourceUnit: string,
  referencedToTrace: boolean,
): string {
  if (kind === "phase") return "°";
  if (kind === "db20") {
    if (referencedToTrace || sourceUnit === "1") return "dB";
    if (sourceUnit === "V") return "dBV";
    if (sourceUnit === "A") return "dBA";
    return `dB ref 1 ${sourceUnit}`;
  }
  return sourceUnit === "1" ? "" : sourceUnit;
}

export function AcResultsExplorer({
  analysis,
  vectors,
  probes,
  labels = {},
  groups = {},
  ...display
}: AcResultsExplorerProps) {
  return (
    <ComplexResultsExplorer
      {...display}
      plotName={analysis.plotName}
      traces={outputTraces(analysis, vectors, probes, labels, groups)}
    />
  );
}

export function ComplexResultsExplorer({
  plotName,
  traces,
  onFocusProbe,
  resultKey,
}: {
  plotName: string;
  traces: readonly OutputTrace[];
  resultKey?: string;
  onFocusProbe?(probe: SimulationFocusTarget): void;
}) {
  const measured = useWaveformWidth();
  const controller = useWaveformView(resultKey);
  const { hidden, selected, markers } = controller.state;
  const setHidden = (value: SetStateAction<ReadonlySet<string>>) =>
    controller.set("hidden", value);
  const setSelected = (value: string) => controller.set("selected", value);
  const frequencyRange = controller.view.x;
  const valueRanges = controller.view.y;
  const [expandedPlot, setExpandedPlot] = useState<ExpandedPlot | null>(null);
  const [viewModes, setViewModes] = useState<
    Readonly<Record<string, AcViewMode>>
  >({});
  const [references, setReferences] = useState<
    Readonly<Record<string, string>>
  >({});
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

  const presentedTraces = (
    quantity: string,
    source: readonly OutputTrace[],
  ): readonly OutputTrace[] => {
    const referenceId = references[quantity];
    if (!referenceId) return source;
    const reference = traces.find(
      (candidate) =>
        candidate.quantity === quantity && candidate.id === referenceId,
    );
    return reference
      ? source.map((trace) => referenceAcTrace(trace, reference))
      : source;
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
          height: responsiveWaveformHeight(
            Math.max(280, measured.width - 116),
            measured.viewportHeight,
          ),
        };
    const valueRange = valueRanges[plot.quantity + plot.kind];
    const layout = layoutAcPlot(
      plotTraces,
      size,
      plot.kind,
      frequencyRange,
      valueRange,
    );
    if (!layout) return null;
    const axis = layout.value;
    const sourceUnit =
      traces.find((trace) => trace.quantity === plot.quantity)?.unit ?? "1";
    const valueUnit = plotUnit(
      plot.kind,
      sourceUnit,
      plot.referenced && references[plot.quantity] !== undefined,
    );
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
      valueUnit,
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
          yUnit={valueUnit}
          logarithmicX
          {...(!expanded ? { onOpen: () => setExpandedPlot(plot) } : {})}
        />
        {!expanded && measurement(plot, plotTraces)}
      </div>
    );
  };

  const measurement = (
    plot: ExpandedPlot | undefined,
    measurementTraces: readonly OutputTrace[] = visible,
  ) => (
    <WaveformMeasurements
      a={markers.A}
      b={markers.B}
      unit="Hz"
      rows={measurementTraces
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
              const sourceUnit = trace.unit;
              const unit = plotUnit(
                kind,
                sourceUnit,
                plot?.referenced === true &&
                  references[plot.quantity] !== undefined,
              );
              return {
                label: trace.label + " " + kind,
                unit,
                ...(a ? { a: acPointValue(a, kind) } : {}),
                ...(b ? { b: acPointValue(b, kind) } : {}),
              };
            },
          );
        })}
    />
  );

  return (
    <div ref={measured.ref} className="ac-results-explorer">
      <header>
        <strong>{plotName}</strong>
      </header>
      {[...new Set(traces.map((trace) => trace.quantity))].map((quantity) => {
        const quantityTraces = traces.filter(
          (trace) => trace.quantity === quantity,
        );
        const mode = viewModes[quantity] ?? "magnitude";
        const kinds = displayKinds(mode);
        const referenceActive = mode === "db20" || mode === "bode";
        const rawVisibleQuantityTraces = quantityTraces.filter(
          (trace) => !hidden.has(trace.id),
        );
        const visibleQuantityTraces = referenceActive
          ? presentedTraces(quantity, rawVisibleQuantityTraces)
          : rawVisibleQuantityTraces;
        const sourceUnit = quantityTraces[0]?.unit ?? "1";
        const referenceId = references[quantity] ?? "";
        return (
          <section key={quantity} className="ac-quantity-group">
            <div className="ac-view-alignment">
              <div className="ac-view-toolbar">
                <div
                  role="group"
                  aria-label={`${groupLabel(quantity)} display`}
                >
                  {VIEW_MODES.map(({ mode: candidate, label }) => (
                    <button
                      key={candidate}
                      type="button"
                      aria-pressed={mode === candidate}
                      onClick={() =>
                        setViewModes((current) => ({
                          ...current,
                          [quantity]: candidate,
                        }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {(mode === "db20" || mode === "bode") && (
                  <label>
                    Reference
                    <select
                      aria-label={`${groupLabel(quantity)} reference`}
                      value={referenceId}
                      onChange={(event) =>
                        setReferences((current) => {
                          const next = { ...current };
                          if (event.target.value)
                            next[quantity] = event.target.value;
                          else delete next[quantity];
                          return next;
                        })
                      }
                    >
                      <option value="">
                        {unityReferenceLabel(sourceUnit)}
                      </option>
                      {quantityTraces
                        .filter((trace) => trace.unit === sourceUnit)
                        .map((trace) => (
                          <option key={trace.id} value={trace.id}>
                            {trace.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
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
                  kinds.map((kind) => (
                    <div key={kind} className="ac-plot-row">
                      {renderPlot(
                        { quantity, kind, referenced: referenceActive },
                        visibleQuantityTraces,
                      )}
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
                <strong>{plotName}</strong>
                <span>
                  {groupLabel(expandedPlot.quantity)} ·{" "}
                  {plotKindLabel(expandedPlot.kind)}
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
                    expandedPlot.referenced
                      ? presentedTraces(
                          expandedPlot.quantity,
                          visible.filter(
                            (trace) => trace.quantity === expandedPlot.quantity,
                          ),
                        )
                      : visible.filter(
                          (trace) => trace.quantity === expandedPlot.quantity,
                        ),
                    true,
                  )
                ) : (
                  <p className="simulation-empty-plot">Outputs hidden</p>
                )}
              </div>
            </div>
            {measurement(
              expandedPlot,
              expandedPlot.referenced
                ? presentedTraces(
                    expandedPlot.quantity,
                    visible.filter(
                      (trace) => trace.quantity === expandedPlot.quantity,
                    ),
                  )
                : visible.filter(
                    (trace) => trace.quantity === expandedPlot.quantity,
                  ),
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

import { useMemo, useState, type PointerEvent, type WheelEvent } from "react";
import type { SimulationProbeSpec } from "@icm/model";
import type { AcResult } from "@icm/spice-run";
import type { Prepared } from "@icm/simulation-service/contract";

import {
  acResponseSvg,
  formatFrequency,
  layoutAcPlot,
  type AcPoint,
  type AcTrace,
} from "./ac-response-plot";

interface OutputTrace extends AcTrace {
  id: string;
  quantity: "voltage" | "current";
  probe?: SimulationProbeSpec;
}

export interface AcResultsExplorerProps {
  analysis: AcResult;
  vectors: Prepared["vectors"];
  probes: readonly SimulationProbeSpec[];
  labels?: Readonly<Record<string, string>>;
  onFocusProbe?(probe: SimulationProbeSpec): void;
}

const PLOT_SIZE = { width: 760, height: 220 } as const;

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

function cropTrace(
  trace: OutputTrace,
  range?: readonly [number, number],
): OutputTrace {
  if (!range) return trace;
  const inside = trace.points.filter(
    (point) => point.frequency >= range[0] && point.frequency <= range[1],
  );
  if (inside.length >= 2) return { ...trace, points: inside };
  return trace;
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
  const [cursorFrequency, setCursorFrequency] = useState<number>();
  const [frequencyRange, setFrequencyRange] =
    useState<readonly [number, number]>();
  const fullRange = useMemo<readonly [number, number]>(() => {
    const frequencies = analysis.frequencyHz.filter(
      (frequency) => frequency > 0,
    );
    return [Math.min(...frequencies), Math.max(...frequencies)];
  }, [analysis.frequencyHz]);
  const visible = traces.filter(
    (trace) => !hidden.has(trace.id) && (solo === null || solo === trace.id),
  );
  const cursorRows =
    cursorFrequency === undefined
      ? []
      : visible.map((trace) => ({
          trace,
          point: closestPoint(trace.points, cursorFrequency),
        }));

  const pointAtPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const trace = cropTrace(visible[0] ?? traces[0]!, frequencyRange);
    const layout = layoutAcPlot([trace], PLOT_SIZE);
    if (!layout) return;
    const svgX =
      ((event.clientX - bounds.left) / bounds.width) * PLOT_SIZE.width;
    const frequency = layout.frequencyAt(svgX);
    setCursorFrequency(
      Math.min(layout.frequency.max, Math.max(layout.frequency.min, frequency)),
    );
  };
  const zoom = (event: WheelEvent<HTMLDivElement>) => {
    if (fullRange[0] === fullRange[1]) return;
    event.preventDefault();
    const current = frequencyRange ?? fullRange;
    const center = cursorFrequency ?? Math.sqrt(current[0] * current[1]);
    const scale = event.deltaY < 0 ? 0.72 : 1.38;
    const left = Math.log(center / current[0]) * scale;
    const right = Math.log(current[1] / center) * scale;
    const next: readonly [number, number] = [
      Math.max(fullRange[0], center / Math.exp(left)),
      Math.min(fullRange[1], center * Math.exp(right)),
    ];
    setFrequencyRange(next[1] > next[0] ? next : undefined);
  };

  return (
    <div className="ac-results-explorer">
      <header>
        <div>
          <strong>{analysis.plotName}</strong>
          <small>Wheel to zoom · move over either plot to inspect</small>
        </div>
        <button type="button" onClick={() => setFrequencyRange(undefined)}>
          Fit
        </button>
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
        const quantityTraces = visible
          .filter((trace) => trace.quantity === quantity)
          .map((trace) => cropTrace(trace, frequencyRange));
        if (quantityTraces.length === 0) return null;
        return (
          <section key={quantity} className="ac-quantity-group">
            <h4>{quantity === "voltage" ? "Voltage" : "Current"}</h4>
            {(["magnitude", "phase"] as const).map((kind) => {
              const svg = acResponseSvg(quantityTraces, PLOT_SIZE, {
                kind,
                showLegend: false,
                ...(cursorFrequency === undefined ? {} : { cursorFrequency }),
              });
              return (
                <div key={kind} className="ac-plot-row">
                  <strong>
                    {kind === "magnitude" ? "Magnitude" : "Phase"}
                  </strong>
                  <div
                    className="spice-ac-plot interactive"
                    onPointerMove={pointAtPointer}
                    onPointerLeave={() => setCursorFrequency(undefined)}
                    onWheel={zoom}
                    dangerouslySetInnerHTML={{ __html: svg ?? "" }}
                  />
                </div>
              );
            })}
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
    </div>
  );
}

import type { SimulationProbeSpec } from "@icm/model";
import type { DcSweepResult } from "@icm/spice-run";
import type { Prepared } from "@icm/simulation-service/contract";

export interface DcResultsExplorerProps {
  analysis: DcSweepResult;
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
};

function extent(values: readonly number[]): readonly [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [-1, 1];
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  if (low !== high) return [low, high];
  const margin = Math.max(Math.abs(low) * 0.05, 1e-12);
  return [low - margin, high + margin];
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

function points(
  xValues: readonly number[],
  yValues: readonly number[],
  xExtent: readonly [number, number],
  yExtent: readonly [number, number],
): string {
  const xSpan = xExtent[1] - xExtent[0] || 1;
  const ySpan = yExtent[1] - yExtent[0] || 1;
  return xValues
    .slice(0, yValues.length)
    .map((x, index) => {
      const y = yValues[index]!;
      return `${(PLOT.left + ((x - xExtent[0]) / xSpan) * (PLOT.width - PLOT.left - PLOT.right)).toFixed(2)},${(PLOT.top + ((yExtent[1] - y) / ySpan) * (PLOT.height - PLOT.top - PLOT.bottom)).toFixed(2)}`;
    })
    .join(" ");
}

export function DcResultsExplorer({
  analysis,
  vectors,
  probes,
  labels = {},
  onFocusProbe,
}: DcResultsExplorerProps) {
  const vectorsByName = new Map(
    vectors.map((vector) => [vector.vector.toLowerCase(), vector]),
  );
  const probesById = new Map(probes.map((probe) => [probe.id, probe]));
  const traces = analysis.probes.map((result, index) => {
    const binding = vectorsByName.get(result.name.toLowerCase());
    const authored = binding ? probesById.get(binding.probeId) : undefined;
    return {
      id: binding?.probeId ?? result.name,
      label: (binding && labels[binding.probeId]) || result.name,
      quantity: result.quantity === "current" ? "current" : "voltage",
      unit: result.unit,
      values: result.value,
      index,
      authored,
    };
  });
  const xExtent = extent(analysis.sweep.values);

  return (
    <section
      className="transient-results-explorer"
      aria-label="DC sweep results"
    >
      <header>
        <div>
          <small>DC sweep</small>
          <strong>{analysis.plotName}</strong>
        </div>
        <span>{analysis.sweep.values.length} points</span>
      </header>
      {(["voltage", "current"] as const).map((quantity) => {
        const group = traces.filter((trace) => trace.quantity === quantity);
        if (!group.length) return null;
        const yExtent = extent(group.flatMap((trace) => [...trace.values]));
        const unit = group.find((trace) => trace.unit)?.unit ?? "";
        return (
          <div className="ac-plot-shell" key={quantity}>
            <div className="spice-ac-plot">
              <svg
                role="img"
                aria-label={`DC ${quantity}`}
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
                  {compact(xExtent[0])}
                  {analysis.sweep.unit ?? ""}
                </text>
                <text
                  textAnchor="end"
                  x={PLOT.width - PLOT.right}
                  y={PLOT.height - 8}
                >
                  {compact(xExtent[1])}
                  {analysis.sweep.unit ?? ""}
                </text>
                <text x={4} y={PLOT.top + 5}>
                  {compact(yExtent[1])}
                  {unit}
                </text>
                <text x={4} y={PLOT.height - PLOT.bottom}>
                  {compact(yExtent[0])}
                  {unit}
                </text>
                {group.map((trace) => (
                  <polyline
                    key={trace.id}
                    className={`transient-trace ac-trace-${trace.index % 6}`}
                    points={points(
                      analysis.sweep.values,
                      trace.values,
                      xExtent,
                      yExtent,
                    )}
                  />
                ))}
              </svg>
            </div>
            <div className="ac-trace-list">
              {group.map((trace) => (
                <button
                  key={trace.id}
                  type="button"
                  data-trace-index={trace.index}
                  onClick={() =>
                    trace.authored && onFocusProbe?.(trace.authored)
                  }
                >
                  {trace.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

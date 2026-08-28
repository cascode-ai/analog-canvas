import {
  defaultDraftTextDocument,
  snapGridPoint,
  type DraftingObject,
  type GridPoint,
} from "@icm/model";
import type {
  DigitalSimulationResult,
  DigitalTrace,
  LogicValue,
} from "@icm/simulation";

const TIME_SCALE_PS: Readonly<Record<string, number>> = {
  ps: 1,
  ns: 1_000,
  us: 1_000_000,
  ms: 1_000_000_000,
  s: 1_000_000_000_000,
};

export function parseSimulationTimePs(raw: string): number | null {
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(ps|ns|us|ms|s)$/iu.exec(
    raw.trim(),
  );
  if (!match) return null;
  const value = Number(match[1]) * TIME_SCALE_PS[match[2]!.toLowerCase()]!;
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : null;
}

export function formatSimulationTime(timePs: number): string {
  for (const [unit, scale] of [
    ["s", 1_000_000_000_000],
    ["ms", 1_000_000_000],
    ["µs", 1_000_000],
    ["ns", 1_000],
  ] as const) {
    if (timePs >= scale && timePs % scale === 0) {
      return `${timePs / scale} ${unit}`;
    }
  }
  return `${timePs} ps`;
}

function valueY(value: LogicValue, top: number, amplitude: number): number {
  if (value === "1") return top;
  if (value === "0") return top + amplitude;
  return top + amplitude / 2;
}

export function traceStepPoints(
  trace: DigitalTrace,
  stopTimePs: number,
  left: number,
  width: number,
  top: number,
  amplitude: number,
): Array<{ x: number; y: number }> {
  const x = (timePs: number) => left + (timePs / stopTimePs) * width;
  const transitions = trace.transitions;
  if (transitions.length === 0) return [];
  const points = [
    { x: left, y: valueY(transitions[0]!.value, top, amplitude) },
  ];
  let previousValue = transitions[0]!.value;
  for (const transition of transitions.slice(1)) {
    points.push({
      x: x(transition.timePs),
      y: valueY(previousValue, top, amplitude),
    });
    points.push({
      x: x(transition.timePs),
      y: valueY(transition.value, top, amplitude),
    });
    previousValue = transition.value;
  }
  points.push({
    x: left + width,
    y: valueY(previousValue, top, amplitude),
  });
  return points;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function guideTimes(result: DigitalSimulationResult): number[] {
  return [
    ...new Set(
      result.traces.flatMap((trace) =>
        trace.transitions
          .map((transition) => transition.timePs)
          .filter((timePs) => timePs > 0 && timePs < result.stopTimePs),
      ),
    ),
  ]
    .sort((left, right) => left - right)
    .slice(0, 24);
}

export function timingWaveformSvg(result: DigitalSimulationResult): string {
  const width = 900;
  const labelWidth = 120;
  const plotLeft = 140;
  const plotWidth = 700;
  const rowHeight = 54;
  const traceAmplitude = 24;
  const topPadding = 28;
  const axisY = topPadding + result.traces.length * rowHeight + 18;
  const height = axisY + 40;
  const guides = guideTimes(result)
    .map((timePs) => {
      const x = plotLeft + (timePs / result.stopTimePs) * plotWidth;
      return `<line class="guide" x1="${x}" y1="${topPadding - 8}" x2="${x}" y2="${axisY - 8}" />`;
    })
    .join("");
  const traces = result.traces
    .map((trace, index) => {
      const top = topPadding + index * rowHeight;
      const points = traceStepPoints(
        trace,
        result.stopTimePs,
        plotLeft,
        plotWidth,
        top,
        traceAmplitude,
      )
        .map((point) => `${point.x},${point.y}`)
        .join(" ");
      return `<text class="label" x="${labelWidth}" y="${top + 18}" text-anchor="end">${escapeXml(trace.name)}</text><polyline class="trace" points="${points}" />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Digital timing waveform"><defs><marker id="time-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#111"/></marker></defs><rect width="100%" height="100%" fill="#fff"/><style>.trace{fill:none;stroke:#111;stroke-width:3;stroke-linejoin:miter;stroke-linecap:square}.guide{stroke:#666;stroke-width:1.2;stroke-dasharray:5 5}.label,.time-label{fill:#111;font-family:'DejaVu Sans',Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:15.116px;font-style:italic;font-weight:700}.time-label{font-size:15.116px}</style>${guides}${traces}<line x1="${plotLeft - 12}" y1="${axisY}" x2="${plotLeft + plotWidth + 16}" y2="${axisY}" stroke="#111" stroke-width="2" marker-end="url(#time-arrow)"/><text class="time-label" x="${plotLeft + plotWidth}" y="${axisY + 28}" text-anchor="end">${escapeXml(formatSimulationTime(result.stopTimePs))}</text><text class="label" x="${plotLeft + plotWidth + 28}" y="${axisY + 8}">t</text></svg>`;
}

function free(position: GridPoint) {
  return { kind: "free" as const, position };
}

export function waveformDraftingObjects(
  result: DigitalSimulationResult,
  origin: GridPoint,
  grid: number,
  nextId: (prefix: string) => string,
): DraftingObject[] {
  const objects: DraftingObject[] = [];
  const labelX = origin.x;
  const plotLeft = origin.x + 100;
  const plotWidth = 400;
  const rowHeight = 50;
  const amplitude = 20;
  const topPadding = 40;
  const snap = (point: { x: number; y: number }) => snapGridPoint(point, grid);
  const addText = (value: string, position: GridPoint, token: "label") => {
    objects.push({
      id: nextId("waveform-text"),
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: free(position),
      content: defaultDraftTextDocument(value),
      alignment: "start",
      rotation: 0,
      typographyToken: token,
    });
  };

  addText(
    `Digital timing · ${formatSimulationTime(result.stopTimePs)}`,
    snap({ x: labelX, y: origin.y }),
    "label",
  );
  result.traces.forEach((trace, index) => {
    const top = origin.y + topPadding + index * rowHeight;
    const points = traceStepPoints(
      trace,
      result.stopTimePs,
      plotLeft,
      plotWidth,
      top,
      amplitude,
    ).map(snap);
    addText(trace.name, snap({ x: labelX, y: top + amplitude }), "label");
    if (points.length >= 2) {
      objects.push({
        id: nextId("waveform-trace"),
        kind: "construction-line",
        locked: false,
        zIndex: 0,
        anchor: free(points[0]!),
        points,
        lineStyle: "solid",
        styleOverride: { strokeScale: 1.5 },
      });
    }
  });

  const axisY = origin.y + topPadding + result.traces.length * rowHeight + 10;
  for (const timePs of guideTimes(result).slice(0, 12)) {
    const x = plotLeft + (timePs / result.stopTimePs) * plotWidth;
    const from = snap({ x, y: origin.y + topPadding - 10 });
    const to = snap({ x, y: axisY - 10 });
    objects.push({
      id: nextId("waveform-guide"),
      kind: "construction-line",
      locked: false,
      zIndex: 0,
      anchor: free(from),
      points: [from, to],
      lineStyle: "dashed",
      styleOverride: { strokeScale: 0.75 },
    });
  }
  const axisStart = snap({ x: plotLeft - 10, y: axisY });
  const axisEnd = snap({ x: plotLeft + plotWidth + 20, y: axisY });
  objects.push({
    id: nextId("waveform-time-axis"),
    kind: "arrow",
    locked: false,
    zIndex: 0,
    anchor: free(axisStart),
    from: free(axisStart),
    to: free(axisEnd),
    styleOverride: { arrowHead: "filled", strokeScale: 1.25 },
  });
  addText("t", snap({ x: axisEnd.x + 10, y: axisEnd.y + 10 }), "label");
  return objects;
}

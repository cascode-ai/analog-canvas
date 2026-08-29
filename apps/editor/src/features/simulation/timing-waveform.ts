import {
  measureRichTextDocument,
  resolveDocumentStyleProfile,
  richTextMetrics,
} from "@icm/derived";
import {
  createEmptyDocument,
  flattenRichText,
  type DraftingObject,
  type GridPoint,
  type RichTextDocument,
  type SchematicDocument,
} from "@icm/model";
import { renderDocumentSvg } from "@icm/render-svg";
import type {
  DigitalSimulationResult,
  DigitalTrace,
  LogicValue,
} from "@icm/simulation";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

const waveformResolver = new InMemorySymbolResolver(builtInSymbols);

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

/** Waveform labels default to full-size Razavi bold italic text. */
export function defaultWaveformLabelDocument(value: string): RichTextDocument {
  return {
    runs: [
      {
        kind: "span",
        style: "italic",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value }],
          },
        ],
      },
    ],
  };
}

export interface TimingWaveformDiagramRow {
  trace: DigitalTrace;
  label: RichTextDocument;
}

export interface TimingWaveformDiagram {
  result: DigitalSimulationResult;
  rows: TimingWaveformDiagramRow[];
}

interface WaveformTextLayout {
  content: RichTextDocument;
  position: GridPoint;
  alignment: "start" | "middle" | "end";
}

export interface TimingWaveformLayout {
  diagram: TimingWaveformDiagram;
  width: number;
  height: number;
  title: WaveformTextLayout;
  rows: Array<{
    label: WaveformTextLayout;
    points: GridPoint[];
  }>;
  guides: Array<{ from: GridPoint; to: GridPoint }>;
  axis: { from: GridPoint; to: GridPoint };
  stopTimeLabel: WaveformTextLayout;
  timeSymbol: WaveformTextLayout;
}

export function createTimingWaveformDiagram(
  result: DigitalSimulationResult,
  aliases: Readonly<Record<string, RichTextDocument>> = {},
): TimingWaveformDiagram {
  return {
    result,
    rows: result.traces.map((trace) => {
      const alias = trace.baseNetIds
        .map((baseNetId) => aliases[baseNetId])
        .find(
          (candidate): candidate is RichTextDocument =>
            candidate !== undefined && flattenRichText(candidate).trim() !== "",
        );
      return {
        trace,
        label: alias ?? defaultWaveformLabelDocument(trace.name),
      };
    }),
  };
}

function integerPoint(point: { x: number; y: number }): GridPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export function layoutTimingWaveformDiagram(
  diagram: TimingWaveformDiagram,
  presentation: SchematicDocument["presentation"],
): TimingWaveformLayout {
  const profile = resolveDocumentStyleProfile(presentation);
  const metrics = richTextMetrics(profile, "label");
  const maximumLabelWidth = Math.max(
    20,
    ...diagram.rows.map((row) =>
      Math.ceil(measureRichTextDocument(row.label, metrics).width),
    ),
  );
  const leftPadding = 20;
  const labelGap = Math.max(12, Math.ceil(profile.typography.labelGap * 2));
  const plotLeft = leftPadding + maximumLabelWidth + labelGap;
  const plotWidth = 520;
  const rowHeight = 50;
  const amplitude = 20;
  const topPadding = 44;
  const axisY = topPadding + diagram.rows.length * rowHeight + 10;
  const axis = {
    from: integerPoint({ x: plotLeft - 10, y: axisY }),
    to: integerPoint({ x: plotLeft + plotWidth + 20, y: axisY }),
  };
  const rows = diagram.rows.map((row, index) => {
    const top = topPadding + index * rowHeight;
    return {
      label: {
        content: row.label,
        position: integerPoint({ x: plotLeft - labelGap, y: top + 18 }),
        alignment: "end" as const,
      },
      points: traceStepPoints(
        row.trace,
        diagram.result.stopTimePs,
        plotLeft,
        plotWidth,
        top,
        amplitude,
      ).map(integerPoint),
    };
  });
  const guides = guideTimes(diagram.result).map((timePs) => {
    const x = plotLeft + (timePs / diagram.result.stopTimePs) * plotWidth;
    return {
      from: integerPoint({ x, y: topPadding - 10 }),
      to: integerPoint({ x, y: axisY - 10 }),
    };
  });
  return {
    diagram,
    width: axis.to.x + 48,
    height: axisY + 42,
    title: {
      content: defaultWaveformLabelDocument(
        `Digital timing · ${formatSimulationTime(diagram.result.stopTimePs)}`,
      ),
      position: { x: leftPadding, y: 20 },
      alignment: "start",
    },
    rows,
    guides,
    axis,
    stopTimeLabel: {
      content: defaultWaveformLabelDocument(
        formatSimulationTime(diagram.result.stopTimePs),
      ),
      position: { x: plotLeft + plotWidth, y: axisY + 28 },
      alignment: "end",
    },
    timeSymbol: {
      content: defaultWaveformLabelDocument("t"),
      position: { x: axis.to.x + 10, y: axisY + 8 },
      alignment: "start",
    },
  };
}

function free(position: GridPoint) {
  return { kind: "free" as const, position };
}

function translated(point: GridPoint, origin: GridPoint): GridPoint {
  return { x: point.x + origin.x, y: point.y + origin.y };
}

export function waveformDraftingObjects(
  layout: TimingWaveformLayout,
  origin: GridPoint,
  nextId: (prefix: string) => string,
): DraftingObject[] {
  const objects: DraftingObject[] = [];
  const addText = (text: WaveformTextLayout) => {
    const position = translated(text.position, origin);
    objects.push({
      id: nextId("waveform-text"),
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: free(position),
      content: text.content,
      alignment: text.alignment,
      rotation: 0,
      typographyToken: "label",
    });
  };

  addText(layout.title);
  layout.rows.forEach((row) => {
    addText(row.label);
    const points = row.points.map((point) => translated(point, origin));
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

  layout.guides.forEach((guide) => {
    const from = translated(guide.from, origin);
    const to = translated(guide.to, origin);
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
  });
  const axisStart = translated(layout.axis.from, origin);
  const axisEnd = translated(layout.axis.to, origin);
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
  addText(layout.stopTimeLabel);
  addText(layout.timeSymbol);
  return objects;
}

/** Preview and export use the exact drafting objects later placed on canvas. */
export function timingWaveformSvg(
  layout: TimingWaveformLayout,
  presentation: SchematicDocument["presentation"],
): string {
  const document = createEmptyDocument("digital-waveform", "Digital waveform");
  document.presentation = { ...presentation };
  let suffix = 0;
  document.drafting = {
    objects: waveformDraftingObjects(
      layout,
      { x: 0, y: 0 },
      (prefix) => `${prefix}-${++suffix}`,
    ),
  };
  return renderDocumentSvg(document, waveformResolver, {
    bounds: { x: 0, y: 0, width: layout.width, height: layout.height },
    margin: 0,
    title: "Digital timing waveform",
  });
}

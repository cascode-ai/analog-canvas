import { waveformTicks } from "./waveform-interaction";
/**
 * A projected waveform plot for complex AC analysis results.
 *
 * Why this draws its own SVG rather than reusing either of the two obvious
 * options:
 *
 * - **Not a charting library.** One plot type is needed, not a toolkit. A
 *   dependency would also render in its own idiom, beside a product that
 *   draws everything else as SVG through one style profile.
 * - **Not the digital-waveform path.** `timing-waveform.ts` composes drafting
 *   objects and hands them to `renderDocumentSvg`, which is right for a
 *   handful of step edges. Drafting objects are persistable user drawing
 *   primitives and there is no polyline among them, so an AC sweep — hundreds
 *   of points per trace — would become hundreds of persistable objects. Wrong
 *   weight and wrong meaning.
 *
 * The output is a plain SVG string plus the geometry a caller needs to read
 * values back off it, so the panel can show a crosshair without this module
 * knowing anything about React.
 */

export interface AcPoint {
  /** Hertz. Must be positive: the frequency axis is logarithmic. */
  frequency: number;
  /** Original complex result, retained for every presentation projection. */
  real: number;
  imaginary: number;
  /** Linear magnitude in the trace's physical unit. */
  magnitude: number;
  /** Magnitude relative to one trace unit, in decibels. */
  magnitudeDb: number;
  /** Phase in degrees. */
  phaseDeg: number;
}

export interface AcTrace {
  /** Stable result-browser identity used for line selection. */
  id?: string;
  /** The expression the author asked for, printed verbatim as the legend. */
  label: string;
  /** Physical result unit before a presentation-only projection. */
  unit: string;
  /** Stable Results Browser colour slot, independent of hide/show filtering. */
  colorIndex?: number;
  points: readonly AcPoint[];
}

export interface AcPlotSize {
  width: number;
  height: number;
}

export interface AcPlotAxis {
  /** Decade boundaries actually drawn, low to high. */
  ticks: readonly number[];
  min: number;
  max: number;
}

export interface AcPlotLayout {
  size: AcPlotSize;
  /** Drawing area inside the axes, in SVG units. */
  frame: { x: number; y: number; width: number; height: number };
  frequency: AcPlotAxis;
  value: AcPlotAxis;
  /** Frequency in Hz for an x in SVG units, for crosshair readout. */
  frequencyAt: (x: number) => number;
}

export type AcPlotKind = "magnitude" | "db20" | "phase" | "real" | "imaginary";

export interface AcResponseSvgOptions {
  /** One physical quantity per plot. Bode magnitude and phase never share an axis. */
  kind: AcPlotKind;
  /** Shared cursor frequency for paired magnitude/phase plots. */
  cursorFrequency?: number;
  cursorFrequencyB?: number;
  /** The interactive Results Browser owns the legend when false. */
  showLegend?: boolean;
  /** Selected Results Browser trace, emphasized on the plot. */
  selectedTraceId?: string;
  /** Explicit axes-toolbar range; traces are clipped to this interval. */
  frequencyRange?: readonly [number, number];
  valueRange?: readonly [number, number];
  /** Presentation unit printed on the value axis. */
  valueUnit?: string;
}

const MARGIN = { left: 56, right: 56, top: 16, bottom: 48 };

function niceDecades(min: number, max: number): number[] {
  const low = Math.floor(Math.log10(min));
  const high = Math.ceil(Math.log10(max));
  const ticks: number[] = [];
  for (let decade = low; decade <= high; decade += 1) {
    ticks.push(10 ** decade);
  }
  return ticks;
}

function adaptiveAxis(
  range: readonly [number, number],
  height: number,
  pad = true,
): AcPlotAxis {
  const span = range[1] - range[0];
  const margin =
    range[0] === range[1]
      ? Math.max(Math.abs(range[0]) * 0.05, 1)
      : pad
        ? span * 0.05
        : 0;
  const min = range[0] - margin;
  const max = range[1] + margin;
  return { min, max, ticks: waveformTicks(min, max, height > 400 ? 10 : 5) };
}

export function layoutAcPlot(
  traces: readonly AcTrace[],
  size: AcPlotSize,
  kind: AcPlotKind = "magnitude",
  frequencyRange?: readonly [number, number],
  valueRange?: readonly [number, number],
): AcPlotLayout | null {
  const points = traces.flatMap((trace) => trace.points);
  const usable = points.filter(
    (point) =>
      point.frequency > 0 && Number.isFinite(acPointValue(point, kind)),
  );
  if (usable.length === 0) return null;

  const frequencies = usable.map((point) => point.frequency);
  const inView = usable.filter(
    (point) =>
      !frequencyRange ||
      (point.frequency >= frequencyRange[0] &&
        point.frequency <= frequencyRange[1]),
  );
  const visible = inView.length ? inView : usable;
  const values = visible.map((point) => acPointValue(point, kind));
  const frame = {
    x: MARGIN.left,
    y: MARGIN.top,
    width: Math.max(1, size.width - MARGIN.left - MARGIN.right),
    height: Math.max(1, size.height - MARGIN.top - MARGIN.bottom),
  };
  const dataMin = Math.min(...frequencies);
  const dataMax = Math.max(...frequencies);
  const logPadding =
    frequencyRange || dataMin === dataMax
      ? 0
      : (Math.log10(dataMax) - Math.log10(dataMin)) * 0.025;
  const fMin = frequencyRange?.[0] ?? dataMin / 10 ** logPadding;
  const fMax = frequencyRange?.[1] ?? dataMax * 10 ** logPadding;
  const decades = niceDecades(fMin, fMax).filter(
    (frequency) => frequency >= fMin && frequency <= fMax,
  );
  const frequency: AcPlotAxis = {
    ticks:
      decades.length >= 2
        ? decades.filter(
            (_, i) =>
              i %
                Math.max(
                  1,
                  Math.ceil(decades.length / (size.width > 1000 ? 10 : 5)),
                ) ===
              0,
          )
        : waveformTicks(fMin, fMax, 5),
    min: fMin,
    max: fMax,
  };
  const logMin = Math.log10(frequency.min);
  const logSpan = Math.log10(frequency.max) - logMin || 1;

  return {
    size,
    frame,
    frequency,
    value: adaptiveAxis(
      valueRange ?? [Math.min(...values), Math.max(...values)],
      size.height,
      valueRange === undefined,
    ),
    frequencyAt: (x: number) =>
      10 ** (logMin + ((x - frame.x) / frame.width) * logSpan),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Hertz with an engineering suffix, the way a frequency axis is read. */
export function formatFrequency(hertz: number): string {
  if (hertz >= 1e9) return `${hertz / 1e9} GHz`;
  if (hertz >= 1e6) return `${hertz / 1e6} MHz`;
  if (hertz >= 1e3) return `${hertz / 1e3} kHz`;
  if (hertz >= 1) return `${hertz} Hz`;
  return `${hertz * 1e3} mHz`;
}

function horizontalTickAnchor(
  x: number,
  frame: AcPlotLayout["frame"],
): "start" | "middle" | "end" {
  if (x - frame.x < 36) return "start";
  if (frame.x + frame.width - x < 36) return "end";
  return "middle";
}

interface Projection {
  x: (frequency: number) => number;
  valueY: (value: number) => number;
}

function projection(layout: AcPlotLayout): Projection {
  const { frame, frequency, value } = layout;
  const logMin = Math.log10(frequency.min);
  const logSpan = Math.log10(frequency.max) - logMin || 1;
  const span = (axis: AcPlotAxis) => axis.max - axis.min || 1;
  return {
    x: (hz) => frame.x + ((Math.log10(hz) - logMin) / logSpan) * frame.width,
    valueY: (pointValue) =>
      frame.y +
      frame.height -
      ((pointValue - value.min) / span(value)) * frame.height,
  };
}

export function acPointValue(point: AcPoint, kind: AcPlotKind): number {
  if (kind === "magnitude") return point.magnitude;
  if (kind === "db20") return point.magnitudeDb;
  if (kind === "phase") return point.phaseDeg;
  if (kind === "real") return point.real;
  return point.imaginary;
}

function polyline(
  trace: AcTrace,
  project: Projection,
  kind: AcPlotKind,
): string {
  return trace.points
    .filter(
      (point) =>
        point.frequency > 0 && Number.isFinite(acPointValue(point, kind)),
    )
    .map(
      (point) =>
        `${project.x(point.frequency).toFixed(2)},${project.valueY(acPointValue(point, kind)).toFixed(2)}`,
    )
    .join(" ");
}

function closestPoint(
  points: readonly AcPoint[],
  frequency: number,
): AcPoint | undefined {
  return points.reduce<AcPoint | undefined>((best, point) => {
    if (point.frequency <= 0) return best;
    if (!best) return point;
    return Math.abs(Math.log(point.frequency / frequency)) <
      Math.abs(Math.log(best.frequency / frequency))
      ? point
      : best;
  }, undefined);
}

export function acResponseSvg(
  traces: readonly AcTrace[],
  size: AcPlotSize,
  options: AcResponseSvgOptions = { kind: "magnitude" },
): string | null {
  const layout = layoutAcPlot(
    traces,
    size,
    options.kind,
    options.frequencyRange,
    options.valueRange,
  );
  if (!layout) return null;
  const project = projection(layout);
  const { frame } = layout;
  const axis = layout.value;
  const axisY = project.valueY;
  const unit = options.valueUnit ?? (options.kind === "phase" ? "°" : "");

  const gridLines = [
    ...layout.frequency.ticks.map((hz) => {
      const projectedX = project.x(hz);
      const x = projectedX.toFixed(2);
      return `<line class="ac-grid" x1="${x}" y1="${frame.y}" x2="${x}" y2="${frame.y + frame.height}"/><text class="ac-axis-label ac-x-axis-label" x="${x}" y="${frame.y + frame.height + 18}" text-anchor="${horizontalTickAnchor(projectedX, frame)}">${escapeXml(formatFrequency(hz))}</text>`;
    }),
    ...axis.ticks.map((value) => {
      const y = axisY(value).toFixed(2);
      return `<line class="ac-grid" x1="${frame.x}" y1="${y}" x2="${frame.x + frame.width}" y2="${y}"/><text class="ac-axis-label" x="${frame.x - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${Number(value.toPrecision(6))}${unit}</text>`;
    }),
  ].join("");

  const curves = traces
    .map((trace, index) => {
      const colorIndex = trace.colorIndex ?? index;
      const points = polyline(trace, project, options.kind);
      const id = trace.id ?? trace.label;
      const selected =
        options.selectedTraceId === id ? " ac-trace-selected" : "";
      const identity = `data-trace-index="${index}" data-trace-id="${escapeXml(id)}"`;
      return (
        `<polyline class="ac-trace-hit" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke" ${identity} points="${points}"/>` +
        `<polyline class="ac-trace ac-trace-${colorIndex % 6}${selected}" points="${points}"/>`
      );
    })
    .join("");
  const clipId = `ac-clip-${options.kind}-${size.width}-${size.height}`;

  // The author asked for these expressions by name; printing them back is the
  // only way to tell two curves apart, and colour alone would leave anyone
  // who cannot separate the hues with an unreadable plot.
  const legend =
    (options.showLegend ?? true)
      ? traces
          .map((trace, index) => {
            const colorIndex = trace.colorIndex ?? index;
            const y = frame.y + 12 + index * 14;
            const swatchX = frame.x + 10;
            return (
              `<line class="ac-trace ac-trace-${colorIndex % 6}" x1="${swatchX}" y1="${y}" x2="${swatchX + 16}" y2="${y}"/>` +
              `<text class="ac-legend-text" x="${swatchX + 22}" y="${y + 3}">${escapeXml(trace.label)}</text>`
            );
          })
          .join("")
      : "";
  const cursorTrace =
    traces.find(
      (trace) => (trace.id ?? trace.label) === options.selectedTraceId,
    ) ?? traces[0];
  const cursor = ([options.cursorFrequency, options.cursorFrequencyB] as const)
    .map((frequency, index) => {
      if (
        frequency === undefined ||
        frequency < layout.frequency.min ||
        frequency > layout.frequency.max
      )
        return "";
      const x = project.x(frequency).toFixed(2);
      const marker = index === 0 ? "A" : "B";
      const color = marker === "A" ? "#175cd3" : "#c4320a";
      const point = cursorTrace
        ? closestPoint(cursorTrace.points, frequency)
        : undefined;
      const value = point && acPointValue(point, options.kind);
      const y = value === undefined ? undefined : axisY(value).toFixed(2);
      const horizontal =
        y === undefined
          ? ""
          : `<line class="ac-cursor" style="stroke:${color}" x1="${frame.x}" y1="${y}" x2="${frame.x + frame.width}" y2="${y}"/><line class="ac-cursor-hit" data-marker="${marker}" x1="${frame.x}" y1="${y}" x2="${frame.x + frame.width}" y2="${y}"/><circle class="ac-cursor-handle" style="stroke:${color}" cx="${x}" cy="${y}" r="4"/>`;
      return `<g><line class="ac-cursor" style="stroke:${color}" x1="${x}" y1="${frame.y}" x2="${x}" y2="${frame.y + frame.height}"/><line class="ac-cursor-hit" data-marker="${marker}" x1="${x}" y1="${frame.y}" x2="${x}" y2="${frame.y + frame.height}"/>${horizontal}<text pointer-events="none" x="${Number(x) + 5}" y="${frame.y + 13}">${marker}</text></g>`;
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="ac-response" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" height="${size.height}" role="img" aria-label="AC ${options.kind}">` +
    `<defs><clipPath id="${clipId}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/></clipPath></defs>` +
    `<rect class="ac-frame" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/>` +
    gridLines +
    `<text class="ac-axis-title" x="${frame.x + frame.width}" y="${size.height - 7}" text-anchor="end">Frequency</text>` +
    `<g clip-path="url(#${clipId})">${curves}</g>` +
    cursor +
    legend +
    `</svg>`
  );
}

/**
 * A Bode plot for AC analysis results.
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
  /** Magnitude in decibels. */
  magnitudeDb: number;
  /** Phase in degrees. */
  phaseDeg: number;
}

export interface AcTrace {
  /** Stable result-browser identity used for line selection. */
  id?: string;
  /** The expression the author asked for, printed verbatim as the legend. */
  label: string;
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
  magnitude: AcPlotAxis;
  phase: AcPlotAxis;
  /** Frequency in Hz for an x in SVG units, for crosshair readout. */
  frequencyAt: (x: number) => number;
}

export type AcPlotKind = "magnitude" | "phase";

export interface AcResponseSvgOptions {
  /** One physical quantity per plot. Bode magnitude and phase never share an axis. */
  kind: AcPlotKind;
  /** Shared cursor frequency for paired magnitude/phase plots. */
  cursorFrequency?: number;
  /** The interactive Results Browser owns the legend when false. */
  showLegend?: boolean;
  /** Selected Results Browser trace, emphasized on the plot. */
  selectedTraceId?: string;
  /** Explicit axes-toolbar range; traces are clipped to this interval. */
  frequencyRange?: readonly [number, number];
}

const MARGIN = { left: 56, right: 56, top: 16, bottom: 32 };

function niceDecades(min: number, max: number): number[] {
  const low = Math.floor(Math.log10(min));
  const high = Math.ceil(Math.log10(max));
  const ticks: number[] = [];
  for (let decade = low; decade <= high; decade += 1) {
    ticks.push(10 ** decade);
  }
  return ticks;
}

/** Round a linear range outward to readable round numbers. */
function niceLinear(min: number, max: number, step: number): AcPlotAxis {
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return { ticks, min: low, max: high === low ? low + step : high };
}

export function layoutAcPlot(
  traces: readonly AcTrace[],
  size: AcPlotSize,
  frequencyRange?: readonly [number, number],
): AcPlotLayout | null {
  const points = traces.flatMap((trace) => trace.points);
  const usable = points.filter((point) => point.frequency > 0);
  if (usable.length === 0) return null;

  const frequencies = usable.map((point) => point.frequency);
  const magnitudes = usable.map((point) => point.magnitudeDb);
  const phases = usable.map((point) => point.phaseDeg);
  const frame = {
    x: MARGIN.left,
    y: MARGIN.top,
    width: Math.max(1, size.width - MARGIN.left - MARGIN.right),
    height: Math.max(1, size.height - MARGIN.top - MARGIN.bottom),
  };
  const dataMin = Math.min(...frequencies);
  const dataMax = Math.max(...frequencies);
  const fMin = frequencyRange?.[0] ?? dataMin;
  const fMax = frequencyRange?.[1] ?? dataMax;
  const decades = niceDecades(fMin, fMax).filter(
    (frequency) => frequency >= fMin && frequency <= fMax,
  );
  const frequency: AcPlotAxis = {
    ticks: decades,
    min: frequencyRange ? fMin : niceDecades(dataMin, dataMax)[0]!,
    max: frequencyRange ? fMax : niceDecades(dataMin, dataMax).at(-1)!,
  };
  const logMin = Math.log10(frequency.min);
  const logSpan = Math.log10(frequency.max) - logMin || 1;

  return {
    size,
    frame,
    frequency,
    magnitude: niceLinear(Math.min(...magnitudes), Math.max(...magnitudes), 20),
    phase: niceLinear(Math.min(...phases), Math.max(...phases), 45),
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

interface Projection {
  x: (frequency: number) => number;
  magnitudeY: (db: number) => number;
  phaseY: (deg: number) => number;
}

function projection(layout: AcPlotLayout): Projection {
  const { frame, frequency, magnitude, phase } = layout;
  const logMin = Math.log10(frequency.min);
  const logSpan = Math.log10(frequency.max) - logMin || 1;
  const span = (axis: AcPlotAxis) => axis.max - axis.min || 1;
  return {
    x: (hz) => frame.x + ((Math.log10(hz) - logMin) / logSpan) * frame.width,
    magnitudeY: (db) =>
      frame.y +
      frame.height -
      ((db - magnitude.min) / span(magnitude)) * frame.height,
    phaseY: (deg) =>
      frame.y + frame.height - ((deg - phase.min) / span(phase)) * frame.height,
  };
}

function polyline(
  trace: AcTrace,
  project: Projection,
  axis: "magnitude" | "phase",
): string {
  return trace.points
    .filter((point) => point.frequency > 0)
    .map((point) => {
      const y =
        axis === "magnitude"
          ? project.magnitudeY(point.magnitudeDb)
          : project.phaseY(point.phaseDeg);
      return `${project.x(point.frequency).toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function acResponseSvg(
  traces: readonly AcTrace[],
  size: AcPlotSize,
  options: AcResponseSvgOptions = { kind: "magnitude" },
): string | null {
  const layout = layoutAcPlot(traces, size, options.frequencyRange);
  if (!layout) return null;
  const project = projection(layout);
  const { frame } = layout;
  const axis = options.kind === "magnitude" ? layout.magnitude : layout.phase;
  const axisY =
    options.kind === "magnitude" ? project.magnitudeY : project.phaseY;
  const unit = options.kind === "magnitude" ? "dB" : "°";

  const gridLines = [
    ...layout.frequency.ticks.map((hz) => {
      const x = project.x(hz).toFixed(2);
      return `<line class="ac-grid" x1="${x}" y1="${frame.y}" x2="${x}" y2="${frame.y + frame.height}"/><text class="ac-axis-label" x="${x}" y="${frame.y + frame.height + 18}" text-anchor="middle">${escapeXml(formatFrequency(hz))}</text>`;
    }),
    ...axis.ticks.map((value) => {
      const y = axisY(value).toFixed(2);
      return `<line class="ac-grid" x1="${frame.x}" y1="${y}" x2="${frame.x + frame.width}" y2="${y}"/><text class="ac-axis-label" x="${frame.x - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${value}${unit}</text>`;
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
        `<polyline class="ac-trace-hit" ${identity} points="${points}"/>` +
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
  const cursor =
    options.cursorFrequency !== undefined &&
    options.cursorFrequency >= layout.frequency.min &&
    options.cursorFrequency <= layout.frequency.max
      ? `<line class="ac-cursor" x1="${project.x(options.cursorFrequency).toFixed(2)}" y1="${frame.y}" x2="${project.x(options.cursorFrequency).toFixed(2)}" y2="${frame.y + frame.height}"/>`
      : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="ac-response" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" height="${size.height}" role="img" aria-label="AC ${options.kind}">` +
    `<defs><clipPath id="${clipId}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/></clipPath></defs>` +
    `<rect class="ac-frame" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/>` +
    gridLines +
    `<g clip-path="url(#${clipId})">${curves}</g>` +
    cursor +
    legend +
    `</svg>`
  );
}

/**
 * The numeric half of a simulation result.
 *
 * A run's provenance — what was submitted, where it ran — is settled by
 * `SimulationRunMetadata`. This is the other half: the numbers, in the shape
 * the analysis actually produced them.
 *
 * Three commitments shape it.
 *
 * **The sweep axis is the file's, never a reconstruction.** A transient run
 * carries the timesteps ngspice chose, which are not evenly spaced and in the
 * measured fixture span a factor of eight million within one run. Nothing here
 * derives a point's position from its index.
 *
 * **An AC point keeps its real and imaginary parts.** No magnitude, no phase,
 * and above all no "gain": a magnitude is a magnitude, and what it means
 * depends on a testbench this layer never sees. A consumer that wants decibels
 * can compute decibels and label them itself.
 *
 * **There is one reader.** A chart and a CSV export are two views of one
 * parse, because two readers of one format are two chances to disagree about
 * what the file said.
 */

import {
  parseNgspiceRawfile,
  type RawfilePlot,
  type RawfileVector,
} from "./rawfile.js";
import type { SimulationDiagnostic } from "./index.js";

/**
 * One measured quantity in a result.
 *
 * `quantity` is ngspice's own word, unedited, for the same reason a diagnostic
 * keeps ngspice's own text. `unit` is the SI symbol when the quantity is one we
 * recognise and `null` when it is not: an unrecognised quantity gets no
 * invented unit, because a wrong unit on a chart axis is worse than no unit.
 */
export interface SimulationProbe {
  /** ngspice's own vector name: `v(out)`, `i(v1)`. */
  readonly name: string;
  readonly quantity: string;
  readonly unit: string | null;
}

/** A DC operating point: one number per probe, and no sweep. */
export interface OperatingPointProbe extends SimulationProbe {
  readonly value: number;
}

export interface OperatingPointResult {
  readonly analysis: "op";
  readonly plotName: string;
  readonly probes: readonly OperatingPointProbe[];
}

/** An AC point, kept as it was solved: a complex number per frequency. */
export interface AcProbe extends SimulationProbe {
  readonly real: readonly number[];
  readonly imag: readonly number[];
}

export interface AcResult {
  readonly analysis: "ac";
  readonly plotName: string;
  /** The swept frequencies, in hertz, exactly as the file recorded them. */
  readonly frequencyHz: readonly number[];
  readonly probes: readonly AcProbe[];
}

export interface TransientProbe extends SimulationProbe {
  /**
   * Named `value` to match the frozen result contract in
   * `docs/specs/simulation.md`, where an operating point's scalar and a
   * transient's series carry the same field name and the analysis tag is what
   * distinguishes them.
   */
  readonly value: readonly number[];
}

export interface TransientResult {
  readonly analysis: "tran";
  readonly plotName: string;
  /**
   * The simulator's own timesteps, in seconds. Not a start and a stride:
   * ngspice chooses these, and in the measured fixture they run from 10 ps to
   * 80 µs inside a single run.
   */
  readonly timeSeconds: readonly number[];
  readonly probes: readonly TransientProbe[];
}

export type SimulationAnalysisResult =
  OperatingPointResult | AcResult | TransientResult;

export interface SimulationResultData {
  readonly schemaVersion: 1;
  /** Never empty. A result with nothing in it is reported `unusable`. */
  readonly analyses: readonly SimulationAnalysisResult[];
}

/**
 * What reading a rawfile produced.
 *
 * `unusable` is the case that matters. A simulator can exit 0, print a
 * plausible log, and leave behind a rawfile with no vectors in it — an
 * analysis that solved nothing, a `write` that saved an empty plot. Reported
 * as a success with an empty result, that reaches the author as a blank chart
 * and no explanation. So there is no such thing here as a reading that
 * succeeded with nothing in it: either there are analyses, or there is a
 * diagnostic saying why there are none.
 */
export type SimulationDataReading =
  | {
      readonly status: "read";
      readonly data: SimulationResultData;
      /** Anything the file held that this protocol does not name. */
      readonly diagnostics: readonly SimulationDiagnostic[];
    }
  | {
      readonly status: "unusable";
      /** Always at least one, and always says what to go look at. */
      readonly diagnostics: readonly SimulationDiagnostic[];
    };

/** ngspice's quantity words, and the SI symbol each one means. */
const UNIT_BY_QUANTITY = new Map<string, string>([
  ["voltage", "V"],
  ["current", "A"],
  ["time", "s"],
  ["frequency", "Hz"],
  ["temp-sweep", "°C"],
  ["res-sweep", "Ω"],
]);

function probeOf(vector: RawfileVector): SimulationProbe {
  const quantity = vector.variable.quantity;
  return {
    name: vector.variable.name,
    quantity,
    unit: UNIT_BY_QUANTITY.get(quantity.toLowerCase()) ?? null,
  };
}

function error(text: string): SimulationDiagnostic {
  return { severity: "error", text };
}

function warning(text: string): SimulationDiagnostic {
  return { severity: "warning", text };
}

type PlotReading =
  | { readonly analysis: SimulationAnalysisResult }
  | { readonly diagnostic: SimulationDiagnostic };

/**
 * Read one rawfile into the analyses it holds.
 *
 * Pass the file's text; pass `""` when the run left no rawfile at all, which
 * is reported as unusable rather than as an empty success.
 */
export function readSimulationData(rawfile: string): SimulationDataReading {
  const parse = parseNgspiceRawfile(rawfile);
  if (!parse.ok) {
    const where =
      parse.error.line === null ? "" : ` (rawfile line ${parse.error.line})`;
    return {
      status: "unusable",
      diagnostics: [error(`${parse.error.message}${where}`)],
    };
  }

  const analyses: SimulationAnalysisResult[] = [];
  const diagnostics: SimulationDiagnostic[] = [];
  for (const plot of parse.plots) {
    const reading = readPlot(plot);
    if ("analysis" in reading) analyses.push(reading.analysis);
    else diagnostics.push(reading.diagnostic);
  }

  if (analyses.length === 0) {
    if (diagnostics.length === 0) {
      diagnostics.push(
        error(
          "The simulator wrote a rawfile with no plots in it, so this run produced no numbers.",
        ),
      );
    }
    // Nothing to show. Whatever the exit status said, this is not a result,
    // and every reason it is not becomes an error the author can read.
    return {
      status: "unusable",
      diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic,
        severity: "error" as const,
      })),
    };
  }
  return { status: "read", data: { schemaVersion: 1, analyses }, diagnostics };
}

function readPlot(plot: RawfilePlot): PlotReading {
  const name = plot.plotName.trim().toLowerCase();
  if (plot.vectors.length === 0 || plot.pointCount === 0) {
    return {
      diagnostic: error(
        `The "${plot.plotName}" plot holds ${plot.vectors.length} variables over ${plot.pointCount} points, so there is nothing in it to read.`,
      ),
    };
  }
  if (name === "operating point") return readOperatingPoint(plot);
  if (name === "ac analysis") return readAc(plot);
  if (name === "transient analysis") return readTransient(plot);
  return {
    diagnostic: warning(
      `The rawfile holds a "${plot.plotName}" plot, which this release does not read. Operating point, AC, and transient analyses are read.`,
    ),
  };
}

function readOperatingPoint(plot: RawfilePlot): PlotReading {
  if (plot.pointCount !== 1) {
    return {
      diagnostic: error(
        `The "${plot.plotName}" plot holds ${plot.pointCount} points. An operating point is a single solution, so this file is not one and its first point is not silently taken for it.`,
      ),
    };
  }
  const probes: OperatingPointProbe[] = [];
  const seen = new Map<string, number>();
  for (const vector of plot.vectors) {
    const value = vector.real[0];
    if (value === undefined) {
      return {
        diagnostic: error(
          `The operating point holds no value for "${vector.variable.name}".`,
        ),
      };
    }
    // ngspice's `write` with an explicit vector list emits the plot's scale
    // before the listed vectors, and an operating-point plot's scale is its
    // first vector, so the first requested probe arrives twice with one
    // value. That echo is the format, not a second probe; two different
    // values under one name would be a real contradiction and is refused.
    const key = `${vector.variable.name}\u0000${vector.variable.quantity}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      if (earlier === value) continue;
      return {
        diagnostic: error(
          `The operating point holds two different values for "${vector.variable.name}": ${earlier} and ${value}.`,
        ),
      };
    }
    seen.set(key, value);
    probes.push({ ...probeOf(vector), value });
  }
  return { analysis: { analysis: "op", plotName: plot.plotName, probes } };
}

/**
 * The sweep column, taken by the quantity ngspice declared rather than by
 * position or by name. A plot that declares none is refused: guessing which
 * column is the x-axis is how a chart ends up plotting a current against a
 * voltage and calling it a frequency response.
 */
function sweepColumn(
  plot: RawfilePlot,
  quantity: string,
): RawfileVector | SimulationDiagnostic {
  const axis = plot.vectors.find(
    (vector) => vector.variable.quantity.toLowerCase() === quantity,
  );
  if (!axis) {
    return error(
      `The "${plot.plotName}" plot declares no ${quantity} variable, so its sweep axis is unknown and its points cannot be placed.`,
    );
  }
  return axis;
}

function readAc(plot: RawfilePlot): PlotReading {
  if (!plot.complex) {
    return {
      diagnostic: error(
        `The "${plot.plotName}" plot is not complex. An AC analysis solves complex phasors, so a real-valued AC plot has already lost its phase and cannot be read as one.`,
      ),
    };
  }
  const axis = sweepColumn(plot, "frequency");
  if (!("variable" in axis)) return { diagnostic: axis };

  const probes: AcProbe[] = [];
  for (const vector of plot.vectors) {
    if (vector === axis) continue;
    const imag = vector.imag;
    if (imag === null) {
      return {
        diagnostic: error(
          `"${vector.variable.name}" has no imaginary part in a complex plot.`,
        ),
      };
    }
    probes.push({ ...probeOf(vector), real: vector.real, imag });
  }
  return {
    analysis: {
      analysis: "ac",
      plotName: plot.plotName,
      // ngspice stores the frequency axis as a complex vector whose imaginary
      // part is zero. The frequency is the real part; nothing carrying
      // information is discarded here.
      frequencyHz: axis.real,
      probes,
    },
  };
}

function readTransient(plot: RawfilePlot): PlotReading {
  const axis = sweepColumn(plot, "time");
  if (!("variable" in axis)) return { diagnostic: axis };

  const probes: TransientProbe[] = [];
  for (const vector of plot.vectors) {
    if (vector === axis) continue;
    probes.push({ ...probeOf(vector), value: vector.real });
  }
  return {
    analysis: {
      analysis: "tran",
      plotName: plot.plotName,
      timeSeconds: axis.real,
      probes,
    },
  };
}

/**
 * The shortest decimal that reads back as this exact double. JavaScript's own
 * number formatting is already that, so a round trip through the CSV loses
 * nothing the rawfile carried.
 */
function csvNumber(value: number): string {
  return String(value);
}

function csvField(text: string): string {
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function labelled(name: string, unit: string | null): string {
  return unit === null ? name : `${name} [${unit}]`;
}

/**
 * One analysis as CSV, derived from the same parse a chart is drawn from.
 *
 * The shape follows the analysis rather than one universal table: an operating
 * point is a list of scalars, so it is one row per probe; a swept analysis is
 * one row per point. An AC row carries a real and an imaginary column per
 * probe and never a magnitude, because deriving one is the reader's decision
 * to make and to label.
 */
export function simulationAnalysisToCsv(
  analysis: SimulationAnalysisResult,
): string {
  const rows =
    analysis.analysis === "op"
      ? operatingPointRows(analysis)
      : analysis.analysis === "ac"
        ? acRows(analysis)
        : transientRows(analysis);
  return rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}

function operatingPointRows(analysis: OperatingPointResult): string[][] {
  return [
    ["variable", "value", "unit"],
    ...analysis.probes.map((probe) => [
      probe.name,
      csvNumber(probe.value),
      probe.unit ?? "",
    ]),
  ];
}

function acRows(analysis: AcResult): string[][] {
  const header = ["frequency [Hz]"];
  for (const probe of analysis.probes) {
    header.push(
      labelled(`re(${probe.name})`, probe.unit),
      labelled(`im(${probe.name})`, probe.unit),
    );
  }
  return [
    header,
    ...analysis.frequencyHz.map((frequency, point) => {
      const row = [csvNumber(frequency)];
      for (const probe of analysis.probes) {
        row.push(cell(probe.real, point), cell(probe.imag, point));
      }
      return row;
    }),
  ];
}

function transientRows(analysis: TransientResult): string[][] {
  const header = ["time [s]"];
  for (const probe of analysis.probes) {
    header.push(labelled(probe.name, probe.unit));
  }
  return [
    header,
    // The file's own time points, in the file's own order. A CSV that
    // renumbered them onto an even grid would describe a run that never
    // happened.
    ...analysis.timeSeconds.map((time, point) => {
      const row = [csvNumber(time)];
      for (const probe of analysis.probes) row.push(cell(probe.value, point));
      return row;
    }),
  ];
}

/**
 * Every probe was read from the same point blocks as the sweep axis, so a
 * short column cannot happen. If one ever did, an empty cell says so, where a
 * zero would not.
 */
function cell(values: readonly number[], point: number): string {
  const value = values[point];
  return value === undefined ? "" : csvNumber(value);
}

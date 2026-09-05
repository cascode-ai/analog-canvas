/**
 * Conservative, advisory size estimation for ngspice's ASCII rawfile.
 *
 * This deliberately stays independent of the persisted SimulationSetup
 * schema so parser support may remain broader than structured authoring. The
 * estimate is a warning input, never an execution admission check.
 */
export type ResultVolumeAnalysis =
  | { readonly kind: "op" }
  | {
      readonly kind: "ac";
      readonly sweep: "dec" | "oct" | "lin";
      readonly points: number;
      readonly startHz: number;
      readonly stopHz: number;
    }
  | {
      readonly kind: "tran";
      readonly stepSeconds: number;
      readonly stopSeconds: number;
      readonly startSeconds?: number;
    };

const RAWFILE_HEADER_BYTES = 4096;
const ASCII_REAL_VALUE_BYTES = 24;
const ASCII_COMPLEX_VALUE_BYTES = 48;

function acPointCount(analysis: Extract<ResultVolumeAnalysis, { kind: "ac" }>) {
  if (analysis.sweep === "lin") return Math.max(1, analysis.points);
  const intervals =
    analysis.sweep === "dec"
      ? Math.log10(analysis.stopHz / analysis.startHz)
      : Math.log2(analysis.stopHz / analysis.startHz);
  return Math.max(1, Math.ceil(intervals * analysis.points) + 1);
}

function tranPointCount(
  analysis: Extract<ResultVolumeAnalysis, { kind: "tran" }>,
) {
  const start = analysis.startSeconds ?? 0;
  // ngspice uses adaptive internal timesteps. Four times the requested output
  // grid is an intentionally conservative warning estimate, not a promise.
  return Math.max(
    1,
    (Math.ceil((analysis.stopSeconds - start) / analysis.stepSeconds) + 1) * 4,
  );
}

export function estimateSimulationOutputBytes(
  analyses: readonly ResultVolumeAnalysis[],
  probeCount: number,
): number {
  let bytes = RAWFILE_HEADER_BYTES;
  for (const analysis of analyses) {
    if (analysis.kind === "op") {
      bytes += RAWFILE_HEADER_BYTES + probeCount * ASCII_REAL_VALUE_BYTES;
      continue;
    }
    const points =
      analysis.kind === "ac"
        ? acPointCount(analysis)
        : tranPointCount(analysis);
    const bytesPerValue =
      analysis.kind === "ac"
        ? ASCII_COMPLEX_VALUE_BYTES
        : ASCII_REAL_VALUE_BYTES;
    // One scale vector (frequency or time) plus every requested probe.
    bytes += RAWFILE_HEADER_BYTES + points * (probeCount + 1) * bytesPerValue;
  }
  return Math.ceil(bytes);
}

export function outputVolumeWarning(
  analyses: readonly ResultVolumeAnalysis[],
  probeCount: number,
  maxOutputBytes: number | undefined,
): string | null {
  if (maxOutputBytes === undefined) return null;
  const estimated = estimateSimulationOutputBytes(analyses, probeCount);
  if (estimated <= maxOutputBytes) return null;
  return `Estimated ASCII raw output is about ${estimated} bytes for ${probeCount} probes, above this executor's ${maxOutputBytes}-byte output limit; the run remains allowed but its result may be truncated.`;
}

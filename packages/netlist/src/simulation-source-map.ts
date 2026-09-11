/** UTF-16 source mapping for execution-only text composition. Not persisted. */
export type SimulationTextOrigin =
  | { kind: "authored"; path: string; startOffset: number }
  | {
      kind: "generated";
      purpose:
        | "canvas-circuit"
        | "canvas-acquisitions"
        | "environment"
        | "run-variant";
      bindingId?: string;
      /** Location of the nominal text replaced for this execution point. */
      nominal?: { path: string; startOffset: number; endOffset: number };
    };
export interface SimulationTextSegment {
  startOffset: number;
  endOffset: number;
  origin: SimulationTextOrigin;
}
export interface SimulationFileSourceMap {
  path: string;
  segments: SimulationTextSegment[];
}
export interface MappedSimulationFile extends SimulationFileSourceMap {
  text: string;
}
export function mapSimulationFile(
  path: string,
  text: string,
  origin: SimulationTextOrigin = { kind: "authored", path, startOffset: 0 },
): MappedSimulationFile {
  return {
    path,
    text,
    segments: text.length
      ? [{ startOffset: 0, endOffset: text.length, origin }]
      : [],
  };
}
function sliceSegment(
  segment: SimulationTextSegment,
  start: number,
  end: number,
): SimulationTextSegment {
  return {
    startOffset: start,
    endOffset: end,
    origin:
      segment.origin.kind === "authored"
        ? {
            ...segment.origin,
            startOffset:
              segment.origin.startOffset + start - segment.startOffset,
          }
        : { ...segment.origin },
  };
}
/** Insert only generated text; every unaffected author offset keeps its owner. */
export function insertSimulationText(
  file: MappedSimulationFile,
  offset: number,
  text: string,
  origin: Extract<SimulationTextOrigin, { kind: "generated" }>,
): MappedSimulationFile {
  return replaceSimulationText(file, offset, offset, text, origin);
}

/** Replace one run-only range without reformatting unaffected source or losing its offsets. */
export function replaceSimulationText(
  file: MappedSimulationFile,
  start: number,
  end: number,
  text: string,
  origin: Extract<SimulationTextOrigin, { kind: "generated" }>,
): MappedSimulationFile {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    end > file.text.length
  )
    throw new RangeError("Invalid execution composition offset");
  const shift = text.length - (end - start);
  const before: SimulationTextSegment[] = [];
  const after: SimulationTextSegment[] = [];
  for (const segment of file.segments) {
    if (segment.startOffset < start)
      before.push(
        sliceSegment(
          segment,
          segment.startOffset,
          Math.min(start, segment.endOffset),
        ),
      );
    if (segment.endOffset > end) {
      const right = sliceSegment(
        segment,
        Math.max(end, segment.startOffset),
        segment.endOffset,
      );
      after.push({
        ...right,
        startOffset: right.startOffset + shift,
        endOffset: right.endOffset + shift,
      });
    }
  }
  return {
    path: file.path,
    text: file.text.slice(0, start) + text + file.text.slice(end),
    segments: [
      ...before,
      ...(text.length
        ? [{ startOffset: start, endOffset: start + text.length, origin }]
        : []),
      ...after,
    ],
  };
}
export function locateSimulationText(
  map: SimulationFileSourceMap,
  offset: number,
): SimulationTextOrigin | null {
  const segment = map.segments.find(
    (item) => offset >= item.startOffset && offset < item.endOffset,
  );
  if (!segment) return null;
  return segment.origin.kind === "authored"
    ? {
        ...segment.origin,
        startOffset: segment.origin.startOffset + offset - segment.startOffset,
      }
    : { ...segment.origin };
}

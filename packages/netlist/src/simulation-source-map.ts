/** UTF-16 source mapping for execution-only text composition. Not persisted. */
export type SimulationTextOrigin =
  | { kind: "authored"; path: string; startOffset: number }
  | {
      kind: "generated";
      purpose: "canvas-circuit" | "canvas-acquisitions" | "environment";
      bindingId?: string;
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
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.text.length)
    throw new RangeError("Invalid execution composition offset");
  const before: SimulationTextSegment[] = [];
  const after: SimulationTextSegment[] = [];
  for (const segment of file.segments) {
    if (segment.startOffset < offset)
      before.push(
        sliceSegment(
          segment,
          segment.startOffset,
          Math.min(offset, segment.endOffset),
        ),
      );
    if (segment.endOffset > offset) {
      const right = sliceSegment(
        segment,
        Math.max(offset, segment.startOffset),
        segment.endOffset,
      );
      after.push({
        ...right,
        startOffset: right.startOffset + text.length,
        endOffset: right.endOffset + text.length,
      });
    }
  }
  return {
    path: file.path,
    text: file.text.slice(0, offset) + text + file.text.slice(offset),
    segments: [
      ...before,
      ...(text.length
        ? [{ startOffset: offset, endOffset: offset + text.length, origin }]
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

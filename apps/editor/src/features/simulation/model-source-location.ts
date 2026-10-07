import { ProjectModelSourceSchema } from "@icm/model";
import { sha256 } from "@icm/simulation-service/files";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";

/** Resolve only an exact archived model span; ambiguous/legacy evidence stays in artifacts. */
export async function modelSourceDiagnosticLocation(
  location: { file: string; line: number },
  text: string,
  sourceMap: unknown,
  modelSnapshot: unknown,
): Promise<SimulationSourceLocation | undefined> {
  if (
    !Array.isArray(sourceMap) ||
    !Number.isSafeInteger(location.line) ||
    location.line < 1
  )
    return undefined;
  const maps = sourceMap.filter(
    (map) =>
      map &&
      typeof map.path === "string" &&
      (location.file === map.path || location.file.endsWith("/" + map.path)),
  );
  if (maps.length !== 1 || !Array.isArray(maps[0].segments)) return undefined;
  let offset = 0;
  for (let line = 1; line < location.line; line++) {
    const end = text.indexOf("\n", offset);
    if (end < 0) return undefined;
    offset = end + 1;
  }
  const segments = maps[0].segments.filter(
    (segment: { startOffset?: unknown; endOffset?: unknown } | null) =>
      segment &&
      typeof segment.startOffset === "number" &&
      typeof segment.endOffset === "number" &&
      Number.isSafeInteger(segment.startOffset) &&
      Number.isSafeInteger(segment.endOffset) &&
      segment.startOffset >= 0 &&
      segment.endOffset <= text.length &&
      offset >= segment.startOffset &&
      offset < segment.endOffset,
  );
  if (segments.length !== 1) return undefined;
  const segment = segments[0];
  const origin = segment?.origin;
  if (
    origin?.kind !== "model-source" ||
    !Number.isSafeInteger(origin.startOffset)
  )
    return undefined;
  const sources = ProjectModelSourceSchema.array()
    .max(256)
    .safeParse(modelSnapshot);
  if (!sources.success) return undefined;
  const owner = sources.data.find(
    (s) => s.id === origin.sourceId && s.revision === origin.revision,
  );
  const file = owner?.files.find((f) => f.path === origin.path);
  if (!file || !owner) return undefined;
  const startOffset = origin.startOffset + offset - segment.startOffset;
  if (startOffset < 0 || startOffset >= file.text.length) return undefined;
  const before = file.text.slice(0, startOffset);
  return {
    scope: "model-source",
    sourceId: owner.id,
    revision: owner.revision,
    path: file.path,
    textDigest: await sha256(file.text),
    startOffset,
    endOffset: startOffset,
    line: before.split("\n").length,
    column: startOffset - before.lastIndexOf("\n"),
  };
}

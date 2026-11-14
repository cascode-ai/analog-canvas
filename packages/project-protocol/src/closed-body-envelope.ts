import { ProjectFormatError } from "./diagnostics.js";

type RecordValue = Record<string, unknown>;
type Path = (string | number)[];

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function entries(value: unknown): [number, RecordValue][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const object = record(item);
    return object ? [[index, object]] : [];
  });
}

function checkPrimitives(value: unknown, parent: Path): void {
  for (const [index, primitive] of entries(value)) {
    const rectangle = primitive.kind === "rectangle";
    if (
      rectangle ||
      (primitive.kind === "path" && Object.hasOwn(primitive, "fillableBody"))
    )
      throw new ProjectFormatError([
        {
          code: "INVALID_PROJECT",
          path: [...parent, index, rectangle ? "kind" : "fillableBody"],
          message: rectangle
            ? "Symbol rectangles require Project schema 82"
            : "Closed Symbol paths require Project schema 82",
        },
      ]);
  }
}

function checkSymbol(value: unknown, path: Path): void {
  const symbol = record(value);
  if (!symbol) return;
  checkPrimitives(symbol.primitives, [...path, "primitives"]);
  for (const [index, variant] of entries(symbol.variants))
    checkPrimitives(variant.additionalPrimitives, [
      ...path,
      "variants",
      index,
      "additionalPrimitives",
    ]);
}

function checkPresentation(value: unknown, path: Path): void {
  const artwork = record(record(value)?.artwork);
  checkSymbol(artwork?.symbol, [...path, "artwork", "symbol"]);
}

function checkDefinition(value: unknown, path: Path): void {
  const definition = record(value);
  checkSymbol(definition?.symbol, [...path, "symbol"]);
  checkPresentation(record(definition?.generatedFrom)?.presentation, [
    ...path,
    "generatedFrom",
    "presentation",
  ]);
}

/** Only typed Artwork participates. Unapplied JSON text stays an opaque draft. */
export function rejectClosedBodyGeometry(raw: RecordValue): void {
  for (const [index, definition] of entries(raw.componentDefinitions))
    checkDefinition(definition, ["componentDefinitions", index]);
  for (const [index, document] of entries(raw.documents))
    checkPresentation(record(document.presentation)?.cellSymbol, [
      "documents",
      index,
      "presentation",
      "cellSymbol",
    ]);
  for (const [index, definition] of entries(raw.externalSubcircuitDefinitions))
    checkPresentation(definition.presentation, [
      "externalSubcircuitDefinitions",
      index,
      "presentation",
    ]);
  for (const [index, source] of entries(raw.modelSources))
    for (const [item, candidate] of entries(record(source.draft)?.authoring)) {
      const path = ["modelSources", index, "draft", "authoring", item];
      checkDefinition(candidate.lastValidArtwork, [
        ...path,
        "lastValidArtwork",
      ]);
      checkDefinition(record(candidate.legacyRepair)?.baseline, [
        ...path,
        "legacyRepair",
        "baseline",
      ]);
      checkPresentation(candidate.presentation, [...path, "presentation"]);
    }
}

import type { DrawingOrderEntry } from "@icm/model";
import { escapeXml } from "./svg-markup.js";

interface DrawingInk {
  readonly electrical: string;
  readonly circuitMarks: string;
  readonly instances: ReadonlyMap<string, string>;
  readonly annotations: ReadonlyMap<string, string>;
  readonly drafting: ReadonlyMap<string, string>;
}

type Group = "symbols" | "annotations" | "drafting";

/** A consecutive paint run. The editor can keep its SVG nodes while panning. */
export interface SvgPaintRun {
  readonly layer?: Group;
  readonly plane?: "background" | "foreground";
  readonly ids?: readonly string[];
  readonly html: string;
}

/** The pose, fill and independent upright text stay on the actual instance. */
export interface InstanceInk {
  readonly before: string;
  readonly geometry: string;
  readonly after: string;
}

/** Only artwork with identical paint and geometry in this scene can share a definition. */
export function shareCanvasSymbols(
  prefix: string,
  symbols: ReadonlyMap<string, InstanceInk>,
  runs: SvgPaintRun[],
): ReadonlyMap<string, string> {
  const references = new Map<string, string | null>();
  const definitions: string[] = [];
  for (const { geometry } of symbols.values()) {
    if (!references.has(geometry)) references.set(geometry, null);
    else if (references.get(geometry) === null) {
      const id = `${escapeXml(prefix)}-symbol-${definitions.length}`;
      definitions.push(`<g id="${id}">${geometry}</g>`);
      references.set(geometry, `<use href="#${id}"/>`);
    }
  }
  if (definitions.length)
    runs.push({ html: `<defs>${definitions.join("")}</defs>` });
  const shared = new Map<string, string>();
  for (const [id, { before, geometry, after }] of symbols) {
    const reference = references.get(geometry);
    if (reference) shared.set(id, before + reference + after);
  }
  return shared;
}

/** Emit consecutive runs of like paint without moving any object across another. */
export function composeDrawing(
  order: readonly DrawingOrderEntry[],
  ink: DrawingInk,
  implicitOrder: boolean,
  canvasRuns?: SvgPaintRun[],
  canvasSymbols?: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  let layer: Group | undefined;
  let draftingPlane: "background" | "foreground" = "background";
  let body: string[] = [];
  let ids: string[] = [];
  function fixed(value: string) {
    parts.push(value);
    if (value) canvasRuns?.push({ html: value });
  }
  function flush(): void {
    if (!layer) return;
    const plane =
      layer === "drafting" ? ` data-drafting-layer="${draftingPlane}"` : "";
    parts.push(`<g data-layer="${layer}"${plane}>${body.join("")}</g>`);
    if (canvasRuns) {
      // Keep stable, short consecutive runs. A guarded update or live drag
      // can retain an entire run without reparsing any of its object nodes.
      for (let start = 0; start < body.length; start += 4) {
        canvasRuns.push({
          layer,
          ...(layer === "drafting" ? { plane: draftingPlane } : {}),
          ids: ids.slice(start, start + 4),
          html: body
            .slice(start, start + 4)
            .map((part, offset) =>
              layer === "symbols"
                ? (canvasSymbols?.get(ids[start + offset]!) ?? part)
                : part,
            )
            .join(""),
        });
      }
    }
    body = [];
    ids = [];
    layer = undefined;
  }
  function paint(
    nextLayer: Group,
    id: string,
    value: string | undefined,
  ): void {
    if (!value) return;
    if (nextLayer !== layer) flush();
    layer = nextLayer;
    body.push(value);
    if (canvasRuns) ids.push(id);
  }

  for (const entry of order) {
    switch (entry.kind) {
      case "electrical":
        flush();
        fixed(ink.electrical);
        draftingPlane = "foreground";
        break;
      case "circuit-marks":
        flush();
        if (implicitOrder && !ink.instances.size)
          fixed('<g data-layer="symbols"></g>');
        fixed(ink.circuitMarks);
        if (implicitOrder && !ink.annotations.size)
          fixed('<g data-layer="annotations"></g>');
        break;
      case "instance":
        paint("symbols", entry.id, ink.instances.get(entry.id));
        break;
      case "annotation":
        paint("annotations", entry.id, ink.annotations.get(entry.id));
        break;
      case "drafting":
        paint("drafting", entry.id, ink.drafting.get(entry.id));
        break;
    }
  }
  flush();
  return parts.join("");
}

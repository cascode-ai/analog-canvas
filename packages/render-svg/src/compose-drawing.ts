import type { DrawingOrderEntry } from "@icm/model";

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

/** Emit consecutive runs of like paint without moving any object across another. */
export function composeDrawing(
  order: readonly DrawingOrderEntry[],
  ink: DrawingInk,
  implicitOrder: boolean,
  canvasRuns?: SvgPaintRun[],
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
          html: body.slice(start, start + 4).join(""),
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

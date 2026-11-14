import type { DrawingOrderEntry } from "@icm/model";

interface DrawingInk {
  readonly electrical: string;
  readonly circuitMarks: string;
  readonly instances: ReadonlyMap<string, string>;
  readonly annotations: ReadonlyMap<string, string>;
  readonly drafting: ReadonlyMap<string, string>;
}

type Group = "symbols" | "annotations" | "drafting";

/** Emit consecutive runs of like paint without moving any object across another. */
export function composeDrawing(
  order: readonly DrawingOrderEntry[],
  ink: DrawingInk,
  implicitOrder: boolean,
): string {
  const parts: string[] = [];
  let layer: Group | undefined;
  let draftingPlane: "background" | "foreground" = "background";
  let body: string[] = [];
  function flush(): void {
    if (!layer) return;
    const plane =
      layer === "drafting" ? ` data-drafting-layer="${draftingPlane}"` : "";
    parts.push(`<g data-layer="${layer}"${plane}>${body.join("")}</g>`);
    body = [];
    layer = undefined;
  }
  function paint(nextLayer: Group, value: string | undefined): void {
    if (!value) return;
    if (nextLayer !== layer) flush();
    layer = nextLayer;
    body.push(value);
  }

  for (const entry of order) {
    switch (entry.kind) {
      case "electrical":
        flush();
        parts.push(ink.electrical);
        draftingPlane = "foreground";
        break;
      case "circuit-marks":
        flush();
        if (implicitOrder && !ink.instances.size)
          parts.push('<g data-layer="symbols"></g>');
        parts.push(ink.circuitMarks);
        if (implicitOrder && !ink.annotations.size)
          parts.push('<g data-layer="annotations"></g>');
        break;
      case "instance":
        paint("symbols", ink.instances.get(entry.id));
        break;
      case "annotation":
        paint("annotations", ink.annotations.get(entry.id));
        break;
      case "drafting":
        paint("drafting", ink.drafting.get(entry.id));
        break;
    }
  }
  flush();
  return parts.join("");
}

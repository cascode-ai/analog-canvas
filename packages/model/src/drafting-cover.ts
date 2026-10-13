import type { CircuitProject, DraftingObject } from "./schema.js";

/**
 * Whether a drafting color is the sheet's own: white or nearly (every
 * channel at least 0xF0). The sheet is white, so such a stroke or fill
 * draws nothing; it only covers the drawing under it, as hand-made wire
 * "hops" masked the wires they crossed (2026-10-13). Never allowed.
 */
function sheetColored(color: string | undefined): boolean {
  if (!color) return false;
  const hex = color.slice(1);
  const full =
    hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return [0, 2, 4].every(
    (offset) => Number.parseInt(full.slice(offset, offset + 2), 16) >= 0xf0,
  );
}

/** The sheet-colored stroke or fill by which an object would cover, if any. */
export function draftingCoverColor(
  object: Pick<DraftingObject, "styleOverride"> | undefined,
): string | null {
  const { color, fillColor } = object?.styleOverride ?? {};
  if (sheetColored(color)) return color!;
  if (sheetColored(fillColor)) return fillColor!;
  return null;
}

/** The first drafting object in a Project that would cover its drawing. */
export function projectDraftingCover(
  project: Pick<CircuitProject, "documents">,
): { documentId: string; objectId: string; color: string } | null {
  for (const document of project.documents)
    for (const object of document.drafting?.objects ?? []) {
      const color = draftingCoverColor(object);
      if (color) return { documentId: document.id, objectId: object.id, color };
    }
  return null;
}

/** What a writer is told when a drafting object would cover the drawing. */
export function draftingCoverMessage(objectId: string, color: string): string {
  return `Drafting object ${objectId} is ${color}, the sheet's own color: it would only hide the drawing under it. Draw nothing to cover wires or parts; a crossing without a dot is no connection and needs no hop.`;
}

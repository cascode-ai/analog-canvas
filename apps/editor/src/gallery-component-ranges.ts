import taxonomy from "../../../config/gallery-taxonomy.json";

/**
 * A size the Gallery wall narrows by: how many parts a circuit's top Cell
 * draws. Ports and supply and ground markers are not parts. The taxonomy is
 * the one list the Worker counts and filters by; a reader may choose any
 * number of sizes and sees circuits of any of them.
 */
export interface GalleryComponentRange {
  key: string;
  min: number;
  /** Absent for the open-ended largest size. */
  max: number | null;
  /** As the sidebar shows it: ≤ 5, 6–10, 26+. */
  label: string;
}

export const GALLERY_COMPONENT_RANGES: readonly GalleryComponentRange[] =
  taxonomy.componentRanges.map((range) => {
    const min = "min" in range && typeof range.min === "number" ? range.min : 0;
    const max =
      "max" in range && typeof range.max === "number" ? range.max : null;
    return {
      key: range.key,
      min,
      max,
      label:
        max === null ? `${min}+` : min === 0 ? `≤ ${max}` : `${min}–${max}`,
    };
  });

/** The size a part count falls in, if the taxonomy covers it. */
export function galleryComponentRangeOf(count: number): string | undefined {
  return GALLERY_COMPONENT_RANGES.find(
    (range) => count >= range.min && (range.max === null || count <= range.max),
  )?.key;
}

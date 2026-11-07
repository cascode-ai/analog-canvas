/**
 * Tags that say where a circuit came from rather than what it is, such as a
 * schematic exported from Cadence Virtuoso. The wall shows one as a mark
 * beside Netlist and AI and filters it among the quick filters, never among
 * the circuit tags; the stored tag stays as written.
 */
const ORIGIN_TAG_MARKS: Readonly<Record<string, string>> = {
  "virtuoso-exported": "Virtuoso",
  "virtuoso exported": "Virtuoso",
};

/** The tool an origin tag names ("Virtuoso"), or null for a circuit tag. */
export function galleryOriginTagMark(tag: string): string | null {
  return ORIGIN_TAG_MARKS[tag.trim().toLowerCase()] ?? null;
}

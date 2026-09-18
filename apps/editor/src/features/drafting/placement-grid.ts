/**
 * Which pitch a drawn object places on.
 *
 * A rectangle is nearly always a block outline somebody wires to, so it
 * places on the electrical grid that wires, pins and Junctions already use.
 * Half a cell of difference there is a visible stub of wire inside the
 * outline — the wire can only land on its own grid, and the outline's edge
 * sat between two of them — and nothing about a block outline wants a finer
 * pitch than the circuit it encloses.
 *
 * Everything else keeps the annotation pitch, which is where placing between
 * grid points earns its keep: a label beside a device, an arrow head at the
 * exact spot it points to.
 */
export function draftingPlacementGrid(
  kind: string | null,
  annotationGrid: number,
  electricalGrid: number,
): number {
  return kind === "rectangle" ? electricalGrid : annotationGrid;
}

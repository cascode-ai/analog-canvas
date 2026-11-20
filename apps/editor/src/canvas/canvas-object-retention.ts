type KeepObjects = (ids: readonly string[]) => () => void;

const surfaces = new WeakMap<ParentNode, KeepObjects>();

/** A drag must keep the nodes it paints, even after the camera leaves them. */
export function registerCanvasObjectRetention(
  surface: ParentNode,
  keep: KeepObjects,
) {
  surfaces.set(surface, keep);
  return () => {
    surfaces.delete(surface);
  };
}

export function retainCanvasDragObjects(
  surface: ParentNode,
  ids: readonly string[],
) {
  return surfaces.get(surface)?.(ids);
}

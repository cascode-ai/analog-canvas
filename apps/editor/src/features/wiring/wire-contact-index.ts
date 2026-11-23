import { buildBoundsSpatialIndex } from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { Rect } from "@icm/model";

export type WireContacts =
  readonly WireSource[] | ReturnType<typeof indexedWireContacts>;

/** Build on first wire gesture for the current drawing's visible contact set. */
export function indexedWireContacts(
  sources: readonly WireSource[],
  grid: number,
) {
  function build() {
    const byOwner = new Map<string, WireSource[]>();
    const entries = sources.flatMap((source) => {
      if (source.endpoint.kind !== "terminal") return [];
      const id = source.endpoint.instanceId;
      const list = byOwner.get(id) ?? [];
      list.push(source);
      byOwner.set(id, list);
      return [
        {
          value: source,
          bounds: { ...source.connection.contactPoint, width: 0, height: 0 },
        },
      ];
    });
    return {
      byOwner,
      spatial: buildBoundsSpatialIndex(entries, Math.max(80, grid * 8)),
    };
  }
  let index: ReturnType<typeof build> | undefined;
  return {
    inBounds(rect: Rect) {
      return (index ??= build()).spatial.queryBounds(rect);
    },
    forOwner(id: string): readonly WireSource[] {
      return (index ??= build()).byOwner.get(id) ?? [];
    },
  };
}

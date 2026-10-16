import {
  computeNetHighlight,
  resolveNetLabelBinding,
  type HierarchyFrame,
  type NetHighlight,
  type ProjectConnectivityIndex,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { endpointNetId } from "../wiring/route-interaction-geometry";
import type { VisualSelection } from "./visual-selection";

/**
 * The nets one clicked thing touches (2026-10-14): a wire's net, a part's
 * pins' nets, a net label's or a pin's net. Several parts at once touch too
 * much to be worth lighting, so they light nothing.
 */
export function selectionNetIds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  selection: VisualSelection,
  selectedEndpoint: Pick<WireSource, "endpoint"> | null,
): string[] {
  if (selection.instanceIds.length > 1) return [];
  const instanceId = selection.instanceIds[0];
  const netIds = [
    ...document.routes
      .filter((route) => selection.routeIds.includes(route.id))
      .map((route) => route.netId),
    ...(instanceId
      ? document.nets
          .filter((net) =>
            net.terminals.some(
              (terminal) => terminal.instanceId === instanceId,
            ),
          )
          .map((net) => net.id)
      : []),
    ...document.annotations
      .filter((annotation) => selection.annotationIds.includes(annotation.id))
      .flatMap(
        (annotation) =>
          resolveNetLabelBinding(document, resolver, annotation)?.netId ?? [],
      ),
    ...document.junctions
      .filter((junction) => selection.junctionIds.includes(junction.id))
      .map((junction) => junction.netId),
    ...(selectedEndpoint
      ? [endpointNetId(document, selectedEndpoint.endpoint) ?? []].flat()
      : []),
  ];
  return [...new Set(netIds)];
}

/**
 * Each touched net whole, by name as well as by wire, so a wire lights every
 * wire that shares its name.
 */
export function selectionNetHighlights(
  index: ProjectConnectivityIndex,
  documentId: string,
  netIds: readonly string[],
  hierarchyPath: readonly HierarchyFrame[],
): NetHighlight[] {
  const highlights = new Map<string, NetHighlight>();
  for (const netId of netIds) {
    const highlight = computeNetHighlight(
      index,
      documentId,
      netId,
      undefined,
      hierarchyPath,
    );
    if (highlight && !highlights.has(highlight.netId))
      highlights.set(highlight.netId, highlight);
  }
  return [...highlights.values()];
}

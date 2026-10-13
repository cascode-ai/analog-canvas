import { deriveDocumentContactEvidence, endpointKey } from "@icm/derived";
import {
  planRoutedTerminalDetachment,
  type SchematicEdit,
} from "@icm/edit-engine";
import { routeEndpoints, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export interface DetachedMovePlan {
  /** Existing typed edits; this planner adds no editor or Engine protocol. */
  edits: readonly SchematicEdit[];
  /** Terminal memberships intentionally removed by the move. */
  disconnectedEndpointKeys: readonly string[];
}

/**
 * Leave every routed wire at its authored coordinates, then electrically
 * disconnect only the selected terminals that those wires used to end on,
 * and those that touch something staying put with no wire between: a
 * ground marker set on a source stays where it stands.
 *
 * The lifecycle detachment planner remains unchanged because returning an
 * Instance to the Placement Tray must preserve connectivity. Shift+M and
 * Ctrl/Cmd-drag instead compose that geometry-preserving planner with the
 * existing disconnect_endpoint edit.
 */
export function planDetachedMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: ReadonlySet<string>,
  sequence: number,
): DetachedMovePlan {
  const detachedTerminalKeys = new Set(
    document.routes.flatMap((route) =>
      routeEndpoints(route).flatMap((endpoint) =>
        endpoint.kind === "terminal" && instanceIds.has(endpoint.instanceId)
          ? [endpointKey(endpoint)]
          : [],
      ),
    ),
  );
  // A pin set directly on another part's pin, or on a Junction, holds a
  // contact with no wire: the part lets go of it too, or the move would
  // carry what it touches along.
  const moving = (endpoint: { kind: string; instanceId?: string }) =>
    endpoint.kind === "terminal" && instanceIds.has(endpoint.instanceId!);
  for (const contact of deriveDocumentContactEvidence(document, resolver)
    .contacts)
    if (contact.endpoints.some((endpoint) => !moving(endpoint)))
      for (const endpoint of contact.endpoints)
        if (moving(endpoint)) detachedTerminalKeys.add(endpointKey(endpoint));
  const disconnectedEndpointKeys: string[] = [];
  const disconnectEdits = document.nets.flatMap((net): SchematicEdit[] =>
    net.terminals.flatMap((terminal): SchematicEdit[] => {
      const endpoint = { kind: "terminal" as const, ...terminal };
      const key = endpointKey(endpoint);
      if (!detachedTerminalKeys.has(key)) return [];
      disconnectedEndpointKeys.push(key);
      return [{ kind: "disconnect_endpoint", endpoint }];
    }),
  );

  return {
    edits: [
      ...planRoutedTerminalDetachment(
        document,
        resolver,
        instanceIds,
        sequence,
      ),
      ...disconnectEdits,
    ],
    disconnectedEndpointKeys,
  };
}

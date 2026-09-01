import { endpointKey } from "@icm/derived";
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
 * disconnect only the selected terminals that those wires used to end on.
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
  const routedTerminalKeys = new Set(
    document.routes.flatMap((route) =>
      routeEndpoints(route).flatMap((endpoint) =>
        endpoint.kind === "terminal" && instanceIds.has(endpoint.instanceId)
          ? [endpointKey(endpoint)]
          : [],
      ),
    ),
  );
  const disconnectedEndpointKeys: string[] = [];
  const disconnectEdits = document.nets.flatMap((net): SchematicEdit[] =>
    net.terminals.flatMap((terminal): SchematicEdit[] => {
      const endpoint = { kind: "terminal" as const, ...terminal };
      const key = endpointKey(endpoint);
      if (!routedTerminalKeys.has(key)) return [];
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

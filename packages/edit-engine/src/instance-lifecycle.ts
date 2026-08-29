import { endpointKey, resolveEndpointConnection } from "@icm/derived";
import { routeBends, routeEnd, routeModes } from "@icm/model";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { rebuildRoutePath } from "./route-leg-mutation.js";

/**
 * Plans the presentation-only transition from canvas to Placement Tray.
 * Electrical terminal membership, NoConnect declarations, and annotations
 * remain owned by the retained Instance. Routed pins are represented by
 * Junctions before the placement disappears, so every visible wire endpoint
 * remains resolvable.
 */
export function planInstanceUnplacement(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  sequence: number,
): SchematicEdit[] {
  const selected = selectedExistingInstanceIds(document, instanceIds);
  if (selected.size === 0) return [];
  return [
    ...planRoutedTerminalDetachment(document, resolver, selected, sequence),
    ...instancesById(document, selected).map((instance): SchematicEdit => ({
      kind: "unplace_instance",
      instanceId: instance.id,
    })),
  ];
}

/**
 * Plans complete Instance disposal. This deliberately composes ordinary
 * strict edits instead of adding a second destructive edit kind: routes are
 * detached first, electrical memberships and explicit opens are removed, then
 * annotations/layout references and the Instance itself are removed.
 */
export function planInstanceDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  sequence: number,
): SchematicEdit[] {
  const selected = selectedExistingInstanceIds(document, instanceIds);
  if (selected.size === 0) return [];

  return [
    ...planRoutedTerminalDetachment(document, resolver, selected, sequence),
    ...[...instanceOwnedAnnotationIds(document, selected)].map(
      (annotationId): SchematicEdit => ({
        kind: "remove_schematic_annotation",
        annotationId,
      }),
    ),
    ...planTerminalDisconnections(document, selected),
    ...planNoConnectRemovals(document, selected),
    ...planLayoutReferenceRemoval(document, selected),
    ...instancesById(document, selected).map((instance): SchematicEdit => ({
      kind: "remove_instance",
      instanceId: instance.id,
    })),
  ];
}

function selectedExistingInstanceIds(
  document: SchematicDocument,
  instanceIds: readonly string[],
): ReadonlySet<string> {
  const requested = new Set(instanceIds);
  return new Set(
    document.instances
      .filter((instance) => requested.has(instance.id))
      .map((instance) => instance.id),
  );
}

function instancesById(
  document: SchematicDocument,
  selected: ReadonlySet<string>,
) {
  return document.instances.filter((instance) => selected.has(instance.id));
}

/**
 * Re-anchors every routed wire leaving the selected instances onto a fresh
 * Junction at its landing, leaving the wires' geometry untouched. Net
 * membership is intentionally preserved: the terminals stay electrically
 * connected and the missing physical path shows up as a flightline, so a
 * detach-move (Ctrl+drag) cannot silently change connectivity.
 */
export function planRoutedTerminalDetachment(
  document: SchematicDocument,
  resolver: SymbolResolver,
  selected: ReadonlySet<string>,
  sequence: number,
): SchematicEdit[] {
  return planRoutedEndpointDetachment(
    document,
    resolver,
    (endpoint) => selected.has(endpoint.instanceId),
    sequence,
  );
}

/**
 * Removes selected terminal connectivity while preserving every visible wire
 * as a Junction-anchored stub. Hierarchy planners use this when a child Cell
 * Pin disappears but the parent Instance and its surrounding drawing remain.
 */
export function planTerminalDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  terminals: readonly { instanceId: string; pinName: string }[],
  sequence: number,
): SchematicEdit[] {
  const selected = new Set(
    terminals.map((terminal) => endpointKey({ kind: "terminal", ...terminal })),
  );
  const matches = (endpoint: { instanceId: string; pinName: string }) =>
    selected.has(endpointKey({ kind: "terminal", ...endpoint }));
  return [
    ...planRoutedEndpointDetachment(document, resolver, matches, sequence),
    ...document.nets.flatMap((net) =>
      net.terminals.filter(matches).map((terminal): SchematicEdit => ({
        kind: "disconnect_endpoint",
        endpoint: { kind: "terminal", ...terminal },
      })),
    ),
    ...document.noConnects
      .filter((noConnect) => matches(noConnect.endpoint))
      .map((noConnect): SchematicEdit => ({
        kind: "remove_no_connect",
        noConnectId: noConnect.id,
      })),
  ];
}

function planRoutedEndpointDetachment(
  document: SchematicDocument,
  resolver: SymbolResolver,
  matches: (endpoint: { instanceId: string; pinName: string }) => boolean,
  sequence: number,
): SchematicEdit[] {
  const replacements = new Map<
    string,
    { endpoint: RouteEndpoint; gridLanding: { x: number; y: number } }
  >();
  const junctionEdits: SchematicEdit[] = [];
  const occupiedIds = new Set(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.layoutGroups,
      ...document.constraints,
      ...(document.drafting?.objects ?? []),
    ].map((object) => object.id),
  );
  let junctionCounter = 0;

  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      if (!matches(terminal)) continue;
      const endpoint: RouteEndpoint = { kind: "terminal", ...terminal };
      const key = endpointKey(endpoint);
      const usedByRoute = document.routes.some(
        (route) =>
          endpointKey(route.start) === key ||
          endpointKey(routeEnd(route)) === key,
      );
      if (!usedByRoute) continue;

      const connection = resolveEndpointConnection(
        document,
        resolver,
        endpoint,
      );
      if (!connection) {
        throw new Error(`Cannot preserve unresolved endpoint ${key}`);
      }
      let junctionId: string;
      do {
        junctionCounter += 1;
        junctionId = `junction-lifecycle-${sequence}-${junctionCounter}`;
      } while (occupiedIds.has(junctionId));
      occupiedIds.add(junctionId);
      replacements.set(key, {
        endpoint: { kind: "junction", junctionId },
        gridLanding: connection.gridLanding,
      });
      junctionEdits.push({
        kind: "add_junction",
        junctionId,
        netId: net.id,
        position: connection.gridLanding,
      });
    }
  }

  const routeEdits = document.routes.flatMap((route): SchematicEdit[] => {
    const routeFinal = routeEnd(route);
    const fromReplacement = replacements.get(endpointKey(route.start));
    const toReplacement = replacements.get(endpointKey(routeFinal));
    if (!fromReplacement && !toReplacement) return [];
    const from = fromReplacement?.endpoint ?? route.start;
    const to = toReplacement?.endpoint ?? routeFinal;
    const waypoints = routeBends(route);
    const segmentModes = routeModes(route);
    if (
      fromReplacement &&
      waypoints[0]?.x === fromReplacement.gridLanding.x &&
      waypoints[0]?.y === fromReplacement.gridLanding.y
    ) {
      waypoints.shift();
      segmentModes.shift();
    }
    if (
      toReplacement &&
      waypoints.at(-1)?.x === toReplacement.gridLanding.x &&
      waypoints.at(-1)?.y === toReplacement.gridLanding.y
    ) {
      waypoints.pop();
      segmentModes.pop();
    }
    return [
      {
        kind: "set_route_path",
        route: rebuildRoutePath(
          route,
          from,
          to,
          waypoints,
          segmentModes,
          `detach-${sequence}`,
        ),
      },
    ];
  });

  return [...junctionEdits, ...routeEdits];
}

function planTerminalDisconnections(
  document: SchematicDocument,
  selected: ReadonlySet<string>,
): SchematicEdit[] {
  return document.nets.flatMap((net) =>
    net.terminals
      .filter((terminal) => selected.has(terminal.instanceId))
      .map((terminal): SchematicEdit => ({
        kind: "disconnect_endpoint",
        endpoint: { kind: "terminal", ...terminal },
      })),
  );
}

function planNoConnectRemovals(
  document: SchematicDocument,
  selected: ReadonlySet<string>,
): SchematicEdit[] {
  return document.noConnects
    .filter((noConnect) => selected.has(noConnect.endpoint.instanceId))
    .map((noConnect): SchematicEdit => ({
      kind: "remove_no_connect",
      noConnectId: noConnect.id,
    }));
}

/** Every annotation that would be orphaned by deleting any selected Instance. */
export function instanceOwnedAnnotationIds(
  document: SchematicDocument,
  instanceIds: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> {
  const selected = new Set(instanceIds);
  return new Set(
    document.annotations
      .filter((annotation) => {
        if (
          annotation.anchor.kind === "object" &&
          selected.has(annotation.anchor.objectId)
        ) {
          return true;
        }
        const binding = annotation.binding;
        return (
          binding !== undefined &&
          binding.kind !== "net-name" &&
          binding.kind !== "cell-terminal-name" &&
          selected.has(binding.instanceId)
        );
      })
      .map((annotation) => annotation.id),
  );
}

function planLayoutReferenceRemoval(
  document: SchematicDocument,
  selected: ReadonlySet<string>,
): SchematicEdit[] {
  const groupEdits = document.layoutGroups.flatMap((group): SchematicEdit[] => {
    const objectIds = group.objectIds.filter((id) => !selected.has(id));
    if (objectIds.length === group.objectIds.length) return [];
    if (objectIds.length === 0) {
      return [{ kind: "remove_layout_group", groupId: group.id }];
    }
    return [{ kind: "set_layout_group", group: { ...group, objectIds } }];
  });
  const constraintEdits = document.constraints.flatMap(
    (constraint): SchematicEdit[] => {
      const objectIds = constraint.objectIds.filter((id) => !selected.has(id));
      if (objectIds.length === constraint.objectIds.length) return [];
      if (objectIds.length < 2) {
        return [
          { kind: "remove_layout_constraint", constraintId: constraint.id },
        ];
      }
      return [
        {
          kind: "set_layout_constraint",
          constraint: { ...constraint, objectIds },
        },
      ];
    },
  );
  return [...groupEdits, ...constraintEdits];
}

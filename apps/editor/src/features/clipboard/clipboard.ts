import { deriveInternalGroupSelection } from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type {
  Annotation,
  Instance,
  Net,
  NoConnect,
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  flattenRichText,
  semanticTextDocument,
  transformPoint,
} from "@icm/model";

import {
  applyOrientationOperations,
  type PlacementOrientationOperation,
} from "../../interaction/shortcut-orientation";

export interface SchematicClipboard {
  instances: Instance[];
  /**
   * Nets entirely inside the copied selection. They are duplicated (or merged
   * by name) when the copy is committed.
   */
  nets: Net[];
  /**
   * A projection of Nets that cross the selection boundary. Only terminals on
   * copied instances are retained. These Nets make the isolated preview a
   * valid document and, on paste, reconnect the copied terminals to the
   * already-existing Net instead of cloning it.
   */
  boundaryNets: Net[];
  routes: RouteBranch[];
  junctions: SchematicDocument["junctions"];
  annotations: Annotation[];
  noConnects: NoConnect[];
}

export interface PasteProposal {
  edits: SchematicEdit[];
  instanceIds: string[];
  errors: string[];
}

/**
 * Returns the stable local origin used to attach a copied subgraph to the
 * pointer. Prefer an instance origin because it is also the point designers
 * intuitively grab when duplicating a component group.
 */
export function clipboardPlacementAnchor(
  clipboard: SchematicClipboard,
): Point | null {
  const annotation = clipboard.annotations[0];
  const annotationPosition = annotation
    ? annotation.anchor.kind === "free"
      ? annotation.anchor.position
      : annotation.anchor.fallbackPosition
    : null;
  return (
    clipboard.instances.find((instance) => instance.placement)?.placement
      ?.position ??
    clipboard.junctions[0]?.position ??
    clipboard.routes[0]?.waypoints[0] ??
    annotationPosition ??
    null
  );
}

/**
 * Builds an isolated, translated formal document for the canvas-only copy
 * ghost. It never enters persistence or the edit engine; the final click still
 * uses proposePaste() below to create stable IDs and typed edits.
 */
export function clipboardPreviewDocument(
  base: SchematicDocument,
  clipboard: SchematicClipboard,
  offset: Point,
  orientationOperations: readonly PlacementOrientationOperation[] = [],
): SchematicDocument {
  const copiedInstanceIds = new Set(clipboard.instances.map(({ id }) => id));
  const annotations = clipboard.annotations.map((annotation) => {
    const preview = structuredClone(annotation);
    if (preview.anchor.kind === "free") {
      preview.anchor.position = movePoint(preview.anchor.position, offset);
    } else if ("fallbackPosition" in preview.anchor) {
      preview.anchor.fallbackPosition = movePoint(
        preview.anchor.fallbackPosition,
        offset,
      );
      if (
        preview.anchor.kind === "object" &&
        copiedInstanceIds.has(preview.anchor.objectId)
      ) {
        preview.anchor.localOffset = transformPoint(
          preview.anchor.localOffset,
          { x: 0, y: 0 },
          applyOrientationOperations(
            { rotation: 0, mirror: "none" },
            orientationOperations,
          ),
        );
      }
    }
    return preview;
  });
  return {
    ...base,
    instances: clipboard.instances.map((instance) => ({
      ...structuredClone(instance),
      placement: instance.placement
        ? {
            ...instance.placement,
            ...applyOrientationOperations(
              instance.placement,
              orientationOperations,
            ),
            position: movePoint(instance.placement.position, offset),
          }
        : null,
    })),
    nets: structuredClone([...clipboard.nets, ...clipboard.boundaryNets]),
    routes: clipboard.routes.map((route) => ({
      ...structuredClone(route),
      waypoints: route.waypoints.map((point) => movePoint(point, offset)),
    })),
    junctions: clipboard.junctions.map((junction) => ({
      ...structuredClone(junction),
      position: movePoint(junction.position, offset),
    })),
    noConnects: structuredClone(clipboard.noConnects),
    annotations,
    drafting: undefined,
  };
}

export function copySelection(
  document: SchematicDocument,
  instanceIds: readonly string[],
): SchematicClipboard | null {
  const selectedIds = new Set(instanceIds);
  const instances = document.instances.filter((instance) =>
    selectedIds.has(instance.id),
  );
  if (instances.length === 0) return null;
  const internal = deriveInternalGroupSelection(document, instanceIds);
  const netIds = new Set(internal.netIds);
  const routeIds = new Set(internal.routeIds);
  const junctionIds = new Set(internal.junctionIds);
  const attachedIds = new Set<string>([
    ...selectedIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
  ]);
  return structuredClone({
    instances,
    nets: document.nets.filter((net) => netIds.has(net.id)),
    boundaryNets: document.nets
      .filter(
        (net) =>
          !netIds.has(net.id) &&
          net.terminals.some((terminal) =>
            selectedIds.has(terminal.instanceId),
          ),
      )
      .map((net) => ({
        ...net,
        terminals: net.terminals.filter((terminal) =>
          selectedIds.has(terminal.instanceId),
        ),
      })),
    routes: document.routes.filter((route) => routeIds.has(route.id)),
    junctions: document.junctions.filter((junction) =>
      junctionIds.has(junction.id),
    ),
    annotations: document.annotations.filter(
      (annotation) =>
        (annotation.netId !== undefined && attachedIds.has(annotation.netId)) ||
        (annotation.anchor.kind === "object" &&
          attachedIds.has(annotation.anchor.objectId)) ||
        (annotation.anchor.kind === "route" &&
          routeIds.has(annotation.anchor.routeId)),
    ),
    noConnects: document.noConnects.filter(
      (noConnect) =>
        noConnect.endpoint.kind === "terminal" &&
        selectedIds.has(noConnect.endpoint.instanceId),
    ),
  });
}

function uniqueCopyId(
  sourceId: string,
  sequence: number,
  occupied: Set<string>,
): string {
  let candidate = `${sourceId}-copy-${sequence}`;
  let collision = 1;
  while (occupied.has(candidate)) {
    collision += 1;
    candidate = `${sourceId}-copy-${sequence}-${collision}`;
  }
  occupied.add(candidate);
  return candidate;
}

function uniqueCopyReference(
  sourceReference: string,
  occupied: Set<string>,
): string {
  const numbered = /^(.*?)(\d+)$/u.exec(sourceReference);
  const base = numbered?.[1] || sourceReference;
  let sequence = numbered ? Number(numbered[2]) + 1 : 1;
  let candidate = numbered ? `${base}${sequence}` : `${base}_COPY${sequence}`;
  while (occupied.has(candidate.toLowerCase())) {
    sequence += 1;
    candidate = numbered ? `${base}${sequence}` : `${base}_COPY${sequence}`;
  }
  occupied.add(candidate.toLowerCase());
  return candidate;
}

/**
 * A pasted instance whose source id equals its source reference keeps the
 * designator convention: it adopts the freshly allocated reference (copy R1
 * becomes R2) so the visible label, the id, and the netlist reference stay a
 * single fact. Anything else (custom ids, reference-less instances) falls
 * back to the opaque `-copy-N` id.
 */
function pastedInstanceId(
  source: Instance,
  nextReference: string | undefined,
  sequence: number,
  occupied: Set<string>,
): string {
  if (
    nextReference !== undefined &&
    source.id === source.netlist?.reference &&
    !occupied.has(nextReference)
  ) {
    occupied.add(nextReference);
    return nextReference;
  }
  return uniqueCopyId(source.id, sequence, occupied);
}

/**
 * Rewrites a pasted instance-label whose text is still the copied reference
 * (or copied id) to the new reference, so a pasted R1 reads R2 on canvas.
 * The replacement content is rebuilt exactly like a freshly placed label
 * (semantic base + subscript runs). Hand-edited label text is preserved
 * verbatim.
 */
function rewriteInstanceLabelText(
  annotation: Annotation,
  source: Instance | undefined,
  nextId: string,
  nextReference: string | undefined,
): void {
  if (
    source === undefined ||
    annotation.kind !== "instance-label" ||
    annotation.anchor.kind !== "object"
  ) {
    return;
  }
  const plain = flattenRichText(annotation.content);
  if (
    plain !== source.id &&
    (source.netlist === undefined || plain !== source.netlist.reference)
  ) {
    return;
  }
  annotation.content = semanticTextDocument(
    nextReference ?? nextId,
    "instance-label",
  );
}

function movePoint(point: Point, offset: Point): Point {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function mapEndpoint(
  endpoint: RouteEndpoint,
  instanceIds: ReadonlyMap<string, string>,
  junctionIds: ReadonlyMap<string, string>,
): RouteEndpoint {
  switch (endpoint.kind) {
    case "terminal":
      return {
        ...endpoint,
        instanceId: instanceIds.get(endpoint.instanceId) ?? endpoint.instanceId,
      };
    case "junction":
      return {
        ...endpoint,
        junctionId: junctionIds.get(endpoint.junctionId) ?? endpoint.junctionId,
      };
  }
}

function firstNetEndpoint(net: Net): RouteEndpoint | null {
  const terminal = net.terminals[0];
  if (terminal) return { kind: "terminal", ...terminal };
  return null;
}

export function proposePaste(
  document: SchematicDocument,
  clipboard: SchematicClipboard,
  offset: Point,
  sequence: number,
): PasteProposal {
  const occupied = new Set<string>(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.layoutGroups,
      ...document.constraints,
    ].map((object) => object.id),
  );
  const occupiedReferences = new Set(
    document.instances.flatMap((instance) =>
      instance.netlist ? [instance.netlist.reference.toLowerCase()] : [],
    ),
  );
  const instanceReferences = new Map(
    clipboard.instances.flatMap((instance) =>
      instance.netlist
        ? [
            [
              instance.id,
              uniqueCopyReference(
                instance.netlist.reference,
                occupiedReferences,
              ),
            ] as const,
          ]
        : [],
    ),
  );
  const instanceIds = new Map(
    clipboard.instances.map((instance) => [
      instance.id,
      pastedInstanceId(
        instance,
        instanceReferences.get(instance.id),
        sequence,
        occupied,
      ),
    ]),
  );
  const routeIds = new Map(
    clipboard.routes.map((route) => [
      route.id,
      uniqueCopyId(route.id, sequence, occupied),
    ]),
  );
  const junctionIds = new Map(
    clipboard.junctions.map((junction) => [
      junction.id,
      uniqueCopyId(junction.id, sequence, occupied),
    ]),
  );
  const netIds = new Map<string, string>();
  const noConnectIds = new Map(
    clipboard.noConnects.map((noConnect) => [
      noConnect.id,
      uniqueCopyId(noConnect.id, sequence, occupied),
    ]),
  );
  const existingAnchors = new Map<string, RouteEndpoint>();
  const errors: string[] = [];
  for (const net of clipboard.nets) {
    const existing = net.name
      ? document.nets.find((candidate) => candidate.name === net.name)
      : undefined;
    if (existing) {
      netIds.set(net.id, existing.id);
      const anchor = firstNetEndpoint(existing);
      if (anchor) existingAnchors.set(net.id, anchor);
    } else {
      netIds.set(net.id, uniqueCopyId(net.id, sequence, occupied));
    }
  }
  const objectIds = new Map<string, string>([
    ...instanceIds,
    ...netIds,
    ...routeIds,
    ...junctionIds,
  ]);
  const edits: SchematicEdit[] = clipboard.instances.map(
    (instance): SchematicEdit => ({
      kind: "add_instance",
      instance: {
        ...structuredClone(instance),
        id: instanceIds.get(instance.id)!,
        ...(instance.netlist
          ? {
              netlist: {
                ...structuredClone(instance.netlist),
                reference: instanceReferences.get(instance.id)!,
              },
            }
          : {}),
        ...(instance.mosBulkBinding
          ? {
              mosBulkBinding: {
                ...instance.mosBulkBinding,
                netId:
                  netIds.get(instance.mosBulkBinding.netId) ??
                  instance.mosBulkBinding.netId,
              },
            }
          : {}),
        placement: instance.placement
          ? {
              ...instance.placement,
              position: movePoint(instance.placement.position, offset),
            }
          : null,
      },
    }),
  );

  for (const net of clipboard.nets) {
    const mappedTerminals = net.terminals.map((terminal): RouteEndpoint => ({
      kind: "terminal",
      instanceId: instanceIds.get(terminal.instanceId)!,
      pinName: terminal.pinName,
    }));
    const netId = netIds.get(net.id)!;
    const existingAnchor = existingAnchors.get(net.id);
    if (existingAnchor) {
      for (const terminal of mappedTerminals) {
        edits.push({
          kind: "connect_endpoints",
          from: existingAnchor,
          to: terminal,
        });
      }
    } else if (mappedTerminals[0]) {
      edits.push({
        kind: "connect_endpoints",
        from: mappedTerminals[0],
        to: mappedTerminals[1] ?? mappedTerminals[0],
        newNetId: netId,
        ...(net.name ? { newNetName: net.name } : {}),
      });
      for (const terminal of mappedTerminals.slice(2)) {
        edits.push({
          kind: "connect_endpoints",
          from: mappedTerminals[0],
          to: terminal,
        });
      }
    }
  }
  for (const boundaryNet of clipboard.boundaryNets) {
    const target = document.nets.find(
      (candidate) => candidate.id === boundaryNet.id,
    );
    const anchor = target ? firstNetEndpoint(target) : null;
    if (!anchor) {
      errors.push(
        `Cannot paste: external Net ${boundaryNet.name ?? boundaryNet.id} is no longer available`,
      );
      continue;
    }
    for (const terminal of boundaryNet.terminals) {
      const instanceId = instanceIds.get(terminal.instanceId);
      if (!instanceId) continue;
      edits.push({
        kind: "connect_endpoints",
        from: anchor,
        to: { kind: "terminal", instanceId, pinName: terminal.pinName },
      });
    }
  }
  edits.push(
    ...clipboard.noConnects.map((noConnect): SchematicEdit => {
      if (noConnect.endpoint.kind !== "terminal") {
        throw new Error("Clipboard NoConnect must target a copied terminal");
      }
      return {
        kind: "add_no_connect",
        noConnect: {
          id: noConnectIds.get(noConnect.id)!,
          endpoint: {
            kind: "terminal",
            instanceId: instanceIds.get(noConnect.endpoint.instanceId)!,
            pinName: noConnect.endpoint.pinName,
          },
        },
      };
    }),
  );
  edits.push(
    ...clipboard.junctions.map((junction): SchematicEdit => ({
      kind: "add_junction",
      junctionId: junctionIds.get(junction.id)!,
      netId: netIds.get(junction.netId)!,
      position: movePoint(junction.position, offset),
    })),
  );
  edits.push(
    ...clipboard.routes.map((route): SchematicEdit => ({
      kind: "set_route_points",
      routeId: routeIds.get(route.id)!,
      netId: netIds.get(route.netId)!,
      from: mapEndpoint(route.from, instanceIds, junctionIds),
      to: mapEndpoint(route.to, instanceIds, junctionIds),
      waypoints: route.waypoints.map((point) => movePoint(point, offset)),
      segmentModes: [...route.segmentModes],
      ...(route.presentation ? { presentation: route.presentation } : {}),
    })),
  );
  const sourceInstancesById = new Map(
    clipboard.instances.map((instance) => [instance.id, instance]),
  );
  edits.push(
    ...clipboard.annotations.map((annotation): SchematicEdit => {
      const clone = structuredClone(annotation);
      if (clone.anchor.kind === "object") {
        rewriteInstanceLabelText(
          clone,
          sourceInstancesById.get(clone.anchor.objectId),
          objectIds.get(clone.anchor.objectId) ?? clone.anchor.objectId,
          instanceReferences.get(clone.anchor.objectId),
        );
      }
      return {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...clone,
          id: uniqueCopyId(annotation.id, sequence, occupied),
          ...(annotation.netId
            ? { netId: netIds.get(annotation.netId) ?? annotation.netId }
            : {}),
          anchor:
            annotation.anchor.kind === "free"
              ? {
                  kind: "free",
                  position: movePoint(annotation.anchor.position, offset),
                }
              : annotation.anchor.kind === "object"
                ? {
                    ...annotation.anchor,
                    objectId:
                      objectIds.get(annotation.anchor.objectId) ??
                      annotation.anchor.objectId,
                    fallbackPosition: movePoint(
                      annotation.anchor.fallbackPosition,
                      offset,
                    ),
                  }
                : {
                    ...annotation.anchor,
                    routeId:
                      routeIds.get(annotation.anchor.routeId) ??
                      annotation.anchor.routeId,
                    fallbackPosition: movePoint(
                      annotation.anchor.fallbackPosition,
                      offset,
                    ),
                  },
        },
      };
    }),
  );
  return { edits, instanceIds: [...instanceIds.values()], errors };
}

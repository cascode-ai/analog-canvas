import type {
  CircuitProject,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";

export { instanceLabelAnnotationFor } from "../features/instance-display/default-instance-display";

export function endpointTestId(endpoint: RouteEndpoint): string {
  switch (endpoint.kind) {
    case "terminal":
      return `terminal-${endpoint.instanceId}-${endpoint.pinName}`;
    case "junction":
      return `junction-${endpoint.junctionId}`;
  }
}

export function occupiedDocumentObjectIds(
  document: SchematicDocument,
): Set<string> {
  const occupied = new Set<string>();
  for (const items of [
    document.instances,
    document.instanceGroups ?? [],
    document.nets,
    document.routes,
    document.junctions,
    document.noConnects,
    document.annotations,
    document.connectivityEvidence,
    document.layoutGroups,
    document.constraints,
    document.inductorCouplings ?? [],
    document.netlist?.terminals ?? [],
    document.drafting?.objects ?? [],
  ]) {
    for (const item of items) occupied.add(item.id);
  }
  for (const route of document.routes) {
    for (const leg of route.legs) {
      occupied.add(leg.id);
      if (leg.to.kind === "bend") occupied.add(leg.to.bendId);
    }
  }
  return occupied;
}

function maxTrailingSuffix(ids: Iterable<string>): number {
  let maximum = 0;
  for (const id of ids) {
    const match = /-(\d{1,9})$/u.exec(id);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum;
}

/**
 * Allocate the next `<prefix>-<n>` object ID that does not collide with any
 * existing object ID in `document`, advancing `counter` monotonically.
 * Prevents upserts (new Rect boxes, Rect labels, arrows, lines, annotations)
 * from silently overwriting previously saved or copied objects (#2485).
 */
export function nextDocumentObjectId(
  document: SchematicDocument,
  prefix: string,
  counter: { current: number },
): string {
  const occupied = occupiedDocumentObjectIds(document);
  let candidate: string;
  do {
    counter.current += 1;
    candidate = `${prefix}-${counter.current}`;
  } while (occupied.has(candidate));
  return candidate;
}

/** Allocate the next unique positive suffix above all trailing suffixes in `document`. */
export function nextDocumentUniqueSuffix(
  document: SchematicDocument,
  counter: { current: number },
): number {
  const next =
    Math.max(
      counter.current,
      maxTrailingSuffix(occupiedDocumentObjectIds(document)),
    ) + 1;
  counter.current = next;
  return next;
}

/** Allocate the next unique positive suffix above all trailing suffixes across `project`. */
export function nextProjectUniqueSuffix(
  project: CircuitProject,
  counter: { current: number },
): number {
  let maximum = counter.current;
  for (const document of project.documents) {
    maximum = Math.max(
      maximum,
      maxTrailingSuffix([document.id, ...occupiedDocumentObjectIds(document)]),
    );
  }
  counter.current = maximum + 1;
  return counter.current;
}

export function maxRoutingCounter(document: SchematicDocument): number {
  let maximum = 0;
  for (const id of occupiedDocumentObjectIds(document)) {
    for (const match of id.matchAll(/(?:^|-)(?:ui|land)-(\d{1,9})(?=$|-)/gu)) {
      maximum = Math.max(maximum, Number(match[1]));
    }
  }
  return maximum;
}

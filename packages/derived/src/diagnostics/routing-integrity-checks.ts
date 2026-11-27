import { deviceDescriptor } from "@icm/devices";
import { routeEnd } from "@icm/model";
import type { CircuitProject } from "@icm/model";
import { variantHiddenPinNames, type SymbolResolver } from "@icm/symbols";

import type { RoutedComponent } from "../connectivity.js";
import type { ProjectConnectivityIndex } from "../connectivity-index.js";
import {
  annotationNetId,
  buildTerminalBaseNetMap,
  logicalNetIdsOf,
  memberNetIds,
  terminalPinKey,
  visibleDocumentAnnotations,
} from "../document-read-helpers.js";
import { endpointKey, resolveEndpointPoint } from "../endpoint.js";
import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import { resolveDocumentRoutingGeometry } from "../resolved-route-geometry.js";
import { findRouteSegmentsAtPoint } from "../route-query.js";
import { supplyMarkerForSymbol } from "../supply-marker.js";
import type { ErcDiagnostic } from "./erc.js";
import { terminalLocator } from "./erc-shared.js";

type Document = CircuitProject["documents"][number];
type DocIndex = ReturnType<ProjectConnectivityIndex["documents"]["get"]>;
type LogicalNets = ReturnType<typeof resolveDocumentLogicalNets>;

/**
 * A drawn piece of a Net that nothing on the sheet joins to the rest: no wire
 * reaches the other pieces, and the piece carries no name of its own (a label,
 * a supply marker, a Cell Pin or a net marker) that would join it by name.
 * Only the stored membership holds it in the Net, so the drawing and the
 * netlist disagree: a bundled example once exported its two drawn tail nodes
 * as ground this way (#1275). Pieces that touch on the sheet (a wire end or
 * pin lying on another piece's wire) look joined and count as one. Pins
 * drawn on no wire at all are ERC_UNCONNECTED_PIN's, and imported topology
 * the editor already shows with routing guides is left alone.
 */
export function reportNetPiecesJoinedOnlyInData(
  document: Document,
  docIndex: DocIndex,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  if (!docIndex || document.routes.length === 0) return;
  const namingInstanceIds = new Set<string>([
    ...(document.netlist?.terminals.flatMap(
      (terminal) => terminal.interfaceInstanceIds,
    ) ?? []),
    ...document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "name-claim" && evidence.owner.kind === "power-marker"
        ? [evidence.owner.objectId]
        : [],
    ),
    ...document.instances
      .filter(
        (instance) =>
          supplyMarkerForSymbol(instance.symbolId) !== undefined ||
          deviceDescriptor(instance.symbolId)?.deviceClass === "net-marker",
      )
      .map((instance) => instance.id),
  ]);
  const railRouteIds = new Set(
    document.routes
      .filter((route) => route.presentation === "power-rail")
      .map((route) => route.id),
  );
  const references = new Map(
    document.instances.map((instance) => [
      instance.id,
      instance.reference ?? instance.id,
    ]),
  );
  for (const record of docIndex.logicalNets.values()) {
    if (record.routingGuidance.length > 0) continue;
    const pieces = record.routedComponents;
    if (pieces.length < 2) continue;
    // Where the Net's labels sit: the Route or endpoint each one names.
    const labelled = new Set<string>();
    for (const baseNetId of record.baseNetIds)
      for (const binding of docIndex.netLabelBindingsByNetId.get(baseNetId) ??
        []) {
        if (binding.routeId) labelled.add(`route:${binding.routeId}`);
        labelled.add(endpointKey(binding.endpoint));
      }
    const named = (piece: RoutedComponent): boolean =>
      piece.routes.some(
        (routeId) =>
          railRouteIds.has(routeId) || labelled.has(`route:${routeId}`),
      ) ||
      piece.nodes.some(
        (node) =>
          labelled.has(node.key) ||
          (node.endpoint.kind === "terminal" &&
            namingInstanceIds.has(node.endpoint.instanceId)),
      );
    // Pieces that touch on the sheet are drawn together.
    const group = pieces.map((_, index) => index);
    const root = (index: number): number => {
      while (group[index] !== index) index = group[index]!;
      return index;
    };
    const pieceOfRoute = new Map<string, number>();
    const pieceOfNode = new Map<string, number>();
    pieces.forEach((piece, index) => {
      for (const routeId of piece.routes) pieceOfRoute.set(routeId, index);
      for (const node of piece.nodes) pieceOfNode.set(node.key, index);
    });
    for (const baseNetId of record.baseNetIds)
      for (const contact of docIndex.contactsByNetId.get(baseNetId) ?? []) {
        const touched = [
          ...contact.endpoints.map((endpoint) =>
            pieceOfNode.get(endpointKey(endpoint)),
          ),
          ...contact.incidents.map((incident) =>
            incident.kind === "route"
              ? pieceOfRoute.get(incident.objectId)
              : undefined,
          ),
        ].filter((index): index is number => index !== undefined);
        for (const index of touched.slice(1)) {
          const [left, right] = [root(touched[0]!), root(index)];
          if (left !== right)
            group[Math.max(left, right)] = Math.min(left, right);
        }
      }
    const groups = new Map<number, RoutedComponent[]>();
    pieces.forEach((piece, index) =>
      groups.set(root(index), [...(groups.get(root(index)) ?? []), piece]),
    );
    if (groups.size < 2) continue;
    const name = logicalNets.byId.get(record.netId)?.name;
    for (const drawn of groups.values()) {
      if (drawn.some(named)) continue;
      const piece = drawn.find((candidate) => candidate.routes.length > 0);
      if (!piece) continue;
      const pins = drawn.flatMap((member) =>
        member.nodes.flatMap((node) =>
          node.endpoint.kind === "terminal" ? [node.endpoint] : [],
        ),
      );
      const pinText = pins
        .map(
          (pin) =>
            `${references.get(pin.instanceId) ?? pin.instanceId}.${pin.pinName}`,
        )
        .join(", ");
      diagnostics.push({
        id: `erc:net-joined-only-in-data:${document.id}:${piece.id}`,
        domain: "erc",
        code: "ERC_NET_JOINED_ONLY_IN_DATA",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: `A drawn part of Net ${name ?? record.netId}${pinText ? ` (${pinText})` : ""} is joined to the rest of it only in the data: no wire or name on the sheet joins them. Draw the connection, name that part, or give it its own Net`,
        primary: directObjectLocator(document.id, "route", piece.routes[0]!),
        related: pins.map((pin) =>
          terminalLocator(document.id, pin.instanceId, pin.pinName),
        ),
        parameters: { netId: record.netId, pieceId: piece.id },
      });
    }
  }
}

/**
 * A wire that ends in the open: at a Junction only that one wire reaches, with
 * no pin, other wire or label there. It is usually what is left of a deleted
 * part or a cut, and it connects nothing. A Power Rail's ends and a wire whose
 * end or run carries a label are drawn that way on purpose and stay silent.
 */
export function reportDanglingWires(
  document: Document,
  docIndex: DocIndex,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  const routesByJunction = new Map<string, Document["routes"]>();
  for (const route of document.routes)
    for (const endpoint of [route.start, routeEnd(route)])
      if (endpoint.kind === "junction")
        routesByJunction.set(endpoint.junctionId, [
          ...(routesByJunction.get(endpoint.junctionId) ?? []),
          route,
        ]);
  // A Junction standing on a pin is a contact, not an open end: the shared
  // contact evidence joins the two endpoints and the Netlist's terminal
  // membership connects the pin. Counting Route arms alone (#2357) reported
  // that wire as ending in the open and invited deleting it.
  const contactedJunctions = new Set<string>();
  for (const contact of docIndex?.contactEvidence.contacts ?? [])
    if (contact.endpoints.length > 1)
      for (const endpoint of contact.endpoints)
        if (endpoint.kind === "junction")
          contactedJunctions.add(endpoint.junctionId);
  const geometry =
    document.routes.length < 2
      ? undefined
      : (docIndex?.routingGeometry ??
        resolveDocumentRoutingGeometry(document, resolver));
  const routeById =
    docIndex?.routesById && docIndex.routesById.size === document.routes.length
      ? docIndex.routesById
      : new Map(document.routes.map((route) => [route.id, route]));
  const visibleAnnotations = visibleDocumentAnnotations(document);
  const labelledObjects = new Set(
    visibleAnnotations.flatMap((annotation) =>
      annotation.anchor.kind === "object"
        ? [annotation.anchor.objectId]
        : annotation.anchor.kind === "route"
          ? [annotation.anchor.routeId]
          : [],
    ),
  );
  for (const evidence of document.connectivityEvidence)
    if (
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker"
    )
      labelledObjects.add(evidence.owner.objectId);
  // A Net Label dragged off its wire keeps naming the stub it stands at
  // (#1300): a free label of the open end's Net within a few grid steps of
  // it counts as that wire's label.
  const reach = document.presentation.grid * 4;
  const freeLabels = visibleAnnotations.flatMap((annotation) => {
    if (
      (annotation.kind !== "net-label" && annotation.kind !== "power-label") ||
      annotation.anchor.kind !== "free"
    )
      return [];
    const netId = annotationNetId(annotation);
    return netId ? [{ netId, position: annotation.anchor.position }] : [];
  });
  for (const junction of [...document.junctions].sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  )) {
    const routes = routesByJunction.get(junction.id) ?? [];
    if (routes.length !== 1) continue;
    const route = routes[0]!;
    if (
      route.presentation === "power-rail" ||
      contactedJunctions.has(junction.id) ||
      labelledObjects.has(junction.id) ||
      labelledObjects.has(route.id) ||
      freeLabels.some(
        (label) =>
          label.netId === junction.netId &&
          Math.hypot(
            label.position.x - junction.position.x,
            label.position.y - junction.position.y,
          ) <= reach,
      )
    )
      continue;
    // A Junction standing on another Route of the same Logical Net (such as a
    // `bulk-dashed` body tap onto a solid wire kept unsplit by normalization,
    // or a tap onto a Power Rail) joins that conductor rather than ending open.
    // For multi-bit bus Junctions, every member Logical Net must be met there.
    const junctionLogicalIds = logicalNetIdsOf(
      memberNetIds(junction),
      logicalNets,
    );
    if (geometry !== undefined && junctionLogicalIds.size > 0) {
      const coveredLogicalIds = new Set<string>();
      for (const address of findRouteSegmentsAtPoint(
        geometry,
        junction.position,
        docIndex?.spatialIndex,
      )) {
        if (address.routeId === route.id) continue;
        const other = routeById.get(address.routeId);
        if (!other) continue;
        for (const logicalId of logicalNetIdsOf(
          memberNetIds(other),
          logicalNets,
        ))
          coveredLogicalIds.add(logicalId);
      }
      if ([...junctionLogicalIds].every((id) => coveredLogicalIds.has(id)))
        continue;
    }
    diagnostics.push({
      id: `erc:dangling-wire:${document.id}:${junction.id}`,
      domain: "erc",
      code: "ERC_DANGLING_WIRE",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Wire ${route.id} ends in the open at Junction ${junction.id}: no pin, other wire or label is there`,
      primary: directObjectLocator(document.id, "junction", junction.id),
      related: [directObjectLocator(document.id, "route", route.id)],
      parameters: { routeId: route.id, junctionId: junction.id },
    });
  }
}

/**
 * A pin the picture shows as wired while the model says it is not: its contact
 * point sits exactly on another Net's wire or Junction dot, or on another
 * part's pin that is not on its Net.
 *
 * Drawing geometry never creates a connection, and a Crossing is not a
 * Junction — so nothing repairs this and nothing else reports it. To the
 * author the wire or pin visibly reaches the pin; to the netlist the pin is on
 * nothing, or on a different Net entirely, and a copy of the drawing, which
 * joins the pins it lands together, reads differently. Only terminals are
 * judged: two Routes crossing is the ordinary, deliberate case the model
 * already names.
 */
export function reportPinsTouchingAnotherNet(
  document: Document,
  docIndex: DocIndex,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  if (document.instances.length === 0) return;
  const geometry =
    document.routes.length === 0
      ? undefined
      : (docIndex?.routingGeometry ??
        resolveDocumentRoutingGeometry(document, resolver));
  const routeById =
    docIndex?.routesById && docIndex.routesById.size === document.routes.length
      ? docIndex.routesById
      : new Map(document.routes.map((route) => [route.id, route]));
  const netIdsByTerminalKey = buildTerminalBaseNetMap(document);
  const declaredOpen = new Set(
    document.noConnects.flatMap((item) =>
      item.endpoint.kind === "terminal"
        ? [terminalPinKey(item.endpoint.instanceId, item.endpoint.pinName)]
        : [],
    ),
  );
  const pinsAtPoint = new Map<
    string,
    {
      instanceId: string;
      pinName: string;
      netId: string | undefined;
      logicalIds: ReadonlySet<string>;
    }[]
  >();
  const endpointLookup =
    docIndex &&
    docIndex.instancesById.size === document.instances.length &&
    docIndex.junctionsById.size === document.junctions.length
      ? {
          instancesById: docIndex.instancesById,
          junctionsById: docIndex.junctionsById,
          logicalNets,
        }
      : undefined;

  for (const instance of [...document.instances].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  )) {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const hidden = variantHiddenPinNames(resolved.variant);
    for (const pin of resolved.definition.pins) {
      if (hidden.has(pin.name)) continue;
      const key = terminalPinKey(instance.id, pin.name);
      // An author who marked the pin open has already answered for it.
      if (declaredOpen.has(key)) continue;
      const point = resolveEndpointPoint(
        document,
        resolver,
        {
          kind: "terminal",
          instanceId: instance.id,
          pinName: pin.name,
        },
        endpointLookup?.instancesById.get(instance.id) === instance
          ? endpointLookup
          : undefined,
      );
      if (!point) continue;
      const pinNetIds = netIdsByTerminalKey.get(key);
      const pinLogicalIds = logicalNetIdsOf(pinNetIds ?? [], logicalNets);
      const at = `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;
      const here = pinsAtPoint.get(at) ?? [];
      here.push({
        instanceId: instance.id,
        pinName: pin.name,
        netId: pinNetIds ? [...pinNetIds][0] : undefined,
        logicalIds: pinLogicalIds,
      });
      pinsAtPoint.set(at, here);
      if (!geometry) continue;
      const foreign = findRouteSegmentsAtPoint(
        geometry,
        point,
        docIndex?.spatialIndex,
      ).flatMap((address) => {
        const route = routeById.get(address.routeId);
        if (!route) return [];
        const routeLogicalIds = logicalNetIdsOf(
          memberNetIds(route),
          logicalNets,
        );
        const sharesLogicalNet = [...routeLogicalIds].some((id) =>
          pinLogicalIds.has(id),
        );
        return routeLogicalIds.size > 0 && !sharesLogicalNet
          ? [{ route, netId: route.netId }]
          : [];
      });
      const first = foreign[0];
      if (!first) continue;
      diagnostics.push({
        id: `erc:touching-not-connected:${document.id}:${instance.id}:${pin.name}`,
        domain: "erc",
        code: "ERC_TOUCHING_NOT_CONNECTED",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: supplyMarkerForSymbol(instance.symbolId)
          ? `Supply marker ${instance.reference ?? instance.id} sits on a wire of Net ${first.netId} without being joined to it, so that wire does not get its supply; join the marker's pin to the wire`
          : pinLogicalIds.size > 0
            ? `Pin ${instance.id}.${pin.name} sits on a wire of Net ${first.netId} but belongs to a different Net`
            : `Pin ${instance.id}.${pin.name} sits on a wire of Net ${first.netId} without being connected to it`,
        primary: terminalLocator(document.id, instance.id, pin.name),
        related: [
          directObjectLocator(document.id, "route", first.route.id),
          directObjectLocator(document.id, "net", first.netId),
        ],
        parameters: {
          instanceId: instance.id,
          pinName: pin.name,
          routeId: first.route.id,
          netId: first.netId,
        },
      });
    }
  }

  // Two parts' pins on one point read as joined. Unless they share a Logical
  // Net, the netlist keeps them apart (often leaving one a dangling node), so
  // each such pair is reported once. Pins on one Net, such as two Ground
  // markers, are the ordinary case.
  for (const pins of pinsAtPoint.values()) {
    for (let index = 0; index < pins.length; index += 1) {
      for (let other = index + 1; other < pins.length; other += 1) {
        const first = pins[index]!;
        const second = pins[other]!;
        if (first.instanceId === second.instanceId) continue;
        if ([...first.logicalIds].some((id) => second.logicalIds.has(id)))
          continue;
        const firstName = `${first.instanceId}.${first.pinName}`;
        const secondName = `${second.instanceId}.${second.pinName}`;
        diagnostics.push({
          id: `erc:touching-pin-not-connected:${document.id}:${first.instanceId}:${first.pinName}:${second.instanceId}:${second.pinName}`,
          domain: "erc",
          code: "ERC_TOUCHING_NOT_CONNECTED",
          severity: "warning",
          confidence: "high",
          gateEligible: false,
          message:
            first.logicalIds.size > 0 && second.logicalIds.size > 0
              ? `Pins ${firstName} and ${secondName} sit on one point but belong to different Nets`
              : `Pins ${firstName} and ${secondName} sit on one point without being connected`,
          primary: terminalLocator(
            document.id,
            first.instanceId,
            first.pinName,
          ),
          related: [
            terminalLocator(document.id, second.instanceId, second.pinName),
            ...[first.netId, second.netId].flatMap((netId) =>
              netId ? [directObjectLocator(document.id, "net", netId)] : [],
            ),
          ],
          parameters: {
            instanceId: first.instanceId,
            pinName: first.pinName,
            otherInstanceId: second.instanceId,
            otherPinName: second.pinName,
          },
        });
      }
    }
  }
}

/**
 * Two wires of different Nets drawn along one line over a common span
 * (#1309). The drawing shows one continuous wire, the two Nets joined, while
 * the netlist keeps them apart: a stretch after a move, a mirror or a pin
 * change, such as swapped op-amp inputs, can leave them so. A crossing and
 * two wires meeting end to end are not an overlap; wires of one Logical Net
 * may share a trunk. Reported once for each pair of wires.
 */
export function reportWiresOverlappingAnotherNet(
  document: Document,
  docIndex: DocIndex,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  if (document.routes.length < 2) return;
  const geometry =
    docIndex?.routingGeometry ??
    resolveDocumentRoutingGeometry(document, resolver);
  const logicalOf = (netId: string) =>
    logicalNets.byBaseNetId.get(netId) ?? null;
  interface Span {
    routeId: string;
    netId: string;
    logicalId: string;
    start: number;
    end: number;
  }
  // Each segment by the line it lies on: its direction, taken one way round,
  // and its distance from the origin across that direction.
  const lines = new Map<
    string,
    { unit: { x: number; y: number }; offset: number; spans: Span[] }
  >();
  for (const route of document.routes) {
    const centerline = geometry.routes.get(route.id)?.centerline;
    if (!centerline) continue;
    const logicalId = logicalOf(route.netId)?.id ?? route.netId;
    for (let index = 1; index < centerline.length; index += 1) {
      const a = centerline[index - 1]!;
      const b = centerline[index]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-6) continue;
      let unit = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      if (unit.x < -1e-9 || (Math.abs(unit.x) <= 1e-9 && unit.y < 0))
        unit = { x: -unit.x, y: -unit.y };
      const offset = unit.x * a.y - unit.y * a.x;
      const key = `${Math.round(unit.x * 1e6)}:${Math.round(unit.y * 1e6)}:${Math.round(offset * 1e3)}`;
      const along = (point: { x: number; y: number }) =>
        unit.x * point.x + unit.y * point.y;
      const line = lines.get(key) ?? { unit, offset, spans: [] };
      line.spans.push({
        routeId: route.id,
        netId: route.netId,
        logicalId,
        start: Math.min(along(a), along(b)),
        end: Math.max(along(a), along(b)),
      });
      lines.set(key, line);
    }
  }
  const reported = new Set<string>();
  for (const { unit, offset, spans } of lines.values()) {
    if (spans.length < 2) continue;
    spans.sort(
      (left, right) =>
        left.start - right.start ||
        left.routeId.localeCompare(right.routeId, "en"),
    );
    for (let index = 0; index < spans.length; index += 1) {
      const left = spans[index]!;
      for (
        let other = index + 1;
        other < spans.length && spans[other]!.start < left.end - 0.5;
        other += 1
      ) {
        const right = spans[other]!;
        if (left.logicalId === right.logicalId) continue;
        const end = Math.min(left.end, right.end);
        if (end - right.start <= 0.5) continue;
        const [first, second] = [left, right].sort((a, b) =>
          a.routeId.localeCompare(b.routeId, "en"),
        ) as [Span, Span];
        const pair = `${first.routeId}\u0000${second.routeId}`;
        if (reported.has(pair)) continue;
        reported.add(pair);
        const at = (t: number) => ({
          x: Math.round((t * unit.x - offset * unit.y) * 1000) / 1000,
          y: Math.round((t * unit.y + offset * unit.x) * 1000) / 1000,
        });
        const from = at(right.start);
        const to = at(end);
        const name = (span: Span) => logicalOf(span.netId)?.name ?? span.netId;
        diagnostics.push({
          id: `erc:overlapping-nets:${document.id}:${first.routeId}:${second.routeId}`,
          domain: "erc",
          code: "ERC_OVERLAPPING_NETS",
          severity: "error",
          confidence: "high",
          gateEligible: false,
          message: `Wires ${first.routeId} (Net ${name(first)}) and ${second.routeId} (Net ${name(second)}) run on top of each other from (${from.x}, ${from.y}) to (${to.x}, ${to.y}): the drawing shows the two Nets joined, though the netlist keeps them apart. Move one wire off the other`,
          primary: directObjectLocator(document.id, "route", first.routeId),
          related: [
            directObjectLocator(document.id, "route", second.routeId),
            directObjectLocator(document.id, "net", first.netId),
            directObjectLocator(document.id, "net", second.netId),
          ],
          parameters: {
            routeId: first.routeId,
            otherRouteId: second.routeId,
            netId: first.netId,
            otherNetId: second.netId,
            fromX: from.x,
            fromY: from.y,
            toX: to.x,
            toY: to.y,
          },
        });
      }
    }
  }
}

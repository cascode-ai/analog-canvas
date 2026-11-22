import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
  AgentCommandPlanNote,
} from "@icm/agent-adapter";
import {
  gateRoutingOperationPlan,
  planRouteNet,
  planRoutingTransform,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveDocumentContactEvidence,
  deriveNetConnectivity,
  endpointKey,
  isVisibleEndpoint,
  pointOnSegment,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  resolveEndpointPoint,
  resolveRouteGeometry,
  resolveVisualAnchor,
} from "@icm/derived";
import {
  inverseTransformPoint,
  routeEnd,
  routeElectricalConnections,
  transformPoint,
  type Annotation,
  type CircuitProject,
  type Instance,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { withStruckLabelsArranged } from "../features/instance-display/struck-label-arrangement";
import { dragNetLabelAttachmentAtPoint } from "../features/wiring/route-interaction-geometry";
import {
  DraftSteps,
  netMembership,
  pinsOnChangedNets,
  spiceNetlist,
} from "./draft-steps";
import { markersOnPinsOnly } from "./property-command";
import { instanceNamed } from "./selection-deletion-command";

type Relocate = Extract<AgentAuthoringCommand, { kind: "relocate" }>;
type Placement = NonNullable<Instance["placement"]>;

const NOTHING = "nothing was moved";

const nameOf = (instance: Instance) => instance.reference ?? instance.id;

const sign = (value: number) => Math.sign(Math.round(value * 1000));
const sameDirection = (a: Point, b: Point) =>
  sign(a.x) === sign(b.x) && sign(a.y) === sign(b.y);

/** Turn `vector` by `quarter` quarter turns, as the page draws them. */
function turned(vector: Point, quarter: number): Point {
  let { x, y } = vector;
  for (let step = 0; step < quarter; step += 1) [x, y] = [-y, x];
  return { x: x + 0, y: y + 0 };
}

/**
 * How a vector from a pin turns when the part goes from one orientation to
 * another: the old orientation undone, the new one applied, mirror included.
 * The pin's own outward direction is the check; should the part's frame not
 * carry it there, the quarter turns that do are used instead.
 */
function pinFrame(
  from: Placement,
  to: Placement,
  was: Point | null,
  now: Point | null,
): (vector: Point) => Point {
  const origin = { x: 0, y: 0 };
  const reframed = (vector: Point) => {
    const point = transformPoint(
      inverseTransformPoint(vector, origin, from),
      origin,
      to,
    );
    return { x: Math.round(point.x) + 0, y: Math.round(point.y) + 0 };
  };
  if (!was || !now || sameDirection(reframed(was), now)) return reframed;
  for (let quarter = 0; quarter < 4; quarter += 1)
    if (sameDirection(turned(was, quarter), now))
      return (vector) => turned(vector, quarter);
  return (vector) => vector;
}

/**
 * Wires and Junctions hanging from one pin alone, reaching no other pin: a
 * stub, often carrying the pin's Net label. It goes with its pin.
 */
interface Stub {
  pin: Extract<RouteEndpoint, { kind: "terminal" }>;
  routeIds: string[];
  junctionIds: string[];
}

/**
 * Move and turn parts, then draw their wires again with route-net, so every
 * Net keeps exactly the pins it had (#2429 follow-up). In steps on a draft:
 * the labels on the wires that go stand free; those wires go, each pin
 * keeping its Net; the parts move with the markers standing on their pins and
 * the stubs hanging from them; each conductor taken apart is joined again;
 * the labels stand on its new wires. The netlist and every pin's Net are
 * then compared with the start; any difference refuses the whole command.
 */
export function planRelocate(
  project: CircuitProject,
  documentId: string,
  resolver: SymbolResolver,
  command: Relocate,
): AgentCommandPlan {
  const document = project.documents.find((item) => item.id === documentId)!;
  const parts = command.parts.map((entry) => {
    const instance = instanceNamed(document, entry.instance, NOTHING);
    if (!instance.placement)
      throw new Error(
        `${nameOf(instance)} is not placed; place it first; ${NOTHING}`,
      );
    return {
      instance,
      placement: {
        position: entry.position,
        rotation: entry.rotation ?? instance.placement.rotation,
        mirror: entry.mirror ?? instance.placement.mirror,
      } satisfies Placement,
    };
  });
  const relocated = new Map(parts.map((part) => [part.instance.id, part]));
  if (relocated.size !== parts.length)
    throw new Error(`each part may be named once; ${NOTHING}`);
  const changed = parts.filter(
    ({ instance, placement }) =>
      instance.placement!.position.x !== placement.position.x ||
      instance.placement!.position.y !== placement.position.y ||
      instance.placement!.rotation !== placement.rotation ||
      instance.placement!.mirror !== placement.mirror,
  );
  if (!changed.length) return { edits: [] };

  // Where the parts' pins will be, read off the Cell with them there.
  const placed: SchematicDocument = {
    ...document,
    instances: document.instances.map((item) => {
      const part = relocated.get(item.id);
      return part ? { ...item, placement: part.placement } : item;
    }),
  };
  const carried = parts.flatMap(({ instance }) =>
    markersOnPinsOnly(document, resolver, instance)
      .filter(({ marker }) => !relocated.has(marker.id))
      .map((entry) => ({ ...entry, part: instance })),
  );

  // The conductors as drawn: pins, wires, Junctions and direct contacts.
  const endpoints = new Map<string, RouteEndpoint>();
  const neighbours = new Map<string, { key: string; routeId?: string }[]>();
  const remember = (endpoint: RouteEndpoint) => {
    const key = endpointKey(endpoint);
    if (!endpoints.has(key)) endpoints.set(key, endpoint);
    return key;
  };
  const link = (from: string, to: string, routeId?: string) => {
    for (const [a, b] of [
      [from, to],
      [to, from],
    ] as const) {
      const list = neighbours.get(a) ?? [];
      list.push({ key: b, ...(routeId ? { routeId } : {}) });
      neighbours.set(a, list);
    }
  };
  for (const route of document.routes)
    for (const edge of routeElectricalConnections(route))
      link(remember(edge.endpoints[0]), remember(edge.endpoints[1]), route.id);
  for (const contact of deriveDocumentContactEvidence(document, resolver)
    .contacts) {
    const [first, ...rest] = contact.endpoints.map(remember);
    for (const key of rest) link(first!, key);
  }
  const isRelocatedPin = (endpoint: RouteEndpoint) =>
    endpoint.kind === "terminal" && relocated.has(endpoint.instanceId);

  // Every wire ending on a relocated pin goes, but for stubs.
  const removed = new Set<string>();
  const stubs: Stub[] = [];
  for (const route of document.routes) {
    const ends = [route.start, routeEnd(route)];
    const pin = ends.find(isRelocatedPin);
    if (!pin || pin.kind !== "terminal") continue;
    const label = `${relocated.get(pin.instanceId)!.instance.reference ?? pin.instanceId}.${pin.pinName}`;
    if (route.members)
      throw new Error(
        `the bus wire ${route.id} on ${label} cannot be redrawn; move it by hand; ${NOTHING}`,
      );
    if (route.presentation === "power-rail")
      throw new Error(
        `the Power Rail ${route.id} ends on ${label}; move the rail first; ${NOTHING}`,
      );
    const other = ends.find((end) => end !== pin)!;
    const stub = other.kind === "junction" ? stubFrom(route.id, other) : null;
    if (stub) stubs.push({ pin, ...stub });
    else removed.add(route.id);
  }
  /** The wires and Junctions past `from`, if they reach no other pin. */
  function stubFrom(
    routeId: string,
    from: RouteEndpoint,
  ): Omit<Stub, "pin"> | null {
    const routeIds = new Set([routeId]);
    const junctionIds = new Set<string>();
    const seen = new Set([endpointKey(from)]);
    const pending = [endpointKey(from)];
    while (pending.length) {
      const key = pending.pop()!;
      const endpoint = endpoints.get(key)!;
      if (endpoint.kind === "terminal") return null;
      junctionIds.add(endpoint.junctionId);
      for (const next of neighbours.get(key) ?? []) {
        if (next.routeId === routeId) continue;
        if (next.routeId) routeIds.add(next.routeId);
        if (seen.has(next.key)) continue;
        seen.add(next.key);
        pending.push(next.key);
      }
    }
    return { routeIds: [...routeIds], junctionIds: [...junctionIds] };
  }

  // The conductors a relocated pin belongs to, each to be joined again.
  const conductorOf = new Map<string, number>();
  const conductors: string[][] = [];
  for (const key of endpoints.keys()) {
    if (conductorOf.has(key)) continue;
    const members: string[] = [];
    const pending = [key];
    conductorOf.set(key, conductors.length);
    while (pending.length) {
      const next = pending.pop()!;
      members.push(next);
      for (const neighbour of neighbours.get(next) ?? [])
        if (!conductorOf.has(neighbour.key)) {
          conductorOf.set(neighbour.key, conductors.length);
          pending.push(neighbour.key);
        }
    }
    conductors.push(members);
  }
  const rejoined = [
    ...new Set(
      [...endpoints.entries()].flatMap(([key, endpoint]) =>
        isRelocatedPin(endpoint) ? [conductorOf.get(key)!] : [],
      ),
    ),
  ]
    .sort((left, right) => left - right)
    .map((index) => conductors[index]!)
    .filter((members) => members.length > 1);

  // The labels and markers standing on wires that go.
  const routeAnnotations = document.annotations.filter(
    (annotation) =>
      annotation.anchor.kind === "route" &&
      removed.has(annotation.anchor.routeId),
  );
  const locked = routeAnnotations.filter((annotation) => annotation.locked);
  if (locked.length)
    throw new Error(
      `${locked.map((item) => item.id).join(", ")} ${locked.length === 1 ? "is" : "are"} locked on a wire that would be redrawn; unlock first; ${NOTHING}`,
    );
  const routeNetOf = new Map(
    document.routes.map((route) => [route.id, route.netId]),
  );
  const freed = routeAnnotations.map((annotation) => ({
    id: annotation.id,
    netId:
      annotation.netId ??
      routeNetOf.get(
        (annotation.anchor as Extract<Annotation["anchor"], { kind: "route" }>)
          .routeId,
      )!,
    position: resolveVisualAnchor(document, resolver, annotation.anchor)
      .position,
  }));

  const before = netMembership(document);
  const netlist = spiceNetlist(project);
  const steps = new DraftSteps(project, documentId, NOTHING);
  const draft = () => steps.document;

  // The labels stand free while their wires go; every pin keeps its Net.
  steps.apply(
    [
      ...routeAnnotations.map((annotation): SchematicEdit => ({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          anchor: {
            kind: "free",
            position: freed.find((item) => item.id === annotation.id)!.position,
          },
        },
      })),
      ...[...removed].map((routeId): SchematicEdit => ({
        kind: "remove_route_geometry",
        routeId,
      })),
    ],
    "taking the wires off",
  );

  // The parts move and turn at once, so a swap never stacks two on one spot.
  const moves: SchematicEdit[] = parts.flatMap(({ instance, placement }) => {
    const from = instance.placement!;
    return [
      ...(from.rotation !== placement.rotation
        ? [
            {
              kind: "rotate_instance" as const,
              instanceId: instance.id,
              rotation: placement.rotation,
            },
          ]
        : []),
      ...(from.mirror !== placement.mirror
        ? [
            {
              kind: "mirror_instance" as const,
              instanceId: instance.id,
              mirror: placement.mirror,
            },
          ]
        : []),
      ...(from.position.x !== placement.position.x ||
      from.position.y !== placement.position.y
        ? [
            {
              kind: "move_instance" as const,
              instanceId: instance.id,
              position: placement.position,
            },
          ]
        : []),
    ];
  });
  // A marker standing on a pin goes by the step its pin goes.
  for (const { marker, pinName, part } of carried) {
    const pin = { kind: "terminal" as const, instanceId: part.id, pinName };
    const at = resolveEndpointPoint(document, resolver, pin);
    const to = resolveEndpointPoint(placed, resolver, pin);
    if (!at || !to || !marker.placement) continue;
    moves.push({
      kind: "move_instance",
      instanceId: marker.id,
      position: {
        x: Math.round(marker.placement.position.x + to.x - at.x),
        y: Math.round(marker.placement.position.y + to.y - at.y),
      },
    });
  }
  steps.apply(
    withStruckLabelsArranged(draft(), resolver, moves),
    "moving the parts",
  );

  // A stub stands out of its pin as it stood before: moved with the pin,
  // turned and mirrored as the part was.
  for (const stub of stubs) {
    const was = resolveEndpointConnection(document, resolver, stub.pin);
    const now = resolveEndpointConnection(placed, resolver, stub.pin);
    if (!was || !now) continue;
    const frame = pinFrame(
      document.instances.find((item) => item.id === stub.pin.instanceId)!
        .placement!,
      relocated.get(stub.pin.instanceId)!.placement,
      was.outward,
      now.outward,
    );
    for (const junctionId of stub.junctionIds) {
      const old = document.junctions.find((item) => item.id === junctionId);
      const current = draft().junctions.find((item) => item.id === junctionId);
      if (!old || !current) continue;
      const offset = frame({
        x: old.position.x - was.gridLanding.x,
        y: old.position.y - was.gridLanding.y,
      });
      const delta = {
        x: now.gridLanding.x + offset.x - current.position.x,
        y: now.gridLanding.y + offset.y - current.position.y,
      };
      if (!delta.x && !delta.y) continue;
      const plan = planRoutingTransform(
        draft(),
        resolver,
        { instanceIds: [], routeIds: [], junctionIds: [junctionId] },
        { kind: "translate", delta },
      );
      const error = plan.diagnostics.find((item) => item.severity === "error");
      if (error)
        throw new Error(
          `the wire hanging from ${pinName(document, stub.pin)} cannot follow it: ${error.message}; ${NOTHING}`,
        );
      const gate = gateRoutingOperationPlan(draft(), plan, {
        symbolResolver: resolver,
      });
      if (!gate.ok)
        throw new Error(
          `the wire hanging from ${pinName(document, stub.pin)} cannot follow it: ${gate.message}; ${NOTHING}`,
        );
      steps.apply(gate.edits, "moving a stub");
    }
  }

  // Each conductor taken apart is joined again, as route-net joins a Net.
  const wireNotes: AgentCommandPlanNote[] = [];
  for (const members of rejoined) {
    const current = draft();
    const ends = members.flatMap((key): RouteEndpoint[] => {
      const endpoint = endpoints.get(key)!;
      if (endpoint.kind === "junction")
        return current.junctions.some((item) => item.id === endpoint.junctionId)
          ? [endpoint]
          : [];
      return current.instances.some(
        (item) => item.id === endpoint.instanceId,
      ) && isVisibleEndpoint(current, resolver, endpoint)
        ? [endpoint]
        : [];
    });
    if (ends.length < 2) continue;
    const pins = ends.flatMap((endpoint) =>
      endpoint.kind === "terminal" ? [pinName(current, endpoint)] : [],
    );
    // The simple paths first, as route-net draws them; only when none is
    // clear does the search go round the parts (avoid), so a wire that could
    // be drawn plainly keeps its plain shape.
    const target = { kind: "endpoints" as const, endpoints: ends };
    try {
      let plan: ReturnType<typeof planRouteNet>;
      try {
        plan = planRouteNet(current, resolver, { target });
      } catch {
        plan = planRouteNet(current, resolver, { target, avoid: true });
      }
      steps.apply(plan, "redrawing");
      wireNotes.push(...(plan.notes ?? []));
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error))
        .replace(/^route-net: /u, "")
        .replace(new RegExp(`; ${NOTHING}$`, "u"), "");
      throw new Error(
        `the connection of ${pins.join(", ")} cannot be redrawn: ${reason}; ${NOTHING}`,
      );
    }
    const joined = draft();
    const components = new Set(
      joined.nets.flatMap((net) =>
        deriveNetConnectivity(joined, resolver, net).components.flatMap(
          (component) =>
            component.nodes.some((node) =>
              ends.some(
                (endpoint) =>
                  endpoint.kind === "terminal" &&
                  node.key === endpointKey(endpoint),
              ),
            )
              ? [component.id]
              : [],
        ),
      ),
    );
    if (components.size > 1)
      throw new Error(
        `the connection of ${pins.join(", ")} could not be drawn whole; ${NOTHING}`,
      );
  }

  // The labels stand on their Net's wire nearest where they stood, a new
  // wire first.
  const original = new Set(document.routes.map((route) => route.id));
  const labelEdits: SchematicEdit[] = [];
  const unplaced: string[] = [];
  for (const label of freed) {
    const current = draft();
    const annotation = current.annotations.find((item) => item.id === label.id);
    if (!annotation) continue;
    const logical = resolveDocumentLogicalNets(current);
    const netId = annotation.netId ?? label.netId;
    const group = logical.byBaseNetId.get(netId)?.baseNetIds ??
      logical.byId.get(netId)?.baseNetIds ?? [netId];
    const records = current.routes
      .filter(
        (route) =>
          group.includes(route.netId) &&
          !route.members &&
          route.presentation !== "power-rail",
      )
      .flatMap((route) => {
        const geometry = resolveRouteGeometry(current, resolver, route);
        return geometry ? [{ route, geometry }] : [];
      });
    const distance = (record: (typeof records)[number]) =>
      Math.min(
        ...record.geometry.segments.map(({ from, to }) =>
          distanceToSegment(label.position, from, to),
        ),
      );
    const rank = (record: (typeof records)[number]) => [
      record.route.netId === netId ? 0 : 1,
      original.has(record.route.id) ? 1 : 0,
      distance(record),
    ];
    const best = [...records].sort((left, right) => {
      const [a, b] = [rank(left), rank(right)];
      return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    })[0];
    const attachment = best
      ? dragNetLabelAttachmentAtPoint(records, label.position, best.route.id)
      : null;
    if (!best || !attachment) {
      unplaced.push(label.id);
      continue;
    }
    labelEdits.push({
      kind: "upsert_schematic_annotation",
      annotation: {
        ...annotation,
        anchor: {
          kind: "route",
          routeId: best.route.id,
          legId: attachment.legId,
          t: attachment.t,
          normalOffset: attachment.normalOffset,
          direction: "forward",
          orientation: "horizontal",
          fallbackPosition: attachment.labelPosition,
        },
      },
    });
  }
  steps.apply(labelEdits, "placing the labels");

  // Every pin keeps its Net, and the netlist reads the same.
  const after = draft();
  const lost = pinsOnChangedNets(after, before, netMembership(after));
  if (lost.length)
    throw new Error(
      `relocating would change the Net of ${lost.join(", ")}; ${NOTHING}`,
    );
  if (netlist !== undefined && spiceNetlist(steps.project) !== netlist)
    throw new Error(`relocating would change the netlist; ${NOTHING}`);
  for (const { instance, placement } of parts) {
    const now = after.instances.find(
      (item) => item.id === instance.id,
    )?.placement;
    if (
      !now ||
      now.position.x !== placement.position.x ||
      now.position.y !== placement.position.y ||
      now.rotation !== placement.rotation ||
      now.mirror !== placement.mirror
    )
      throw new Error(
        `${nameOf(instance)} could not be set at the place asked; ${NOTHING}`,
      );
  }

  // A stub carried with its pin never comes to lie on another Net's pin,
  // Junction or wire: it would read as joined there.
  const touches = otherNets(after, resolver);
  for (const stub of stubs)
    for (const routeId of stub.routeIds) {
      const met = touches.alongRoute(routeId);
      if (met.length)
        throw new Error(
          `the wire hanging from ${pinName(document, stub.pin)} would touch ${met.map((item) => item.text).join(", ")}; choose another place; ${NOTHING}`,
        );
    }
  // A pin that now lies on another Net is not joined to it, as a move
  // without join leaves it; the receipt says so.
  const landed = changed.flatMap(({ instance }): AgentCommandPlanNote[] => {
    const met = new Map<string, Touch[]>();
    for (const pin of resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    )?.definition.pins ?? []) {
      const endpoint = {
        kind: "terminal" as const,
        instanceId: instance.id,
        pinName: pin.name,
      };
      if (!isVisibleEndpoint(after, resolver, endpoint)) continue;
      const connection = resolveEndpointConnection(after, resolver, endpoint);
      if (!connection) continue;
      const found = touches.atPin(endpoint, [
        connection.contactPoint,
        connection.gridLanding,
      ]);
      if (found.length) met.set(pin.name, found);
    }
    if (!met.size) return [];
    const listed = [...met].map(
      ([pin, found]) =>
        `pin ${pin} (${found.map((item) => item.text).join(", ")})`,
    );
    return [
      {
        code: "LANDED_ON_OTHER_NET",
        message: `${nameOf(instance)} now touches another Net at ${listed.join(", ")} and was not joined to it; relocate it clear, or connect them if they belong together`,
        objectIds: [
          instance.id,
          ...new Set([...met.values()].flat().map((item) => item.objectId)),
        ],
      },
    ];
  });

  const drawn = after.routes.filter((route) => !original.has(route.id)).length;
  return {
    structureEdits: steps.structureEdits,
    notes: [
      {
        code: "RELOCATED",
        message: `Relocated ${changed.map(({ instance }) => nameOf(instance)).join(", ")}: ${removed.size} wire${removed.size === 1 ? "" : "s"} taken off and ${drawn} drawn; every Net keeps its pins${carried.length ? `; ${carried.length} marker${carried.length === 1 ? "" : "s"} went along` : ""}${unplaced.length ? `; ${unplaced.join(", ")} stand${unplaced.length === 1 ? "s" : ""} free, with no wire of its Net to stand on` : ""}.`,
        objectIds: [
          ...changed.map(({ instance }) => instance.id),
          ...carried.map(({ marker }) => marker.id),
        ],
      },
      ...landed,
      ...wireNotes,
    ],
  };
}

/** Something of another Net a pin or wire meets, in words. */
interface Touch {
  text: string;
  objectId: string;
}

/**
 * What of other Nets lies where a pin or a wire is: a pin, a Junction or a
 * wire, by its point. A crossing of two wires' middles meets nothing; a pin
 * or wire end on another Net's wire reads as joined to it, and is not.
 */
function otherNets(document: SchematicDocument, resolver: SymbolResolver) {
  const logical = resolveDocumentLogicalNets(document);
  const logicalOf = (netId: string | null | undefined) =>
    netId ? (logical.byBaseNetId.get(netId)?.id ?? netId) : undefined;
  const netText = (netId: string | undefined) =>
    netId ? `Net ${logical.byId.get(netId)?.name ?? netId}` : "no Net";
  const pinNet = new Map<string, string>();
  for (const net of document.nets)
    for (const terminal of net.terminals)
      pinNet.set(
        endpointKey({ kind: "terminal", ...terminal }),
        logicalOf(net.id)!,
      );
  const same = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  const pins = document.instances.flatMap((instance) => {
    if (!instance.placement) return [];
    return (
      resolver.resolve(instance.symbolId, instance.symbolVariantId)?.definition
        .pins ?? []
    ).flatMap((pin) => {
      const endpoint = {
        kind: "terminal" as const,
        instanceId: instance.id,
        pinName: pin.name,
      };
      if (!isVisibleEndpoint(document, resolver, endpoint)) return [];
      const connection = resolveEndpointConnection(
        document,
        resolver,
        endpoint,
      );
      const key = endpointKey(endpoint);
      return connection
        ? [
            {
              instanceId: instance.id,
              key,
              net: pinNet.get(key),
              points: [connection.contactPoint, connection.gridLanding],
              text: `pin ${pinName(document, endpoint)}`,
            },
          ]
        : [];
    });
  });
  const junctions = document.junctions.map((junction) => ({
    id: junction.id,
    nets: (
      junction.members?.map((member) => member.netId) ?? [junction.netId]
    ).map(logicalOf),
    point: junction.position,
  }));
  const routes = document.routes.flatMap((route) => {
    const geometry = resolveRouteGeometry(document, resolver, route);
    return geometry
      ? [
          {
            id: route.id,
            nets: routeElectricalConnections(route).map((connection) =>
              logicalOf(connection.netId),
            ),
            segments: geometry.segments,
            points: geometry.centerline,
          },
        ]
      : [];
  });
  /** A Net other than `own`; a pin on no Net is no one's. */
  const other = (
    own: string | undefined,
    nets: readonly (string | undefined)[],
  ) => own === undefined || !nets.includes(own);
  const where = (point: Point) => `(${point.x}, ${point.y})`;
  return {
    /** What of another Net touches one of a pin's points. */
    atPin(
      pin: Extract<RouteEndpoint, { kind: "terminal" }>,
      points: readonly Point[],
    ): Touch[] {
      const own = pinNet.get(endpointKey(pin));
      const found: Touch[] = [];
      for (const candidate of pins)
        if (
          candidate.instanceId !== pin.instanceId &&
          other(own, [candidate.net]) &&
          candidate.points.some((a) => points.some((b) => same(a, b)))
        )
          found.push({
            text: `${candidate.text} of ${netText(candidate.net)}`,
            objectId: candidate.instanceId,
          });
      for (const junction of junctions)
        if (
          other(own, junction.nets) &&
          points.some((point) => same(point, junction.point))
        )
          found.push({
            text: `Junction ${junction.id} of ${netText(junction.nets[0])}`,
            objectId: junction.id,
          });
      for (const route of routes)
        if (
          other(own, route.nets) &&
          points.some((point) =>
            route.segments.some(({ from, to }) =>
              pointOnSegment(point, from, to),
            ),
          )
        )
          found.push({
            text: `Route ${route.id} of ${netText(route.nets[0])}`,
            objectId: route.id,
          });
      return found;
    },
    /** What of another Net a wire runs over or ends on, and where. */
    alongRoute(routeId: string): Touch[] {
      const wire = routes.find((route) => route.id === routeId);
      if (!wire) return [];
      const own = wire.nets[0];
      const on = (point: Point) =>
        wire.segments.some(({ from, to }) => pointOnSegment(point, from, to));
      const found: Touch[] = [];
      for (const candidate of pins) {
        const point = candidate.points.find(on);
        if (point && other(own, [candidate.net]))
          found.push({
            text: `${candidate.text} of ${netText(candidate.net)} at ${where(point)}`,
            objectId: candidate.instanceId,
          });
      }
      for (const junction of junctions)
        if (other(own, junction.nets) && on(junction.point))
          found.push({
            text: `Junction ${junction.id} of ${netText(junction.nets[0])} at ${where(junction.point)}`,
            objectId: junction.id,
          });
      for (const route of routes) {
        if (route.id === routeId || !other(own, route.nets)) continue;
        const point =
          route.points.find(on) ??
          wire.points.find((candidate) =>
            route.segments.some(({ from, to }) =>
              pointOnSegment(candidate, from, to),
            ),
          );
        if (point)
          found.push({
            text: `Route ${route.id} of ${netText(route.nets[0])} at ${where(point)}`,
            objectId: route.id,
          });
      }
      return found;
    },
  };
}

function pinName(
  document: SchematicDocument,
  pin: Extract<RouteEndpoint, { kind: "terminal" }>,
): string {
  const instance = document.instances.find(
    (item) => item.id === pin.instanceId,
  );
  return `${instance?.reference ?? pin.instanceId}.${pin.pinName}`;
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - from.x) * dx + (point.y - from.y) * dy) / length,
        ),
      )
    : 0;
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
} from "@icm/agent-adapter";
import { planSetVddConnectionMode } from "@icm/edit-engine";
import {
  deriveDocumentContactEvidence,
  endpointKey,
  isVisibleEndpoint,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  deriveStableId,
  foldNetName,
  projectCellInterface,
  transformPoint,
  type CircuitProject,
  type Point,
  type RouteEndpoint,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  DraftSteps,
  netMembership,
  pinsOnChangedNets,
  spiceNetlist,
} from "./draft-steps";
import { PIN_MARKERS } from "./property-command";
import { netNamed, planDeleteWires } from "./selection-deletion-command";

type RenderNetAs = Extract<AgentAuthoringCommand, { kind: "render-net-as" }>;

const NOTHING = "nothing was changed";

const DIRECTIONS = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
} as const;

/**
 * A Net drawn the textbook way: a marker of its name standing on each of
 * its pins, pointing away from the part, and its wires deleted. In steps on
 * a draft, sent as one Project transaction: the markers are placed as a GUI
 * placement places them (a Cell Pin's markers join its one Port, with its
 * direction; on any other Net they name it globally); then the Net's wires
 * go as delete-wires deletes them. Every pin's Net and the netlist are then
 * compared with the start; any difference refuses the whole command.
 */
export function planRenderNetAs(
  project: CircuitProject,
  documentId: string,
  resolver: SymbolResolver,
  command: RenderNetAs,
  plan: (
    project: CircuitProject,
    command: AgentAuthoringCommand,
  ) => AgentCommandPlan,
): AgentCommandPlan {
  const document = project.documents.find((item) => item.id === documentId)!;
  const net = netNamed(document, command.net, NOTHING);
  const name = net.name;
  if (!name)
    throw new Error(
      `Net ${net.id} has no name for its markers to keep; name it first, as add-label does; ${NOTHING}`,
    );
  const nodeZero = name === "0";
  if (command.as === "supply" && nodeZero)
    throw new Error(`Net 0 is ground; render it as ground; ${NOTHING}`);
  const symbolId =
    command.as === "supply" ? "vdd-port" : nodeZero ? "ground" : "named-ground";
  const markerPin = resolver.resolve(symbolId)?.definition.pins[0];
  if (!markerPin) throw new Error(`${symbolId} has no pin`);
  const port = projectCellInterface(document.netlist).ports.find(
    (item) => foldNetName(item.name) === foldNetName(name),
  );
  // A supply marker or named ground names its Net as a Cell Pin or globally.
  if (symbolId !== "ground" && !port && net.scope !== "global")
    throw new Error(
      `${name} is a local Net and no Cell Pin; a ${symbolId === "vdd-port" ? "supply marker" : "named ground"} would make it global or a Cell Pin; make it one first; ${NOTHING}`,
    );

  // Every drawn pin of the Net but the markers' own, and those a marker
  // stands on already; pins touching each other share one marker.
  const isMarker = (instanceId: string) =>
    (document.instances.find((item) => item.id === instanceId)?.symbolId ??
      "") in PIN_MARKERS;
  const contacts = deriveDocumentContactEvidence(document, resolver);
  const landings = new Set<string>();
  const targets = document.nets
    .filter((base) => net.baseNetIds.includes(base.id))
    .flatMap((base) => base.terminals)
    .flatMap((terminal) => {
      const endpoint = { kind: "terminal" as const, ...terminal };
      if (
        isMarker(terminal.instanceId) ||
        !isVisibleEndpoint(document, resolver, endpoint) ||
        contacts.byEndpointKey
          .get(endpointKey(endpoint))
          ?.endpoints.some(
            (other) => other.kind === "terminal" && isMarker(other.instanceId),
          )
      )
        return [];
      const connection = resolveEndpointConnection(
        document,
        resolver,
        endpoint,
      );
      if (!connection) return [];
      const at = `${connection.gridLanding.x},${connection.gridLanding.y}`;
      if (landings.has(at)) return [];
      landings.add(at);
      return [{ endpoint, connection }];
    });

  /** The turn that points the marker's pin back at the part. */
  const rotationFacing = (outward: Point | null) => {
    if (!outward) return 0;
    const local = DIRECTIONS[markerPin.direction];
    const candidates = [0, 90, 180, 270] as const;
    const dot = (rotation: (typeof candidates)[number]) => {
      const turned = transformPoint(
        local,
        { x: 0, y: 0 },
        { rotation, mirror: "none" },
      );
      return turned.x * outward.x + turned.y * outward.y;
    };
    return [...candidates].sort((left, right) => dot(left) - dot(right))[0]!;
  };
  const markers = targets.map(({ endpoint, connection }) => ({
    endpoint,
    instance: {
      id: deriveStableId(
        "render-net-as",
        `${documentId}:${document.revision}`,
        endpointKey(endpoint),
      ),
      symbolId,
      ...(symbolId === "ground" ? {} : { reference: name }),
      placement: {
        position: connection.gridLanding,
        rotation: rotationFacing(connection.outward),
        mirror: "none" as const,
      },
    },
    landing: connection.gridLanding,
  }));

  const before = netMembership(document);
  const netlist = spiceNetlist(project);
  const steps = new DraftSteps(project, documentId, NOTHING);
  if (markers.length)
    steps.apply(
      plan(steps.project, {
        kind: "place-components",
        instances: markers.map(({ instance }) => instance),
        pinAnchors: Object.fromEntries(
          markers.map(({ instance, landing }) => [
            instance.id,
            { pinName: markerPin.name, position: landing },
          ]),
        ),
        ...(port && symbolId !== "ground"
          ? {
              terminalDirections: Object.fromEntries(
                markers.map(({ instance }) => [instance.id, port.direction]),
              ),
            }
          : {}),
      }),
      "placing the markers",
    );
  // A Net that is no Cell Pin stays one: its supply markers name it globally.
  if (!port && symbolId !== "ground")
    for (const { instance } of markers)
      if (
        steps.document.netlist?.terminals.some((terminal) =>
          terminal.interfaceInstanceIds.includes(instance.id),
        )
      )
        steps.apply(
          {
            structureEdits: planSetVddConnectionMode(
              steps.project,
              documentId,
              instance.id,
              "global",
            ),
          },
          "naming the markers' Net",
        );

  // The Net's wires go, as delete-wires deletes them: the Net is found again
  // by its pins, as the markers may have given it another ID.
  const pinKey = (terminal: { instanceId: string; pinName: string }) =>
    endpointKey({ kind: "terminal", ...terminal });
  const netPins = new Set(
    document.nets
      .filter((base) => net.baseNetIds.includes(base.id))
      .flatMap((base) => base.terminals.map(pinKey)),
  );
  const drawn = steps.document;
  const current = resolveDocumentLogicalNets(drawn).groups.filter((group) =>
    group.baseNetIds.some((id) =>
      drawn.nets
        .find((base) => base.id === id)
        ?.terminals.some((terminal) => netPins.has(pinKey(terminal))),
    ),
  );
  const deleted = drawn.routes.filter((route) =>
    current.some((group) =>
      (route.members ?? [route]).every((member) =>
        group.baseNetIds.includes(member.netId),
      ),
    ),
  ).length;
  for (const group of current) {
    const document = steps.document;
    const ids = new Set(group.baseNetIds);
    if (
      !document.routes.some((route) =>
        (route.members ?? [route]).every((member) => ids.has(member.netId)),
      )
    )
      continue;
    steps.apply(
      planDeleteWires(
        steps.project,
        documentId,
        document,
        resolver,
        { kind: "delete-wires", net: group.id },
        document.revision + 1,
      ),
      "deleting the Net's wires",
    );
  }

  // Every pin keeps its Net, the markers are on it, and nothing overlaps.
  const after = steps.document;
  const markerIds = new Set(markers.map(({ instance }) => instance.id));
  const isNew = (key: string) => markerIds.has(key.split(":")[1] ?? "");
  const membership = netMembership(after);
  const lost = pinsOnChangedNets(after, before, membership, isNew);
  if (lost.length)
    throw new Error(
      `rendering ${name} would change the Net of ${lost.join(", ")}; ${NOTHING}`,
    );
  for (const { instance, endpoint } of markers) {
    const key = endpointKey({
      kind: "terminal",
      instanceId: instance.id,
      pinName: markerPin.name,
    });
    const own = membership.get(endpointKey(endpoint));
    if (!own || membership.get(key) !== own)
      throw new Error(
        `a marker on ${pinLabel(after, endpoint)} would not join ${name}; ${NOTHING}`,
      );
  }
  if (netlist !== undefined && spiceNetlist(steps.project) !== netlist)
    throw new Error(
      `rendering ${name} would change the netlist (a marker names its Net ${port ? "as the Cell Pin" : "globally"}); ${NOTHING}`,
    );
  // Drawn boxes keep a stroke's margin each, so a marker touching its part
  // at the pin overlaps it by two; more is a marker drawn over a part.
  const TOUCH = 3;
  const bounds = visibleInstanceBounds(after, resolver);
  for (const { instance, endpoint } of markers) {
    const box = bounds.find((item) => item.id === instance.id)?.bounds;
    if (!box) continue;
    const struck = bounds.find(
      (other) =>
        other.id !== instance.id &&
        Math.min(box.x + box.width, other.bounds.x + other.bounds.width) -
          Math.max(box.x, other.bounds.x) >
          TOUCH &&
        Math.min(box.y + box.height, other.bounds.y + other.bounds.height) -
          Math.max(box.y, other.bounds.y) >
          TOUCH,
    );
    if (struck) {
      const other = after.instances.find((item) => item.id === struck.id);
      throw new Error(
        `the marker on ${pinLabel(after, endpoint)} would overlap ${other?.reference ?? (markerIds.has(struck.id) ? "another new marker" : struck.id)}; move the part clear first; ${NOTHING}`,
      );
    }
  }

  if (!steps.structureEdits.length) return { edits: [] };
  const what =
    symbolId === "ground"
      ? "ground"
      : symbolId === "named-ground"
        ? "named ground"
        : "supply marker";
  return {
    structureEdits: steps.structureEdits,
    notes: [
      {
        code: "NET_RENDERED_AS",
        message: `Drew ${name} as ${markers.length} ${what}${markers.length === 1 ? "" : "s"} on its pins and deleted its ${deleted} wire${deleted === 1 ? "" : "s"}; its name and netlist stay.`,
        objectIds: [...markerIds],
      },
    ],
  };
}

function pinLabel(
  document: CircuitProject["documents"][number],
  endpoint: RouteEndpoint,
): string {
  if (endpoint.kind !== "terminal") return endpoint.junctionId;
  const instance = document.instances.find(
    (item) => item.id === endpoint.instanceId,
  );
  return `${instance?.reference ?? endpoint.instanceId}.${endpoint.pinName}`;
}

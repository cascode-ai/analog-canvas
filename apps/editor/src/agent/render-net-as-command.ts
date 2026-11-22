import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
} from "@icm/agent-adapter";
import {
  planSetVddConnectionMode,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  createLabelClearanceContext,
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
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  DraftSteps,
  electricalFacts,
  netlistChange,
  netMembership,
  pinsOnChangedNets,
  spiceNetlist,
} from "./draft-steps";
import { planMosBulkDefaultUpdate } from "../features/component-insert/mos-bulk-defaults";
import { arrangeInstanceLabels } from "../features/instance-display/arrange-instance-labels";
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

/** Placement edits that would make a marker the Cell's MOS body default. */
const BODY_DEFAULT_EDITS = new Set<SchematicEdit["kind"]>([
  "set_mos_bulk_defaults",
  "reconcile_mos_bulk",
]);

/**
 * A Net drawn the textbook way: a marker of its name standing on each of
 * its pins, pointing away from the part, and its wires deleted. In steps on
 * a draft, sent as one Project transaction: the markers are placed as a GUI
 * placement places them (a Cell Pin's markers join its one Port, with its
 * direction; a global Net's name it globally; a local Net's name it in this
 * Cell only, as its Net labels did), but never as a MOS body default; then
 * the Net's wires go as delete-wires deletes them, and the markers wired to
 * the Net before, left touching nothing of it, go with them. Every pin's Net
 * and the netlist (or, while it cannot be exported, every Cell's Nets and
 * Pins) are then compared with the start; any difference refuses the whole
 * command. Labels a marker covers move clear, or it is refused.
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
  // The scope the Net has, and keeps: a supply marker or named ground joins
  // a Cell Pin, names a global Net globally and a local one locally.
  const scope =
    symbolId === "ground"
      ? "node 0"
      : port
        ? "Cell Pin"
        : net.scope === "global"
          ? "global"
          : "local";

  // Every drawn pin of the Net but the markers' own, and those a marker
  // stands on already; pins touching each other share one marker.
  const isMarker = (instanceId: string) =>
    (document.instances.find((item) => item.id === instanceId)?.symbolId ??
      "") in PIN_MARKERS;
  const contacts = deriveDocumentContactEvidence(document, resolver);
  const landings = new Set<string>();
  const netTerminals = document.nets
    .filter((base) => net.baseNetIds.includes(base.id))
    .flatMap((base) => base.terminals);
  const targets = netTerminals.flatMap((terminal) => {
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
    const connection = resolveEndpointConnection(document, resolver, endpoint);
    if (!connection) return [];
    const at = `${connection.gridLanding.x},${connection.gridLanding.y}`;
    if (landings.has(at)) return [];
    landings.add(at);
    return [{ endpoint, connection }];
  });
  const oldMarkers = [
    ...new Set(
      netTerminals
        .map((terminal) => terminal.instanceId)
        .filter((instanceId) => isMarker(instanceId)),
    ),
  ];

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
      withoutBodyDefaults(
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
      ),
      "placing the markers",
    );
  // A Net that is no Cell Pin stays one: its markers name it as it was
  // named, globally or in this Cell only.
  if (scope === "global" || scope === "local")
    for (const { instance } of markers)
      if (
        steps.document.netlist?.terminals.some((terminal) =>
          terminal.interfaceInstanceIds.includes(instance.id),
        )
      ) {
        const global = planSetVddConnectionMode(
          steps.project,
          documentId,
          instance.id,
          "global",
        );
        steps.apply(
          { structureEdits: scope === "local" ? namedLocally(global) : global },
          "naming the markers' Net",
        );
      }

  // The Net's wires go, as delete-wires deletes them: the Net is found again
  // by its pins, as the markers may have given it another ID.
  const pinKey = (terminal: { instanceId: string; pinName: string }) =>
    endpointKey({ kind: "terminal", ...terminal });
  const netPins = new Set(netTerminals.map(pinKey));
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

  // A marker wired to the Net before that now touches nothing of it goes,
  // unless it holds a Cell Pin no other marker keeps.
  const { removed: orphans, kept } = strandedMarkers(
    steps.document,
    resolver,
    oldMarkers,
  );
  // A MOS body default on such a marker's own Net stays on the Net.
  const orphanNets = new Set(
    steps.document.nets
      .filter((base) =>
        base.terminals.some((terminal) =>
          orphans.includes(terminal.instanceId),
        ),
      )
      .map((base) => base.id),
  );
  const survivor = steps.document.nets.find((base) =>
    base.terminals.some(
      (terminal) =>
        netPins.has(pinKey(terminal)) && !isMarker(terminal.instanceId),
    ),
  )?.id;
  for (const kind of ["nmos", "pmos"] as const) {
    const netId = steps.document.mosBulkDefaults?.[`${kind}NetId`];
    if (survivor && netId && orphanNets.has(netId))
      steps.apply(
        planMosBulkDefaultUpdate(steps.project, steps.document, kind, survivor),
        "keeping the MOS body default on the Net",
      );
  }
  if (orphans.length)
    steps.apply(
      keepingPinOrder(
        steps.document,
        plan(steps.project, {
          kind: "delete-selection",
          selection: {
            instanceIds: orphans,
            routeIds: [],
            junctionIds: [],
            annotationIds: [],
            draftingIds: [],
            noConnectIds: [],
          },
        }),
      ),
      "removing the markers left without a connection",
    );

  // Every pin keeps its Net, the markers are on it, and nothing overlaps.
  const after = steps.document;
  const markerIds = new Set(markers.map(({ instance }) => instance.id));
  const gone = new Set(orphans);
  const ignored = (key: string) => {
    const instanceId = key.split(":")[1] ?? "";
    return markerIds.has(instanceId) || gone.has(instanceId);
  };
  const membership = netMembership(after);
  const lost = pinsOnChangedNets(after, before, membership, ignored);
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
  if (netlist !== undefined) {
    const rendered = spiceNetlist(steps.project);
    if (rendered === undefined)
      throw new Error(
        `rendering ${name} would stop the netlist exporting; ${NOTHING}`,
      );
    if (rendered !== netlist)
      throw new Error(
        `rendering ${name} would change the netlist: ${netlistChange(netlist, rendered)}; ${NOTHING}`,
      );
  } else {
    // No netlist to compare: what it would say of every Cell is compared.
    const was = electricalFacts(project, ignored);
    const now = electricalFacts(steps.project, ignored);
    const changed = [...new Set([...was.keys(), ...now.keys()])]
      .sort()
      .find((key) => was.get(key) !== now.get(key));
    if (changed !== undefined)
      throw new Error(
        `rendering ${name} would change ${changed} from ${was.get(changed) ?? "nothing"} to ${now.get(changed) ?? "nothing"} (the netlist cannot be exported, so every Cell's Nets and Pins were compared); ${NOTHING}`,
      );
  }
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
  // A part's label a marker covers moves clear, as a placement moves it;
  // any other text a marker or its name would cover refuses.
  if (markers.length) {
    const ids = markers.map(({ instance }) => instance.id);
    const owners = [
      ...new Set(
        coveredText(steps.document, resolver, ids).flatMap(({ owner }) =>
          owner && !markerIds.has(owner) ? [owner] : [],
        ),
      ),
    ];
    if (owners.length)
      steps.apply(
        arrangeInstanceLabels(steps.document, resolver, owners, {
          rowsOnly: true,
          compact: false,
        }),
        "moving labels clear of the markers",
      );
    const [covered] = coveredText(steps.document, resolver, ids);
    if (covered) {
      const endpoint = markers.find(
        ({ instance }) => instance.id === covered.markerId,
      )!.endpoint;
      throw new Error(
        `the marker on ${pinLabel(steps.document, endpoint)} would cover ${covered.what}; move it clear first; ${NOTHING}`,
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
  const scopeText = {
    "node 0": "it stays node 0",
    "Cell Pin": "it stays a Cell Pin",
    global: "it stays global",
    local: "it stays local to this Cell, as its markers name it here only",
  }[scope];
  const counted = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;
  return {
    structureEdits: steps.structureEdits,
    notes: [
      {
        code: "NET_RENDERED_AS",
        message: `Drew ${name} as ${counted(markers.length, what)} on its pins and deleted its ${counted(deleted, "wire")}${orphans.length ? `; removed ${counted(orphans.length, "old marker")} left touching nothing of it` : ""}${kept.length ? `; kept ${counted(kept.length, "old marker")} that ${kept.length === 1 ? "is" : "are"} its Cell Pin's only marker` : ""}; ${scopeText}, and its name and netlist stay.`,
        objectIds: [...markerIds],
      },
    ],
  };
}

/** A placement plan without the edits that set a MOS body default. */
function withoutBodyDefaults(plan: AgentCommandPlan): AgentCommandPlan {
  const keep = (edits: readonly SchematicEdit[]) =>
    edits.filter((edit) => !BODY_DEFAULT_EDITS.has(edit.kind));
  return "edits" in plan
    ? { ...plan, edits: keep(plan.edits) }
    : {
        ...plan,
        structureEdits: plan.structureEdits.map((edit) =>
          edit.kind === "transact_document"
            ? { ...edit, edits: keep(edit.edits) }
            : edit,
        ),
      };
}

/**
 * Global naming, made local: the claims the supply markers make are scoped
 * to this Cell, so the Net keeps its scope. They still mark it a supply, as
 * the netlist asks of a Net a supply marker stands on.
 */
function namedLocally(
  edits: readonly ProjectStructureEdit[],
): ProjectStructureEdit[] {
  return edits.map((edit) =>
    edit.kind === "transact_document"
      ? {
          ...edit,
          edits: edit.edits.map((item) =>
            item.kind === "upsert_connectivity_evidence" &&
            item.evidence.kind === "name-claim" &&
            item.evidence.owner.kind === "power-marker"
              ? { ...item, evidence: { ...item.evidence, scope: "local" } }
              : item,
          ),
        }
      : edit,
  );
}

/**
 * Of the markers wired to the Net before, those its wires' deletion left
 * touching nothing: no other pin, no wire. One that is a Cell Pin's only
 * marker is kept, so the Pin stays.
 */
function strandedMarkers(
  document: SchematicDocument,
  resolver: SymbolResolver,
  candidates: readonly string[],
): { removed: string[]; kept: string[] } {
  const contacts = deriveDocumentContactEvidence(document, resolver);
  const wired = new Set(
    document.routes.flatMap((route) =>
      (route.members ?? [route]).map((member) => member.netId),
    ),
  );
  const terminals = document.netlist?.terminals ?? [];
  const retired = new Set<string>();
  const removed: string[] = [];
  const kept: string[] = [];
  for (const instanceId of candidates) {
    if (!document.instances.some((item) => item.id === instanceId)) continue;
    const nets = document.nets.filter((net) =>
      net.terminals.some((terminal) => terminal.instanceId === instanceId),
    );
    const alone = nets.every(
      (net) =>
        !wired.has(net.id) &&
        net.terminals.every((terminal) => {
          if (terminal.instanceId !== instanceId) return false;
          return !contacts.byEndpointKey
            .get(endpointKey({ kind: "terminal", ...terminal }))
            ?.endpoints.some(
              (other) =>
                other.kind !== "terminal" || other.instanceId !== instanceId,
            );
        }),
    );
    if (!alone) continue;
    const own = terminals.find((terminal) =>
      terminal.interfaceInstanceIds.includes(instanceId),
    );
    if (own) {
      const others = terminals.filter(
        (terminal) =>
          terminal.id !== own.id &&
          !retired.has(terminal.id) &&
          foldNetName(terminal.name) === foldNetName(own.name) &&
          (terminal.interfaceInstanceIds.length > 0 ||
            terminal.interfaceAnnotationId !== undefined),
      );
      if (!others.length) {
        kept.push(instanceId);
        continue;
      }
      retired.add(own.id);
    }
    removed.push(instanceId);
  }
  return { removed, kept };
}

/**
 * A deletion of Cell Pin markers that leaves each Pin where it was: the
 * Cell's Pins keep their order, and a Pin the Cell's symbol places by a
 * removed marker's terminal is placed by the terminal that now leads it.
 */
function keepingPinOrder(
  document: SchematicDocument,
  plan: AgentCommandPlan,
): AgentCommandPlan {
  if ("edits" in plan) return plan;
  const removedIds = new Set(
    plan.structureEdits.flatMap((edit) =>
      edit.kind === "transact_document" && edit.documentId === document.id
        ? edit.edits.flatMap((item) =>
            item.kind === "remove_cell_terminal" ? [item.terminalId] : [],
          )
        : [],
    ),
  );
  const terminals = document.netlist?.terminals ?? [];
  if (!removedIds.size) return plan;
  const order = projectCellInterface(document.netlist).ports.map(
    (port) => port.key,
  );
  const remaining = terminals.filter(
    (terminal) => !removedIds.has(terminal.id),
  );
  const rank = (name: string) => order.indexOf(foldNetName(name));
  const sorted = [...remaining].sort(
    (left, right) => rank(left.name) - rank(right.name),
  );
  const extra: SchematicEdit[] = [];
  if (sorted.some((terminal, index) => terminal !== remaining[index]))
    extra.push({
      kind: "reorder_cell_terminals",
      terminalIds: sorted.map((terminal) => terminal.id),
    });
  const symbol = document.presentation.cellSymbol;
  const placements = symbol?.pinPlacements ?? [];
  if (placements.some((placement) => removedIds.has(placement.terminalId))) {
    const leader = (terminalId: string) => {
      const removed = terminals.find((terminal) => terminal.id === terminalId)!;
      return sorted.find(
        (terminal) => foldNetName(terminal.name) === foldNetName(removed.name),
      )?.id;
    };
    const moved = new Map(
      placements.flatMap((placement) => {
        const next = removedIds.has(placement.terminalId)
          ? leader(placement.terminalId)
          : undefined;
        return next ? [[next, placement] as const] : [];
      }),
    );
    extra.push({
      kind: "set_cell_symbol_presentation",
      presentation: {
        ...symbol,
        pinPlacements: placements.flatMap((placement) => {
          if (removedIds.has(placement.terminalId)) {
            const next = leader(placement.terminalId);
            return next ? [{ ...placement, terminalId: next }] : [];
          }
          return moved.has(placement.terminalId) ? [] : [placement];
        }),
      },
    });
  }
  if (!extra.length) return plan;
  return {
    ...plan,
    structureEdits: plan.structureEdits.map((edit) =>
      edit.kind === "transact_document" && edit.documentId === document.id
        ? { ...edit, edits: [...edit.edits, ...extra] }
        : edit,
    ),
  };
}

/**
 * The text new markers, or their own names, are drawn over: a part's label
 * (with the part), a Net label or free text, other than a marker's own.
 */
function coveredText(
  document: SchematicDocument,
  resolver: SymbolResolver,
  markerIds: readonly string[],
): { markerId: string; what: string; owner?: string }[] {
  const context = createLabelClearanceContext(document, resolver);
  const ownerOf = (id: string) => {
    const annotation = document.annotations.find((item) => item.id === id);
    return annotation?.anchor.kind === "object"
      ? annotation.anchor.objectId
      : undefined;
  };
  const describe = (id: string) => {
    const owner = ownerOf(id);
    const part = document.instances.find((item) => item.id === owner);
    const annotation = document.annotations.find((item) => item.id === id);
    if (part) return `${part.reference ?? part.id}'s label ${id}`;
    if (annotation?.kind === "net-label" || annotation?.kind === "power-label")
      return `Net label ${id}`;
    return `text ${id}`;
  };
  const covered: { markerId: string; what: string; owner?: string }[] = [];
  for (const markerId of markerIds) {
    const body = context.symbols.find((item) => item.id === markerId)?.bounds;
    const own = context.visible.filter((item) => ownerOf(item.id) === markerId);
    const ownIds = new Set(own.map((item) => item.id));
    const boxes = [
      ...(body ? [{ box: body, id: "" }] : []),
      ...own.map((item) => ({
        box: context.measure(item).inkBounds,
        id: item.id,
      })),
    ];
    for (const { box, id } of boxes)
      for (const hit of context.overlapsAt(box, id)) {
        if (ownIds.has(hit)) continue;
        const owner = ownerOf(hit);
        covered.push({
          markerId,
          what: describe(hit),
          ...(owner && document.instances.some((item) => item.id === owner)
            ? { owner }
            : {}),
        });
      }
  }
  return covered;
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

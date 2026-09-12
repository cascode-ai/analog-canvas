import {
  isEligibleSeriesInsertionPinPair,
  planSeriesInstanceSplice,
} from "./series-splice-planner.js";
import { createContactPlanningDraft } from "./contact-planning-draft.js";
import { planElectricalMarkerRename } from "./net-name-operation-planner.js";
import { planEnsurePowerNet } from "./power-net-planner.js";
import {
  proposeEndpointRouteAttachment,
  proposeEndpointsRouteAttachment,
  type WireSource,
} from "./routing-planner.js";
import type { ExpectedElectricalEffect } from "./routing-operation-plan.js";
import type { SchematicEdit } from "./edit-schema.js";
import { deviceDescriptor } from "@icm/devices";
import {
  endpointKey,
  isVisibleEndpoint,
  isMosBulkTerminal,
  findRouteSegmentsAtPoint,
  resolveEndpointConnection,
  resolveDocumentRoutingGeometry,
  resolveElectricalContactTargets,
} from "@icm/derived";
import type {
  ElectricalContactCandidate,
  ElectricalContactTarget,
} from "@icm/derived";
import { deriveStableId, routeEndpoints } from "@icm/model";
import type { Instance, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

const POWER_CONNECTION_BY_SYMBOL = {
  ground: {
    name: "0",
    pinName: "0",
    domain: "ground",
    scope: "global",
  },
  "vdd-port": {
    name: "VDD",
    pinName: "P",
    domain: "vdd",
    scope: "global",
  },
} as const;

export type SymbolPowerConnection =
  (typeof POWER_CONNECTION_BY_SYMBOL)[keyof typeof POWER_CONNECTION_BY_SYMBOL];

export function powerConnectionForSymbol(
  symbolId: string,
): SymbolPowerConnection | undefined {
  return POWER_CONNECTION_BY_SYMBOL[
    symbolId as keyof typeof POWER_CONNECTION_BY_SYMBOL
  ];
}

export interface PlacementContactProposal {
  edits: readonly SchematicEdit[];
  matched: boolean;
  ambiguous: boolean;
  rejected?: string;
  powerNetId?: string;
  powerEndpoint?: RouteEndpoint;
  netId?: string;
  expectedElectricalEffect?: ExpectedElectricalEffect;
}

function standalonePowerNetId(
  document: SchematicDocument,
  instanceId: string,
): string {
  const preferred = `net-power-${instanceId.toLowerCase()}`;
  const occupied = new Set([
    ...document.instances.map((instance) => instance.id),
    ...document.nets.map((net) => net.id),
    ...document.routes.map((route) => route.id),
    ...document.junctions.map((junction) => junction.id),
    ...document.noConnects.map((noConnect) => noConnect.id),
    ...document.annotations.map((annotation) => annotation.id),
    ...document.connectivityEvidence.map((evidence) => evidence.id),
    ...document.layoutGroups.map((group) => group.id),
    ...document.constraints.map((constraint) => constraint.id),
    ...(document.drafting?.objects.map((object) => object.id) ?? []),
    ...(document.netlist?.terminals.map((terminal) => terminal.id) ?? []),
  ]);
  if (!occupied.has(preferred)) return preferred;

  let suffix = 2;
  while (occupied.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

/** Visible electrical anchors for an Instance that is about to be placed. */
export function placementWireSources(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
): readonly WireSource[] {
  if (!instance.placement) return [];
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return [];
  const placedDocument = {
    ...document,
    instances: [
      ...document.instances.filter((candidate) => candidate.id !== instance.id),
      instance,
    ],
  };
  return resolved.definition.pins.flatMap((pin): WireSource[] => {
    const endpoint = {
      kind: "terminal" as const,
      instanceId: instance.id,
      pinName: pin.name,
    };
    const connection = resolveEndpointConnection(
      placedDocument,
      resolver,
      endpoint,
    );
    return connection && isVisibleEndpoint(placedDocument, resolver, endpoint)
      ? [
          {
            endpoint,
            netId:
              document.nets.find((n) =>
                n.terminals.some(
                  (t) => t.instanceId === instance.id && t.pinName === pin.name,
                ),
              )?.id ?? null,
            connection,
            preludeEdits: [],
            ...(isMosBulkTerminal(placedDocument, endpoint)
              ? { routePresentation: "bulk-dashed" as const }
              : {}),
          },
        ]
      : [];
  });
}

function samePoint(
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean {
  return left.x === right.x && left.y === right.y;
}

function isEligibleSeriesInsertionPair(
  instance: Instance,
  visibleSources: readonly WireSource[],
  contactedSources: readonly WireSource[],
): boolean {
  return isEligibleSeriesInsertionPinPair(
    contactedSources.map(({ endpoint }) =>
      endpoint.kind === "terminal" ? endpoint.pinName : "",
    ),
    visibleSources.length,
    deviceDescriptor(instance.symbolId)?.seriesInsertionPinPair,
  );
}

/**
 * A component may acquire electrical connectivity only from an exact visible
 * pin-to-pin, pin-to-Junction, or pin-to-Route contact. Grid coincidence alone
 * is deliberately insufficient. Multiple independent contacts commit
 * together; multiple disconnected conductors at one point remain ambiguous.
 * Several pins landing on one conductor at distinct points are the
 * series-insertion drop and attach together, cutting the Route at each pin.
 */
export function proposePlacementContact(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
  targets: readonly WireSource[],
  options: {
    mode?: "placement" | "move";
    instances?: readonly Instance[];
  } = {},
): PlacementContactProposal {
  const contacts: Array<{
    source: WireSource;
    target: ElectricalContactTarget;
  }> = [];
  let ambiguous = false;
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const sources = (options.instances ?? [instance]).flatMap((item) =>
    placementWireSources(document, resolver, item),
  );
  for (const source of sources) {
    const sourceKey = endpointKey(source.endpoint);
    const candidates: ElectricalContactCandidate[] = targets
      .filter(
        (target) =>
          endpointKey(target.endpoint) !== sourceKey &&
          samePoint(
            source.connection.contactPoint,
            target.connection.contactPoint,
          ),
      )
      .map((target) => ({
        kind: "endpoint" as const,
        id: `endpoint:${JSON.stringify(target.endpoint)}`,
        point: target.connection.contactPoint,
        netId: target.netId,
        endpoint: target.endpoint,
      }));
    for (const address of findRouteSegmentsAtPoint(
      routingGeometry,
      source.connection.contactPoint,
    )) {
      const route = document.routes.find(
        (candidate) => candidate.id === address.routeId,
      );
      if (
        !route ||
        routeEndpoints(route).some((e) => endpointKey(e) === sourceKey)
      )
        continue;
      candidates.push({
        kind: "route" as const,
        id: `route:${route.id}:${address.segmentIndex}`,
        point: source.connection.contactPoint,
        netId: route.netId,
        routeId: route.id,
        segmentIndex: address.segmentIndex,
      });
    }
    const groups = resolveElectricalContactTargets(
      document,
      resolver,
      candidates,
    );
    if (groups.length === 1) {
      const target = groups[0]!;
      // Returning to an existing endpoint bond is a preserve transform, not
      // a fresh attach/merge. Keep both authored membership and its identity.
      if (
        options.mode === "move" &&
        target.endpoint &&
        source.netId !== null &&
        source.netId === target.endpoint.netId
      )
        continue;
      contacts.push({ source, target });
    } else if (groups.length > 1) ambiguous = true;
  }
  if (ambiguous) {
    return { edits: [], matched: false, ambiguous: true };
  }
  if (contacts.length === 0) {
    return { edits: [], matched: false, ambiguous: false };
  }
  // Several pins of one device may land on the SAME conductor. Exactly two
  // contacts form a series-insertion gesture only when the whole visible
  // device is two-terminal or its Device descriptor names that pair. This is
  // based on exact resolved pin contacts, never on symbol bounds. Any other
  // same-conductor multi-contact remains an ordinary attachment; two pins
  // claiming the exact same point remain ambiguous.
  const routeContactGroups = new Map<
    string,
    Array<{
      source: WireSource;
      route: NonNullable<ElectricalContactTarget["route"]>;
    }>
  >();
  for (const contact of contacts) {
    const route = contact.target.route;
    if (!route || contact.target.endpoint) continue;
    routeContactGroups.set(route.routeId, [
      ...(routeContactGroups.get(route.routeId) ?? []),
      { source: contact.source, route },
    ]);
  }
  for (const group of routeContactGroups.values()) {
    const pointKeys = group.map(
      (member) =>
        `${member.source.connection.contactPoint.x},${member.source.connection.contactPoint.y}`,
    );
    if (new Set(pointKeys).size !== pointKeys.length) {
      return { edits: [], matched: false, ambiguous: true };
    }
  }
  const onlyRouteContactGroup =
    routeContactGroups.size === 1
      ? [...routeContactGroups.values()][0]
      : undefined;
  const spliceGroup =
    contacts.length === 2 &&
    contacts.every(
      (c) =>
        c.source.endpoint.kind === "terminal" &&
        c.source.endpoint.instanceId === instance.id,
    ) &&
    onlyRouteContactGroup?.length === 2 &&
    isEligibleSeriesInsertionPair(
      instance,
      sources,
      onlyRouteContactGroup.map((member) => member.source),
    )
      ? onlyRouteContactGroup
      : undefined;
  const alreadyRouted = sources.some((source) =>
    document.routes.some((route) =>
      routeEndpoints(route).some(
        (endpoint) => endpointKey(endpoint) === endpointKey(source.endpoint),
      ),
    ),
  );
  if (
    spliceGroup &&
    spliceGroup.length === 2 &&
    !(options.mode === "move" && alreadyRouted)
  ) {
    const projected = structuredClone(document);
    projected.instances = [
      ...projected.instances.filter(
        (candidate) => candidate.id !== instance.id,
      ),
      structuredClone(instance),
    ];
    const splice = planSeriesInstanceSplice(
      projected,
      resolver,
      spliceGroup[0]!.route.routeId,
      [
        {
          endpoint: spliceGroup[0]!.source.endpoint,
          point: spliceGroup[0]!.source.connection.contactPoint,
          segmentIndex: spliceGroup[0]!.route.segmentIndex,
        },
        {
          endpoint: spliceGroup[1]!.source.endpoint,
          point: spliceGroup[1]!.source.connection.contactPoint,
          segmentIndex: spliceGroup[1]!.route.segmentIndex,
        },
      ],
      `splice-${instance.id.toLowerCase()}`,
    );
    return splice.ok
      ? {
          edits: splice.edits,
          matched: true,
          ambiguous: false,
          expectedElectricalEffect: splice.expectedElectricalEffect,
        }
      : {
          edits: [],
          matched: false,
          ambiguous: false,
          rejected: splice.message,
        };
  }
  const power =
    options.mode === "move"
      ? undefined
      : POWER_CONNECTION_BY_SYMBOL[
          instance.symbolId as keyof typeof POWER_CONNECTION_BY_SYMBOL
        ];
  const edits: SchematicEdit[] = [];
  // Fold all contact membership edits through the transaction's own mutations
  // before compiling any split. Later contacts must see prior Net merges, but
  // Route leg identities must remain unchanged until every split is planned.
  const contactDraft = createContactPlanningDraft(document, resolver);
  const connected = contactDraft.document;
  for (const item of options.instances ?? [instance]) {
    connected.instances = connected.instances.filter((i) => i.id !== item.id);
    connected.instances.push(structuredClone(item));
  }
  const connections = new Map<
    WireSource,
    { netId: string; newNetId: string }
  >();
  try {
    for (const { source, target } of contacts) {
      const newNetId =
        contacts.length === 1
          ? `net-contact-${instance.id.toLowerCase()}`
          : `net-contact-${source.endpoint.kind === "terminal" ? source.endpoint.instanceId.toLowerCase() + "-" + source.endpoint.pinName.toLowerCase() : instance.id.toLowerCase()}`;
      const to =
        target.endpoint?.endpoint ??
        connected.routes.find((r) => r.id === target.route!.routeId)!.start;
      const connection = contactDraft.connect(source.endpoint, to, newNetId);
      if (!connection.ok)
        return {
          edits: [],
          matched: false,
          ambiguous: false,
          rejected: connection.message,
        };
      connections.set(source, { netId: connection.netId, newNetId });
    }
  } catch (error) {
    return {
      edits: [],
      matched: false,
      ambiguous: false,
      rejected: error instanceof Error ? error.message : String(error),
    };
  }
  edits.push(...contactDraft.edits);
  let powerNetId: string | undefined;
  let powerCandidateState: "existing" | "pending-connection" | undefined;
  let powerEndpoint: RouteEndpoint | undefined;
  let netId: string | undefined;
  for (const contact of contacts) {
    const { source, target } = contact;
    if (target.endpoint) {
      const { newNetId } = connections.get(source)!;
      const createsNet = target.endpoint.netId === null;
      if (power && createsNet) powerNetId = newNetId;
      else if (power && target.endpoint.netId) {
        powerNetId = target.endpoint.netId;
      }
      if (power) {
        powerCandidateState = createsNet ? "pending-connection" : "existing";
      }
      netId = target.endpoint.netId ?? newNetId;
    } else if (target.route) {
      const group = routeContactGroups.get(target.route.routeId) ?? [];
      if (group[0]?.source === source) {
        const connectedNetId = connected.routes.find(
          (r) => r.id === target.route!.routeId,
        )!.netId;
        edits.push(
          ...(group.length === 1
            ? proposeEndpointRouteAttachment(
                connected,
                source.endpoint,
                connectedNetId,
                target.route.routeId,
                source.connection.contactPoint,
                target.route.segmentIndex,
                `contact-${instance.id.toLowerCase()}-${source.endpoint.kind === "terminal" ? source.endpoint.pinName.toLowerCase() : "pin"}`,
              )
            : proposeEndpointsRouteAttachment(
                connected,
                resolver,
                target.route.routeId,
                group.map((member) => ({
                  endpoint: member.source.endpoint,
                  endpointNetId: connectedNetId,
                  point: member.source.connection.contactPoint,
                  segmentIndex: member.route.segmentIndex,
                })),
                `contact-${instance.id.toLowerCase()}`,
              )
          ).edits,
        );
      }
      if (power) powerNetId = target.route.netId;
      if (power) powerCandidateState = "existing";
      netId = target.route.netId;
    }
    if (power) powerEndpoint = source.endpoint;
  }
  if (power && powerNetId && powerCandidateState) {
    const plan = planEnsurePowerNet(document, {
      candidateNetId: powerNetId,
      candidateState: powerCandidateState,
      domain: power.domain,
      name: power.name,
      scope: power.scope,
      evidenceId: deriveStableId(
        "connectivity-evidence",
        document.id,
        "power-marker",
        instance.id,
        powerNetId,
      ),
      owner: { kind: "power-marker", objectId: instance.id },
    });
    if (!plan.ok) {
      return {
        edits: [],
        matched: false,
        ambiguous: false,
        rejected: plan.message,
      };
    }
    edits.push(...plan.edits);
    powerNetId = plan.netId;
  }
  return {
    edits,
    matched: true,
    ambiguous: false,
    ...(powerNetId ? { powerNetId } : {}),
    ...(powerEndpoint ? { powerEndpoint } : {}),
    ...(netId ? { netId } : {}),
  };
}

export function proposedStandalonePowerConnection(
  document: SchematicDocument,
  instance: Instance,
): PlacementContactProposal {
  const power =
    POWER_CONNECTION_BY_SYMBOL[
      instance.symbolId as keyof typeof POWER_CONNECTION_BY_SYMBOL
    ];
  if (!power) return { edits: [], matched: false, ambiguous: false };
  const endpoint: RouteEndpoint = {
    kind: "terminal",
    instanceId: instance.id,
    pinName: power.pinName,
  };
  // Instance designators are deliberately reusable after deletion, while a
  // Base Net may remain alive because its wire/Junction topology remains.
  // Keep those lifetimes independent instead of assuming that VDD2 becoming
  // available also makes net-power-vdd2 available.
  const netId = standalonePowerNetId(document, instance.id);
  const plan = planEnsurePowerNet(document, {
    candidateNetId: netId,
    candidateState: "pending-connection",
    domain: power.domain,
    name: power.name,
    scope: power.scope,
    evidenceId: deriveStableId(
      "connectivity-evidence",
      document.id,
      "power-marker",
      instance.id,
      netId,
    ),
    owner: { kind: "power-marker", objectId: instance.id },
  });
  if (!plan.ok) {
    return {
      edits: [],
      matched: false,
      ambiguous: false,
      rejected: plan.message,
    };
  }
  return {
    edits: [
      {
        kind: "connect_endpoints",
        from: endpoint,
        to: endpoint,
        newNetId: netId,
      },
      ...plan.edits,
    ],
    matched: false,
    ambiguous: false,
    powerNetId: plan.netId,
    powerEndpoint: endpoint,
  };
}

/**
 * Put one supply marker on a supply of its own.
 *
 * Every VDD marker joins the Net named VDD, which is right: two markers
 * carrying the same name are the same supply, and renaming that Net renames
 * the supply everywhere it is used. What was missing is the other intent —
 * "this one is a different rail" — because a design routinely carries VDDH
 * and VDDL, or VDD1 and VDD2, at once.
 *
 * So a new name detaches rather than renames: the marker leaves the shared
 * Net, takes a Net of its own, and claims the new name there. The supply it
 * left keeps its name and every other marker on it. Naming it back to VDD
 * rejoins the shared Net by the same rule, because that is what the name
 * means.
 */
export function proposedSupplyPortRename(
  document: SchematicDocument,
  instance: Instance,
  name: string,
): { edits: SchematicEdit[]; netId?: string; rejected?: string } {
  const result = planElectricalMarkerRename(document, instance.id, name);
  if (result.status === "rejected") {
    return { edits: [], rejected: result.message };
  }
  if (result.status === "noop") return { edits: [] };
  const netId = result.plan.edits
    .flatMap((edit) =>
      edit.kind === "connect_endpoints" && edit.newNetId ? [edit.newNetId] : [],
    )
    .at(-1);
  return {
    edits: [...result.plan.edits],
    ...(netId ? { netId } : {}),
  };
}

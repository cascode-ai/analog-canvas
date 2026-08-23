import {
  planEnsurePowerNet,
  proposeEndpointRouteAttachment,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import {
  findRouteSegmentsAtPoint,
  resolveDocumentRoutingGeometry,
  resolveElectricalContactTargets,
} from "@icm/derived";
import type {
  ElectricalContactCandidate,
  ElectricalContactTarget,
} from "@icm/derived";
import { deriveStableId, transformPoint } from "@icm/model";
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
}

function newInstanceEndpoints(
  resolver: SymbolResolver,
  instance: Instance,
): readonly WireSource[] {
  if (!instance.placement) return [];
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return [];
  return resolved.definition.pins.flatMap((pin): WireSource[] => {
    const endpoint = {
      kind: "terminal" as const,
      instanceId: instance.id,
      pinName: pin.name,
    };
    return !resolved.variant?.hiddenPinNames.includes(pin.name) &&
      pin.presentation.visibility !== "implicit"
      ? [
          {
            endpoint,
            netId: null,
            point: transformPoint(
              pin.at,
              instance.placement!.position,
              instance.placement!,
            ),
            preludeEdits: [],
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

/**
 * A component may acquire electrical connectivity only from an exact visible
 * pin-to-pin, pin-to-Junction, or pin-to-Route contact. Grid coincidence alone
 * is deliberately insufficient. Multiple independent contacts commit
 * together; multiple disconnected conductors at one point remain ambiguous.
 */
export function proposePlacementContact(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
  targets: readonly WireSource[],
): PlacementContactProposal {
  const contacts: Array<{
    source: WireSource;
    target: ElectricalContactTarget;
  }> = [];
  let ambiguous = false;
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  for (const source of newInstanceEndpoints(resolver, instance)) {
    const candidates: ElectricalContactCandidate[] = targets
      .filter((target) => samePoint(source.point, target.point))
      .map((target) => ({
        kind: "endpoint" as const,
        id: `endpoint:${JSON.stringify(target.endpoint)}`,
        point: target.point,
        netId: target.netId,
        endpoint: target.endpoint,
      }));
    for (const address of findRouteSegmentsAtPoint(
      routingGeometry,
      source.point,
    )) {
      const route = document.routes.find(
        (candidate) => candidate.id === address.routeId,
      );
      if (!route) continue;
      candidates.push({
        kind: "route" as const,
        id: `route:${route.id}:${address.segmentIndex}`,
        point: source.point,
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
    if (groups.length === 1) contacts.push({ source, target: groups[0]! });
    else if (groups.length > 1) ambiguous = true;
  }
  if (ambiguous) {
    return { edits: [], matched: false, ambiguous: true };
  }
  if (contacts.length === 0) {
    return { edits: [], matched: false, ambiguous: false };
  }
  const routeIds = contacts.flatMap((contact) =>
    contact.target.route ? [contact.target.route.routeId] : [],
  );
  if (new Set(routeIds).size !== routeIds.length) {
    return { edits: [], matched: false, ambiguous: true };
  }
  const power =
    POWER_CONNECTION_BY_SYMBOL[
      instance.symbolId as keyof typeof POWER_CONNECTION_BY_SYMBOL
    ];
  const edits: SchematicEdit[] = [];
  let powerNetId: string | undefined;
  let powerCandidateState: "existing" | "pending-connection" | undefined;
  let powerEndpoint: RouteEndpoint | undefined;
  let netId: string | undefined;
  for (const contact of contacts) {
    const { source, target } = contact;
    if (target.endpoint) {
      const newNetId =
        contacts.length === 1
          ? `net-contact-${instance.id.toLowerCase()}`
          : `net-contact-${instance.id.toLowerCase()}-${
              source.endpoint.kind === "terminal"
                ? source.endpoint.pinName.toLowerCase()
                : "pin"
            }`;
      const createsNet = target.endpoint.netId === null;
      edits.push({
        kind: "connect_endpoints",
        from: source.endpoint,
        to: target.endpoint.endpoint,
        ...(createsNet ? { newNetId } : {}),
      });
      if (power && createsNet) powerNetId = newNetId;
      else if (power && target.endpoint.netId) {
        powerNetId = target.endpoint.netId;
      }
      if (power) {
        powerCandidateState = createsNet ? "pending-connection" : "existing";
      }
      netId = target.endpoint.netId ?? newNetId;
    } else if (target.route) {
      edits.push(
        ...proposeEndpointRouteAttachment(
          document,
          source.endpoint,
          null,
          target.route.routeId,
          source.point,
          target.route.segmentIndex,
          `contact-${instance.id.toLowerCase()}-${source.endpoint.kind === "terminal" ? source.endpoint.pinName.toLowerCase() : "pin"}`,
        ).edits,
      );
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
  const netId = `net-power-${instance.id.toLowerCase()}`;
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
  const power = powerConnectionForSymbol(instance.symbolId);
  if (!power) return { edits: [], rejected: "Not a supply marker" };
  const requested = name.trim();
  if (!requested) return { edits: [], rejected: "A supply needs a name" };

  const endpoint: RouteEndpoint = {
    kind: "terminal",
    instanceId: instance.id,
    pinName: power.pinName,
  };
  // A fresh Net per name, so renaming twice cannot land back on a Net the
  // marker already left behind.
  const candidateNetId = deriveStableId(
    "net",
    document.id,
    "power",
    instance.id,
    requested.toLowerCase(),
  );
  const plan = planEnsurePowerNet(document, {
    candidateNetId,
    candidateState: "pending-connection",
    domain: power.domain,
    name: requested,
    scope: power.scope,
    evidenceId: deriveStableId(
      "connectivity-evidence",
      document.id,
      "power-marker",
      instance.id,
      candidateNetId,
    ),
    owner: { kind: "power-marker", objectId: instance.id },
  });
  if (!plan.ok) return { edits: [], rejected: plan.message };

  // The claim this marker used to make on its old supply has to go, or it
  // keeps that Net named after a marker that is no longer on it.
  const staleClaims = document.connectivityEvidence.filter(
    (evidence) =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker" &&
      evidence.owner.objectId === instance.id,
  );

  // The marker's own label reads the Net it names. Left pointing at the Net
  // the marker just left, it resolves to nothing and the label goes blank.
  const boundLabels = document.annotations.filter(
    (annotation) =>
      annotation.binding?.kind === "net-name" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instance.id,
  );

  return {
    edits: [
      { kind: "disconnect_endpoint", endpoint },
      ...staleClaims.map((evidence): SchematicEdit => ({
        kind: "remove_connectivity_evidence",
        evidenceId: evidence.id,
      })),
      {
        kind: "connect_endpoints",
        from: endpoint,
        to: endpoint,
        newNetId: candidateNetId,
      },
      ...plan.edits,
      ...boundLabels.map((annotation): SchematicEdit => ({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          netId: plan.netId,
          binding: { kind: "net-name", netId: plan.netId },
        },
      })),
    ],
    netId: plan.netId,
  };
}

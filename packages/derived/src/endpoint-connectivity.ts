import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { DocumentConnectivityIndex } from "./connectivity-index.js";
import { endpointKey } from "./endpoint.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";

export type EndpointMembership = "unbound" | "singleton" | "peer-connected";

export interface EndpointConnectivityIntent {
  explicitNoConnect: boolean;
  implicit: boolean;
  formalBoundary: boolean;
  globalSupply: boolean;
}

/**
 * One pure, revision-local answer to two deliberately separate questions:
 * what electrical peers does this endpoint have, and which explicit design
 * intents make an otherwise peerless endpoint acceptable? This is derived
 * from the canonical Base/Logical-Net model and is never persisted.
 */
export interface EndpointConnectivityAssessment {
  endpoint: RouteEndpoint;
  baseNetId: string | null;
  logicalNetId: string | null;
  membership: EndpointMembership;
  peerEndpoints: readonly RouteEndpoint[];
  intent: EndpointConnectivityIntent;
  electricallySatisfied: boolean;
}

export interface EndpointConnectivityClassifier {
  assess(endpoint: RouteEndpoint): EndpointConnectivityAssessment;
}

function sameEndpoint(left: RouteEndpoint, right: RouteEndpoint): boolean {
  return endpointKey(left) === endpointKey(right);
}

export function createEndpointConnectivityClassifier(
  document: SchematicDocument,
  index: DocumentConnectivityIndex | undefined,
  resolver: SymbolResolver,
): EndpointConnectivityClassifier {
  const logicalResolution = resolveDocumentLogicalNets(document);
  const noConnectKeys = new Set(
    document.noConnects.map((record) => endpointKey(record.endpoint)),
  );

  return {
    assess(endpoint): EndpointConnectivityAssessment {
      const key = endpointKey(endpoint);
      const baseNetId = index?.endpointToBaseNetId.get(key) ?? null;
      const record = baseNetId
        ? index?.logicalNetByBaseNetId.get(baseNetId)
        : undefined;
      const peers = (record?.logicalEndpoints ?? []).filter(
        (candidate) => !sameEndpoint(candidate, endpoint),
      );
      const membership: EndpointMembership = !baseNetId
        ? "unbound"
        : peers.length > 0
          ? "peer-connected"
          : "singleton";
      const logicalGroup = baseNetId
        ? logicalResolution.byBaseNetId.get(baseNetId)
        : undefined;
      const formalBoundary = Boolean(
        logicalGroup &&
        document.netlist?.terminals.some((terminal) =>
          logicalGroup.baseNetIds.includes(terminal.netId),
        ),
      );
      const globalSupply = Boolean(
        logicalGroup?.scope === "global" &&
        (logicalGroup.powerDomain === "vdd" ||
          logicalGroup.powerDomain === "ground"),
      );
      let implicit = false;
      if (endpoint.kind === "terminal") {
        const instance = document.instances.find(
          (candidate) => candidate.id === endpoint.instanceId,
        );
        const resolved = instance
          ? resolver.resolve(instance.symbolId, instance.symbolVariantId)
          : undefined;
        implicit = Boolean(
          resolved?.definition.pins.find((pin) => pin.name === endpoint.pinName)
            ?.presentation.visibility === "implicit",
        );
      }
      const intent: EndpointConnectivityIntent = {
        explicitNoConnect: noConnectKeys.has(key),
        implicit,
        formalBoundary,
        globalSupply,
      };
      return {
        endpoint,
        baseNetId,
        logicalNetId: record?.netId ?? null,
        membership,
        peerEndpoints: peers,
        intent,
        electricallySatisfied:
          membership === "peer-connected" ||
          intent.explicitNoConnect ||
          intent.implicit ||
          intent.formalBoundary ||
          intent.globalSupply,
      };
    },
  };
}

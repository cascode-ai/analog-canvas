import { deriveStableId, routeEnd } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { deriveDocumentContactEvidence } from "./contact.js";
import { endpointKey } from "./endpoint.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";

export interface NameClaimFact {
  readonly evidenceId: string;
  readonly netId: string;
  readonly name: string;
  readonly scope: "local" | "global";
  readonly powerDomain?: "vdd" | "ground";
}

export interface ElectricalTopologyProjection {
  readonly endpointToBaseNet: ReadonlyMap<string, string>;
  readonly endpointToPhysicalComponent: ReadonlyMap<string, string>;
  readonly logicalNetByBaseNet: ReadonlyMap<string, string>;
  readonly nameClaimsByOwner: ReadonlyMap<string, NameClaimFact>;
  readonly routeIncidence: ReadonlyMap<string, readonly string[]>;
  readonly junctionIncidence: ReadonlyMap<string, readonly string[]>;
}

class DisjointSet {
  readonly #parent = new Map<string, string>();

  add(key: string): void {
    if (!this.#parent.has(key)) this.#parent.set(key, key);
  }

  find(key: string): string {
    const parent = this.#parent.get(key);
    if (!parent) throw new Error(`Unknown electrical endpoint ${key}`);
    if (parent === key) return key;
    const root = this.find(parent);
    this.#parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    this.add(left);
    this.add(right);
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [survivor, removed] = [leftRoot, rightRoot].sort((a, b) =>
      a.localeCompare(b, "en"),
    );
    this.#parent.set(removed!, survivor!);
  }
}

function ownerKey(
  owner: {
    kind: "net-label" | "power-marker" | "global-declaration";
    annotationId?: string;
    objectId?: string;
    sourceNetId?: string;
  },
  netId: string,
): string {
  switch (owner.kind) {
    case "net-label":
      return `net-label:${owner.annotationId}`;
    case "power-marker":
      return `power-marker:${owner.objectId}`;
    case "global-declaration":
      return `global-declaration:${owner.sourceNetId}:${netId}`;
  }
}

/**
 * Derive the electrical facts used to validate a planned routing operation.
 * The projection is independent of a planner's changed-object report.
 */
export function deriveElectricalTopologyProjection(
  document: SchematicDocument,
  resolver?: SymbolResolver,
): ElectricalTopologyProjection {
  const endpointToBaseNet = new Map<string, string>();
  const sets = new DisjointSet();
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      const key = endpointKey({ kind: "terminal", ...terminal });
      endpointToBaseNet.set(key, net.id);
      sets.add(key);
    }
  }
  for (const junction of document.junctions) {
    const key = endpointKey({ kind: "junction", junctionId: junction.id });
    endpointToBaseNet.set(key, junction.netId);
    sets.add(key);
  }

  const routeIncidence = new Map<string, readonly string[]>();
  const junctionIncidenceMutable = new Map<string, string[]>();
  for (const route of document.routes) {
    const keys = [endpointKey(route.start), endpointKey(routeEnd(route))];
    routeIncidence.set(route.id, keys);
    sets.union(keys[0]!, keys[1]!);
    for (const endpoint of [route.start, routeEnd(route)]) {
      if (endpoint.kind !== "junction") continue;
      const incident = junctionIncidenceMutable.get(endpoint.junctionId) ?? [];
      incident.push(route.id);
      junctionIncidenceMutable.set(endpoint.junctionId, incident);
    }
  }
  if (resolver) {
    for (const contact of deriveDocumentContactEvidence(document, resolver)
      .contacts) {
      const keys = contact.endpoints.map(endpointKey);
      const first = keys[0];
      if (!first) continue;
      for (const key of keys.slice(1)) sets.union(first, key);
    }
  }

  const endpointToPhysicalComponent = new Map<string, string>();
  for (const [key, netId] of endpointToBaseNet) {
    endpointToPhysicalComponent.set(
      key,
      deriveStableId("physical-component", netId, sets.find(key)),
    );
  }
  const logicalNetByBaseNet = new Map<string, string>();
  for (const group of resolveDocumentLogicalNets(document).groups) {
    for (const netId of group.baseNetIds) {
      logicalNetByBaseNet.set(netId, group.id);
    }
  }
  const nameClaimsByOwner = new Map<string, NameClaimFact>();
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "name-claim") continue;
    nameClaimsByOwner.set(ownerKey(evidence.owner, evidence.netId), {
      evidenceId: evidence.id,
      netId: evidence.netId,
      name: evidence.name,
      scope: evidence.scope,
      ...(evidence.powerDomain ? { powerDomain: evidence.powerDomain } : {}),
    });
  }
  const junctionIncidence = new Map<string, readonly string[]>();
  for (const junction of document.junctions) {
    junctionIncidence.set(
      junction.id,
      [...(junctionIncidenceMutable.get(junction.id) ?? [])].sort((a, b) =>
        a.localeCompare(b, "en"),
      ),
    );
  }
  return {
    endpointToBaseNet,
    endpointToPhysicalComponent,
    logicalNetByBaseNet,
    nameClaimsByOwner,
    routeIncidence,
    junctionIncidence,
  };
}

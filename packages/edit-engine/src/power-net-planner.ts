import { resolveDocumentLogicalNets } from "@icm/derived";
import type { ConnectivityEvidence, SchematicDocument } from "@icm/model";

import type { SchematicEdit } from "./edit-schema.js";
import { planEnsureNamedNet } from "./named-net-planner.js";

type PowerDomain = "vdd" | "ground";

type PowerMarkerOwner = Extract<
  ConnectivityEvidence,
  { kind: "name-claim" }
>["owner"];

export type PowerNetCandidateState =
  "existing" | "pending-connection" | "created-power";

export interface EnsurePowerNetRequest {
  /** Caller-owned Base Net, existing now or created earlier in the transaction. */
  candidateNetId: string;
  candidateState: PowerNetCandidateState;
  domain: PowerDomain;
  evidenceId: string;
  owner: PowerMarkerOwner;
  /** Supply markers may use AVDD/DVDD; Ground defaults to SPICE node 0. */
  name?: string;
  scope?: "local" | "global";
}

export type EnsurePowerNetPlan =
  | { ok: true; netId: string; edits: readonly SchematicEdit[] }
  | { ok: false; message: string; relatedNetIds: readonly string[] };

export function canonicalPowerName(domain: PowerDomain): "0" | "VDD" {
  return domain === "ground" ? "0" : "VDD";
}

/** Stable IDs remain useful for import/migration, never for electrical lookup. */
export function preferredPowerNetId(domain: PowerDomain): string {
  return domain === "ground" ? "net-global-0" : "net-global-vdd";
}

/**
 * Power, Ground, VDD and named supplies use the ordinary named-Net marker
 * protocol. The planner never merges Base Nets and never writes Net.name.
 */
export function planEnsurePowerNet(
  document: SchematicDocument,
  request: EnsurePowerNetRequest,
): EnsurePowerNetPlan {
  const requestedName =
    request.name?.trim() || canonicalPowerName(request.domain);
  const requestedScope = request.scope ?? "global";
  const candidate = document.nets.find(
    (net) => net.id === request.candidateNetId,
  );
  if (request.candidateState === "existing" && !candidate) {
    return {
      ok: false,
      message: `Power Net candidate does not exist: ${request.candidateNetId}`,
      relatedNetIds: [request.candidateNetId],
    };
  }

  if (candidate) {
    const logical = resolveDocumentLogicalNets(document).byBaseNetId.get(
      candidate.id,
    );
    if (
      logical?.name &&
      logical.name.toLowerCase() !== requestedName.toLowerCase()
    ) {
      return {
        ok: false,
        message: `Cannot attach ${requestedName} to differently named Net ${logical.name}`,
        relatedNetIds: [...logical.baseNetIds],
      };
    }
    if (
      logical &&
      logical.powerDomain !== "none" &&
      logical.powerDomain !== request.domain
    ) {
      return {
        ok: false,
        message: `Cannot attach ${requestedName} to Net with incompatible power role ${logical.powerDomain}`,
        relatedNetIds: [...logical.baseNetIds],
      };
    }
  }

  const planningDocument = structuredClone(document);
  if (!candidate) {
    planningDocument.nets.push({
      id: request.candidateNetId,
      scope: "local",
      powerDomain: "none",
      terminals: [],
    });
  }
  const plan = planEnsureNamedNet(planningDocument, {
    candidateNetId: request.candidateNetId,
    name: requestedName,
    evidenceId: request.evidenceId,
    owner: request.owner,
    scope: requestedScope,
    powerDomain: request.domain,
  });
  return plan.ok ? { ok: true, netId: plan.netId, edits: plan.edits } : plan;
}

import { foldNetName } from "@icm/model";
import type { ConnectivityEvidence } from "@icm/model";

import type { SchematicEdit } from "./edit-schema.js";

type NameClaim = Extract<ConnectivityEvidence, { kind: "name-claim" }>;

export type EnsureNamedNetPlan =
  | { ok: true; netId: string; name: string; edits: readonly SchematicEdit[] }
  | { ok: false; message: string; relatedNetIds: readonly string[] };

export interface NamedNetPlannerDocument {
  nets: readonly { id: string }[];
  connectivityEvidence: readonly ConnectivityEvidence[];
}

/** Author an owner-addressed name without merging physical Base Nets. */
export function planEnsureNamedNet(
  document: NamedNetPlannerDocument,
  request: {
    candidateNetId: string;
    name: string;
    evidenceId: string;
    owner: NameClaim["owner"];
    scope?: "local" | "global";
    powerDomain?: "vdd" | "ground";
  },
): EnsureNamedNetPlan {
  const candidate = document.nets.find(
    (net) => net.id === request.candidateNetId,
  );
  if (!candidate) {
    return {
      ok: false,
      message: `Named Net candidate does not exist: ${request.candidateNetId}`,
      relatedNetIds: [request.candidateNetId],
    };
  }
  const name = request.name.trim();
  if (!name) {
    return {
      ok: false,
      message: "Named Net claim cannot be empty",
      relatedNetIds: [candidate.id],
    };
  }
  const scope = request.scope ?? "local";
  const foldedName = foldNetName(name);
  const matchingNetIds = new Set(
    document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "name-claim" &&
      evidence.scope === scope &&
      foldNetName(evidence.name) === foldedName
        ? [evidence.netId]
        : [],
    ),
  );
  const existingDomains = new Set(
    document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "name-claim" &&
      matchingNetIds.has(evidence.netId) &&
      evidence.powerDomain
        ? [evidence.powerDomain]
        : [],
    ),
  );
  if (request.powerDomain) existingDomains.add(request.powerDomain);
  if (existingDomains.size > 1) {
    return {
      ok: false,
      message: "Cannot join named Nets with incompatible power roles",
      relatedNetIds: [...matchingNetIds, candidate.id],
    };
  }

  const evidence: NameClaim = {
    id: request.evidenceId,
    kind: "name-claim",
    netId: candidate.id,
    name,
    owner: request.owner,
    scope,
    ...(request.powerDomain ? { powerDomain: request.powerDomain } : {}),
  };
  const existingEvidence = document.connectivityEvidence.find(
    (item) => item.id === evidence.id,
  );
  const edits: SchematicEdit[] = [];
  // An imported explicit-property claim remains owner-addressed evidence.
  // Editing a visible owner adopts it so one physical Net does not retain two
  // contradictory names. Other label/Port owners remain independently owned.
  for (const item of document.connectivityEvidence) {
    if (
      item.id !== evidence.id &&
      item.kind === "name-claim" &&
      item.netId === candidate.id &&
      item.owner.kind === "explicit-net-property" &&
      item.name !== name
    ) {
      edits.push({
        kind: "upsert_connectivity_evidence",
        evidence: { ...item, name },
      });
    }
  }
  if (JSON.stringify(existingEvidence) !== JSON.stringify(evidence)) {
    edits.push({ kind: "upsert_connectivity_evidence", evidence });
  }
  return { ok: true, netId: candidate.id, name, edits };
}

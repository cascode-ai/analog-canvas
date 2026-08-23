import { foldNetName } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

export type LogicalNetConflictCode =
  "name-conflict" | "scope-conflict" | "power-domain-conflict";
export type LogicalNetPowerDomain = "none" | "vdd" | "ground" | "conflict";

export interface ResolvedLogicalNet {
  /** Stable canonical Base-Net ID; derived groups are never persisted. */
  id: string;
  baseNetIds: readonly string[];
  name?: string;
  scope?: "local" | "global";
  powerDomain: LogicalNetPowerDomain;
  evidenceIds: readonly string[];
  sourceNetIds: readonly string[];
  conflicts: readonly LogicalNetConflictCode[];
}

export interface ResolvedDocumentLogicalNets {
  groups: readonly ResolvedLogicalNet[];
  byId: ReadonlyMap<string, ResolvedLogicalNet>;
  byBaseNetId: ReadonlyMap<string, ResolvedLogicalNet>;
}

export type LogicalNetContractIssue = {
  code:
    | "CONFLICTING_LOGICAL_NET_NAME"
    | "CONFLICTING_LOGICAL_NET_SCOPE"
    | "CONFLICTING_LOGICAL_NET_POWER_DOMAIN";
  netIds: readonly string[];
};

export function logicalNetContractIssueKey(
  issue: LogicalNetContractIssue,
): string {
  return `${issue.code}:${issue.netIds.join(",")}`;
}

class DisjointSet {
  readonly parent = new Map<string, string>();

  constructor(ids: readonly string[]) {
    for (const id of ids) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent || parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort((a, b) =>
      a.localeCompare(b, "en"),
    );
    this.parent.set(second!, first!);
  }
}

function unionGroups(
  set: DisjointSet,
  groups: Iterable<readonly string[]>,
): void {
  for (const ids of groups) {
    const [first, ...rest] = ids;
    if (!first) continue;
    for (const id of rest) set.union(first, id);
  }
}

/**
 * Resolve Document-local logical identity from schema-22 evidence. Physical
 * Base Nets remain intact; this pure result is the only name/source folding
 * implementation used by editor and netlist consumers.
 */
export function resolveDocumentLogicalNets(
  document: SchematicDocument,
): ResolvedDocumentLogicalNets {
  const baseNetIds = document.nets
    .map((net) => net.id)
    .sort((left, right) => left.localeCompare(right, "en"));
  const set = new DisjointSet(baseNetIds);

  unionGroups(
    set,
    document.connectivityEvidence.flatMap((evidence) =>
      evidence.kind === "explicit-equivalence" ? [evidence.memberNetIds] : [],
    ),
  );

  const byScopedName = new Map<string, string[]>();
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "name-claim") continue;
    const key = `${evidence.scope}\u0000${foldNetName(evidence.name)}`;
    const ids = byScopedName.get(key) ?? [];
    ids.push(evidence.netId);
    byScopedName.set(key, ids);
  }
  unionGroups(set, byScopedName.values());

  const bySource = new Map<string, string[]>();
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "spice-source") continue;
    const ids = bySource.get(evidence.sourceNetId) ?? [];
    ids.push(evidence.netId);
    bySource.set(evidence.sourceNetId, ids);
  }
  unionGroups(set, bySource.values());

  const membersByRoot = new Map<string, string[]>();
  for (const netId of baseNetIds) {
    const root = set.find(netId);
    const members = membersByRoot.get(root) ?? [];
    members.push(netId);
    membersByRoot.set(root, members);
  }

  const groups = [...membersByRoot.values()]
    .map((members): ResolvedLogicalNet => {
      members.sort((left, right) => left.localeCompare(right, "en"));
      const memberSet = new Set(members);
      const evidence = document.connectivityEvidence
        .filter((item) =>
          item.kind === "explicit-equivalence"
            ? item.memberNetIds.some((netId) => memberSet.has(netId))
            : memberSet.has(item.netId),
        )
        .sort((left, right) => left.id.localeCompare(right.id, "en"));
      const nameCandidates = evidence.flatMap((item) =>
        item.kind === "name-claim" ? [item.name] : [],
      );
      const namesByFolded = new Map<string, string>();
      for (const name of nameCandidates) {
        const folded = foldNetName(name);
        if (!namesByFolded.has(folded)) namesByFolded.set(folded, name.trim());
      }
      const scopes = new Set(
        evidence.flatMap((item) =>
          item.kind === "name-claim" ? [item.scope] : [],
        ),
      );
      if (scopes.size === 0) scopes.add("local");
      const powerDomains = new Set<"vdd" | "ground">();
      for (const item of evidence) {
        if (item.kind === "name-claim" && item.powerDomain) {
          powerDomains.add(item.powerDomain);
        }
      }
      const powerDomain: LogicalNetPowerDomain =
        powerDomains.size > 1
          ? "conflict"
          : (powerDomains.values().next().value ?? "none");
      const conflicts: LogicalNetConflictCode[] = [];
      if (namesByFolded.size > 1) {
        conflicts.push("name-conflict");
      }
      if (scopes.size > 1) conflicts.push("scope-conflict");
      if (powerDomain === "conflict") {
        conflicts.push("power-domain-conflict");
      }
      const sourceNetIds = [
        ...new Set(
          evidence.flatMap((item) =>
            item.kind === "spice-source" ? [item.sourceNetId] : [],
          ),
        ),
      ].sort((left, right) => left.localeCompare(right, "en"));
      return {
        id: members[0]!,
        baseNetIds: members,
        ...(namesByFolded.size === 1
          ? { name: [...namesByFolded.values()][0]! }
          : {}),
        ...(scopes.size === 1
          ? { scope: [...scopes][0] as "local" | "global" }
          : {}),
        powerDomain,
        evidenceIds: evidence.map((item) => item.id),
        sourceNetIds,
        conflicts,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const byBaseNetId = new Map(
    groups.flatMap((group) =>
      group.baseNetIds.map((netId) => [netId, group] as const),
    ),
  );
  return { groups, byId, byBaseNetId };
}

/** Electrical naming invariants evaluated on the one resolved semantic view. */
export function validateLogicalNetContract(
  document: SchematicDocument,
): readonly LogicalNetContractIssue[] {
  return resolveDocumentLogicalNets(document)
    .groups.flatMap((group): LogicalNetContractIssue[] => [
      ...(group.conflicts.includes("name-conflict")
        ? [
            {
              code: "CONFLICTING_LOGICAL_NET_NAME" as const,
              netIds: group.baseNetIds,
            },
          ]
        : []),
      ...(group.conflicts.includes("scope-conflict")
        ? [
            {
              code: "CONFLICTING_LOGICAL_NET_SCOPE" as const,
              netIds: group.baseNetIds,
            },
          ]
        : []),
      ...(group.conflicts.includes("power-domain-conflict")
        ? [
            {
              code: "CONFLICTING_LOGICAL_NET_POWER_DOMAIN" as const,
              netIds: group.baseNetIds,
            },
          ]
        : []),
    ])
    .sort((left, right) =>
      logicalNetContractIssueKey(left).localeCompare(
        logicalNetContractIssueKey(right),
        "en",
      ),
    );
}

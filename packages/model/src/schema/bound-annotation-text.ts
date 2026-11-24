import { isFrozenSnapshot } from "../immutable-snapshot.js";

/**
 * The Document shape this reader needs. It is stated structurally rather than
 * as the parsed `SchematicDocument` so the compatibility layer can call it on
 * a Project that has not been through the schema yet — which is exactly when
 * a stale format override has to be repaired.
 */
interface BoundAnnotationSource {
  instances?: readonly { id: string; reference?: string | undefined }[];
  netlist?: { terminals: readonly { id: string; name: string }[] } | undefined;
  connectivityEvidence?: readonly {
    kind: string;
    netId?: string | undefined;
    name?: string | undefined;
    // Not every evidence kind carries an owner; only name claims do.
    owner?:
      | {
          kind: string;
          annotationId?: string | undefined;
          objectId?: string | undefined;
        }
      | undefined;
  }[];
}

type EvidenceList = NonNullable<BoundAnnotationSource["connectivityEvidence"]>;
type ClaimGroups = ReadonlyMap<string | undefined, EvidenceList>;
type AcceptClaim = (evidence: EvidenceList[number]) => boolean;
export type AnnotationNameClaimReader = (
  netId: string | undefined,
  accepts: AcceptClaim,
) => EvidenceList[number] | undefined;
const snapshotClaims = new WeakMap<EvidenceList, ClaimGroups>();

function groupNameClaims(evidence: EvidenceList): ClaimGroups {
  const owned = isFrozenSnapshot(evidence);
  const cached = owned ? snapshotClaims.get(evidence) : undefined;
  if (cached) return cached;
  const groups = new Map<string | undefined, EvidenceList[number][]>();
  for (const item of evidence) {
    if (item.kind !== "name-claim") continue;
    const group = groups.get(item.netId);
    if (group) group.push(item);
    else groups.set(item.netId, [item]);
  }
  if (owned) snapshotClaims.set(evidence, groups);
  return groups;
}

function firstClaim(
  candidates: EvidenceList | undefined,
  accepts: AcceptClaim,
) {
  // Keep the bucket private, including the array argument of Array.find.
  for (const item of candidates ?? []) if (accepts(item)) return item;
  return undefined;
}

/** Use during a single read pass. A subsequent pass over a draft builds from its current facts. */
export function createAnnotationNameClaimReader(
  document: BoundAnnotationSource,
): AnnotationNameClaimReader {
  let groups: ClaimGroups | undefined;
  return (netId, accepts) => {
    groups ??= groupNameClaims(document.connectivityEvidence ?? []);
    return firstClaim(groups.get(netId), accepts);
  };
}

export function findAnnotationNameClaim(
  document: BoundAnnotationSource,
  netId: string | undefined,
  accepts: AcceptClaim,
  readClaims?: AnnotationNameClaimReader,
): EvidenceList[number] | undefined {
  if (readClaims) return readClaims(netId, accepts);
  const evidence = document.connectivityEvidence;
  if (evidence && isFrozenSnapshot(evidence))
    return firstClaim(groupNameClaims(evidence).get(netId), accepts);
  return evidence?.find(
    (item) =>
      item.kind === "name-claim" && item.netId === netId && accepts(item),
  );
}

interface BoundAnnotationLike {
  id: string;
  kind: string;
  anchor: { kind: string; objectId?: string | undefined };
  binding?:
    | {
        kind: string;
        instanceId?: string | undefined;
        terminalId?: string | undefined;
        netId?: string | undefined;
        memberEndpoint?: unknown;
        memberEndpoints?: unknown;
      }
    | undefined;
}

/**
 * The text a bound Annotation is obliged to read as: its Instance's Reference,
 * its Cell terminal's name, or the Net name it claims, compiled to the house
 * style.
 *
 * This is the single authority for that question. The schema uses it to refuse
 * a format override that no longer says the name it presents, and the
 * compatibility layer uses it to repair one — and those two must never drift,
 * because a repair computed differently from the check either fails to fix the
 * file or reports success on a file that still cannot load.
 *
 * Returns null when the Annotation binds to nothing, which has no obligation.
 */
export function boundAnnotationName(
  document: BoundAnnotationSource,
  annotation: BoundAnnotationLike,
  readClaims?: AnnotationNameClaimReader,
): string | null {
  const binding = annotation.binding;
  if (!binding) return null;

  if (binding.kind === "instance-reference") {
    return (
      (document.instances ?? []).find(
        (instance) => instance.id === binding.instanceId,
      )?.reference ?? ""
    );
  }
  if (binding.kind === "cell-terminal-name") {
    return (
      document.netlist?.terminals.find(
        (terminal) => terminal.id === binding.terminalId,
      )?.name ?? ""
    );
  }
  if (binding.kind !== "net-name") return null;
  // A selector may read a caller's formal interface through a Symbol Resolver.
  // Its renderer accepts a format only while it still presents that live name.
  if (binding.memberEndpoint || binding.memberEndpoints) return null;

  // Pre-parse callers reach this before schema defaults are applied, so the
  // arrays this reads may legitimately be absent rather than empty.
  const nameClaim = findAnnotationNameClaim(
    document,
    binding.netId,
    (evidence) =>
      (evidence.owner?.kind === "net-label" &&
        evidence.owner.annotationId === annotation.id) ||
      // A power-marker claim is owned by the marker instance for supply
      // ports, but a drawn power rail's claim is owned by the label
      // annotation itself — both spellings name this annotation's net.
      (evidence.owner?.kind === "power-marker" &&
        ((annotation.anchor.kind === "object" &&
          evidence.owner.objectId === annotation.anchor.objectId) ||
          evidence.owner.objectId === annotation.id)),
    readClaims,
  );
  return nameClaim?.name ?? "";
}

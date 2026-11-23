import {
  foldNetName,
  isFrozenSnapshot,
  scalarConnectivityEvidence,
  scalarCellTerminals,
  routeEnd,
  type RouteBranch,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveCommittedDocumentLogicalNets,
  type EndpointObjectLookup,
} from "@icm/derived";
import type { EditTransaction } from "./edit-schema.js";

export function scalarRenameGroup(
  document: SchematicDocument,
  transaction: EditTransaction,
): ReadonlySet<string> | undefined {
  const [edit, presentation] = transaction.edits;
  if (
    !isFrozenSnapshot(document) ||
    transaction.edits.length > 2 ||
    edit?.kind !== "upsert_connectivity_evidence"
  )
    return undefined;
  const claim = edit.evidence;
  if (claim.kind !== "name-claim" || claim.signal) return undefined;
  const old = document.connectivityEvidence.find(
    (item) => item.id === claim.id,
  );
  if (old?.kind !== "name-claim" || old.signal || old.netId !== claim.netId)
    return undefined;
  // The text editor can save the same label's formatting alongside its name.
  if (
    presentation &&
    (presentation.kind !== "upsert_schematic_annotation" ||
      presentation.annotation.kind !== "net-label" ||
      claim.owner.kind !== "net-label" ||
      presentation.annotation.id !== claim.owner.annotationId ||
      !document.annotations.some(
        (a) => a.id === presentation.annotation.id && a.kind === "net-label",
      ))
  )
    return undefined;
  const names = new Set([foldNetName(old.name), foldNetName(claim.name)]);
  const seeds = new Set([claim.netId]);
  // A claim can join a distant Port or label, or change the matching formal
  // Pin's global scope. Include whole old groups for both spellings.
  for (const item of scalarConnectivityEvidence(document)) {
    if (item.kind === "name-claim" && names.has(foldNetName(item.name)))
      seeds.add(item.netId);
  }
  for (const terminal of scalarCellTerminals(document.netlist)) {
    if (names.has(foldNetName(terminal.name))) seeds.add(terminal.netId);
  }
  const prior = resolveCommittedDocumentLogicalNets(document);
  const groups = new Set([...seeds].map((id) => prior.byBaseNetId.get(id)));
  const closedNetIds = new Set<string>();
  for (const group of groups) {
    if (!group) return undefined;
    for (const id of group.baseNetIds) closedNetIds.add(id);
  }
  return closedNetIds;
}

/** An ordinary wire between free scalar Junctions depends only on its own
 * conductor and endpoints. A rail also depends on its logical name, covered by closedNetIds. Device
 * pins, contact anchors and bus lanes retain full geometry checks. */
export function renameCanAffectRoute(
  route: RouteBranch,
  closedNetIds: ReadonlySet<string>,
  changed: ReadonlySet<string>,
  lookup: EndpointObjectLookup,
): boolean {
  if (
    closedNetIds.has(route.netId) ||
    changed.has(route.id) ||
    changed.has(route.netId) ||
    route.members
  )
    return true;
  return [route.start, routeEnd(route)].some((endpoint) => {
    if (endpoint.kind === "terminal" || changed.has(endpoint.junctionId))
      return true;
    const junction = lookup.junctionsById.get(endpoint.junctionId);
    return !junction || junction.contactAnchor || junction.members;
  });
}

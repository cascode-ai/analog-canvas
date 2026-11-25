import { resolveDocumentLogicalNets } from "@icm/derived";
import {
  foldNetName,
  parseSignalExpression,
  scalarConnectivityEvidence,
  type Annotation,
  type ConnectivityEvidence,
  type SchematicDocument,
} from "@icm/model";
import type { EditTransaction } from "./edit-schema.js";
import { junctionInUse } from "./power-rail-label.js";
import { removeConnectivityEvidenceOwnedBy } from "./transaction-connectivity.js";

function parseScalarSignalName(signalName: string): string | undefined {
  try {
    const names = parseSignalExpression(signalName);
    return names.length === 1 ? names[0] : undefined;
  } catch {
    return undefined;
  }
}

function isFormalPortSymbol(symbolId: string): boolean {
  return symbolId === "port" || symbolId === "port-filled";
}

/**
 * Unstyled, non-contact-anchor label-anchor Junctions that become unused once
 * `removedLabels` are gone. Uses the single `junctionInUse` semantic while
 * preserving color-styled Junctions and explicit contact anchors.
 */
export function removableLabelJunctionIds(
  document: SchematicDocument,
  removedLabels: readonly Annotation[],
): string[] {
  if (!removedLabels.length) return [];
  const removedIdSet = new Set(removedLabels.map((label) => label.id));
  const unlabelled: SchematicDocument = {
    ...document,
    annotations: document.annotations.filter(
      (item) => !removedIdSet.has(item.id),
    ),
  };
  const junctionIds = new Set<string>();
  for (const label of removedLabels) {
    if (label.anchor.kind !== "object") continue;
    const { objectId } = label.anchor;
    const junction = document.junctions.find((item) => item.id === objectId);
    if (
      junction &&
      !junction.styleOverride?.color &&
      junction.contactAnchor === undefined &&
      !junctionInUse(unlabelled, junction.id)
    ) {
      junctionIds.add(junction.id);
    }
  }
  return [...junctionIds];
}

/**
 * Local, unlocked, unaliased, non-selector, non-layout-referenced Net Labels
 * bound to `netId` whose scalar name matches `signalName` (case-insensitive).
 * Global, power-domain, and conflicting Logical Nets never match so existing
 * rejection boundaries remain intact.
 */
export function findRedundantNetLabelsForPort(
  document: SchematicDocument,
  netId: string,
  signalName: string,
  excludeAnnotationIds?: ReadonlySet<string>,
): Annotation[] {
  const scalarName = parseScalarSignalName(signalName);
  if (!scalarName || !document.nets.some((net) => net.id === netId)) return [];
  const group = resolveDocumentLogicalNets(document).byBaseNetId.get(netId);
  if (group && (group.scope === "global" || group.conflicts.length > 0)) {
    return [];
  }
  const layoutReferenced = new Set([
    ...document.layoutGroups.flatMap((item) => item.objectIds),
    ...document.constraints.flatMap((item) => item.objectIds),
  ]);
  const targetFolded = foldNetName(scalarName);
  const scalarEvidence = scalarConnectivityEvidence(document);
  const retired: Annotation[] = [];

  for (const annotation of document.annotations) {
    if (
      annotation.kind !== "net-label" ||
      annotation.locked ||
      excludeAnnotationIds?.has(annotation.id) ||
      layoutReferenced.has(annotation.id) ||
      annotation.binding?.kind !== "net-name" ||
      annotation.binding.netId !== netId ||
      annotation.binding.memberEndpoint !== undefined ||
      annotation.binding.memberEndpoints !== undefined
    ) {
      continue;
    }
    const ownedClaims = scalarEvidence.filter(
      (
        evidence,
      ): evidence is Extract<ConnectivityEvidence, { kind: "name-claim" }> =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "net-label" &&
        evidence.owner.annotationId === annotation.id,
    );
    if (ownedClaims.length > 0) {
      if (
        ownedClaims.every(
          (claim) =>
            claim.scope === "local" &&
            claim.powerDomain === undefined &&
            foldNetName(claim.name) === targetFolded,
        )
      ) {
        retired.push(annotation);
      }
      continue;
    }
    if (
      group &&
      group.name !== undefined &&
      foldNetName(group.name) === targetFolded
    ) {
      retired.push(annotation);
    }
  }
  return retired;
}

/**
 * Retire pre-existing same-net, same-name local Net Labels (and their owned
 * local claims and now-unused unstyled anchor Junctions) when a transaction
 * adds a scalar formal Port onto that Base Net, including after physical
 * contact normalization merges the Port onto an existing conductor.
 */
export function retireRedundantNetLabelsForAddedCellTerminals(
  draft: SchematicDocument,
  transaction: EditTransaction,
  changedObjectIds: Set<string>,
  deferNetPrune: (netId: string) => void,
): boolean {
  const addedTerminalIds = transaction.edits.flatMap((edit) =>
    edit.kind === "add_cell_terminal" ? [edit.terminal.id] : [],
  );
  if (!addedTerminalIds.length) return false;
  const upsertedAnnotationIds = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "upsert_schematic_annotation" ? [edit.annotation.id] : [],
    ),
  );
  const addedJunctionIds = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "add_junction" ? [edit.junctionId] : [],
    ),
  );

  let connectivityChanged = false;
  for (const terminalId of addedTerminalIds) {
    const terminal = draft.netlist?.terminals.find(
      (candidate) => candidate.id === terminalId,
    );
    if (!terminal || (terminal.signal?.members.length ?? 1) !== 1) continue;
    const ownerInstance = draft.instances.find(
      (instance) => instance.id === terminal.interfaceInstanceIds[0],
    );
    if (!ownerInstance || !isFormalPortSymbol(ownerInstance.symbolId)) continue;
    const signalName = terminal.signal?.members[0]?.name ?? terminal.name;
    const retiredLabels = findRedundantNetLabelsForPort(
      draft,
      terminal.netId,
      signalName,
      upsertedAnnotationIds,
    );
    if (!retiredLabels.length) continue;

    const junctionIdsToRemove = removableLabelJunctionIds(
      draft,
      retiredLabels,
    ).filter((junctionId) => !addedJunctionIds.has(junctionId));
    const retiredIdSet = new Set(retiredLabels.map((label) => label.id));
    const ownerNetIds = removeConnectivityEvidenceOwnedBy(
      draft,
      retiredIdSet,
      changedObjectIds,
    );
    if (ownerNetIds.length > 0) connectivityChanged = true;
    for (const netId of ownerNetIds) deferNetPrune(netId);
    draft.annotations = draft.annotations.filter(
      (annotation) => !retiredIdSet.has(annotation.id),
    );
    changedObjectIds.add(terminal.netId);
    for (const annotationId of retiredIdSet) changedObjectIds.add(annotationId);
    if (junctionIdsToRemove.length > 0) {
      const removedJunctionSet = new Set(junctionIdsToRemove);
      draft.junctions = draft.junctions.filter(
        (junction) => !removedJunctionSet.has(junction.id),
      );
      for (const junctionId of removedJunctionSet) {
        changedObjectIds.add(junctionId);
      }
    }
  }
  return connectivityChanged;
}

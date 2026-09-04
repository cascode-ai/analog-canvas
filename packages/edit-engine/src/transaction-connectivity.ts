import { deriveStableId, foldNetName } from "@icm/model";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import {
  endpointKey,
  hasExplicitMosBulkRoute,
  mosBulkKind,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import { replaceLayoutReference } from "./transaction-routing.js";

function retargetConnectivityEvidence(
  draft: SchematicDocument,
  sourceNetId: string,
  targetNetId: string,
  changedObjectIds: Set<string>,
): void {
  for (const evidence of draft.connectivityEvidence) {
    if (evidence.netId === sourceNetId) {
      evidence.netId = targetNetId;
      changedObjectIds.add(evidence.id);
    }
  }
  const seenEvidence = new Set<string>();
  draft.connectivityEvidence = draft.connectivityEvidence.filter((evidence) => {
    const key =
      evidence.kind === "spice-source"
        ? `spice-source\u0000${evidence.netId}\u0000${evidence.sourceNetId}`
        : evidence.kind === "net-name-hint"
          ? `net-name-hint\u0000${evidence.netId}\u0000${evidence.origin}\u0000${foldNetName(evidence.sourceName)}`
          : evidence.kind === "name-claim" &&
              evidence.owner.kind === "global-declaration"
            ? `global-declaration\u0000${evidence.netId}\u0000${evidence.owner.sourceNetId}\u0000${foldNetName(evidence.name)}`
            : null;
    if (!key || !seenEvidence.has(key)) {
      if (key) seenEvidence.add(key);
      return true;
    }
    changedObjectIds.add(evidence.id);
    return false;
  });
}

type BaseNetMergeResult =
  | { ok: true }
  | {
      ok: false;
      code: "OBJECT_NOT_FOUND" | "EDIT_PRECONDITION";
      message: string;
      netIds: readonly string[];
    };

export function mergeBaseNets(
  draft: SchematicDocument,
  targetNetId: string,
  sourceNetId: string,
  changedObjectIds: Set<string>,
): BaseNetMergeResult {
  if (targetNetId === sourceNetId) return { ok: true };
  const target = draft.nets.find((net) => net.id === targetNetId);
  const sourceIndex = draft.nets.findIndex((net) => net.id === sourceNetId);
  const source = draft.nets[sourceIndex];
  if (!target || !source) {
    return {
      ok: false,
      code: "OBJECT_NOT_FOUND",
      message: `Net merge target/source does not exist: ${targetNetId}, ${sourceNetId}`,
      netIds: [targetNetId, sourceNetId],
    };
  }
  const logicalNets = resolveDocumentLogicalNets(draft);
  const targetPowerDomain =
    logicalNets.byBaseNetId.get(target.id)?.powerDomain ?? "none";
  const sourcePowerDomain =
    logicalNets.byBaseNetId.get(source.id)?.powerDomain ?? "none";
  if (
    targetPowerDomain === "conflict" ||
    sourcePowerDomain === "conflict" ||
    (targetPowerDomain !== "none" &&
      sourcePowerDomain !== "none" &&
      targetPowerDomain !== sourcePowerDomain)
  ) {
    return {
      ok: false,
      code: "EDIT_PRECONDITION",
      message: "Cannot merge Nets with incompatible power domains",
      netIds: [target.id, source.id],
    };
  }
  for (const instance of draft.instances) {
    if (instance.mosBulkBinding?.netId === source.id) {
      instance.mosBulkBinding.netId = target.id;
      changedObjectIds.add(instance.id);
    }
  }
  if (draft.mosBulkDefaults?.nmosNetId === source.id) {
    draft.mosBulkDefaults.nmosNetId = target.id;
  }
  if (draft.mosBulkDefaults?.pmosNetId === source.id) {
    draft.mosBulkDefaults.pmosNetId = target.id;
  }
  for (const terminal of draft.netlist?.terminals ?? []) {
    if (terminal.netId === source.id) terminal.netId = target.id;
  }
  for (const terminal of source.terminals) {
    if (
      !target.terminals.some(
        (candidate) =>
          candidate.instanceId === terminal.instanceId &&
          candidate.pinName === terminal.pinName,
      )
    ) {
      target.terminals.push(structuredClone(terminal));
    }
  }
  for (const route of draft.routes) {
    if (route.netId === source.id) {
      route.netId = target.id;
      changedObjectIds.add(route.id);
    }
  }
  for (const junction of draft.junctions) {
    if (junction.netId === source.id) {
      junction.netId = target.id;
      changedObjectIds.add(junction.id);
    }
  }
  for (const annotation of draft.annotations) {
    if (annotation.netId === source.id) {
      annotation.netId = target.id;
      changedObjectIds.add(annotation.id);
    }
    if (
      annotation.binding?.kind === "net-name" &&
      annotation.binding.netId === source.id
    ) {
      annotation.binding = { kind: "net-name", netId: target.id };
      changedObjectIds.add(annotation.id);
    }
  }
  for (const group of draft.layoutGroups) {
    const replaced = group.objectIds.includes(source.id);
    group.objectIds = replaceLayoutReference(
      group.objectIds,
      source.id,
      target.id,
    );
    if (replaced) changedObjectIds.add(group.id);
  }
  for (const constraint of draft.constraints) {
    const replaced = constraint.objectIds.includes(source.id);
    constraint.objectIds = replaceLayoutReference(
      constraint.objectIds,
      source.id,
      target.id,
    );
    if (replaced) changedObjectIds.add(constraint.id);
  }
  retargetConnectivityEvidence(draft, source.id, target.id, changedObjectIds);
  draft.nets.splice(sourceIndex, 1);
  changedObjectIds.add(target.id);
  changedObjectIds.add(source.id);
  return { ok: true };
}

export function removeNoConnectForEndpoint(
  draft: SchematicDocument,
  endpoint: RouteEndpoint,
  changedObjectIds: Set<string>,
): void {
  if (endpoint.kind !== "terminal") return;
  draft.noConnects = draft.noConnects.filter((noConnect) => {
    const matches =
      noConnect.endpoint.instanceId === endpoint.instanceId &&
      noConnect.endpoint.pinName === endpoint.pinName;
    if (matches) changedObjectIds.add(noConnect.id);
    return !matches;
  });
}

export function preferredPhysicalMergeTarget(
  draft: SchematicDocument,
  leftNetId: string,
  rightNetId: string,
): readonly [targetNetId: string, sourceNetId: string] {
  const logical = resolveDocumentLogicalNets(draft);
  const score = (netId: string): number => {
    const resolved = logical.byBaseNetId.get(netId);
    return (
      (resolved?.powerDomain !== undefined &&
      resolved.powerDomain !== "none" &&
      resolved.powerDomain !== "conflict"
        ? 4
        : 0) +
      (resolved?.scope === "global" ? 2 : 0) +
      (resolved?.name ? 1 : 0)
    );
  };
  const leftScore = score(leftNetId);
  const rightScore = score(rightNetId);
  if (leftScore !== rightScore) {
    return leftScore > rightScore
      ? [leftNetId, rightNetId]
      : [rightNetId, leftNetId];
  }
  return leftNetId.localeCompare(rightNetId, "en") <= 0
    ? [leftNetId, rightNetId]
    : [rightNetId, leftNetId];
}

export function uniquePhysicalContactId(
  draft: SchematicDocument,
  kind: "net" | "route",
  transactionId: string,
  seed: string,
): string {
  const occupied = new Set([
    ...draft.instances.map((object) => object.id),
    ...draft.nets.map((object) => object.id),
    ...draft.routes.map((object) => object.id),
    ...draft.junctions.map((object) => object.id),
    ...draft.noConnects.map((object) => object.id),
    ...draft.annotations.map((object) => object.id),
    ...draft.connectivityEvidence.map((object) => object.id),
    ...draft.layoutGroups.map((object) => object.id),
    ...draft.constraints.map((object) => object.id),
    ...(draft.drafting?.objects.map((object) => object.id) ?? []),
    ...(draft.netlist?.terminals.map((object) => object.id) ?? []),
  ]);
  let attempt = 0;
  while (true) {
    const id = deriveStableId(
      kind,
      draft.id,
      "physical-contact",
      transactionId,
      seed,
      String(attempt),
    );
    if (!occupied.has(id)) return id;
    attempt += 1;
  }
}

/**
 * The contacts this transaction may normalize into electrical connections.
 *
 * Only geometry the transaction INTRODUCES bonds: a placed instance, an
 * explicit Junction, a drawn power rail, a typed attach. Moving,
 * rotating, mirroring, aligning, or re-pointing EXISTING geometry never
 * bonds — rearranging a schematic must not silently merge Nets (nor be
 * rejected by a merge it never asked for). A transform that parks pins
 * on foreign conductors leaves them visually coincident but electrically
 * separate, exactly like a Crossing.
 *
 * The license is deliberately tiered: introduced objects bond at every
 * contact they make, but a typed attach names one endpoint and one exact
 * conductor point, and bonds nothing beyond them — the instance's other
 * pins and the rest of the conductor stay inert.
 */
export type PhysicalContactLicense = {
  /** Objects the transaction introduces; every contact they make bonds. */
  readonly objectIds: Set<string>;
  /** Endpoints a typed attach names; only that pin or Junction bonds. */
  readonly endpointKeys: Set<string>;
  /** Exact conductor points a typed attach names, keyed by Route ID. */
  readonly routePoints: Map<string, Set<string>>;
};

export function physicalContactPointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function addLicensedRoutePoint(
  license: PhysicalContactLicense,
  routeId: string,
  point: Point,
): void {
  const points = license.routePoints.get(routeId) ?? new Set<string>();
  points.add(physicalContactPointKey(point));
  license.routePoints.set(routeId, points);
}

export function physicalContactLicenseForTransaction(
  transaction: EditTransaction,
): PhysicalContactLicense {
  const result: PhysicalContactLicense = {
    objectIds: new Set(),
    endpointKeys: new Set(),
    routePoints: new Map(),
  };
  for (const edit of transaction.edits) {
    switch (edit.kind) {
      case "add_instance":
        result.objectIds.add(edit.instance.id);
        break;
      case "place_instance":
        result.objectIds.add(edit.instanceId);
        break;
      case "add_junction":
        result.objectIds.add(edit.junctionId);
        break;
      case "attach_endpoint_to_route":
        result.endpointKeys.add(endpointKey(edit.endpoint));
        // The attach splits the conductor at the named point; whether a
        // caller reuses the original Route ID for a split product must not
        // change what bonds, so the point is licensed under every ID the
        // edit can leave it on.
        for (const routeId of [
          edit.routeId,
          edit.firstRouteId,
          edit.secondRouteId,
        ]) {
          addLicensedRoutePoint(result, routeId, edit.point);
        }
        break;
      case "add_power_rail":
        result.objectIds.add(edit.routeId);
        result.objectIds.add(edit.startJunctionId);
        result.objectIds.add(edit.endJunctionId);
        break;
    }
  }
  return result;
}

export function connectivityEvidenceNetIds(
  evidence: SchematicDocument["connectivityEvidence"][number],
): readonly string[] {
  return [evidence.netId];
}

function connectivityEvidenceOwnerId(
  evidence: SchematicDocument["connectivityEvidence"][number],
): string | null {
  if (evidence.kind !== "name-claim") return null;
  switch (evidence.owner.kind) {
    case "net-label":
      return evidence.owner.annotationId;
    case "power-marker":
      return evidence.owner.objectId;
    case "global-declaration":
      return null;
  }
}

export function removeConnectivityEvidenceOwnedBy(
  draft: SchematicDocument,
  objectIds: ReadonlySet<string>,
  changedObjectIds: Set<string>,
): readonly string[] {
  const affectedNetIds = new Set<string>();
  draft.connectivityEvidence = draft.connectivityEvidence.filter((evidence) => {
    const ownerId = connectivityEvidenceOwnerId(evidence);
    if (!ownerId || !objectIds.has(ownerId)) {
      return true;
    }
    changedObjectIds.add(evidence.id);
    for (const netId of connectivityEvidenceNetIds(evidence)) {
      affectedNetIds.add(netId);
    }
    return false;
  });
  return [...affectedNetIds];
}

export function retargetConnectivityEvidenceOwner(
  draft: SchematicDocument,
  sourceObjectId: string,
  targetObjectId: string,
  changedObjectIds: Set<string>,
): void {
  for (const evidence of draft.connectivityEvidence) {
    if (
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker" &&
      evidence.owner.objectId === sourceObjectId
    ) {
      evidence.owner.objectId = targetObjectId;
      changedObjectIds.add(evidence.id);
    }
  }
}

export function retargetOwnerEvidenceAfterSplit(
  draft: SchematicDocument,
  originalNetId: string,
  changedObjectIds: Set<string>,
): void {
  const instanceNetId = (instanceId: string): string | undefined =>
    draft.nets
      .flatMap((net) =>
        net.terminals.some((terminal) => terminal.instanceId === instanceId)
          ? [net.id]
          : [],
      )
      .sort((left, right) => left.localeCompare(right, "en"))[0];
  const objectNetId = (objectId: string): string | undefined =>
    draft.routes.find((route) => route.id === objectId)?.netId ??
    draft.junctions.find((junction) => junction.id === objectId)?.netId ??
    draft.annotations.find((annotation) => annotation.id === objectId)?.netId ??
    instanceNetId(objectId);

  for (const evidence of draft.connectivityEvidence) {
    if (evidence.kind !== "name-claim" || evidence.netId !== originalNetId) {
      continue;
    }
    let targetNetId: string | undefined;
    if (evidence.owner.kind === "net-label") {
      const annotationId = evidence.owner.annotationId;
      const annotation = draft.annotations.find(
        (candidate) => candidate.id === annotationId,
      );
      if (annotation?.anchor.kind === "route") {
        const routeId = annotation.anchor.routeId;
        targetNetId = draft.routes.find((route) => route.id === routeId)?.netId;
      } else if (annotation?.anchor.kind === "object") {
        targetNetId = objectNetId(annotation.anchor.objectId);
      }
      if (annotation && targetNetId && targetNetId !== annotation.netId) {
        annotation.netId = targetNetId;
        if (annotation.binding?.kind === "net-name") {
          annotation.binding = { kind: "net-name", netId: targetNetId };
        }
        changedObjectIds.add(annotation.id);
      }
    } else if (evidence.owner.kind === "power-marker") {
      targetNetId = objectNetId(evidence.owner.objectId);
    }
    if (targetNetId && targetNetId !== evidence.netId) {
      evidence.netId = targetNetId;
      changedObjectIds.add(evidence.id);
    }
  }
}

export function propagateSpiceSourceEvidenceAfterSplit(
  draft: SchematicDocument,
  originalNetId: string,
  splitNetIds: readonly string[],
  changedObjectIds: Set<string>,
): void {
  const sourceNetIds = draft.connectivityEvidence.flatMap((evidence) =>
    evidence.kind === "spice-source" && evidence.netId === originalNetId
      ? [evidence.sourceNetId]
      : [],
  );
  for (const sourceNetId of new Set(sourceNetIds)) {
    for (const netId of splitNetIds) {
      if (
        draft.connectivityEvidence.some(
          (evidence) =>
            evidence.kind === "spice-source" &&
            evidence.netId === netId &&
            evidence.sourceNetId === sourceNetId,
        )
      ) {
        continue;
      }
      const id = deriveStableId(
        "connectivity-evidence",
        "spice-source",
        sourceNetId,
        netId,
      );
      draft.connectivityEvidence.push({
        id,
        kind: "spice-source",
        netId,
        sourceNetId,
      });
      changedObjectIds.add(id);
    }
  }
  const nameHints = draft.connectivityEvidence.filter(
    (
      evidence,
    ): evidence is Extract<
      SchematicDocument["connectivityEvidence"][number],
      { kind: "net-name-hint" }
    > => evidence.kind === "net-name-hint" && evidence.netId === originalNetId,
  );
  for (const hint of nameHints) {
    for (const netId of splitNetIds) {
      if (
        draft.connectivityEvidence.some(
          (evidence) =>
            evidence.kind === "net-name-hint" &&
            evidence.netId === netId &&
            evidence.origin === hint.origin &&
            foldNetName(evidence.sourceName) === foldNetName(hint.sourceName),
        )
      ) {
        continue;
      }
      const id = deriveStableId(
        "connectivity-evidence",
        "net-name-hint",
        hint.id,
        netId,
      );
      draft.connectivityEvidence.push({ ...hint, id, netId });
      changedObjectIds.add(id);
    }
  }
}

/**
 * Ensure the ADR 0010 drafting layer exists on a draft Document. It is
 * optional in the schema so legacy Projects still validate; edits that touch
 * drafting initialize an empty container first.
 */
export function ensureDraftingLayer(draft: SchematicDocument): void {
  if (!draft.drafting) {
    draft.drafting = { objects: [] };
  }
}

/**
 * A local Net with no electrical or authored presentation reachability is
 * implementation debris, not a reusable electrical object. This is called
 * immediately after the final endpoint is disconnected so a later
 * `remove_instance` cannot retain a stale Port designator through its Net.
 *
 * Evidence describes a live Base Net; it cannot make an otherwise unreachable
 * Base Net live by referring back to it. Visible labels/markers are already
 * counted through their Annotation, Instance, Route, or Junction owners.
 * Imported source/name evidence is retired with the Base Net, while the
 * Document source binding remains the durable provenance record.
 */
export function pruneUnreachableLocalNet(
  draft: SchematicDocument,
  netId: string,
  changedObjectIds: Set<string>,
  options: {
    deferInto?: Set<string>;
    protectedEvidenceIds?: ReadonlySet<string>;
  } = {},
): void {
  options.deferInto?.add(netId);
  const net = draft.nets.find((candidate) => candidate.id === netId);
  if (!net || net.terminals.length > 0) {
    return;
  }
  if (
    draft.routes.some((route) => route.netId === netId) ||
    draft.junctions.some((junction) => junction.netId === netId) ||
    draft.netlist?.terminals.some((terminal) => terminal.netId === netId) ||
    draft.annotations.some(
      (annotation) =>
        annotation.netId === netId ||
        (annotation.binding?.kind === "net-name" &&
          annotation.binding.netId === netId),
    ) ||
    draft.layoutGroups.some((group) => group.objectIds.includes(netId)) ||
    draft.constraints.some((constraint) =>
      constraint.objectIds.includes(netId),
    ) ||
    draft.instances.some((instance) => instance.mosBulkBinding?.netId === netId)
  ) {
    return;
  }
  const referencedEvidence = draft.connectivityEvidence.filter((evidence) =>
    connectivityEvidenceNetIds(evidence).includes(netId),
  );
  if (
    referencedEvidence.some((evidence) =>
      options.protectedEvidenceIds?.has(evidence.id),
    ) ||
    (options.deferInto && referencedEvidence.length > 0)
  ) {
    return;
  }
  draft.connectivityEvidence = draft.connectivityEvidence.filter((evidence) => {
    if (evidence.netId !== netId) return true;
    changedObjectIds.add(evidence.id);
    return false;
  });
  let clearedBulkDefault = false;
  if (draft.mosBulkDefaults?.nmosNetId === netId) {
    delete draft.mosBulkDefaults.nmosNetId;
    clearedBulkDefault = true;
  }
  if (draft.mosBulkDefaults?.pmosNetId === netId) {
    delete draft.mosBulkDefaults.pmosNetId;
    clearedBulkDefault = true;
  }
  if (clearedBulkDefault) {
    if (
      !draft.mosBulkDefaults?.nmosNetId &&
      !draft.mosBulkDefaults?.pmosNetId
    ) {
      delete draft.mosBulkDefaults;
    }
    changedObjectIds.add(draft.id);
  }
  draft.nets = draft.nets.filter((candidate) => candidate.id !== netId);
  changedObjectIds.add(netId);
}

/**
 * A Cell bulk default may deliberately point at an ordinary custom body-bias
 * Net, so a default is not invalid merely because it is not a power Net.
 * However, when the default was a reviewed supply before this transaction and
 * the transaction removes its final supply claim, retaining the materialized
 * B terminals turns deleted presentation into stale electrical truth.
 *
 * Compare the transaction boundary rather than guessing from the final shape:
 * explicit custom defaults remain untouched, while a last VDD/Ground marker
 * deletion revokes only the bindings that were materialized from that default.
 */
export function revokeInvalidatedSupplyBulkDefaults(
  before: SchematicDocument,
  draft: SchematicDocument,
  changedObjectIds: Set<string>,
  deferNetPrune: (netId: string) => void,
): boolean {
  const beforeLogical = resolveDocumentLogicalNets(before);
  const afterLogical = resolveDocumentLogicalNets(draft);
  let changed = false;

  for (const [kind, field, expectedDomain] of [
    ["nmos", "nmosNetId", "ground"],
    ["pmos", "pmosNetId", "vdd"],
  ] as const) {
    const beforeDefaultId = before.mosBulkDefaults?.[field];
    const afterDefaultId = draft.mosBulkDefaults?.[field];
    if (!beforeDefaultId || !afterDefaultId) continue;
    const beforeGroup = beforeLogical.byBaseNetId.get(beforeDefaultId);
    const wasSupply = beforeGroup?.powerDomain === expectedDomain;
    const remainsSupply =
      afterLogical.byBaseNetId.get(afterDefaultId)?.powerDomain ===
      expectedDomain;
    if (!wasSupply || remainsSupply) continue;

    const replacementGroups = afterLogical.groups.filter(
      (group) =>
        group.powerDomain === expectedDomain &&
        beforeGroup?.name &&
        group.name &&
        foldNetName(group.name) === foldNetName(beforeGroup.name),
    );
    const replacementNetId =
      replacementGroups.length === 1 ? replacementGroups[0]!.id : undefined;

    const affectedNetIds = new Set<string>();
    for (const instance of draft.instances) {
      if (
        instance.symbolId !== kind ||
        instance.mosBulkBinding?.origin !== "cell-default" ||
        instance.mosBulkBinding.netId !== afterDefaultId
      ) {
        continue;
      }
      const net = draft.nets.find(
        (candidate) => candidate.id === afterDefaultId,
      );
      if (net && replacementNetId !== afterDefaultId) {
        net.terminals = net.terminals.filter(
          (terminal) =>
            terminal.instanceId !== instance.id || terminal.pinName !== "B",
        );
        affectedNetIds.add(net.id);
        changedObjectIds.add(net.id);
      }
      if (replacementNetId) {
        const replacement = draft.nets.find(
          (candidate) => candidate.id === replacementNetId,
        );
        if (
          replacement &&
          !replacement.terminals.some(
            (terminal) =>
              terminal.instanceId === instance.id && terminal.pinName === "B",
          )
        ) {
          replacement.terminals.push({ instanceId: instance.id, pinName: "B" });
          changedObjectIds.add(replacement.id);
        }
        instance.mosBulkBinding.netId = replacementNetId;
      } else {
        delete instance.mosBulkBinding;
      }
      changedObjectIds.add(instance.id);
    }

    if (replacementNetId) draft.mosBulkDefaults![field] = replacementNetId;
    else delete draft.mosBulkDefaults![field];
    changedObjectIds.add(draft.id);
    changed = true;
    for (const netId of affectedNetIds) {
      deferNetPrune(netId);
    }
  }

  if (
    draft.mosBulkDefaults &&
    !draft.mosBulkDefaults.nmosNetId &&
    !draft.mosBulkDefaults.pmosNetId
  ) {
    delete draft.mosBulkDefaults;
  }
  return changed;
}

export function implicitBulkPresentation(
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver | undefined,
): boolean {
  const resolved = resolver?.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  return Boolean(
    resolved?.variant?.hiddenPinNames.includes("B") ||
    resolved?.definition.pins.find((pin) => pin.name === "B")?.presentation
      .visibility === "implicit",
  );
}

/**
 * A materialized cell-default body is policy-owned, not route-owned.  Route
 * splitting may temporarily place its terminal on a detached Base Net, but it
 * must converge back to the currently configured default before validation.
 * An explicit disconnect first removes mosBulkBinding, so explicit four-pin
 * body editing remains outside this invariant.
 */
export function reconcileMaterializedMosBulkBindings(
  draft: SchematicDocument,
  changedObjectIds: Set<string>,
  deferNetPrune: (netId: string) => void,
): boolean {
  let changed = false;
  for (const instance of draft.instances) {
    if (instance.mosBulkBinding?.origin !== "cell-default") continue;
    if (hasExplicitMosBulkRoute(draft, instance.id)) {
      delete instance.mosBulkBinding;
      changedObjectIds.add(instance.id);
      changed = true;
      continue;
    }
    const kind = mosBulkKind(instance);
    const targetNetId =
      kind === "nmos"
        ? draft.mosBulkDefaults?.nmosNetId
        : kind === "pmos"
          ? draft.mosBulkDefaults?.pmosNetId
          : undefined;
    const currentNets = draft.nets.filter((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id && terminal.pinName === "B",
      ),
    );
    const target = targetNetId
      ? draft.nets.find((net) => net.id === targetNetId)
      : undefined;

    if (!target) {
      for (const net of currentNets) {
        net.terminals = net.terminals.filter(
          (terminal) =>
            terminal.instanceId !== instance.id || terminal.pinName !== "B",
        );
        changedObjectIds.add(net.id);
        deferNetPrune(net.id);
      }
      delete instance.mosBulkBinding;
      changedObjectIds.add(instance.id);
      changed = true;
      continue;
    }

    for (const net of currentNets) {
      if (net.id === target.id) continue;
      net.terminals = net.terminals.filter(
        (terminal) =>
          terminal.instanceId !== instance.id || terminal.pinName !== "B",
      );
      changedObjectIds.add(net.id);
      deferNetPrune(net.id);
      changed = true;
    }
    if (
      !target.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id && terminal.pinName === "B",
      )
    ) {
      target.terminals.push({ instanceId: instance.id, pinName: "B" });
      changedObjectIds.add(target.id);
      changed = true;
    }
    if (instance.mosBulkBinding.netId !== target.id) {
      instance.mosBulkBinding.netId = target.id;
      changedObjectIds.add(instance.id);
      changed = true;
    }
  }
  return changed;
}

export interface BulkDefaultIdentity {
  name?: string;
  scope?: "local" | "global";
  powerDomain?: "ground" | "vdd";
}

export function retargetMosBulkDefaultsAfterSplit(
  draft: SchematicDocument,
  originalNetId: string,
  splitNetIds: readonly string[],
  identity: BulkDefaultIdentity | undefined,
  changedObjectIds: Set<string>,
): boolean {
  if (!identity || (!identity.name && !identity.powerDomain)) return false;
  const resolution = resolveDocumentLogicalNets(draft);
  const matchingGroups = [
    ...new Map(
      splitNetIds.flatMap((netId) => {
        const group = resolution.byBaseNetId.get(netId);
        if (!group) return [];
        if (
          identity.name &&
          (!group.name ||
            foldNetName(group.name) !== foldNetName(identity.name))
        ) {
          return [];
        }
        if (identity.scope && group.scope !== identity.scope) return [];
        if (
          identity.powerDomain &&
          group.powerDomain !== identity.powerDomain
        ) {
          return [];
        }
        return [[group.id, group] as const];
      }),
    ).values(),
  ];
  if (matchingGroups.length !== 1) return false;

  const matchingBaseNetIds = matchingGroups[0]!.baseNetIds
    .filter((netId) => splitNetIds.includes(netId))
    .sort((left, right) => left.localeCompare(right, "en"));
  const targetNetId = matchingBaseNetIds[0];
  if (!targetNetId) return false;

  let changed = false;
  if (
    draft.mosBulkDefaults?.nmosNetId === originalNetId &&
    targetNetId !== originalNetId
  ) {
    draft.mosBulkDefaults.nmosNetId = targetNetId;
    changed = true;
  }
  if (
    draft.mosBulkDefaults?.pmosNetId === originalNetId &&
    targetNetId !== originalNetId
  ) {
    draft.mosBulkDefaults.pmosNetId = targetNetId;
    changed = true;
  }
  if (changed) changedObjectIds.add(draft.id);
  return changed;
}

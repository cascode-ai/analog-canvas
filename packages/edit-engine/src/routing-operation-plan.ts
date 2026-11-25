import {
  isFrozenSnapshot,
  routeEndpoints,
  routeElectricalConnections,
  junctionElectricalEndpoints,
  type SchematicDocument,
} from "@icm/model";
import {
  deriveElectricalTopologyProjection,
  cachedDocumentConnectivityIndex,
  scalarEndpointFromKey,
  endpointKey,
  resolveDocumentLogicalNets,
  type ElectricalTopologyProjection,
  type RoutingAffectedClosure,
} from "@icm/derived";

import { isLocalScalarConnection } from "./local-scalar-connection.js";
import type { SchematicEdit } from "./edit-schema.js";
import {
  prepareTransaction,
  type PreparedTransaction,
} from "./prepared-transaction.js";
import type {
  EditDiagnostic,
  EditDiff,
  EditExecutionContext,
} from "./transaction-result.js";

export type RoutingOperationIntent =
  | "connect"
  | "attach-to-route"
  | "cut"
  | "transform"
  | "route-geometry"
  | "clone"
  | "compose"
  | "delete"
  | "rename-marker"
  | "rename-net";

export interface OperationIdRemap {
  readonly instances: Readonly<Record<string, string>>;
  readonly nets: Readonly<Record<string, string>>;
  readonly routes: Readonly<Record<string, string>>;
  readonly legs: Readonly<Record<string, string>>;
  readonly bends: Readonly<Record<string, string>>;
  readonly junctions: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
  readonly evidence: Readonly<Record<string, string>>;
  readonly noConnects: Readonly<Record<string, string>>;
  readonly draftingObjects: Readonly<Record<string, string>>;
  readonly layoutGroups: Readonly<Record<string, string>>;
  readonly constraints: Readonly<Record<string, string>>;
  readonly cellTerminals: Readonly<Record<string, string>>;
  readonly inductorCouplings?: Readonly<Record<string, string>>;
}

export type ExpectedElectricalEffect =
  | { readonly kind: "preserve"; readonly endpointKeys: readonly string[] }
  | {
      readonly kind: "merge";
      readonly endpointGroups: readonly (readonly string[])[];
    }
  | {
      readonly kind: "partition";
      readonly sourceBaseNetIds: readonly string[];
      readonly cutRouteIds: readonly string[];
    }
  | { readonly kind: "remove"; readonly removedEndpointKeys: readonly string[] }
  | {
      readonly kind: "clone";
      readonly mapping: Readonly<Record<string, string>>;
      readonly boundaryPolicy: "disconnect";
    }
  | {
      readonly kind: "compose";
      readonly mapping: Readonly<Record<string, string>>;
      readonly boundaryPolicy: "preserve-target-physical";
    }
  | {
      readonly kind: "rebind-name-owner";
      readonly ownerKey: string;
      readonly fromBaseNetId: string;
      readonly requestedName: string;
      readonly scope: "local" | "global";
    }
  | {
      readonly kind: "rename-logical-net";
      readonly logicalNetId: string;
      readonly requestedName: string;
      readonly scope: "local" | "global";
    };

export interface RoutingOperationPlan {
  readonly source: { readonly documentId: string; readonly revision: number };
  readonly intent: RoutingOperationIntent;
  readonly affected: RoutingAffectedClosure;
  readonly expectedElectricalEffect: ExpectedElectricalEffect;
  readonly edits: readonly SchematicEdit[];
  readonly idRemap: OperationIdRemap;
  readonly diagnostics: readonly EditDiagnostic[];
}

export interface ActualElectricalEffect {
  readonly changedEndpointBaseNetKeys: readonly string[];
  readonly changedPhysicalComponentKeys: readonly string[];
  readonly changedLogicalBaseNetIds: readonly string[];
  readonly changedNameOwnerKeys: readonly string[];
  readonly addedRouteIds: readonly string[];
  readonly removedRouteIds: readonly string[];
}

export interface EvaluatedRoutingOperation {
  readonly preparedTransaction: PreparedTransaction;
  readonly plan: RoutingOperationPlan;
  readonly finalDocument: SchematicDocument;
  readonly actualElectricalEffect: ActualElectricalEffect;
  readonly diff: EditDiff;
  readonly diagnostics: readonly EditDiagnostic[];
}

export type RoutingOperationEvaluation =
  | { readonly ok: true; readonly value: EvaluatedRoutingOperation }
  | {
      readonly ok: false;
      readonly message: string;
      readonly diagnostics: readonly EditDiagnostic[];
    };

const EMPTY_CLOSURE: RoutingAffectedClosure = {
  instances: [],
  internalRoutes: [],
  boundaryRoutes: [],
  externalRoutes: [],
  internalJunctions: [],
  boundaryJunctions: [],
  electricalAnnotationIds: [],
  protectedObjectIds: [],
};

const EMPTY_ID_REMAP: OperationIdRemap = {
  instances: {},
  nets: {},
  routes: {},
  legs: {},
  bends: {},
  junctions: {},
  annotations: {},
  evidence: {},
  noConnects: {},
  draftingObjects: {},
  layoutGroups: {},
  constraints: {},
  cellTerminals: {},
};

function unique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function changedMapKeys<T>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
): readonly string[] {
  return unique([...before.keys(), ...after.keys()]).filter(
    (key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)),
  );
}

function routeIds(document: SchematicDocument): Set<string> {
  return new Set(document.routes.map((route) => route.id));
}

function actualEffect(
  beforeDocument: SchematicDocument,
  afterDocument: SchematicDocument,
  before: ElectricalTopologyProjection,
  after: ElectricalTopologyProjection,
): ActualElectricalEffect {
  const beforeRoutes = routeIds(beforeDocument);
  const afterRoutes = routeIds(afterDocument);
  return {
    changedEndpointBaseNetKeys: changedMapKeys(
      before.endpointToBaseNet,
      after.endpointToBaseNet,
    ),
    changedPhysicalComponentKeys: changedMapKeys(
      before.endpointToPhysicalComponent,
      after.endpointToPhysicalComponent,
    ),
    changedLogicalBaseNetIds: changedMapKeys(
      before.logicalNetByBaseNet,
      after.logicalNetByBaseNet,
    ),
    changedNameOwnerKeys: changedMapKeys(
      before.nameClaimsByOwner,
      after.nameClaimsByOwner,
    ),
    addedRouteIds: [...afterRoutes]
      .filter((id) => !beforeRoutes.has(id))
      .sort((a, b) => a.localeCompare(b, "en")),
    removedRouteIds: [...beforeRoutes]
      .filter((id) => !afterRoutes.has(id))
      .sort((a, b) => a.localeCompare(b, "en")),
  };
}

/**
 * A successful conductor merge may immediately canonicalize away the exact
 * degree-two Junctions named by the Wire gesture. In that case the original
 * endpoint identities are no longer valid witnesses even though their two
 * source conductors now share one Base Net. Fall back to surviving endpoints
 * from each source Base Net so effect validation follows electrical identity,
 * not temporary segmentation anchors.
 */
function endpointGroupMergedBaseNet(
  before: ElectricalTopologyProjection,
  after: ElectricalTopologyProjection,
  endpointKeys: readonly string[],
): string | null {
  const directNetIds = unique(
    endpointKeys.flatMap((key) => {
      const netId = after.endpointToBaseNet.get(key);
      return netId ? [netId] : [];
    }),
  );
  if (
    directNetIds.length === 1 &&
    endpointKeys.every((key) => after.endpointToBaseNet.has(key))
  ) {
    return directNetIds[0]!;
  }

  const sourceBaseNetIds = unique(
    endpointKeys.flatMap((key) => {
      const netId = before.endpointToBaseNet.get(key);
      return netId ? [netId] : [];
    }),
  );
  if (sourceBaseNetIds.length === 0) return null;

  const survivingNetIds: string[] = [];
  for (const sourceBaseNetId of sourceBaseNetIds) {
    const witnesses = unique(
      [...before.endpointToBaseNet.entries()].flatMap(([key, netId]) => {
        if (netId !== sourceBaseNetId) return [];
        const survivingNetId = after.endpointToBaseNet.get(key);
        return survivingNetId ? [survivingNetId] : [];
      }),
    );
    if (witnesses.length === 0) return null;
    survivingNetIds.push(...witnesses);
  }
  const merged = unique(survivingNetIds);
  return merged.length === 1 ? merged[0]! : null;
}

function groupSharesBaseNet(
  keys: readonly string[],
  netOf: (key: string) => string | undefined,
): boolean {
  const first = keys[0] && netOf(keys[0]);
  return !!first && keys.every((key) => netOf(key) === first);
}

function validateExpectedEffect(
  beforeDocument: SchematicDocument,
  afterDocument: SchematicDocument,
  before: ElectricalTopologyProjection,
  after: ElectricalTopologyProjection,
  expected: ExpectedElectricalEffect,
  coalescedEndpoints?: ReadonlyMap<string, string>,
): string | null {
  // A Junction the conductor-topology normalizer folded away is surviving
  // connectivity, not a lost endpoint: its conductor persists on the mapped
  // Base Net. Preserve and merge effects read it through that map.
  const coalescedOnto = (key: string): string | undefined =>
    coalescedEndpoints?.get(key);
  switch (expected.kind) {
    case "preserve": {
      const preserved = expected.endpointKeys.every((key) => {
        const beforeNet = before.endpointToBaseNet.get(key);
        const afterNet = after.endpointToBaseNet.get(key);
        if (beforeNet === afterNet) return true;
        return afterNet === undefined && coalescedOnto(key) === beforeNet;
      });
      if (!preserved) {
        return "Routing operation changed endpoint Net membership outside a preserve effect";
      }
      return null;
    }
    case "merge":
      for (const group of expected.endpointGroups) {
        // Precise first: every member resolves — directly or through the
        // transaction's coalesced-endpoint report — onto one Base Net. The
        // witness fallback then covers merges whose members vanished without
        // a report entry.
        if (
          !groupSharesBaseNet(
            group,
            (key) => after.endpointToBaseNet.get(key) ?? coalescedOnto(key),
          ) &&
          !endpointGroupMergedBaseNet(before, after, group)
        ) {
          return `Routing merge did not join endpoint group ${group.join(", ")}`;
        }
      }
      return null;
    case "partition": {
      const remaining = new Set(afterDocument.routes.map((route) => route.id));
      if (expected.cutRouteIds.some((routeId) => remaining.has(routeId))) {
        return "Routing partition retained a Route declared as cut";
      }
      return null;
    }
    case "remove":
      return expected.removedEndpointKeys.some((key) =>
        after.endpointToBaseNet.has(key),
      )
        ? "Routing removal retained an endpoint declared as removed"
        : null;
    case "clone":
      return Object.entries(expected.mapping).some(
        ([source, clone]) => source === clone,
      )
        ? "Routing clone reused a source identity"
        : null;
    case "compose": {
      if (
        Object.entries(expected.mapping).some(
          ([source, clone]) => source === clone,
        )
      ) {
        return "Document composition reused a source identity";
      }
      return existingEndpointKeys(beforeDocument).some(
        (key) =>
          before.endpointToBaseNet.get(key) !==
          after.endpointToBaseNet.get(key),
      )
        ? "Document composition changed existing physical Net membership"
        : null;
    }
    case "rebind-name-owner": {
      const claim = after.nameClaimsByOwner.get(expected.ownerKey);
      return claim?.name === expected.requestedName &&
        claim.scope === expected.scope
        ? null
        : `Routing rename did not rebind ${expected.ownerKey}`;
    }
    case "rename-logical-net": {
      const resolved = resolveDocumentLogicalNets(afterDocument);
      const group =
        resolved.byId.get(expected.logicalNetId) ??
        resolved.byBaseNetId.get(expected.logicalNetId);
      return group?.name === expected.requestedName &&
        group.scope === expected.scope
        ? null
        : `Routing rename did not rename Logical Net ${expected.logicalNetId}`;
    }
  }
}

function endpointKeysFromEdits(edits: readonly SchematicEdit[]): string[] {
  return edits.flatMap((edit) => {
    // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- only these edits name the endpoints a plan tracks
    switch (edit.kind) {
      case "connect_endpoints":
        return [endpointKey(edit.from), endpointKey(edit.to)];
      case "disconnect_endpoint":
        return [endpointKey(edit.endpoint)];
      case "attach_endpoint_to_route":
        return [endpointKey(edit.endpoint)];
      case "add_no_connect":
        return [endpointKey(edit.noConnect.endpoint)];
      default:
        return [];
    }
  });
}

/**
 * Endpoints this edit list explicitly takes off their Net.
 *
 * `disconnect_endpoint` is a statement, not an accident: it says this pin is
 * leaving, and the transaction already reads it that way when it suppresses
 * the normalization that would otherwise reconnect it. A preserve declaration
 * must therefore not name it — otherwise the guard against silent rewiring
 * refuses the one operation that said out loud what it was doing, which is
 * what happened to re-pointing a wire off its pin.
 */
function disconnectedEndpointKeys(
  edits: readonly SchematicEdit[],
): readonly string[] {
  return edits.flatMap((edit) =>
    edit.kind === "disconnect_endpoint" ? [endpointKey(edit.endpoint)] : [],
  );
}

// Recognize the lazy declaration created here without reading all of its endpoints.
const deferredPreserveEffects = new WeakSet<ExpectedElectricalEffect>();

/** Preserve everything named, minus whatever the edits deliberately release. */
function preserveEffect(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
  named: readonly string[] = [],
): ExpectedElectricalEffect {
  const released = new Set(disconnectedEndpointKeys(edits));
  const keep = (keys: readonly string[]) =>
    keys.filter((key) => !released.has(key));
  const explicit = keep(named);
  if (explicit.length > 0) return { kind: "preserve", endpointKeys: explicit };
  // The source snapshot owns this declaration. A stand-alone placement can
  // prove every membership unchanged without enumerating its old endpoints.
  if (!isFrozenSnapshot(document))
    return {
      kind: "preserve",
      endpointKeys: keep(existingEndpointKeys(document)),
    };
  let keys: readonly string[] | undefined;
  const effect = Object.freeze({
    kind: "preserve" as const,
    get endpointKeys() {
      return (keys ??= keep(existingEndpointKeys(document)));
    },
  });
  deferredPreserveEffects.add(effect);
  return effect;
}

function existingEndpointKeys(document: SchematicDocument): readonly string[] {
  return unique([
    ...document.nets.flatMap((net) =>
      net.terminals.map((terminal) =>
        endpointKey({ kind: "terminal", ...terminal }),
      ),
    ),
    ...document.junctions
      .flatMap(junctionElectricalEndpoints)
      .map((item) => endpointKey(item.endpoint)),
  ]);
}

/**
 * Read requested connections from the final path endpoints or explicit
 * logical/attachment edits. A Wire needs no separate merge declaration.
 */
function mergeGroupsFromEdits(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
): readonly (readonly string[])[] {
  return edits.flatMap((edit) => {
    if (edit.kind === "set_route_path") {
      return routeElectricalConnections(edit.route).map((edge) =>
        edge.endpoints.map(endpointKey),
      );
    }
    if (edit.kind === "route_orthogonal") {
      return [[endpointKey(edit.from), endpointKey(edit.to)]];
    }
    if (edit.kind === "connect_endpoints") {
      return [[endpointKey(edit.from), endpointKey(edit.to)]];
    }
    if (edit.kind === "attach_endpoint_to_route") {
      const route = document.routes.find(
        (candidate) => candidate.id === edit.routeId,
      );
      return route
        ? [
            [
              endpointKey(edit.endpoint),
              ...routeEndpoints(route).map((endpoint) => endpointKey(endpoint)),
            ],
          ]
        : [];
    }
    return [];
  });
}

function expectedElectricalEffectForOperation(
  document: SchematicDocument,
  intent: RoutingOperationIntent,
  edits: readonly SchematicEdit[],
): ExpectedElectricalEffect {
  const mergeGroups = mergeGroupsFromEdits(document, edits);
  if (intent === "connect" || intent === "attach-to-route") {
    return mergeGroups.length > 0
      ? { kind: "merge", endpointGroups: mergeGroups }
      : preserveEffect(document, edits);
  }
  if (intent === "cut") {
    const cutRouteIds = edits.flatMap((edit) =>
      edit.kind === "cut_connection" || edit.kind === "remove_route_geometry"
        ? [edit.routeId]
        : [],
    );
    const sourceBaseNetIds = unique(
      cutRouteIds.flatMap((routeId) => {
        const route = document.routes.find((item) => item.id === routeId);
        return route
          ? routeElectricalConnections(route).map((edge) => edge.netId)
          : [];
      }),
    );
    return { kind: "partition", sourceBaseNetIds, cutRouteIds };
  }
  if (intent === "delete") {
    const removedInstanceIds = new Set(
      edits.flatMap((edit) =>
        edit.kind === "remove_instance" ? [edit.instanceId] : [],
      ),
    );
    return {
      kind: "remove",
      removedEndpointKeys: unique([
        ...endpointKeysFromEdits(edits),
        ...document.nets.flatMap((net) =>
          net.terminals
            .filter((terminal) => removedInstanceIds.has(terminal.instanceId))
            .map((terminal) => endpointKey({ kind: "terminal", ...terminal })),
        ),
      ]),
    };
  }
  if (intent === "clone" || intent === "compose") {
    return { kind: "preserve", endpointKeys: existingEndpointKeys(document) };
  }
  // A geometry operation usually preserves membership, but it does not have
  // to: a wire dragged so its end lands on another conductor, or a part moved
  // onto a wire, carries the joining primitive in its edits like any other
  // operation. The primitive is what joins Nets, not the intent label, so it
  // is read the same way here.
  if (mergeGroups.length > 0) {
    return { kind: "merge", endpointGroups: mergeGroups };
  }
  return preserveEffect(document, edits, endpointKeysFromEdits(edits));
}

export function createRoutingOperationPlan(
  document: SchematicDocument,
  input: Pick<RoutingOperationPlan, "intent" | "edits" | "diagnostics"> &
    Partial<
      Pick<
        RoutingOperationPlan,
        "affected" | "expectedElectricalEffect" | "idRemap"
      >
    >,
): RoutingOperationPlan {
  return {
    source: { documentId: document.id, revision: document.revision },
    intent: input.intent,
    affected: input.affected ?? EMPTY_CLOSURE,
    expectedElectricalEffect:
      input.expectedElectricalEffect ??
      expectedElectricalEffectForOperation(document, input.intent, input.edits),
    edits: input.edits,
    idRemap: input.idRemap ?? EMPTY_ID_REMAP,
    diagnostics: input.diagnostics,
  };
}

export type RoutingOperationGate =
  | {
      readonly ok: true;
      readonly edits: readonly SchematicEdit[];
      readonly evaluated: EvaluatedRoutingOperation;
    }
  | {
      readonly ok: false;
      readonly message: string;
      /**
       * Why it failed, in the terms the schema or planner used. The gate is
       * the last place that knows; dropping it here left a person staring
       * at "Transaction result failed Document validation" with nothing to
       * act on and nothing to report.
       */
      readonly diagnostics: readonly EditDiagnostic[];
    };

/** Evaluate once before a UI commit; the returned edits are the evaluated plan. */
export function gateRoutingOperationPlan(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
  context: EditExecutionContext = {},
): RoutingOperationGate {
  const evaluation = evaluateRoutingOperationPlan(document, plan, context);
  return evaluation.ok
    ? {
        ok: true,
        edits: evaluation.value.plan.edits,
        evaluated: evaluation.value,
      }
    : {
        ok: false,
        message: evaluation.message,
        diagnostics: evaluation.diagnostics,
      };
}

function routingPlanRefusal(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
): Exclude<RoutingOperationEvaluation, { ok: true }> | undefined {
  if (plan.source.documentId !== document.id) {
    return {
      ok: false,
      message: "Routing operation targets another Cell",
      diagnostics: [],
    };
  }
  if (plan.source.revision !== document.revision) {
    return {
      ok: false,
      message: "Routing operation is stale",
      diagnostics: [],
    };
  }
  if (plan.edits.length === 0) {
    return {
      ok: false,
      message: "Routing operation has no edits",
      diagnostics: [],
    };
  }
  const blocking = plan.diagnostics.find((item) => item.severity === "error");
  if (blocking) {
    return {
      ok: false,
      message: blocking.message,
      diagnostics: plan.diagnostics,
    };
  }
  return undefined;
}

function prepareRoutingOperation(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
  context: EditExecutionContext,
  routing?: Parameters<typeof prepareTransaction>[3],
) {
  const preparation = prepareTransaction(
    document,
    {
      transactionId: `evaluate-routing-${document.revision}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "routing-operation-evaluator" },
      edits: [...plan.edits],
    },
    context,
    routing,
  );
  if (!preparation.prepared) {
    return {
      ok: false as const,
      message: preparation.result.error.message,
      diagnostics: preparation.result.diagnostics,
    };
  }
  return {
    ok: true as const,
    result: preparation.result,
    prepared: preparation.prepared,
    membershipUnchanged: preparation.membershipUnchanged,
  };
}

type RoutingPreparation = Extract<
  ReturnType<typeof prepareRoutingOperation>,
  { ok: true }
>;

function finishFullEvaluation(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
  context: EditExecutionContext,
  preparation: RoutingPreparation,
  before = deriveElectricalTopologyProjection(document, context.symbolResolver),
): RoutingOperationEvaluation {
  const result = preparation.result;
  const after = deriveElectricalTopologyProjection(
    result.document,
    context.symbolResolver,
  );
  const violation = validateExpectedEffect(
    document,
    result.document,
    before,
    after,
    plan.expectedElectricalEffect,
    result.coalescedEndpoints,
  );
  if (violation) {
    return {
      ok: false,
      message: violation,
      diagnostics: [
        {
          code: "ELECTRICAL_EFFECT_MISMATCH",
          severity: "error",
          message: violation,
        },
      ],
    };
  }
  return {
    ok: true,
    value: {
      preparedTransaction: preparation.prepared,
      plan,
      finalDocument: result.document,
      actualElectricalEffect: actualEffect(
        document,
        result.document,
        before,
        after,
      ),
      diff: result.diff,
      diagnostics: result.diagnostics,
    },
  };
}

export function evaluateRoutingOperationPlan(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
  context: EditExecutionContext = {},
): RoutingOperationEvaluation {
  const refusal = routingPlanRefusal(document, plan);
  if (refusal) return refusal;
  const before = deriveElectricalTopologyProjection(
    document,
    context.symbolResolver,
  );
  const preparation = prepareRoutingOperation(document, plan, context);
  return preparation.ok
    ? finishFullEvaluation(document, plan, context, preparation, before)
    : preparation;
}

type CanvasRoutingGate =
  | Exclude<RoutingOperationGate, { ok: true }>
  | {
      readonly ok: true;
      readonly edits: readonly SchematicEdit[];
      readonly evaluated: Pick<
        EvaluatedRoutingOperation,
        "preparedTransaction" | "finalDocument"
      >;
    };

function isEndpointKeyList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const key of value) if (typeof key !== "string") return false;
  return true;
}

function supportsScalarDeclaration(
  expected: ExpectedElectricalEffect,
): expected is Extract<
  ExpectedElectricalEffect,
  { kind: "preserve" | "merge" }
> {
  if (expected?.kind === "preserve")
    return (
      deferredPreserveEffects.has(expected) ||
      isEndpointKeyList(
        Object.getOwnPropertyDescriptor(expected, "endpointKeys")?.value,
      )
    );
  if (expected?.kind !== "merge" || !Array.isArray(expected.endpointGroups))
    return false;
  for (const group of expected.endpointGroups)
    if (!isEndpointKeyList(group)) return false;
  return true;
}

/** A Canvas commit consumes the validated document; only full-report callers need an actual-effect diff. */
export function gateCanvasRoutingOperation(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
  context: EditExecutionContext = {},
): CanvasRoutingGate {
  const refusal = routingPlanRefusal(document, plan);
  if (refusal) return refusal;
  const expected = plan.expectedElectricalEffect;
  const index = cachedDocumentConnectivityIndex(
    document,
    context.symbolResolver,
  );
  if (
    !index ||
    (plan.intent !== "connect" && plan.intent !== "attach-to-route") ||
    !supportsScalarDeclaration(expected)
  )
    return gateRoutingOperationPlan(document, plan, context);

  const memberships = new Map<string, string | undefined>();
  const changedNetIds = new Set<string>();
  const preparation = prepareRoutingOperation(document, plan, context, {
    changedNetIds,
    readMembership:
      expected.kind !== "merge"
        ? undefined
        : (read) => {
            for (const group of expected.endpointGroups) {
              for (const key of group) {
                if (memberships.has(key)) continue;
                const endpoint = scalarEndpointFromKey(key);
                if (endpoint) memberships.set(key, read(endpoint));
              }
            }
          },
  });
  if (!preparation.ok) return preparation;
  const { result } = preparation;
  // A missing or retired endpoint may need the original source-Net witness
  // search. Only a complete positive proof can skip the full evaluator.
  const proven =
    expected.kind === "preserve"
      ? preparation.membershipUnchanged
      : expected.endpointGroups.every((group) =>
          groupSharesBaseNet(group, (key) =>
            memberships.has(key)
              ? (memberships.get(key) ?? result.coalescedEndpoints?.get(key))
              : undefined,
          ),
        );
  if (
    !proven ||
    !isLocalScalarConnection(
      plan.edits,
      expected,
      index,
      memberships,
      changedNetIds,
    )
  ) {
    const full = finishFullEvaluation(document, plan, context, preparation);
    if (!full.ok) return full;
  }
  return {
    ok: true,
    edits: plan.edits,
    evaluated: {
      preparedTransaction: preparation.prepared,
      finalDocument: result.document,
    },
  };
}

import { routeEndpoints, type SchematicDocument } from "@icm/model";
import {
  deriveElectricalTopologyProjection,
  endpointKey,
  resolveDocumentLogicalNets,
  type ElectricalTopologyProjection,
  type RoutingAffectedClosure,
} from "@icm/derived";

import type { SchematicEdit } from "./edit-schema.js";
import { executeTransaction } from "./transaction.js";
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

function sameMapEntries(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => before.get(key) === after.get(key));
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
        const resolvedNetIds = unique(
          group.flatMap((key) => {
            const netId =
              after.endpointToBaseNet.get(key) ?? coalescedOnto(key);
            return netId ? [netId] : [];
          }),
        );
        const everyMemberResolved = group.every(
          (key) =>
            after.endpointToBaseNet.has(key) ||
            coalescedOnto(key) !== undefined,
        );
        if (
          !(everyMemberResolved && resolvedNetIds.length === 1) &&
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

function existingEndpointKeys(document: SchematicDocument): readonly string[] {
  return unique([
    ...document.nets.flatMap((net) =>
      net.terminals.map((terminal) =>
        endpointKey({ kind: "terminal", ...terminal }),
      ),
    ),
    ...document.junctions.map((junction) =>
      endpointKey({ kind: "junction", junctionId: junction.id }),
    ),
  ]);
}

export function expectedElectricalEffectForOperation(
  document: SchematicDocument,
  intent: RoutingOperationIntent,
  edits: readonly SchematicEdit[],
): ExpectedElectricalEffect {
  if (intent === "connect" || intent === "attach-to-route") {
    const groups = edits.flatMap((edit) => {
      if (edit.kind === "connect_endpoints") {
        return [[endpointKey(edit.from), endpointKey(edit.to)]];
      }
      // Attaching an endpoint to a Route is the other way this operation
      // joins Nets: the endpoint becomes the common node of the two Route
      // halves, so it ends up sharing that conductor's Net. Deriving merge
      // only from connect_endpoints left every attach declaring "preserve"
      // while performing a join, and the gate refused the gesture — a pin
      // dragged onto a wire simply would not land.
      if (edit.kind === "attach_endpoint_to_route") {
        const route = document.routes.find(
          (candidate) => candidate.id === edit.routeId,
        );
        return route
          ? [
              [
                endpointKey(edit.endpoint),
                ...routeEndpoints(route).map((endpoint) =>
                  endpointKey(endpoint),
                ),
              ],
            ]
          : [];
      }
      return [];
    });
    return groups.length > 0
      ? { kind: "merge", endpointGroups: groups }
      : { kind: "preserve", endpointKeys: existingEndpointKeys(document) };
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
        return route ? [route.netId] : [];
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
  const editedEndpointKeys = endpointKeysFromEdits(edits);
  return {
    kind: "preserve",
    endpointKeys:
      editedEndpointKeys.length > 0
        ? editedEndpointKeys
        : existingEndpointKeys(document),
  };
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

export function evaluateRoutingOperationPlan(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
  context: EditExecutionContext = {},
): RoutingOperationEvaluation {
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
  const before = deriveElectricalTopologyProjection(
    document,
    context.symbolResolver,
  );
  const result = executeTransaction(
    document,
    {
      transactionId: `evaluate-routing-${document.revision}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "routing-operation-evaluator" },
      edits: [...plan.edits],
    },
    context,
  );
  if (!result.ok) {
    return {
      ok: false,
      message: result.error.message,
      diagnostics: result.diagnostics,
    };
  }
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

export function emptyRoutingAffectedClosure(): RoutingAffectedClosure {
  return EMPTY_CLOSURE;
}

export function emptyOperationIdRemap(): OperationIdRemap {
  return EMPTY_ID_REMAP;
}

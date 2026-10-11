import { couplableInductorPins, couplesInstances } from "@icm/derived";
import { InductorCouplingSchema } from "@icm/model";
import type { InductorCoupling, SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type InductorCouplingEdit = Extract<
  EditTransaction["edits"][number],
  { kind: "set_inductor_coupling" | "remove_inductor_coupling" }
>;

export interface InductorCouplingEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  reject: RejectEdit;
}

/** Writes the list back, leaving no empty field behind. */
function storeInductorCouplings(
  draft: SchematicDocument,
  couplings: InductorCoupling[],
): void {
  if (couplings.length) draft.inductorCouplings = couplings;
  else delete draft.inductorCouplings;
}

export function applyInductorCouplingEdit(
  edit: InductorCouplingEdit,
  context: InductorCouplingEditContext,
): EditMutationOutcome {
  const { draft, changedObjectIds, reject } = context;
  const couplings = [...(draft.inductorCouplings ?? [])];
  const refuse = (message: string, objectIds: string[] = []) => ({
    ok: false as const,
    rejection: reject("EDIT_PRECONDITION", message, [], objectIds),
  });
  if (edit.kind === "remove_inductor_coupling") {
    const index = couplings.findIndex(
      (coupling) => coupling.id === edit.couplingId,
    );
    if (index < 0)
      return {
        ok: false,
        rejection: reject(
          "OBJECT_NOT_FOUND",
          `Inductor coupling does not exist: ${edit.couplingId}`,
          [],
          [edit.couplingId],
        ),
      };
    couplings.splice(index, 1);
    storeInductorCouplings(draft, couplings);
    changedObjectIds.add(edit.couplingId);
    return { ok: true, connectivityChanged: false };
  }
  const coupling = InductorCouplingSchema.parse(edit.coupling);
  const index = couplings.findIndex(
    (candidate) => candidate.id === coupling.id,
  );
  if (
    index < 0 &&
    [
      ...draft.instances,
      ...draft.nets,
      ...draft.routes,
      ...draft.junctions,
      ...draft.noConnects,
      ...draft.annotations,
      ...draft.connectivityEvidence,
      ...draft.layoutGroups,
      ...draft.constraints,
      ...(draft.drafting?.objects ?? []),
    ].some((object) => object.id === coupling.id)
  )
    return refuse(`Object ID already exists: ${coupling.id}`, [coupling.id]);
  for (const member of coupling.members) {
    const instance = draft.instances.find(
      (candidate) => candidate.id === member.instanceId,
    );
    if (!instance)
      return {
        ok: false,
        rejection: reject(
          "OBJECT_NOT_FOUND",
          `Instance does not exist: ${member.instanceId}`,
          [],
          [member.instanceId],
        ),
      };
    const pins = couplableInductorPins(instance.symbolId);
    if (!pins)
      return refuse(
        `Only inductors can be coupled; ${instance.reference ?? instance.id} is ${instance.symbolId}`,
        [instance.id],
      );
    if (!pins.includes(member.dotPin))
      return refuse(
        `${instance.reference ?? instance.id} has no pin ${member.dotPin}; its pins are ${pins.join(" and ")}`,
        [instance.id],
      );
  }
  const [first, second] = coupling.members;
  if (first.instanceId === second.instanceId)
    return refuse("An inductor coupling needs two different inductors", [
      first.instanceId,
    ]);
  const others = couplings.filter((candidate) => candidate.id !== coupling.id);
  const pair = others.find((candidate) =>
    couplesInstances(candidate, first.instanceId, second.instanceId),
  );
  if (pair)
    return refuse(`These two inductors are already coupled by ${pair.name}`, [
      pair.id,
    ]);
  const named = others.find(
    (candidate) => candidate.name.toLowerCase() === coupling.name.toLowerCase(),
  );
  if (named)
    return refuse(`Another coupling is already named ${named.name}`, [
      named.id,
    ]);
  if (index >= 0) couplings[index] = coupling;
  else couplings.push(coupling);
  storeInductorCouplings(draft, couplings);
  changedObjectIds.add(coupling.id);
  return { ok: true, connectivityChanged: false };
}

/**
 * A coupled inductor can only become another inductor Symbol: a coupling is
 * removed by the person removing it, never as a side effect of a swap.
 */
export function coupledInductorSwapRefusal(
  draft: SchematicDocument,
  instanceId: string,
  toSymbolId: string,
): string | null {
  const coupled = (draft.inductorCouplings ?? []).some((coupling) =>
    coupling.members.some((member) => member.instanceId === instanceId),
  );
  return coupled && !couplableInductorPins(toSymbolId)
    ? `Instance ${instanceId} is coupled to another inductor; remove its coupling before changing it to ${toSymbolId}`
    : null;
}

/**
 * A coupled inductor swapped for another inductor keeps its couplings, its
 * dotted end following the pin map or, failing that, the same place in pin
 * order.
 */
export function remapCoupledInductorDots(
  draft: SchematicDocument,
  instanceId: string,
  fromSymbolId: string,
  toSymbolId: string,
  pinMap: Readonly<Record<string, string>>,
  changedObjectIds: Set<string>,
): void {
  const from = couplableInductorPins(fromSymbolId);
  const to = couplableInductorPins(toSymbolId);
  if (!from || !to) return;
  for (const coupling of draft.inductorCouplings ?? []) {
    for (const member of coupling.members) {
      if (member.instanceId !== instanceId) continue;
      const mapped = pinMap[member.dotPin] ?? member.dotPin;
      const dotPin = to.includes(mapped)
        ? mapped
        : to[Math.max(0, from.indexOf(member.dotPin))]!;
      if (dotPin === member.dotPin) continue;
      member.dotPin = dotPin;
      changedObjectIds.add(coupling.id);
    }
  }
}

import { equalJsonValue, SignalFlowParametersSchema } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import { reflowCanonicalInstanceLabelsAfterPresentationChange } from "./transaction-instance-annotations.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type InstanceSignalFlowEdit = Extract<
  EditTransaction["edits"][number],
  { kind: "set_instance_signal_flow_parameters" }
>;

export interface InstanceSignalFlowEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  resolver: SymbolResolver | undefined;
  reject: RejectEdit;
}

export type InstanceSignalFlowEditOutcome = EditMutationOutcome;

export function applyInstanceSignalFlowEdit(
  edit: InstanceSignalFlowEdit,
  context: InstanceSignalFlowEditContext,
): InstanceSignalFlowEditOutcome {
  const { draft, changedObjectIds, resolver, reject } = context;

  const instance = draft.instances.find(
    (candidate) => candidate.id === edit.instanceId,
  );
  if (!instance) {
    return {
      ok: false,
      rejection: reject(
        "OBJECT_NOT_FOUND",
        `Instance does not exist: ${edit.instanceId}`,
        [],
        [edit.instanceId],
      ),
    };
  }

  const before = structuredClone(instance);
  const parameters =
    edit.parameters === null
      ? undefined
      : SignalFlowParametersSchema.parse(edit.parameters);

  let nextParameters: typeof instance.signalFlowParameters | undefined;
  if (parameters === undefined) {
    nextParameters = undefined;
  } else if (
    parameters.formula === undefined &&
    parameters.coefficient === undefined &&
    parameters.bodyWidth === undefined &&
    parameters.bodyHeight === undefined
  ) {
    nextParameters = undefined;
  } else {
    nextParameters = structuredClone(parameters);
  }

  if (
    equalJsonValue(
      instance.signalFlowParameters ?? null,
      nextParameters ?? null,
    )
  ) {
    return {
      ok: false,
      rejection: reject(
        "EDIT_PRECONDITION",
        "Signal Flow parameter edit does not change the instance",
        [],
        [edit.instanceId],
      ),
    };
  }

  if (nextParameters === undefined) {
    delete instance.signalFlowParameters;
  } else {
    instance.signalFlowParameters = nextParameters;
  }

  changedObjectIds.add(edit.instanceId);
  reflowCanonicalInstanceLabelsAfterPresentationChange(
    draft,
    before,
    edit.instanceId,
    changedObjectIds,
    resolver,
  );
  return {
    ok: true,
    connectivityChanged: false,
    geometryChanged: true,
  };
}

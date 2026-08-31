import { createReferenceIndex, referenceIssuesForInstance } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";
import {
  refreshInstanceReferenceAnnotation,
  refreshInstanceValueAnnotation,
} from "./transaction-instance-annotations.js";

type InstanceNetlistEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      | "patch_instance_netlist_parameters"
      | "set_instance_reference"
      | "set_instance_binding"
      | "set_instance_netlist"
      | "bulk_patch_instance_netlist";
  }
>;

export interface InstanceNetlistEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  reject: RejectEdit;
}

export type InstanceNetlistEditOutcome = EditMutationOutcome;

function referencePolicyFailure(
  draft: SchematicDocument,
  instanceId: string,
): string | null {
  const issue = referenceIssuesForInstance(
    createReferenceIndex(draft),
    instanceId,
  )[0];
  if (!issue) return null;
  switch (issue.code) {
    case "MISSING_REFERENCE":
      return "This component requires an Instance Reference";
    case "WRONG_REFERENCE_PREFIX":
      return `Reference ${issue.reference} does not match this component prefix`;
    case "DUPLICATE_REFERENCE":
      return `Reference ${issue.reference} is already used by ${issue.otherInstanceId}`;
  }
}

export function applyInstanceNetlistEdit(
  edit: InstanceNetlistEdit,
  context: InstanceNetlistEditContext,
): InstanceNetlistEditOutcome {
  const { draft, changedObjectIds, reject } = context;

  switch (edit.kind) {
    case "patch_instance_netlist_parameters": {
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
      const set = edit.set ?? {};
      const unset = edit.unset ?? [];
      if (Object.keys(set).length === 0 && unset.length === 0) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Netlist parameter patch must set or unset at least one parameter",
            [],
            [edit.instanceId],
          ),
        };
      }
      const duplicateUnset = new Set(unset);
      if (duplicateUnset.size !== unset.length) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Netlist parameter patch cannot unset the same parameter more than once",
            [],
            [edit.instanceId],
          ),
        };
      }
      const conflictingKey = Object.keys(set).find((key) =>
        duplicateUnset.has(key),
      );
      if (conflictingKey) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            `Netlist parameter patch cannot set and unset ${conflictingKey}`,
            [],
            [edit.instanceId],
          ),
        };
      }
      const before: SchematicDocument["instances"][number] =
        structuredClone(instance);
      const netlist = instance.netlist;
      if (!netlist) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Netlist parameter patch requires an instance netlist record",
            [],
            [edit.instanceId],
          ),
        };
      }
      const nextParameters = { ...netlist.parameters };
      for (const key of unset) delete nextParameters[key];
      for (const [key, value] of Object.entries(set)) {
        nextParameters[key] = value;
      }
      const namesByFoldedName = new Map<string, string>();
      for (const name of Object.keys(nextParameters)) {
        const foldedName = name.toLowerCase();
        const prior = namesByFoldedName.get(foldedName);
        if (prior && prior !== name) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Netlist parameter ${name} duplicates ${prior} under case folding`,
              [],
              [edit.instanceId],
            ),
          };
        }
        namesByFoldedName.set(foldedName, name);
      }
      const changed =
        Object.keys(nextParameters).length !==
          Object.keys(netlist.parameters).length ||
        Object.entries(nextParameters).some(
          ([key, value]) => netlist.parameters[key] !== value,
        );
      if (!changed) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Netlist parameter patch does not change the instance",
            [],
            [edit.instanceId],
          ),
        };
      }
      netlist.parameters = nextParameters;
      refreshInstanceValueAnnotation(
        draft,
        before,
        edit.instanceId,
        changedObjectIds,
      );
      changedObjectIds.add(edit.instanceId);
      return { ok: true, connectivityChanged: false };
    }
    case "set_instance_reference": {
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
      if (
        draft.netlist?.terminals.some((terminal) =>
          terminal.interfaceInstanceIds.includes(instance.id),
        )
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "A formal Cell Pin is identified by its Cell terminal name, not an Instance reference",
            [],
            [instance.id],
          ),
        };
      }
      if (instance.symbolId === "ground" || instance.symbolId === "vdd-port") {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "A power marker is identified by its visible Net name, not an Instance reference",
            [],
            [instance.id],
          ),
        };
      }
      if (instance.reference === edit.reference) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Reference edit does not change the instance",
            [],
            [edit.instanceId],
          ),
        };
      }
      instance.reference = edit.reference;
      const failure = referencePolicyFailure(draft, instance.id);
      if (failure) {
        return {
          ok: false,
          rejection: reject("EDIT_PRECONDITION", failure, [], [instance.id]),
        };
      }
      for (const annotation of draft.annotations) {
        if (
          annotation.binding?.kind === "instance-reference" &&
          annotation.binding.instanceId === instance.id
        ) {
          changedObjectIds.add(annotation.id);
        }
      }
      return { ok: true, connectivityChanged: false };
    }
    case "set_instance_binding": {
      const instance = draft.instances.find(
        (candidate) => candidate.id === edit.instanceId,
      );
      if (!instance?.netlist) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Binding edit requires an instance netlist record",
            [],
            [edit.instanceId],
          ),
        };
      }
      const current = instance.netlist.binding ?? null;
      if (JSON.stringify(current) === JSON.stringify(edit.binding)) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Binding edit does not change the instance",
            [],
            [edit.instanceId],
          ),
        };
      }
      if (edit.binding)
        instance.netlist.binding = structuredClone(edit.binding);
      else delete instance.netlist.binding;
      const failure = referencePolicyFailure(draft, instance.id);
      if (failure) {
        return {
          ok: false,
          rejection: reject("EDIT_PRECONDITION", failure, [], [instance.id]),
        };
      }
      changedObjectIds.add(edit.instanceId);
      return { ok: true, connectivityChanged: true };
    }
    case "set_instance_netlist": {
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
      if (
        instance.netlist &&
        JSON.stringify(instance.netlist) === JSON.stringify(edit.netlist)
      ) {
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "Netlist edit does not change the instance",
            [],
            [edit.instanceId],
          ),
        };
      }
      const before: SchematicDocument["instances"][number] =
        structuredClone(instance);
      instance.netlist = structuredClone(edit.netlist);
      const failure = referencePolicyFailure(draft, instance.id);
      if (failure) {
        return {
          ok: false,
          rejection: reject("EDIT_PRECONDITION", failure, [], [instance.id]),
        };
      }
      refreshInstanceValueAnnotation(
        draft,
        before,
        edit.instanceId,
        changedObjectIds,
      );
      changedObjectIds.add(edit.instanceId);
      return { ok: true, connectivityChanged: true };
    }
    case "bulk_patch_instance_netlist": {
      const assignedIds = new Set<string>();
      let connectivityChanged = false;
      for (const assignment of edit.assignments) {
        if (assignedIds.has(assignment.instanceId)) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Bulk netlist patch repeats instance ${assignment.instanceId}`,
              [],
              [assignment.instanceId],
            ),
          };
        }
        assignedIds.add(assignment.instanceId);
        const instance = draft.instances.find(
          (candidate) => candidate.id === assignment.instanceId,
        );
        if (!instance?.netlist) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Bulk netlist patch requires a netlist record: ${assignment.instanceId}`,
              [],
              [assignment.instanceId],
            ),
          };
        }
        const before: SchematicDocument["instances"][number] =
          structuredClone(instance);
        let changed = false;
        let parametersChanged = false;
        if (
          assignment.reference !== undefined &&
          instance.reference !== assignment.reference
        ) {
          instance.reference = assignment.reference;
          changed = true;
        }
        if (assignment.binding !== undefined) {
          const current = instance.netlist.binding ?? null;
          if (JSON.stringify(current) !== JSON.stringify(assignment.binding)) {
            if (assignment.binding) {
              instance.netlist.binding = structuredClone(assignment.binding);
            } else {
              delete instance.netlist.binding;
            }
            changed = true;
            connectivityChanged = true;
          }
        }
        const set = assignment.set ?? {};
        const unset = assignment.unset ?? [];
        const unsetNames = new Set(unset.map((name) => name.toLowerCase()));
        if (unsetNames.size !== unset.length) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Bulk netlist patch repeats an unset parameter on ${instance.id}`,
              [],
              [instance.id],
            ),
          };
        }
        const conflictingKey = Object.keys(set).find((key) =>
          unsetNames.has(key.toLowerCase()),
        );
        if (conflictingKey) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Bulk netlist patch cannot set and unset ${conflictingKey}`,
              [],
              [instance.id],
            ),
          };
        }
        if (Object.keys(set).length > 0 || unset.length > 0) {
          const nextParameters = { ...instance.netlist.parameters };
          for (const key of unset) delete nextParameters[key];
          for (const [key, value] of Object.entries(set)) {
            nextParameters[key] = value;
          }
          const namesByFoldedName = new Map<string, string>();
          for (const name of Object.keys(nextParameters)) {
            const folded = name.toLowerCase();
            const prior = namesByFoldedName.get(folded);
            if (prior && prior !== name) {
              return {
                ok: false,
                rejection: reject(
                  "EDIT_PRECONDITION",
                  `Netlist parameter ${name} duplicates ${prior} under case folding`,
                  [],
                  [instance.id],
                ),
              };
            }
            namesByFoldedName.set(folded, name);
          }
          parametersChanged =
            Object.keys(nextParameters).length !==
              Object.keys(instance.netlist.parameters).length ||
            Object.entries(nextParameters).some(
              ([key, value]) => instance.netlist!.parameters[key] !== value,
            );
          if (parametersChanged) {
            instance.netlist.parameters = nextParameters;
            changed = true;
          }
        }
        if (!changed) {
          return {
            ok: false,
            rejection: reject(
              "EDIT_PRECONDITION",
              `Bulk netlist patch does not change ${instance.id}`,
              [],
              [instance.id],
            ),
          };
        }
        if (parametersChanged) {
          refreshInstanceValueAnnotation(
            draft,
            before,
            instance.id,
            changedObjectIds,
          );
        }
        refreshInstanceReferenceAnnotation(
          draft,
          before,
          instance.id,
          changedObjectIds,
        );
        changedObjectIds.add(instance.id);
      }
      for (const instanceId of assignedIds) {
        const failure = referencePolicyFailure(draft, instanceId);
        if (failure) {
          return {
            ok: false,
            rejection: reject("EDIT_PRECONDITION", failure, [], [instanceId]),
          };
        }
      }
      return { ok: true, connectivityChanged };
    }
  }
}

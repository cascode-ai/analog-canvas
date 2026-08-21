import { deviceDescriptor } from "@icm/devices";
import type { SchematicEdit } from "@icm/edit-engine";
import {
  NetlistParameterNameSchema,
  NetlistParameterValueSchema,
} from "@icm/model";
import type { Instance } from "@icm/model";

export interface AdditionalParameterDraft {
  readonly id: string;
  readonly originalName: string | null;
  readonly name: string;
  readonly value: string;
}

export type AdditionalParameterPlan =
  | { readonly kind: "unchanged" }
  | { readonly kind: "invalid"; readonly message: string }
  | {
      readonly kind: "edit";
      readonly edit: Extract<
        SchematicEdit,
        { kind: "patch_instance_netlist_parameters" }
      >;
    };

function knownParameterNames(
  symbolId: string,
  additionalKnownNames: readonly string[] = [],
): ReadonlySet<string> {
  return new Set(
    [
      ...(deviceDescriptor(symbolId)?.parameters ?? []).map(
        (parameter) => parameter.name,
      ),
      ...additionalKnownNames,
    ].map((name) => name.toLowerCase()),
  );
}

export function additionalParameterDrafts(
  instance: Instance,
  additionalKnownNames: readonly string[] = [],
): readonly AdditionalParameterDraft[] {
  const known = knownParameterNames(instance.symbolId, additionalKnownNames);
  return Object.entries(instance.netlist?.parameters ?? {})
    .filter(([name]) => !known.has(name.toLowerCase()))
    .map(([name, value], index) => ({
      id: `${instance.id}:additional:${index}`,
      originalName: name,
      name,
      value,
    }));
}

/**
 * Turns the explicit Additional Parameters form into the one typed parameter
 * patch. Blank values delete their row; new blank rows are simply ignored.
 */
export function planAdditionalParameterPatch(
  instance: Instance,
  drafts: readonly AdditionalParameterDraft[],
  additionalKnownNames: readonly string[] = [],
): AdditionalParameterPlan {
  if (!instance.netlist) {
    return {
      kind: "invalid",
      message: "This component has no netlist record to receive parameters",
    };
  }
  const known = knownParameterNames(instance.symbolId, additionalKnownNames);
  const desired = new Map<string, { name: string; value: string }>();
  for (const draft of drafts) {
    const name = draft.name.trim();
    const value = draft.value.trim();
    if (!name && !value) continue;
    if (!name) {
      return { kind: "invalid", message: "Additional parameter needs a name" };
    }
    const nameResult = NetlistParameterNameSchema.safeParse(name);
    if (!nameResult.success) {
      return {
        kind: "invalid",
        message: `Invalid parameter name: ${name}`,
      };
    }
    const foldedName = name.toLowerCase();
    if (known.has(foldedName)) {
      return {
        kind: "invalid",
        message: `${name} is already a descriptor-defined parameter`,
      };
    }
    if (desired.has(foldedName)) {
      return {
        kind: "invalid",
        message: `Duplicate parameter name: ${name}`,
      };
    }
    // A blank raw value means delete. It does not create an empty persisted
    // parameter; an existing row with this name is omitted from `desired`.
    if (!value) continue;
    if (!NetlistParameterValueSchema.safeParse(value).success) {
      return { kind: "invalid", message: `Invalid value for ${name}` };
    }
    desired.set(foldedName, { name, value });
  }

  const existing = Object.entries(instance.netlist.parameters).filter(
    ([name]) => !known.has(name.toLowerCase()),
  );
  const existingByFoldedName = new Map(
    existing.map(([name, value]) => [name.toLowerCase(), { name, value }]),
  );
  const set: Record<string, string> = {};
  const unset = new Set<string>();
  for (const [foldedName, current] of existingByFoldedName) {
    const next = desired.get(foldedName);
    if (!next || next.name !== current.name) unset.add(current.name);
  }
  for (const { name, value } of desired.values()) {
    const current = existingByFoldedName.get(name.toLowerCase());
    if (!current || current.name !== name || current.value !== value) {
      set[name] = value;
    }
  }
  if (Object.keys(set).length === 0 && unset.size === 0) {
    return { kind: "unchanged" };
  }
  return {
    kind: "edit",
    edit: {
      kind: "patch_instance_netlist_parameters",
      instanceId: instance.id,
      ...(Object.keys(set).length > 0 ? { set } : {}),
      ...(unset.size > 0 ? { unset: [...unset] } : {}),
    },
  };
}

import type {
  InstanceNetlistBinding,
  InstanceNetlistData,
  SchematicDocument,
} from "@icm/model";
import {
  createReferenceIndex,
  deviceDescriptor,
  nextReference,
  referencePolicyForSymbol,
} from "@icm/devices";

function referencePrefix(symbolId: string): string {
  const policy = referencePolicyForSymbol(symbolId);
  return policy.kind === "required" ? policy.prefix : "X";
}

/** Prefixes used only to allocate stable object IDs for schematic markers. */
const instanceIdPrefixOverrides: Record<string, string> = {
  ground: "GND",
  port: "P",
  "port-filled": "P",
  "vdd-port": "VDD",
};

export function instanceIdPrefix(symbolId: string): string {
  return instanceIdPrefixOverrides[symbolId] ?? referencePrefix(symbolId);
}

/** Allocate object identity without consulting the authored Reference domain. */
export function nextInstanceId(
  document: SchematicDocument,
  symbolId: string,
): string {
  const prefix = instanceIdPrefix(symbolId);
  const used = new Set(
    document.instances.map((instance) => instance.id.toLowerCase()),
  );
  let index = 1;
  while (used.has(`${prefix}${index}`.toLowerCase())) index += 1;
  return `${prefix}${index}`;
}

export function nextInstanceReference(
  document: SchematicDocument,
  symbolId: string,
): string | undefined {
  return nextReference(
    createReferenceIndex(document),
    referencePolicyForSymbol(symbolId),
  );
}

function rawParameters(
  parameterValues: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parameterValues)
      .filter(
        ([name, value]) =>
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) && typeof value === "string",
      )
      .map(([name, value]) => [name, String(value)])
      .filter(([, value]) => value !== ""),
  );
}

function defaultBinding(symbolId: string): InstanceNetlistBinding | undefined {
  const definition = deviceDescriptor(symbolId);
  if (!definition || definition.targetPolicy === "required-model") {
    return undefined;
  }
  if (definition.targetPolicy === "builtin") {
    return {
      kind: "primitive",
      deviceClass: definition.deviceClass,
    };
  }
  return undefined;
}

export function initialInstanceNetlist(
  symbolId: string,
  parameterValues: Readonly<Record<string, string>>,
): InstanceNetlistData | undefined {
  const policy = referencePolicyForSymbol(symbolId);
  if (policy.kind === "none") return undefined;
  const binding = defaultBinding(symbolId);
  return {
    ...(binding ? { binding } : {}),
    parameters: rawParameters(parameterValues),
  };
}

export function bindingForEditedModel(
  symbolId: string,
  modelName: string,
): InstanceNetlistBinding | undefined {
  const definition = deviceDescriptor(symbolId);
  if (!definition) return undefined;
  if (definition.targetPolicy === "required-model") {
    return modelName.trim()
      ? {
          kind: "model",
          deviceClass: definition.deviceClass,
          name: modelName.trim(),
        }
      : undefined;
  }
  return defaultBinding(symbolId);
}

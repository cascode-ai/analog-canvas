import type {
  CircuitProject,
  Instance,
  InstanceNetlistBinding,
  InstanceNetlistData,
  SchematicDocument,
} from "@icm/model";
import {
  createReferenceIndex,
  deviceDescriptor,
  nextReference,
  referencePolicyForSymbol,
  referencePolicyForInstance,
  subcircuitDescriptor,
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

/** Insert and Copy both create a fresh device from authored settings only. */
export function createNewInstance(
  document: SchematicDocument,
  template: Pick<
    Instance,
    | "symbolId"
    | "symbolVariantId"
    | "placement"
    | "netlist"
    | "styleOverride"
    | "signalFlowParameters"
  >,
  options: {
    id?: string | undefined;
    reference?: string | undefined;
    project?: Pick<CircuitProject, "componentDefinitions"> | undefined;
  } = {},
): Instance {
  const {
    symbolId,
    symbolVariantId,
    placement,
    netlist,
    styleOverride,
    signalFlowParameters,
  } = structuredClone(template);
  const instance: Instance = {
    id: options.id ?? nextInstanceId(document, symbolId),
    symbolId,
    placement,
    ...(symbolVariantId ? { symbolVariantId } : {}),
    ...(netlist ? { netlist } : {}),
    ...(styleOverride ? { styleOverride } : {}),
    ...(signalFlowParameters ? { signalFlowParameters } : {}),
  };
  const reference =
    options.reference ??
    nextReference(
      createReferenceIndex(document, options.project),
      referencePolicyForInstance(instance, options.project),
    );
  if (reference) instance.reference = reference;
  return instance;
}

export function nextCellPinName(
  document: SchematicDocument,
  reservedNames: ReadonlySet<string> = new Set(),
): string {
  const occupied = new Set(
    (document.netlist?.terminals ?? []).map((terminal) =>
      terminal.name.trim().toLowerCase(),
    ),
  );
  let ordinal = 1;
  while (true) {
    const name = ordinal === 1 ? "Vin" : `Vin${ordinal}`;
    if (
      !occupied.has(name.toLowerCase()) &&
      !reservedNames.has(name.toLowerCase())
    )
      return name;
    ordinal += 1;
  }
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
  const subcircuit = subcircuitDescriptor(symbolId);
  if (subcircuit) {
    return { kind: "unresolved-subcircuit", name: subcircuit.target };
  }
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

/**
 * The netlist record a freshly placed Instance carries.
 *
 * `modelTarget` is the model the process in hand names for this device, so a
 * transistor drawn while working in a process is bound to that process from
 * the moment it lands, rather than blocking export until someone opens the
 * Netlist panel and picks the process again. A device that takes no explicit
 * model ignores it.
 */
export function initialInstanceNetlist(
  symbolId: string,
  parameterValues: Readonly<Record<string, string>>,
  modelTarget?: string,
): InstanceNetlistData | undefined {
  const policy = referencePolicyForSymbol(symbolId);
  if (policy.kind === "none") return undefined;
  const binding = modelTarget
    ? bindingForEditedModel(symbolId, modelTarget)
    : defaultBinding(symbolId);
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

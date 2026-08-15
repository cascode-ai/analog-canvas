import type {
  Instance,
  InstanceNetlistBinding,
  InstanceNetlistData,
  SchematicDocument,
} from "@icm/model";
import { deviceNetlistDefinition } from "@icm/symbols";

function referencePrefix(symbolId: string): string {
  return deviceNetlistDefinition(symbolId)?.referencePrefix ?? "X";
}

/**
 * Prefixes used for on-canvas placement labels. Schematic-only markers keep
 * their label prefixes here; real devices inherit the reviewed netlist
 * reference prefix so a placed label and its netlist reference agree.
 */
const placementPrefixOverrides: Record<string, string> = {
  ground: "GND",
  port: "P",
  "port-filled": "P",
};

export function placementReferencePrefix(symbolId: string): string {
  return placementPrefixOverrides[symbolId] ?? referencePrefix(symbolId);
}

/**
 * Lowest unused per-prefix designator across the union of instance ids and
 * netlist references, so the visible label, the instance id, and the netlist
 * reference never collide with either domain (undo, reload, and deletion all
 * re-scan the live document, and freed numbers are reused).
 */
export function nextInstanceDesignator(
  document: SchematicDocument,
  symbolId: string,
): string {
  const prefix = placementReferencePrefix(symbolId);
  const used = new Set<string>();
  for (const instance of document.instances) {
    used.add(instance.id.toLowerCase());
    if (instance.netlist?.reference) {
      used.add(instance.netlist.reference.toLowerCase());
    }
  }
  let index = 1;
  while (used.has(`${prefix}${index}`.toLowerCase())) index += 1;
  return `${prefix}${index}`;
}

/**
 * Whether the placement label prefix equals the netlist reference prefix, so
 * one designator can serve as both the instance id and its netlist reference.
 */
export function netlistReferenceMatchesPlacement(symbolId: string): boolean {
  const netlistPrefix = deviceNetlistDefinition(symbolId)?.referencePrefix;
  if (!netlistPrefix) return false;
  return (
    netlistPrefix.toLowerCase() ===
    placementReferencePrefix(symbolId).toLowerCase()
  );
}

export function nextInstanceReference(
  document: SchematicDocument,
  symbolId: string,
): string {
  const prefix = referencePrefix(symbolId) || "PWR";
  const used = new Set(
    document.instances.flatMap((instance) =>
      instance.netlist?.reference
        ? [instance.netlist.reference.toLowerCase()]
        : [],
    ),
  );
  let index = 1;
  while (used.has(`${prefix}${index}`.toLowerCase())) index += 1;
  return `${prefix}${index}`;
}

function rawParameters(
  properties: Readonly<Instance["properties"]>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(
        ([name, value]) =>
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"),
      )
      .map(([name, value]) => [name, String(value)])
      .filter(([, value]) => value !== ""),
  );
}

function defaultBinding(symbolId: string): InstanceNetlistBinding | undefined {
  const definition = deviceNetlistDefinition(symbolId);
  if (!definition || definition.targetPolicy === "required-model") {
    return undefined;
  }
  if (
    definition.targetPolicy === "builtin" ||
    definition.targetPolicy === "none"
  ) {
    return {
      kind: "primitive",
      deviceClass: definition.deviceClass,
    };
  }
  return undefined;
}

export function initialInstanceNetlist(
  document: SchematicDocument,
  symbolId: string,
  properties: Readonly<Instance["properties"]>,
  reference?: string,
): InstanceNetlistData {
  const binding = defaultBinding(symbolId);
  return {
    reference: reference ?? nextInstanceReference(document, symbolId),
    ...(binding ? { binding } : {}),
    parameters: rawParameters(properties),
  };
}

export function bindingForEditedModel(
  symbolId: string,
  modelName: string,
): InstanceNetlistBinding | undefined {
  const definition = deviceNetlistDefinition(symbolId);
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

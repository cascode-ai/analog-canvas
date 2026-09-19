import type { CircuitProject } from "@icm/model";
import type {
  BuiltInSubcircuitDescriptor,
  DeviceDescriptor,
  DeviceRegistry,
} from "./contract.js";
import {
  componentDeviceDescriptors,
  componentSubcircuitDescriptors,
} from "./components.generated.js";
import { validateDeviceDescriptors } from "./validation.js";

export function defineDeviceRegistry(
  descriptors: readonly DeviceDescriptor[],
): DeviceRegistry {
  const issues = validateDeviceDescriptors(descriptors);
  if (issues.length > 0) {
    throw new Error(
      `Invalid device registry: ${issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const byId = new Map(
    descriptors.map((descriptor) => [descriptor.id, descriptor]),
  );
  const bySymbolId = new Map(
    descriptors.map((descriptor) => [descriptor.symbolId, descriptor]),
  );
  return {
    descriptors,
    byId: (id) => byId.get(id),
    bySymbolId: (symbolId) => bySymbolId.get(symbolId),
  };
}

export const deviceRegistry = defineDeviceRegistry(componentDeviceDescriptors);

export const builtInDeviceDescriptors: readonly DeviceDescriptor[] =
  deviceRegistry.descriptors;

export function deviceDescriptor(
  symbolId: string,
  project?: Pick<CircuitProject, "componentDefinitions">,
): DeviceDescriptor | undefined {
  const local = project?.componentDefinitions?.find(
    (definition) => definition.symbol.id === symbolId,
  );
  return local
    ? (local.electrical as DeviceDescriptor | undefined)
    : deviceRegistry.bySymbolId(symbolId);
}

export function deviceDescriptorById(id: string): DeviceDescriptor | undefined {
  return deviceRegistry.byId(id);
}

function defineSubcircuitRegistry(
  descriptors: readonly BuiltInSubcircuitDescriptor[],
): ReadonlyMap<string, BuiltInSubcircuitDescriptor> {
  const bySymbolId = new Map<string, BuiltInSubcircuitDescriptor>();
  for (const descriptor of descriptors) {
    if (bySymbolId.has(descriptor.symbolId)) {
      throw new Error(
        `Invalid subcircuit registry: duplicate Symbol ${descriptor.symbolId}`,
      );
    }
    bySymbolId.set(descriptor.symbolId, descriptor);
  }
  return bySymbolId;
}

const subcircuitsBySymbolId = defineSubcircuitRegistry(
  componentSubcircuitDescriptors,
);

export const builtInSubcircuitDescriptors: readonly BuiltInSubcircuitDescriptor[] =
  componentSubcircuitDescriptors;

export function subcircuitDescriptor(
  symbolId: string,
  project?: Pick<CircuitProject, "componentDefinitions">,
): BuiltInSubcircuitDescriptor | undefined {
  const local = project?.componentDefinitions?.find(
    (definition) => definition.symbol.id === symbolId,
  );
  return local ? local.subcircuit : subcircuitsBySymbolId.get(symbolId);
}

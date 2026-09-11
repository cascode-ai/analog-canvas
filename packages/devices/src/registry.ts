import type { DeviceDescriptor, DeviceRegistry } from "./contract.js";
import { componentDeviceDescriptors } from "./components.generated.js";
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
): DeviceDescriptor | undefined {
  return deviceRegistry.bySymbolId(symbolId);
}

export function deviceDescriptorById(id: string): DeviceDescriptor | undefined {
  return deviceRegistry.byId(id);
}

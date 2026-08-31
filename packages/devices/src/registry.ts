import type { DeviceDescriptor, DeviceRegistry } from "./contract.js";
import {
  capacitorDevice,
  currentSourceDevice,
  diodeDevice,
  groundDevice,
  inductorCompactDevice,
  inductorDevice,
  ndmosDevice,
  nmosDevice,
  npnDevice,
  pdmosDevice,
  pmosDevice,
  pnpDevice,
  pulseVoltageSourceDevice,
  resistorDevice,
  variableCapacitorDevice,
  variableInductorDevice,
  variableResistorDevice,
  vddPortDevice,
  voltageControlledSwitchDevice,
  voltageSourceDevice,
  zenerDiodeDevice,
  idealSwitchDevice,
  closedSwitchDevice,
} from "./descriptors/index.js";
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

export const deviceRegistry = defineDeviceRegistry([
  resistorDevice,
  variableResistorDevice,
  capacitorDevice,
  variableCapacitorDevice,
  inductorCompactDevice,
  inductorDevice,
  variableInductorDevice,
  nmosDevice,
  pmosDevice,
  ndmosDevice,
  pdmosDevice,
  diodeDevice,
  zenerDiodeDevice,
  npnDevice,
  pnpDevice,
  voltageSourceDevice,
  pulseVoltageSourceDevice,
  currentSourceDevice,
  voltageControlledSwitchDevice,
  idealSwitchDevice,
  closedSwitchDevice,
  groundDevice,
  vddPortDevice,
]);

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

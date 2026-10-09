import type { CircuitProject, ComponentDefinition } from "@icm/model";
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

function defineDeviceRegistry(
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

/** @internal Registry tests validate every built-in descriptor. */
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

/** Recognize an inherited black-box contract, rather than only its Symbol ID.
 * Formal aliases, order and retargeting remain authorable; generated bodies
 * independently check their fixed positional interface during netlist export. */
export function hasBuiltInSubcircuitInterface(
  component: ComponentDefinition,
): boolean {
  const local = component.subcircuit;
  const canonical = subcircuitsBySymbolId.get(component.symbol.id);
  if (
    !local ||
    !canonical ||
    local.id !== canonical.id ||
    local.symbolId !== canonical.symbolId ||
    local.ports.length !== canonical.ports.length
  )
    return false;
  const contacts = [...local.ports];
  for (const port of canonical.ports) {
    const index = contacts.findIndex(
      (candidate) =>
        candidate.direction === port.direction &&
        ("pinName" in candidate
          ? candidate.pinName === port.pinName
          : candidate.supply === port.supply),
    );
    if (index < 0) return false;
    contacts.splice(index, 1);
  }
  return true;
}

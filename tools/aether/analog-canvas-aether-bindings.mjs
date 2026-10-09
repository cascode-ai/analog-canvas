import { instanceBuiltInSubcircuit } from "@icm/devices";

/** Names alone must never replace an authored Cell or implementation. */
export function assertSupportedHierarchy(project, ir, source, instance) {
  if (instance.deviceClass !== "hierarchical") return;
  if (instance.target === "inverter"
      && instanceBuiltInSubcircuit(project, source)?.target === "inverter"
      && ir.generatedDefinitions?.some((item) => item.kind === "behavioral" && item.name === instance.target)) {
    return;
  }
  if (instance.reviewedExternalBindingId) return;
  const binding = source.netlist?.binding;
  const definition = binding?.kind === "external-subcircuit"
    ? project.externalSubcircuitDefinitions.find((item) => item.id === binding.definitionId)
    : null;
  // Explicit process remaps for declaration-only ULVT MOS interfaces.
  if (definition && !definition.implementation
      && ["nch_ulvt_mac", "pch_ulvt_mac"].includes(definition.name)
      && definition.name === instance.target) return;
  throw new Error(`${instance.reference}: unsupported authored subcircuit ${instance.target}`);
}

import { instanceSpiceSource } from "@icm/netlist";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
export type { ComponentSourceCode } from "@icm/netlist";

/** UI supplies only artwork fallback pins; electrical projection belongs to netlist. */
export function componentSourceCode(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  resolver: SymbolResolver,
) {
  const instance = project.documents
    .find((d) => d.id === documentId)
    ?.instances.find((i) => i.id === instanceId);
  const pins = instance
    ? (resolver
        .resolve(instance.symbolId, instance.symbolVariantId)
        ?.definition.pins.map((p) => p.name) ?? [])
    : [];
  return instanceSpiceSource(project, documentId, instanceId, pins);
}

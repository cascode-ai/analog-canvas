import { resolveReviewedExternalBinding } from "@icm/devices";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function repairLegacyReviewedExternalReferences(
  raw: Record<string, unknown>,
): { project: Record<string, unknown>; changed: boolean } {
  const project = structuredClone(raw);
  const definitions = new Map<
    string,
    ReturnType<typeof resolveReviewedExternalBinding>
  >();
  for (const definition of Array.isArray(project.externalSubcircuitDefinitions)
    ? project.externalSubcircuitDefinitions
    : []) {
    if (!isRecord(definition) || typeof definition.id !== "string") continue;
    const terminalNames = Array.isArray(definition.terminals)
      ? definition.terminals.flatMap((terminal) =>
          isRecord(terminal) && typeof terminal.name === "string"
            ? [terminal.name]
            : [],
        )
      : [];
    definitions.set(
      definition.id,
      typeof definition.name === "string"
        ? resolveReviewedExternalBinding(definition.name, terminalNames)
        : undefined,
    );
  }

  let changed = false;
  for (const document of Array.isArray(project.documents)
    ? project.documents
    : []) {
    if (!isRecord(document) || !Array.isArray(document.instances)) continue;
    const instances = document.instances.filter(isRecord);
    const occupied = new Set(
      instances.flatMap((instance) =>
        typeof instance.reference === "string"
          ? [instance.reference.toLowerCase()]
          : [],
      ),
    );
    for (const instance of instances) {
      if (
        typeof instance.reference !== "string" ||
        typeof instance.symbolId !== "string" ||
        !isRecord(instance.netlist) ||
        !isRecord(instance.netlist.binding) ||
        instance.netlist.binding.kind !== "external-subcircuit" ||
        typeof instance.netlist.binding.definitionId !== "string"
      ) {
        continue;
      }
      const reviewed = definitions.get(instance.netlist.binding.definitionId);
      if (
        !reviewed ||
        reviewed.symbolId !== instance.symbolId ||
        instance.reference.toUpperCase().startsWith("X")
      ) {
        continue;
      }
      const candidate = `X${instance.reference}`;
      if (occupied.has(candidate.toLowerCase())) continue;
      occupied.delete(instance.reference.toLowerCase());
      occupied.add(candidate.toLowerCase());
      instance.reference = candidate;
      changed = true;
    }
  }
  return { project, changed };
}

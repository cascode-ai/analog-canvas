import {
  deriveStableId,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { subcircuitDescriptor } from "@icm/devices";

/** Shared exported Cell spelling for both checks and netlist generation. */
export function portableCellIdentifier(
  name: string,
  documentId: string,
): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) return name;
  const ascii = name.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
  const body = ascii
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!body)
    return `Cell_${deriveStableId("cell", documentId).slice("cell-".length)}`;
  return /^[A-Za-z_]/u.test(body) ? body : `Cell_${body}`;
}

export function findExternalMasterCollisions(
  project: CircuitProject,
  documents: readonly SchematicDocument[] = project.documents,
): {
  documentId: string;
  instanceId: string;
  localDocumentId: string;
  masterName: string;
  localName: string;
}[] {
  const names = new Map<string, SchematicDocument>();
  for (const document of documents) {
    if (!document.netlist?.name) continue;
    const key = portableCellIdentifier(
      document.netlist.name,
      document.id,
    ).toLowerCase();
    if (!names.has(key)) names.set(key, document);
  }
  return documents.flatMap((document) =>
    document.instances.flatMap((instance) => {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") return [];
      const target =
        binding?.kind === "external-subcircuit"
          ? project.externalSubcircuitDefinitions.find(
              (item) => item.id === binding.definitionId,
            )?.name
          : binding?.kind === "unresolved-subcircuit"
            ? binding.name
            : subcircuitDescriptor(instance.symbolId)?.target;
      const local = target ? names.get(target.toLowerCase()) : undefined;
      return local && target
        ? [
            {
              documentId: document.id,
              instanceId: instance.id,
              localDocumentId: local.id,
              masterName: target,
              localName: local.netlist!.name,
            },
          ]
        : [];
    }),
  );
}

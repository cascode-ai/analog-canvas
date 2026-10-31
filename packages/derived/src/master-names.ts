import {
  deriveStableId,
  spellGreekLetters,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import {
  callOwner,
  isLibraryPart,
  namesOwnBody,
  subcircuitDescriptor,
} from "@icm/devices";

/**
 * Shared exported Cell spelling for both checks and netlist generation. Greek
 * letters keep their meaning as standard names (Φgen is PHIgen) before any
 * other character is folded away.
 */
export function portableCellIdentifier(
  name: string,
  documentId: string,
): string {
  const spelled = spellGreekLetters(name);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(spelled)) return spelled;
  const ascii = spelled.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
  const body = ascii
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!body)
    return `Cell_${deriveStableId("cell", documentId).slice("cell-".length)}`;
  return /^[A-Za-z_]/u.test(body) ? body : `Cell_${body}`;
}

/**
 * Calls by name that a local Cell of the same exported name would shadow:
 * two of the author's definitions under one name. An unbound Library part
 * calls its generated body, and one retargeted to the Cell's name is bound
 * to that Cell, so neither collides (#1928).
 */
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
      if (
        binding?.kind === "subcircuit" ||
        callOwner(project, instance) === "library"
      )
        return [];
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

/**
 * The master a Library part names in place of its own body (#1928), if any.
 * An older part with no binding names its symbol's own master, which for a
 * comparator placed before the ideal comparator is `comparator`.
 */
export function libraryPartMaster(
  project: Pick<CircuitProject, "componentDefinitions">,
  instance: SchematicDocument["instances"][number],
): string | undefined {
  if (!isLibraryPart(project, instance.symbolId)) return undefined;
  const binding = instance.netlist?.binding;
  const name =
    binding?.kind === "unresolved-subcircuit"
      ? binding.name
      : binding
        ? undefined
        : subcircuitDescriptor(instance.symbolId)?.target;
  return name && !namesOwnBody(instance.symbolId, name) ? name : undefined;
}

/**
 * The Cell or external definition of the master a Library part names in
 * place of its own body (#1928), and the parameters it declares: the part is
 * bound to it, Pins by name, as set-model binds it. Undefined for an unbound
 * part and for a name the Project does not define, which stays a call to the
 * reader's libraries.
 */
export function libraryPartRetarget(
  project: Pick<
    CircuitProject,
    "documents" | "externalSubcircuitDefinitions" | "componentDefinitions"
  >,
  instance: SchematicDocument["instances"][number],
):
  | {
      binding:
        | { kind: "subcircuit"; childDocumentId: string }
        | { kind: "external-subcircuit"; definitionId: string };
      formalParameters: readonly { readonly name: string }[];
    }
  | undefined {
  const name = libraryPartMaster(project, instance);
  if (!name) return undefined;
  const folded = name.toLowerCase();
  const cell = project.documents.find(
    (document) =>
      document.netlist &&
      (document.netlist.name.toLowerCase() === folded ||
        portableCellIdentifier(
          document.netlist.name,
          document.id,
        ).toLowerCase() === folded),
  );
  if (cell)
    return {
      binding: { kind: "subcircuit", childDocumentId: cell.id },
      formalParameters: cell.netlist!.formalParameters,
    };
  const definition = project.externalSubcircuitDefinitions.find(
    (candidate) => candidate.name.toLowerCase() === folded,
  );
  return (
    definition && {
      binding: { kind: "external-subcircuit", definitionId: definition.id },
      formalParameters: definition.formalParameters,
    }
  );
}

import type { CircuitProject } from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import {
  buildCircuitComponentPackage,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type {
  SharedComponent,
  SharedDefinitionPayload,
} from "./component-library-contract";
import {
  COMPONENT_CONTENT_VERSION,
  componentPublicationContent,
  componentContentDigest,
} from "./component-publication-content";

/** Both insertion paths capture the same provenance on the local class. */
export async function componentLibraryCapture(
  entry: SharedComponent,
): Promise<SharedDefinitionPayload> {
  const payload = structuredClone({
    definition: entry.definition,
    ...(entry.circuit ? { circuit: entry.circuit } : {}),
  });
  payload.definition.libraryOrigin = {
    componentId: entry.id,
    revision: entry.revision,
    authorId: entry.authorId,
    contentVersion: COMPONENT_CONTENT_VERSION,
    digest: await componentContentDigest(componentPublicationContent(payload)),
  };
  return payload;
}

export function componentLibraryAssociation(
  project: CircuitProject,
  symbolId: string,
  payload: SharedDefinitionPayload,
): ProjectStructureEdit[] {
  const definition = payload.definition;
  const captured = project.componentDefinitions?.find(
    (item) => item.symbol.id === symbolId,
  );
  const automatic = !captured
    ? project.externalSubcircuitDefinitions.find(
        (item) =>
          !item.symbolId && externalSubcircuitSymbolId(item.id) === symbolId,
      )
    : undefined;
  const current = captured ?? automatic;
  if (!current || !definition.libraryOrigin)
    throw Error(
      "The captured component is no longer available for association.",
    );
  const applied = {
    ...project,
    modelSources: project.modelSources?.map(
      ({ draft: _draft, ...source }) => source,
    ),
  };
  const currentPayload = automatic
    ? buildCircuitComponentPackage(applied, automatic.id, symbolId)
    : captured?.circuitBinding
      ? buildCircuitComponentPackage(
          applied,
          captured.circuitBinding.definitionId,
          symbolId,
        )
      : { definition: captured! };
  if (
    componentPublicationContent(currentPayload) !==
    componentPublicationContent(payload)
  )
    throw Error(
      "The local definition changed. Recover the published snapshot before associating.",
    );
  if (
    JSON.stringify(current.libraryOrigin) ===
    JSON.stringify(definition.libraryOrigin)
  )
    return [];
  return [
    {
      kind: "associate_component_library",
      symbolId,
      ...(automatic ? { definitionId: automatic.id } : {}),
      expectedOrigin: current.libraryOrigin ?? null,
      origin: definition.libraryOrigin,
    },
  ];
}

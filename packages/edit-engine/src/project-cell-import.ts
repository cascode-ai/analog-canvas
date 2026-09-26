import {
  CircuitProjectSchema,
  deriveStableId,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import {
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
  resolvePdkSymbolMappingForTerminalOrder,
} from "@icm/symbols";

import type { ProjectStructureEdit } from "./project-transaction.js";
import { planExternalCopyDependencies } from "./project-copy-dependencies.js";

export type ProjectCellImportFailureCode =
  | "SOURCE_CELL_NOT_FOUND"
  | "SYMBOL_LIBRARY_MISMATCH"
  | "SOURCE_DEPENDENCY_MISSING"
  | "EXTERNAL_DEFINITION_CONFLICT"
  | "PARTIAL_IMPORT_CONFLICT"
  | "IMPORT_TOO_LARGE";

export type ProjectCellImportPlan =
  | {
      ok: true;
      status: "ready";
      rootDocumentId: string;
      importedDocumentIds: readonly string[];
      edits: readonly ProjectStructureEdit[];
    }
  | {
      ok: true;
      status: "already-imported";
      rootDocumentId: string;
      importedDocumentIds: readonly string[];
      edits: readonly [];
    }
  | {
      ok: false;
      code: ProjectCellImportFailureCode;
      message: string;
    };

const ID_VALUE_KEYS = new Set([
  "annotationId",
  "bendId",
  "childDocumentId",
  "definitionId",
  "fileId",
  "id",
  "instanceId",
  "junctionId",
  "legId",
  "netId",
  "nmosNetId",
  "objectId",
  "pmosNetId",
  "routeId",
  "sourceNetId",
  "terminalId",
]);
const ID_ARRAY_KEYS = new Set(["interfaceInstanceIds", "objectIds"]);

function importId(
  destinationProjectId: string,
  sourceProjectId: string,
  rootDocumentId: string,
  sourceId: string,
): string {
  return deriveStableId(
    "import",
    destinationProjectId,
    sourceProjectId,
    rootDocumentId,
    sourceId,
  );
}

function collectIdentifierValues(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectIdentifierValues(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "parameters" || key === "properties") continue;
    if (ID_VALUE_KEYS.has(key) && typeof item === "string") output.add(item);
    if (ID_ARRAY_KEYS.has(key) && Array.isArray(item)) {
      for (const id of item) if (typeof id === "string") output.add(id);
    }
    collectIdentifierValues(item, output);
  }
}

export function remapImportedIdentifierValues(
  value: unknown,
  identifiers: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      remapImportedIdentifierValues(item, identifiers),
    );
  }
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "parameters" || key === "properties") {
      output[key] = structuredClone(item);
      continue;
    }
    if (ID_VALUE_KEYS.has(key) && typeof item === "string") {
      output[key] = identifiers.get(item) ?? item;
    } else if (ID_ARRAY_KEYS.has(key) && Array.isArray(item)) {
      output[key] = item.map((id) =>
        typeof id === "string" ? (identifiers.get(id) ?? id) : id,
      );
    } else {
      output[key] = remapImportedIdentifierValues(item, identifiers);
    }
  }
  return output;
}

function cellClosure(
  source: CircuitProject,
  rootDocumentId: string,
): SchematicDocument[] | null {
  const byId = new Map(
    source.documents.map((document) => [document.id, document]),
  );
  if (!byId.has(rootDocumentId)) return null;
  const ordered: SchematicDocument[] = [];
  const visited = new Set<string>();
  const visit = (documentId: string): boolean => {
    if (visited.has(documentId)) return true;
    const document = byId.get(documentId);
    if (!document) return false;
    visited.add(documentId);
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit" && !visit(binding.childDocumentId)) {
        return false;
      }
    }
    ordered.push(document);
    return true;
  };
  return visit(rootDocumentId) ? ordered : null;
}

function importedCellNames(
  destination: CircuitProject,
  source: CircuitProject,
  closure: readonly SchematicDocument[],
): Map<string, string> {
  const used = new Set(
    destination.documents.flatMap((document) =>
      document.netlist
        ? [document.netlist.name.toLocaleLowerCase("en-US")]
        : [],
    ),
  );
  const names = new Map<string, string>();
  const suffix = deriveStableId("cell", source.id).slice(-8);
  for (const document of closure) {
    const base = document.netlist?.name ?? document.name;
    let candidate = base;
    if (used.has(candidate.toLocaleLowerCase("en-US"))) {
      candidate = `${base}_${suffix}`.slice(0, 128);
    }
    let sequence = 2;
    while (used.has(candidate.toLocaleLowerCase("en-US"))) {
      const tail = `_${suffix}_${sequence++}`;
      candidate = `${base.slice(0, 128 - tail.length)}${tail}`;
    }
    used.add(candidate.toLocaleLowerCase("en-US"));
    names.set(document.id, candidate);
  }
  return names;
}

/**
 * Plans one independent, project-local copy of a Cell and every local Cell it
 * calls. The returned edit is atomic at the existing Project transaction
 * boundary; no persistent cross-Project reference or live synchronization is
 * created.
 */
export function planProjectCellImport(
  destinationInput: CircuitProject,
  sourceInput: CircuitProject,
  sourceDocumentId: string,
  options: { sharedSnapshot?: boolean } = {},
): ProjectCellImportPlan {
  const destination = CircuitProjectSchema.parse(destinationInput);
  const source = CircuitProjectSchema.parse(sourceInput);
  const identityRoot = options.sharedSnapshot
    ? "copy-snapshot"
    : sourceDocumentId;
  const sourceRoot = source.documents.find(
    (document) => document.id === sourceDocumentId,
  );
  if (!sourceRoot) {
    return {
      ok: false,
      code: "SOURCE_CELL_NOT_FOUND",
      message: `Source Cell does not exist: ${sourceDocumentId}`,
    };
  }
  if (
    JSON.stringify(destination.symbolLibrary) !==
    JSON.stringify(source.symbolLibrary)
  ) {
    return {
      ok: false,
      code: "SYMBOL_LIBRARY_MISMATCH",
      message: `Source uses Symbol Library ${source.symbolLibrary.id}@${source.symbolLibrary.version}; destination requires ${destination.symbolLibrary.id}@${destination.symbolLibrary.version}`,
    };
  }
  const closure = cellClosure(source, sourceDocumentId);
  if (!closure) {
    return {
      ok: false,
      code: "SOURCE_DEPENDENCY_MISSING",
      message: `Source Cell ${sourceRoot.name} has a missing child Cell`,
    };
  }

  const expectedDocumentIds = closure.map((document) =>
    importId(destination.id, source.id, identityRoot, document.id),
  );
  const existingDocumentIds = new Set(
    destination.documents.map((document) => document.id),
  );
  const existingCount = expectedDocumentIds.filter((id) =>
    existingDocumentIds.has(id),
  ).length;
  if (existingCount === expectedDocumentIds.length && !options.sharedSnapshot) {
    return {
      ok: true,
      status: "already-imported",
      rootDocumentId: importId(
        destination.id,
        source.id,
        sourceDocumentId,
        sourceDocumentId,
      ),
      importedDocumentIds: expectedDocumentIds,
      edits: [],
    };
  }
  if (existingCount > 0 && !options.sharedSnapshot) {
    return {
      ok: false,
      code: "PARTIAL_IMPORT_CONFLICT",
      message: "Part of this Cell closure already exists in the destination",
    };
  }

  let dependencies: ReturnType<typeof planExternalCopyDependencies>;
  try {
    dependencies = planExternalCopyDependencies(
      destination,
      source,
      closure.flatMap((document) => document.instances),
      closure,
      (id) => importId(destination.id, source.id, identityRoot, id),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: message.includes("incompatible")
        ? "EXTERNAL_DEFINITION_CONFLICT"
        : "SOURCE_DEPENDENCY_MISSING",
      message,
    };
  }
  const externalIdMap = dependencies.externalIds;
  const fileIdMap = dependencies.fileIds;
  const newExternalDefinitions = dependencies.edits.flatMap((edit) =>
    edit.kind === "upsert_external_subcircuit_definition"
      ? [edit.definition]
      : [],
  );
  const identifiers = new Set<string>();
  for (const document of closure)
    collectIdentifierValues(document, identifiers);

  const identifierMap = new Map<string, string>();
  for (const identifier of identifiers) {
    identifierMap.set(
      identifier,
      importId(destination.id, source.id, identityRoot, identifier),
    );
  }
  for (const [sourceId, targetId] of externalIdMap) {
    identifierMap.set(sourceId, targetId);
  }
  for (const [sourceId, targetId] of fileIdMap)
    identifierMap.set(sourceId, targetId);

  const names = importedCellNames(destination, source, closure);
  if (options.sharedSnapshot)
    for (const document of closure) {
      const existing = destination.documents.find(
        (d) => d.id === identifierMap.get(document.id),
      );
      if (existing)
        names.set(document.id, existing.netlist?.name ?? existing.name);
    }
  const importedDocuments = closure.map((document) => {
    const remapped = remapImportedIdentifierValues(
      document,
      identifierMap,
    ) as SchematicDocument;
    const name = names.get(document.id)!;
    remapped.name = name;
    if (remapped.netlist) remapped.netlist.name = name;
    // Imported Cells are independent destination definitions. Keep the
    // source span for provenance, but bind the definition to its destination
    // Cell name so hierarchical symbol resolution and emitted `.subckt`
    // identity continue to agree after a collision rename.
    if (remapped.sourceBinding) remapped.sourceBinding.cellName = name;
    for (const instance of remapped.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") {
        const child = closure.find(
          (candidate) =>
            identifierMap.get(candidate.id) === binding.childDocumentId,
        );
        if (child)
          instance.symbolId = hierarchicalSymbolId(names.get(child.id)!);
      } else if (binding?.kind === "external-subcircuit") {
        const definition = [
          ...destination.externalSubcircuitDefinitions,
          ...newExternalDefinitions,
        ].find((candidate) => candidate.id === binding.definitionId);
        const reviewed = definition
          ? resolvePdkSymbolMappingForTerminalOrder(
              definition.name,
              definition.terminals.map((terminal) => terminal.name),
            )
          : undefined;
        instance.symbolId =
          reviewed?.symbolId === instance.symbolId
            ? instance.symbolId
            : externalSubcircuitSymbolId(binding.definitionId);
      }
    }
    return remapped;
  });
  const rootDocumentId = identifierMap.get(sourceDocumentId)!;
  if (options.sharedSnapshot)
    for (const document of importedDocuments) {
      const existing = destination.documents.find((d) => d.id === document.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(document)) {
        return {
          ok: false,
          code: "PARTIAL_IMPORT_CONFLICT",
          message: `Previously copied Cell ${existing.name} was changed in the destination; cannot silently reuse it for this source snapshot`,
        };
      }
    }
  const edits: ProjectStructureEdit[] = [
    ...dependencies.edits,
    ...importedDocuments
      .filter(
        (document) =>
          !options.sharedSnapshot || !existingDocumentIds.has(document.id),
      )
      .map((document): ProjectStructureEdit => ({
        kind: "add_document",
        document,
      })),
  ];
  if (edits.length > 256) {
    return {
      ok: false,
      code: "IMPORT_TOO_LARGE",
      message: `Cell closure requires ${edits.length} Project edits; the limit is 256`,
    };
  }
  return {
    ok: true,
    status: "ready",
    rootDocumentId,
    importedDocumentIds: importedDocuments.map((document) => document.id),
    edits,
  };
}

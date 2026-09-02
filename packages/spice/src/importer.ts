import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  CircuitProjectSchema,
  deriveStableId,
} from "@icm/model";
import {
  reviewedExternalBindingForTerminalCount,
  sky130MicrometresToProjectLength,
} from "@icm/devices";
import {
  externalSubcircuitSymbolId,
  isRazaviProductSymbolId,
  resolvePdkSymbolMapping,
} from "@icm/symbols";
import type { PdkSymbolMappingOverride } from "@icm/symbols";
import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  Instance,
  InstanceNetlistBinding,
  NetlistDeviceClass,
  Net,
  SchematicDocument,
} from "@icm/model";

import type { SpiceCompileResult } from "./compiler.js";
import type { SpiceCompileOptions } from "./dialect.js";
import { diagnostic } from "./diagnostics.js";
import type { SpiceDiagnostic } from "./diagnostics.js";
import type { CircuitCellIR, CircuitIR, CircuitInstanceIR } from "./ir.js";
import type { SourceBundle, SpiceSourceInput } from "./source-types.js";
import { compileSpiceSources } from "./compiler.js";

export interface SpiceImportResult extends SpiceCompileResult {
  project: CircuitProject | null;
}

export interface SpiceImportOptions {
  symbolMappings?: readonly PdkSymbolMappingOverride[];
  namingProfile?: "native" | "cadence-bang";
}

function importedNetName(
  name: string,
  scope: "local" | "global",
  namingProfile: NonNullable<SpiceImportOptions["namingProfile"]>,
): { name: string; scope: "local" | "global"; sourceName: string } {
  if (
    namingProfile === "cadence-bang" &&
    name.length > 1 &&
    name.endsWith("!")
  ) {
    return { name: name.slice(0, -1), scope: "global", sourceName: name };
  }
  return { name, scope, sourceName: name };
}

interface ImportSymbolMapping {
  symbolId: string;
  pinNames?: readonly string[];
  registryId?: string;
}

function explicitSymbolOverride(
  modelName: string,
  terminalCount: number,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): ImportSymbolMapping | undefined {
  const override = symbolMappings.find(
    (candidate) =>
      candidate.modelName.toLowerCase() === modelName.toLowerCase() &&
      candidate.terminalCount === terminalCount &&
      candidate.pinNames.length === terminalCount &&
      isRazaviProductSymbolId(candidate.symbolId),
  );
  return override
    ? {
        symbolId: override.symbolId,
        ...(override.pinNames ? { pinNames: override.pinNames } : {}),
        ...(override.registryId ? { registryId: override.registryId } : {}),
      }
    : undefined;
}

function externalDefinitionId(masterName: string): string {
  return deriveStableId("external-subcircuit", masterName.toLowerCase());
}

function netlistDeviceClass(symbolId: string): NetlistDeviceClass | null {
  const classes: Readonly<Record<string, NetlistDeviceClass>> = {
    resistor: "resistor",
    capacitor: "capacitor",
    inductor: "inductor",
    "inductor-compact": "inductor",
    nmos: "mos",
    pmos: "mos",
    diode: "diode",
    "zener-diode": "diode",
    npn: "bjt",
    pnp: "bjt",
    "voltage-source": "voltage-source",
    "current-source": "current-source",
    ground: "net-marker",
    vdd: "net-marker",
  };
  return classes[symbolId] ?? null;
}

function importedNetlistBinding(
  instance: CircuitInstanceIR,
  mapping: ImportSymbolMapping,
): InstanceNetlistBinding | undefined {
  if (instance.target.kind === "subcircuit") {
    return {
      kind: "unresolved-subcircuit",
      name: instance.target.cellName,
    };
  }
  if (instance.target.kind === "external-subcircuit") {
    return {
      kind: "external-subcircuit",
      definitionId: externalDefinitionId(instance.target.masterName),
    };
  }
  const deviceClass = netlistDeviceClass(mapping.symbolId);
  if (!deviceClass) return undefined;
  switch (instance.target.kind) {
    case "primitive":
      return { kind: "primitive", deviceClass };
    case "model":
      return { kind: "model", deviceClass, name: instance.target.modelName };
    case "opaque":
      return { kind: "model", deviceClass, name: instance.target.sourceName };
  }
}

function symbolFor(
  instance: CircuitInstanceIR,
  modelTypeByName: ReadonlyMap<string, string>,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): ImportSymbolMapping | null {
  if (instance.target.kind === "subcircuit") {
    return {
      symbolId: deriveStableId(
        "hierarchical-symbol",
        instance.target.cellName.toLowerCase(),
      ),
    };
  }
  if (instance.target.kind === "external-subcircuit") {
    const mapping = resolvePdkSymbolMapping(
      instance.target.masterName,
      instance.terminals.length,
      symbolMappings,
    );
    return {
      symbolId:
        mapping?.symbolId ??
        externalSubcircuitSymbolId(
          externalDefinitionId(instance.target.masterName),
        ),
      ...(mapping?.pinNames ? { pinNames: mapping.pinNames } : {}),
      ...(mapping?.registryId ? { registryId: mapping.registryId } : {}),
    };
  }
  if (instance.target.kind === "model") {
    const pdkMapping = explicitSymbolOverride(
      instance.target.modelName,
      instance.terminals.length,
      symbolMappings,
    );
    if (pdkMapping) {
      return {
        symbolId: pdkMapping.symbolId,
        ...(pdkMapping.pinNames ? { pinNames: pdkMapping.pinNames } : {}),
        ...(pdkMapping.registryId ? { registryId: pdkMapping.registryId } : {}),
      };
    }
    const modelType = modelTypeByName.get(
      instance.target.modelName.toLowerCase(),
    );
    if (instance.terminals.length === 2 && modelType === "d")
      return { symbolId: "diode", pinNames: ["A", "K"] };
    if (instance.terminals.length === 3 && modelType === "npn")
      return { symbolId: "npn", pinNames: ["C", "B", "E"] };
    if (instance.terminals.length === 3 && modelType === "pnp")
      return { symbolId: "pnp", pinNames: ["C", "B", "E"] };
    if (instance.terminals.length === 4 && modelType === "nmos")
      return { symbolId: "nmos", pinNames: ["D", "G", "S", "B"] };
    if (instance.terminals.length === 4 && modelType === "pmos")
      return { symbolId: "pmos", pinNames: ["D", "G", "S", "B"] };
    return null;
  }
  if (instance.target.kind === "opaque") {
    const pdkMapping = explicitSymbolOverride(
      instance.target.sourceName,
      instance.terminals.length,
      symbolMappings,
    );
    return pdkMapping
      ? {
          symbolId: pdkMapping.symbolId,
          ...(pdkMapping.pinNames ? { pinNames: pdkMapping.pinNames } : {}),
          ...(pdkMapping.registryId
            ? { registryId: pdkMapping.registryId }
            : {}),
        }
      : null;
  }
  if (instance.target.kind !== "primitive") return null;
  const symbols: Record<string, ImportSymbolMapping> = {
    resistor: { symbolId: "resistor" },
    capacitor: { symbolId: "capacitor" },
    // Imported L elements take the scale-reconciled Inductor so an imported
    // schematic reads at the same scale as its R and C.
    inductor: { symbolId: "inductor-compact" },
    nmos: { symbolId: "nmos" },
    pmos: { symbolId: "pmos" },
    "voltage-source": { symbolId: "voltage-source" },
    "current-source": { symbolId: "current-source" },
  };
  const mapping = symbols[instance.target.family];
  return mapping && isRazaviProductSymbolId(mapping.symbolId) ? mapping : null;
}

function targetDescription(
  instance: CircuitInstanceIR,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): string {
  switch (instance.target.kind) {
    case "primitive":
      return `primitive:${instance.target.family}`;
    case "model":
      return `model:${instance.target.modelName}`;
    case "subcircuit":
      return `subcircuit:${instance.target.cellName}`;
    case "external-subcircuit":
      return `external-subcircuit:${instance.target.masterName}`;
    case "opaque":
      return explicitSymbolOverride(
        instance.target.sourceName,
        instance.terminals.length,
        symbolMappings,
      )
        ? `model:${instance.target.sourceName}`
        : `opaque:${instance.target.sourceName}`;
  }
}

function importProvenance(
  instance: CircuitInstanceIR,
  modelTypeByName: ReadonlyMap<string, string>,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): NonNullable<Instance["importProvenance"]> {
  switch (instance.target.kind) {
    case "primitive":
      return {
        kind: "primitive",
        sourceMasterName: instance.target.family,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "resolved",
      };
    case "model": {
      const modelType = modelTypeByName.get(
        instance.target.modelName.toLowerCase(),
      );
      return {
        kind: "model",
        sourceMasterName: instance.target.modelName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "resolved",
        ...(modelType ? { modelType } : {}),
      };
    }
    case "subcircuit":
      // The second importer pass resolves the stable child document id. Until
      // then the evidence records the target name without deriving it from a
      // mutable compatibility property.
      return {
        kind: "subcircuit",
        sourceMasterName: instance.target.cellName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "missing",
      };
    case "external-subcircuit":
      return {
        kind: "opaque",
        sourceMasterName: instance.target.masterName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "missing",
      };
    case "opaque":
      return {
        kind: "opaque",
        sourceMasterName: instance.target.sourceName,
        sourceTarget: targetDescription(instance, symbolMappings),
        status: "resolved",
      };
  }
}

function importInstance(
  instance: CircuitInstanceIR,
  diagnostics: SpiceDiagnostic[],
  modelTypeByName: ReadonlyMap<string, string>,
  symbolMappings: readonly PdkSymbolMappingOverride[],
): Instance | null {
  const mapping = symbolFor(instance, modelTypeByName, symbolMappings);
  if (!mapping) {
    diagnostics.push(
      diagnostic(
        "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
        "error",
        "import",
        `Unsupported SPICE device ${instance.name} (${targetDescription(instance, symbolMappings)}): the approved Razavi catalog has no symbol. Add and review a Razavi symbol mapping before importing.`,
        instance.sourceRef,
      ),
    );
    return null;
  }
  const netlistBinding = importedNetlistBinding(instance, mapping);
  const reviewed =
    instance.target.kind === "external-subcircuit"
      ? reviewedExternalBindingForTerminalCount(
          instance.target.masterName,
          instance.terminals.length,
        )
      : undefined;
  const parameters = Object.fromEntries(
    Object.entries(instance.parameters).map(([name, parameter]) => {
      const reviewedParameter = reviewed?.parameters.find(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
      );
      if (reviewedParameter?.targetUnit !== "micrometre") {
        return [name, parameter.rawText];
      }
      try {
        return [name, sky130MicrometresToProjectLength(parameter.rawText)];
      } catch (error) {
        diagnostics.push(
          diagnostic(
            "SPICE_IMPORT_INVALID_REVIEWED_GEOMETRY",
            "error",
            "import",
            error instanceof Error ? error.message : String(error),
            instance.sourceRef,
          ),
        );
        return [name, parameter.rawText];
      }
    }),
  );
  return {
    id: instance.id,
    symbolId: mapping.symbolId,
    sourceRef: instance.sourceRef,
    importProvenance: {
      ...importProvenance(instance, modelTypeByName, symbolMappings),
      ...(mapping.registryId
        ? { symbolMappingRegistryId: mapping.registryId }
        : {}),
      terminalMapping: instance.terminals.map((terminal) => ({
        sourcePosition: terminal.position,
        pinName:
          mapping.pinNames?.[terminal.position] ??
          terminal.name ??
          `P${terminal.position + 1}`,
      })),
    },
    placement: null,
    reference: instance.name,
    netlist: {
      ...(netlistBinding ? { binding: netlistBinding } : {}),
      parameters,
    },
  };
}

function importDocument(
  cell: CircuitCellIR,
  diagnostics: SpiceDiagnostic[],
  modelTypeByName: ReadonlyMap<string, string>,
  options: SpiceImportOptions,
): SchematicDocument {
  const symbolMappings = options.symbolMappings ?? [];
  const namingProfile = options.namingProfile ?? "native";
  const documentId = deriveStableId("document", cell.name.toLowerCase());
  const visibleInstances = cell.instances.filter((instance) => {
    if (instance.terminals.length > 0) return true;
    diagnostics.push(
      diagnostic(
        "SPICE_IMPORT_NON_VISUAL_INSTANCE",
        "warning",
        "import",
        `Structural instance ${instance.name} has no electrical terminals and remains in transient Circuit IR only`,
        instance.sourceRef,
      ),
    );
    return false;
  });
  const instances = visibleInstances
    .map((instance) =>
      importInstance(instance, diagnostics, modelTypeByName, symbolMappings),
    )
    .filter((instance): instance is Instance => instance !== null);
  const importedInstanceById = new Map(
    instances.map((instance) => [instance.id, instance]),
  );
  const nets: Net[] = cell.nets.map((net) => ({
    id: net.id,
    terminals: visibleInstances
      .filter((instance) => importedInstanceById.has(instance.id))
      .flatMap((instance) =>
        instance.terminals
          .filter((terminal) => terminal.netId === net.id)
          .map((terminal) => ({
            instanceId: instance.id,
            pinName: String(
              importedInstanceById
                .get(instance.id)
                ?.importProvenance?.terminalMapping?.find(
                  (candidate) => candidate.sourcePosition === terminal.position,
                )?.pinName ?? `P${terminal.position + 1}`,
            ),
          })),
      ),
  }));
  const formalTerminals = cell.ports.map((port, index) => {
    const importedPortName = importedNetName(
      port.name,
      cell.nets.find((net) => net.id === port.netId)?.scope ?? "local",
      namingProfile,
    ).name;
    const interfaceInstanceId = deriveStableId(
      "cell-pin",
      documentId,
      String(index),
      importedPortName,
    );
    instances.push({
      id: interfaceInstanceId,
      symbolId: "port",
      placement: null,
    });
    const net = nets.find((candidate) => candidate.id === port.netId);
    net?.terminals.push({ instanceId: interfaceInstanceId, pinName: "P" });
    return {
      id: deriveStableId(
        "cell-terminal",
        documentId,
        String(index),
        importedPortName,
      ),
      name: importedPortName,
      netId: port.netId,
      direction: "passive" as const,
      interfaceInstanceIds: [interfaceInstanceId],
    };
  });
  return {
    id: documentId,
    name: cell.name,
    revision: 0,
    sourceBinding: { cellName: cell.name, sourceRef: cell.sourceRef },
    sourceStatus: "in-sync",
    netlist: {
      name: cell.name,
      terminals: formalTerminals,
      formalParameters: cell.parameters.map((parameter) => ({
        name: parameter.name,
        defaultValue: parameter.rawText,
      })),
    },
    instances,
    nets,
    connectivityEvidence: cell.nets.flatMap((net) => {
      const importedName = importedNetName(net.name, net.scope, namingProfile);
      return [
        ...(importedName.name
          ? [
              importedName.scope === "global"
                ? {
                    id: deriveStableId(
                      "connectivity-evidence",
                      documentId,
                      "global-declaration",
                      net.id,
                      importedName.name,
                    ),
                    kind: "name-claim" as const,
                    netId: net.id,
                    name: importedName.name,
                    owner: {
                      kind: "global-declaration" as const,
                      sourceNetId: net.id,
                    },
                    scope: "global" as const,
                    ...(importedName.name === "0"
                      ? { powerDomain: "ground" as const }
                      : {}),
                  }
                : {
                    id: deriveStableId(
                      "connectivity-evidence",
                      documentId,
                      "net-name-hint",
                      net.id,
                      net.name,
                    ),
                    kind: "net-name-hint" as const,
                    netId: net.id,
                    sourceName: importedName.sourceName,
                    origin: "spice-import" as const,
                  },
            ]
          : []),
        ...(importedName.scope === "global" &&
        importedName.sourceName !== importedName.name
          ? [
              {
                id: deriveStableId(
                  "connectivity-evidence",
                  documentId,
                  "net-name-hint",
                  net.id,
                  importedName.sourceName,
                ),
                kind: "net-name-hint" as const,
                netId: net.id,
                sourceName: importedName.sourceName,
                origin: "spice-import" as const,
              },
            ]
          : []),
        ...[net.id].map((sourceNetId) => ({
          id: deriveStableId(
            "connectivity-evidence",
            documentId,
            "spice-source",
            net.id,
            sourceNetId,
          ),
          kind: "spice-source" as const,
          netId: net.id,
          sourceNetId,
        })),
      ];
    }),
    routes: [],
    junctions: [],
    annotations: [],
    presentation: {
      styleProfileId: "razavi-textbook-v1",
      grid: 10,
      compactness: "normal",
    },
    layoutGroups: [],
    constraints: [],
    noConnects: [],
  };
}

/**
 * Records a stable document link for an imported `X` instance. Typed
 * `netlist.binding` is the navigation authority; import provenance retains the
 * source spelling without becoming an electrical runtime fallback.
 */
function bindImportedChildDocuments(documents: readonly SchematicDocument[]): {
  documents: SchematicDocument[];
  externalSubcircuitDefinitions: ExternalSubcircuitDefinition[];
} {
  const documentIdByCellName = new Map(
    documents.flatMap((document) => {
      const cellName = document.sourceBinding?.cellName;
      return cellName ? [[cellName.toLowerCase(), document.id] as const] : [];
    }),
  );
  const externalDefinitions = new Map<string, ExternalSubcircuitDefinition>();
  const boundDocuments: SchematicDocument[] = documents.map((document) => ({
    ...document,
    instances: document.instances.map((instance) => {
      const referencedInstance = { ...instance };
      const isImportedChild = instance.importProvenance?.kind === "subcircuit";
      const isImportedExternal =
        instance.netlist?.binding?.kind === "external-subcircuit";
      if (!isImportedChild && !isImportedExternal) {
        return referencedInstance;
      }
      const childDocumentId = isImportedChild
        ? documentIdByCellName.get(
            instance.importProvenance!.sourceMasterName.toLowerCase(),
          )
        : undefined;
      const externalDefinition = !childDocumentId
        ? (() => {
            const key =
              instance.importProvenance!.sourceMasterName.toLowerCase();
            const existing = externalDefinitions.get(key);
            if (existing) return existing;
            const definition: ExternalSubcircuitDefinition = {
              id: externalDefinitionId(
                instance.importProvenance!.sourceMasterName,
              ),
              name: instance.importProvenance!.sourceMasterName,
              terminals: (() => {
                const sourceTerminals = (
                  instance.importProvenance!.terminalMapping ?? []
                ).toSorted(
                  (left, right) => left.sourcePosition - right.sourcePosition,
                );
                const reviewed = reviewedExternalBindingForTerminalCount(
                  instance.importProvenance!.sourceMasterName,
                  sourceTerminals.length,
                );
                return sourceTerminals.map((terminal, index) => ({
                  id: deriveStableId(
                    "external-subcircuit-terminal",
                    key,
                    String(index),
                  ),
                  name:
                    reviewed?.terminals.length === sourceTerminals.length
                      ? reviewed.terminals[index]!.targetName
                      : terminal.pinName,
                  direction: "passive" as const,
                }));
              })(),
              formalParameters:
                reviewedExternalBindingForTerminalCount(
                  instance.importProvenance!.sourceMasterName,
                  instance.importProvenance!.terminalMapping?.length ?? 0,
                )?.parameters.map((parameter) => ({
                  name: parameter.name,
                  ...(parameter.targetDefaultValue === undefined
                    ? {}
                    : { defaultValue: parameter.targetDefaultValue }),
                })) ?? [],
              interfaceStatus: reviewedExternalBindingForTerminalCount(
                instance.importProvenance!.sourceMasterName,
                instance.importProvenance!.terminalMapping?.length ?? 0,
              )
                ? "declared"
                : "inferred-positional",
            };
            externalDefinitions.set(key, definition);
            return definition;
          })()
        : undefined;
      return {
        ...referencedInstance,
        importProvenance: {
          ...instance.importProvenance,
          status:
            childDocumentId ||
            (isImportedExternal &&
              Boolean(instance.importProvenance?.symbolMappingRegistryId))
              ? ("resolved" as const)
              : ("missing" as const),
        } as NonNullable<Instance["importProvenance"]>,
        netlist: instance.netlist
          ? {
              ...instance.netlist,
              binding: childDocumentId
                ? {
                    kind: "subcircuit" as const,
                    childDocumentId,
                  }
                : {
                    kind: "external-subcircuit" as const,
                    definitionId: externalDefinition!.id,
                  },
            }
          : undefined,
      };
    }),
  }));
  return {
    documents: boundDocuments,
    externalSubcircuitDefinitions: [...externalDefinitions.values()],
  };
}

function sourceProjectName(bundle: SourceBundle): string {
  const filename = bundle.entryPath.split("/").at(-1) ?? bundle.entryPath;
  return filename.replace(/\.[^.]+$/u, "") || "Imported SPICE";
}

export function importCircuitIR(
  ir: CircuitIR,
  bundle: SourceBundle,
  inputDiagnostics: readonly SpiceDiagnostic[] = [],
  options: SpiceImportOptions = {},
): { project: CircuitProject; diagnostics: SpiceDiagnostic[] } {
  const diagnostics = [...inputDiagnostics];
  const modelTypeByName = new Map(
    ir.models.map((model) => [
      model.name.toLowerCase(),
      model.modelType.toLowerCase(),
    ]),
  );
  const importedDocuments = ir.cells.map((cell) =>
    importDocument(cell, diagnostics, modelTypeByName, options),
  );
  const { documents, externalSubcircuitDefinitions } =
    bindImportedChildDocuments(importedDocuments);
  const topCell = ir.topCells[0] ?? ir.cells[0]?.name;
  const topDocument = documents.find(
    (document) =>
      document.sourceBinding?.cellName.toLowerCase() === topCell?.toLowerCase(),
  );
  if (!topDocument)
    throw new Error("Circuit IR has no importable top Document");
  const name = topCell ?? sourceProjectName(bundle);
  const entryHash = bundle.files.find(
    (file) => file.id === bundle.entryFileId,
  )?.hash;
  const project = CircuitProjectSchema.parse({
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: deriveStableId("project", bundle.entryPath, entryHash ?? "missing"),
    name: `${name} (SPICE Import)`,
    source: {
      entry: bundle.entryPath,
      dialect: ir.dialect,
      sourcePolicy: "copy",
      files: bundle.files.map((file) => ({
        id: file.id,
        path: file.path,
        hash: file.hash,
      })),
    },
    symbolLibrary: {
      id: "razavi-symbols",
      version: "1",
      hash: "razavi-reference-v1",
    },
    structureRevision: 0,
    topDocumentId: topDocument.id,
    documents,
    externalSubcircuitDefinitions,
  });
  return { project, diagnostics };
}

export function importCompileResult(
  result: SpiceCompileResult,
  options: SpiceImportOptions = {},
): SpiceImportResult {
  if (!result.ir) return { ...result, project: null };
  try {
    const imported = importCircuitIR(
      result.ir,
      result.bundle,
      result.diagnostics,
      options,
    );
    const hasErrors = imported.diagnostics.some(
      (item) => item.severity === "error",
    );
    return {
      ...result,
      project: hasErrors ? null : imported.project,
      diagnostics: imported.diagnostics,
      successful: !hasErrors,
    };
  } catch (error) {
    const diagnostics = [
      ...result.diagnostics,
      diagnostic(
        "SPICE_IMPORT_INVALID_PROJECT",
        "error",
        "import",
        error instanceof Error ? error.message : String(error),
      ),
    ];
    return { ...result, project: null, diagnostics, successful: false };
  }
}

export async function importSpiceSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  compileOptions: SpiceCompileOptions = {},
  importOptions: SpiceImportOptions = {},
): Promise<SpiceImportResult> {
  return importCompileResult(
    await compileSpiceSources(inputs, entryPath, compileOptions),
    importOptions,
  );
}

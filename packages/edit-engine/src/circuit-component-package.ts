import {
  ComponentDefinitionSchema,
  ExternalSubcircuitDefinitionSchema,
  ProjectModelSourceSchema,
  circuitComponentIssues,
  createEmptyProject,
  initializeCircuitComponent,
  type CircuitProject,
} from "@icm/model";
import { z } from "zod";
import { inspectProjectModelSource, modelInterfaceMatches } from "@icm/netlist";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import { createExternalSubcircuitInstance } from "./hierarchy-planner.js";
import { planExternalCopyDependencies } from "./project-copy-dependencies.js";

const PackageSchema = z.strictObject({
  definition: ComponentDefinitionSchema,
  circuit: z.strictObject({
    version: z.literal(1),
    externalDefinition: ExternalSubcircuitDefinitionSchema,
    source: ProjectModelSourceSchema,
  }),
});
export type CircuitComponentPackage = z.infer<typeof PackageSchema>;
export type CircuitComponentResources = CircuitComponentPackage["circuit"];

/** Author a public snapshot with ordinary Project transactions, outside a drawing. */
export function createCircuitComponentPackageProject(
  value: unknown,
  identity: string,
) {
  const packaged = parseCircuitComponentPackage(value);
  const project = createEmptyProject(identity, "Component snapshot");
  project.componentDefinitions = [packaged.definition];
  project.externalSubcircuitDefinitions = [packaged.circuit.externalDefinition];
  project.modelSources = [packaged.circuit.source];
  return project;
}

/** A package carries the same applied owner, interface and artwork as a Project. */
export function parseCircuitComponentPackage(
  value: unknown,
): CircuitComponentPackage {
  const packaged = PackageSchema.parse(value);
  const {
    definition,
    circuit: { externalDefinition, source },
  } = packaged;
  const implementation = externalDefinition.implementation;
  if (definition.generatedFrom || !definition.circuitBinding)
    throw Error(
      "Select a source-bound symbol without a schematic Cell dependency",
    );
  if (source.draft || source.revision < 1)
    throw Error("Apply the model draft before sharing");
  if (
    implementation?.kind !== "source" ||
    implementation.sourceId !== source.id ||
    externalDefinition.symbolId !== definition.symbol.id
  )
    throw Error(
      "Package source, interface and symbol must have the same owner",
    );
  const mappings = circuitComponentIssues(definition, externalDefinition);
  const mapping = mappings[0];
  if (mapping)
    throw Object.assign(
      Error(`${mapping.path.join(".")}: ${mapping.message}`),
      {
        issues: mappings.map((issue) => ({
          ...issue,
          path: ["definition", ...issue.path],
        })),
      },
    );
  const inspected = inspectProjectModelSource(source);
  const failure = inspected.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (failure)
    throw Object.assign(
      Error(`${failure.path ?? "model"}: ${failure.message}`),
      {
        issues: inspected.diagnostics
          .filter((issue) => issue.severity === "error")
          .map((issue) => ({
            path: ["circuit", "source"],
            message: issue.message,
            ...(issue.path ? { file: issue.path } : {}),
            ...(issue.sourceRef ? { sourceRef: issue.sourceRef } : {}),
          })),
      },
    );
  const entry = inspected.entries.find(
    (entry) => entry.name === implementation.entry,
  );
  if (!entry || !modelInterfaceMatches(externalDefinition, entry))
    throw Error(
      "Package interface does not match the applied native declaration",
    );
  const paths = new Set(inspected.graph.paths);
  if (source.files.some((file) => !paths.has(file.path)))
    throw Error("Package contains an unrelated owned source file");
  return packaged;
}

/** Publish applied facts only, excluding unrelated Project files and all drafts. */
export function buildCircuitComponentPackage(
  project: CircuitProject,
  definitionId: string,
  symbolId?: string,
): CircuitComponentPackage {
  const owner = project.externalSubcircuitDefinitions.find(
    (item) => item.id === definitionId,
  );
  const implementation = owner?.implementation;
  if (!owner || implementation?.kind !== "source")
    throw Error("Apply a real native implementation before sharing");
  const source = project.modelSources?.find(
    (item) => item.id === implementation.sourceId,
  );
  if (!source) throw Error("The native source owner is missing");
  if (source.draft) throw Error("Apply the model draft before sharing");
  const id = symbolId ?? owner.symbolId ?? externalSubcircuitSymbolId(owner.id);
  const captured = project.componentDefinitions?.find(
    (item) => item.symbol.id === id,
  );
  const automatic = createProjectSymbolResolver(
    project,
    builtInSymbols,
  ).resolve(id)?.definition;
  if (!captured && !automatic) throw Error("The selected artwork is missing");
  const definition = initializeCircuitComponent(
    captured?.circuitBinding ? captured : { symbol: automatic! },
    owner,
  );
  const paths = new Set(inspectProjectModelSource(source).graph.paths);
  return parseCircuitComponentPackage({
    definition,
    circuit: {
      version: 1,
      externalDefinition: { ...owner, symbolId: definition.symbol.id },
      source: {
        ...source,
        files: source.files.filter((file) => paths.has(file.path)),
      },
    },
  });
}

/** Capturing a selected snapshot reuses ordinary copy ownership and atomic edits. */
export function planCircuitComponentCapture(
  destination: CircuitProject,
  value: unknown,
  identity: string,
) {
  const packaged = parseCircuitComponentPackage(value);
  for (const dependency of packaged.circuit.source.dependencies) {
    const conflicting = destination.modelSources?.some((model) =>
      model.dependencies.some(
        (prior) =>
          (prior.id === dependency.id ||
            prior.mountPath === dependency.mountPath) &&
          (prior.id !== dependency.id ||
            prior.mountPath !== dependency.mountPath ||
            prior.sha256 !== dependency.sha256),
      ),
    );
    if (conflicting)
      throw Error(`Conflicting model dependency ${dependency.id}`);
  }
  const source = createCircuitComponentPackageProject(packaged, identity);
  const instance = createExternalSubcircuitInstance(
    "package",
    packaged.circuit.externalDefinition,
    {
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: "none",
    },
  );
  // A public snapshot owns applied bytes; private destination drafts stay private.
  const applied = {
    ...destination,
    modelSources: destination.modelSources?.map(
      ({ draft: _draft, ...model }) => model,
    ),
  };
  const dependencies = planExternalCopyDependencies(
    applied,
    source,
    [instance],
    [],
  );
  const symbolId = dependencies.symbolIds.get(packaged.definition.symbol.id)!;
  if (symbolId !== packaged.definition.symbol.id)
    throw Error(
      "Captured component revision has conflicting artwork or Pin mapping",
    );
  const definitionId = dependencies.externalIds.get(
    packaged.circuit.externalDefinition.id,
  )!;
  const capturedOwner = dependencies.edits.find(
    (edit) =>
      edit.kind === "upsert_external_subcircuit_definition" &&
      edit.definition.id === definitionId,
  );
  const owner =
    capturedOwner?.kind === "upsert_external_subcircuit_definition"
      ? capturedOwner.definition
      : destination.externalSubcircuitDefinitions.find(
          (item) => item.id === definitionId,
        )!;
  // Retain selected artwork before placement; existing occurrences keep their IDs.
  if (owner.symbolId !== symbolId)
    dependencies.edits.push({
      kind: "upsert_external_subcircuit_definition",
      definition: { ...owner, symbolId },
    });
  return {
    edits: dependencies.edits,
    definitionId,
    symbolId,
  };
}

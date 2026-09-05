import { z } from "zod";

import { CURRENT_PROJECT_SCHEMA_VERSION, StableIdSchema } from "./common.js";
import { SourceManifestSchema, SymbolLibraryLockSchema } from "./source.js";
import { SchematicDocumentSchema } from "./document.js";
import { CellSymbolPresentationSchema } from "./presentation.js";
import { SimulationSetupSchema } from "./simulation.js";
import { reportDuplicateIds } from "./validation.js";
import { projectCellInterface } from "../cell-interface-projection.js";

export const ExternalSubcircuitTerminalSchema = z.strictObject({
  /** Stable interface identity. Name and presentation may change independently. */
  id: StableIdSchema,
  name: z.string().min(1).max(128),
  direction: z.enum(["input", "output", "inout", "passive"]),
});
export const ExternalSubcircuitFormalParameterSchema = z.strictObject({
  name: z.string().min(1).max(128),
  defaultValue: z.string().min(1).max(1024).optional(),
});
export const ExternalSubcircuitDefinitionSchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().min(1).max(128),
  terminals: z.array(ExternalSubcircuitTerminalSchema).max(128),
  formalParameters: z.array(ExternalSubcircuitFormalParameterSchema).max(128),
  /** Imported positional interfaces are valid, but remain visibly provisional. */
  interfaceStatus: z.enum(["declared", "inferred-positional"]),
  presentation: CellSymbolPresentationSchema.optional(),
});

export const CircuitProjectSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_PROJECT_SCHEMA_VERSION),
    id: StableIdSchema,
    name: z.string().min(1),
    source: SourceManifestSchema,
    symbolLibrary: SymbolLibraryLockSchema,
    structureRevision: z.number().int().nonnegative(),
    topDocumentId: StableIdSchema,
    documents: z.array(SchematicDocumentSchema).min(1),
    externalSubcircuitDefinitions: z
      .array(ExternalSubcircuitDefinitionSchema)
      .max(256)
      .default([]),
    /**
     * The Project's only persisted simulation authority (ADR 0055). Absent
     * for every Project that has not authored a setup; a run's results never
     * land here.
     */
    simulation: SimulationSetupSchema.optional(),
  })
  .superRefine((project, context) => {
    const cellNames = new Set<string>();
    for (const [documentIndex, document] of project.documents.entries()) {
      const name = document.netlist?.name.toLowerCase();
      if (!name) continue;
      if (cellNames.has(name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate netlist Cell name: ${document.netlist!.name}`,
          path: ["documents", documentIndex, "netlist", "name"],
        });
      }
      cellNames.add(name);
    }
    reportDuplicateIds(project.documents, "documents", context);
    const externalSubcircuitDefinitions = project.externalSubcircuitDefinitions;
    reportDuplicateIds(
      externalSubcircuitDefinitions,
      "externalSubcircuitDefinitions",
      context,
    );
    const externalDefinitionsById = new Map<
      string,
      z.infer<typeof ExternalSubcircuitDefinitionSchema>
    >();
    const externalDefinitionNames = new Set<string>();
    for (const [
      definitionIndex,
      definition,
    ] of externalSubcircuitDefinitions.entries()) {
      externalDefinitionsById.set(definition.id, definition);
      reportDuplicateIds(
        definition.terminals,
        `externalSubcircuitDefinitions.${definitionIndex}.terminals`,
        context,
      );
      const normalizedName = definition.name.toLowerCase();
      if (externalDefinitionNames.has(normalizedName)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate external subcircuit name: ${definition.name}`,
          path: ["externalSubcircuitDefinitions", definitionIndex, "name"],
        });
      }
      externalDefinitionNames.add(normalizedName);
      for (const [field, values] of [
        ["terminals", definition.terminals.map((terminal) => terminal.name)],
        [
          "formalParameters",
          definition.formalParameters.map((parameter) => parameter.name),
        ],
      ] as const) {
        const seen = new Set<string>();
        for (const [index, value] of values.entries()) {
          const normalized = value.toLowerCase();
          if (seen.has(normalized)) {
            context.addIssue({
              code: "custom",
              message: `Duplicate external subcircuit ${field} name: ${value}`,
              path: [
                "externalSubcircuitDefinitions",
                definitionIndex,
                field,
                index,
                "name",
              ],
            });
          }
          seen.add(normalized);
        }
      }
    }
    if (
      !project.documents.some(
        (document) => document.id === project.topDocumentId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: `Unknown top document: ${project.topDocumentId}`,
        path: ["topDocumentId"],
      });
    }
    const simulationRootId =
      project.simulation?.input.kind === "structured"
        ? project.simulation.input.rootDocumentId
        : undefined;
    if (
      simulationRootId !== undefined &&
      !project.documents.some((document) => document.id === simulationRootId)
    ) {
      context.addIssue({
        code: "custom",
        message: `Unknown simulation root document: ${simulationRootId}`,
        path: ["simulation", "input", "rootDocumentId"],
      });
    }
    const documentById = new Map(
      project.documents.map((document) => [document.id, document]),
    );
    const childrenByDocument = new Map<string, string[]>();
    for (const [documentIndex, document] of project.documents.entries()) {
      const children: string[] = [];
      for (const [instanceIndex, instance] of document.instances.entries()) {
        const binding = instance.netlist?.binding;
        if (binding?.kind !== "subcircuit") continue;
        const child = documentById.get(binding.childDocumentId);
        if (!child) {
          context.addIssue({
            code: "custom",
            message: `Hierarchy binding references unknown Document: ${binding.childDocumentId}`,
            path: [
              "documents",
              documentIndex,
              "instances",
              instanceIndex,
              "netlist",
              "binding",
              "childDocumentId",
            ],
          });
          continue;
        }
        if (!child.netlist) {
          context.addIssue({
            code: "custom",
            message: `Hierarchy binding requires child Document ${child.id} to define a Cell interface`,
            path: [
              "documents",
              documentIndex,
              "instances",
              instanceIndex,
              "netlist",
              "binding",
            ],
          });
          continue;
        }
        const childPinNames = new Set(
          projectCellInterface(child.netlist).ports.map((port) => port.name),
        );
        const referencedPins: Array<{
          pinName: string;
          path: Array<string | number>;
        }> = [];
        for (const [netIndex, net] of document.nets.entries()) {
          for (const [terminalIndex, terminal] of net.terminals.entries()) {
            if (terminal.instanceId !== instance.id) continue;
            referencedPins.push({
              pinName: terminal.pinName,
              path: [
                "documents",
                documentIndex,
                "nets",
                netIndex,
                "terminals",
                terminalIndex,
                "pinName",
              ],
            });
          }
        }
        for (const [routeIndex, route] of document.routes.entries()) {
          const finalTarget = route.legs.at(-1)?.to;
          const routeEndpoints = [
            ["start", route.start],
            [
              "end",
              finalTarget?.kind === "endpoint"
                ? finalTarget.endpoint
                : undefined,
            ],
          ] as const;
          for (const [endpointName, endpoint] of routeEndpoints) {
            if (
              !endpoint ||
              endpoint.kind !== "terminal" ||
              endpoint.instanceId !== instance.id
            )
              continue;
            referencedPins.push({
              pinName: endpoint.pinName,
              path: [
                "documents",
                documentIndex,
                "routes",
                routeIndex,
                ...(endpointName === "start"
                  ? ["start"]
                  : ["legs", route.legs.length - 1, "to", "endpoint"]),
                "pinName",
              ],
            });
          }
        }
        for (const [
          noConnectIndex,
          noConnect,
        ] of document.noConnects.entries()) {
          if (noConnect.endpoint.instanceId !== instance.id) continue;
          referencedPins.push({
            pinName: noConnect.endpoint.pinName,
            path: [
              "documents",
              documentIndex,
              "noConnects",
              noConnectIndex,
              "endpoint",
              "pinName",
            ],
          });
        }
        for (const reference of referencedPins) {
          if (childPinNames.has(reference.pinName)) continue;
          context.addIssue({
            code: "custom",
            message: `Hierarchy Instance ${instance.id} references unknown child terminal ${reference.pinName}`,
            path: reference.path,
          });
        }
        children.push(child.id);
      }
      for (const [instanceIndex, instance] of document.instances.entries()) {
        const binding = instance.netlist?.binding;
        if (binding?.kind !== "external-subcircuit") continue;
        const definition = externalDefinitionsById.get(binding.definitionId);
        if (!definition) {
          context.addIssue({
            code: "custom",
            message: `External subcircuit binding references unknown definition: ${binding.definitionId}`,
            path: [
              "documents",
              documentIndex,
              "instances",
              instanceIndex,
              "netlist",
              "binding",
              "definitionId",
            ],
          });
          continue;
        }
        // External target terminals and native Symbol pins are deliberately
        // different namespaces (for example SKY130 R0/R1/B maps to the
        // frozen resistor pins 1/2 plus a property-only B terminal). The
        // model layer validates definition identity; the reviewed device
        // registry validates the exact mapping during authoring and export.
      }
      childrenByDocument.set(document.id, children);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (documentId: string, path: string[]): void => {
      if (visiting.has(documentId)) {
        context.addIssue({
          code: "custom",
          message: `Hierarchy cycle: ${[...path, documentId].join(" -> ")}`,
          path: ["documents"],
        });
        return;
      }
      if (visited.has(documentId)) return;
      visiting.add(documentId);
      for (const childId of childrenByDocument.get(documentId) ?? []) {
        visit(childId, [...path, documentId]);
      }
      visiting.delete(documentId);
      visited.add(documentId);
    };
    for (const document of project.documents) visit(document.id, []);
  });

export const CircuitProjectJsonSchema = z.toJSONSchema(CircuitProjectSchema, {
  target: "draft-2020-12",
});
export const SchematicDocumentJsonSchema = z.toJSONSchema(
  SchematicDocumentSchema,
  {
    target: "draft-2020-12",
  },
);

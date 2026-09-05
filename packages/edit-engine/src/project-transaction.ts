import {
  CircuitProjectSchema,
  ExternalSubcircuitDefinitionSchema,
  SchematicDocumentSchema,
  SimulationSetupSchema,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { routeEnd } from "@icm/model";
import { resolveReviewedExternalBinding } from "@icm/devices";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
  resolvePdkSymbolMappingForTerminalOrder,
} from "@icm/symbols";
import { z } from "zod";

import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  SchematicEditSchema,
  type EditActor,
} from "./edit-schema.js";
import { executeTransaction } from "./transaction.js";
import { planInstanceSymbolGeometryRouteFollow } from "./transaction-route-follow.js";
import type {
  EditDiagnostic,
  EditTransactionResult,
} from "./transaction-result.js";

export const ProjectStructureEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("add_document"),
    document: SchematicDocumentSchema,
  }),
  z.strictObject({
    kind: z.literal("remove_document"),
    documentId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("rename_project"),
    name: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("rename_document"),
    documentId: z.string().min(1),
    name: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("upsert_external_subcircuit_definition"),
    definition: ExternalSubcircuitDefinitionSchema,
  }),
  z.strictObject({
    kind: z.literal("remove_external_subcircuit_definition"),
    definitionId: z.string().min(1),
  }),
  /**
   * Replace or clear the Project's one persisted `SimulationSetup` (ADR 0055).
   * A non-null setup replaces the current one whole; a structured setup must
   * name a Document of the Project as its root, while a raw setup owns its
   * authored files and has no Canvas root. `null` clears it. Source values stay
   * on the source Instances and are edited through ordinary Document edits.
   */
  z.strictObject({
    kind: z.literal("set_simulation_setup"),
    setup: SimulationSetupSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("transact_document"),
    documentId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    edits: z
      .array(SchematicEditSchema)
      .min(1)
      .max(MAX_SCHEMATIC_EDITS_PER_TRANSACTION),
  }),
]);

export const ProjectTransactionSchema = z.strictObject({
  transactionId: z.string().min(1),
  projectId: z.string().min(1),
  expectedStructureRevision: z.number().int().nonnegative(),
  actor: z.strictObject({
    kind: z.enum(["human", "agent"]),
    id: z.string().min(1),
  }),
  dryRun: z.boolean().optional(),
  edits: z.array(ProjectStructureEditSchema).min(1).max(256),
});

export type ProjectStructureEdit = z.infer<typeof ProjectStructureEditSchema>;
export type ProjectTransaction = z.infer<typeof ProjectTransactionSchema>;

export type ProjectTransactionErrorCode =
  | "INVALID_TRANSACTION"
  | "PROJECT_MISMATCH"
  | "STALE_STRUCTURE_REVISION"
  | "OBJECT_NOT_FOUND"
  | "EDIT_PRECONDITION"
  | "DOCUMENT_TRANSACTION_REJECTED"
  | "INVALID_RESULT";

export interface AppliedProjectTransaction {
  ok: true;
  applied: boolean;
  structureRevision: number;
  proposedStructureRevision: number;
  project: CircuitProject;
  proposedProject: CircuitProject;
  changedDocumentIds: readonly string[];
  documentResults: readonly EditTransactionResult[];
  diagnostics: readonly EditDiagnostic[];
}

export interface RejectedProjectTransaction {
  ok: false;
  applied: false;
  structureRevision: number;
  project: CircuitProject;
  error: { code: ProjectTransactionErrorCode; message: string };
  diagnostics: readonly EditDiagnostic[];
}

export type ProjectTransactionResult =
  AppliedProjectTransaction | RejectedProjectTransaction;

function rejectProjectTransaction(
  project: CircuitProject,
  code: ProjectTransactionErrorCode,
  message: string,
  diagnostics: readonly EditDiagnostic[] = [
    { code, severity: "error", message },
  ],
): RejectedProjectTransaction {
  return {
    ok: false,
    applied: false,
    structureRevision: project.structureRevision,
    project,
    error: { code, message },
    diagnostics,
  };
}

export function rejectProjectStructureTransaction(
  project: CircuitProject,
  code: ProjectTransactionErrorCode,
  message: string,
): RejectedProjectTransaction {
  return rejectProjectTransaction(project, code, message);
}

function replaceDocument(
  project: CircuitProject,
  document: SchematicDocument,
): void {
  const index = project.documents.findIndex(
    (candidate) => candidate.id === document.id,
  );
  if (index < 0) throw new Error(`Document not found: ${document.id}`);
  project.documents[index] = document;
}

function externalCallerValidationFailure(
  project: CircuitProject,
): { message: string; objectIds: string[] } | null {
  const definitions = new Map(
    project.externalSubcircuitDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  for (const document of project.documents) {
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind !== "external-subcircuit") continue;
      const definition = definitions.get(binding.definitionId);
      if (!definition) continue;
      const reviewed = definition.presentation
        ? undefined
        : resolveReviewedExternalBinding(
            definition.name,
            definition.terminals.map((terminal) => terminal.name),
          );
      const allowed = new Set(
        (reviewed
          ? reviewed.terminals.map((terminal) => terminal.pinName)
          : definition.terminals.map((terminal) => terminal.name)
        ).map((name) => name.toLowerCase()),
      );
      const references = [
        ...document.nets.flatMap((net) =>
          net.terminals
            .filter((terminal) => terminal.instanceId === instance.id)
            .map((terminal) => ({
              pinName: terminal.pinName,
              objectIds: [instance.id, net.id],
              canvas: false,
            })),
        ),
        ...document.routes.flatMap((route) =>
          [route.start, routeEnd(route)].flatMap((endpoint) =>
            endpoint.kind === "terminal" && endpoint.instanceId === instance.id
              ? [
                  {
                    pinName: endpoint.pinName,
                    objectIds: [instance.id, route.id],
                    canvas: true,
                  },
                ]
              : [],
          ),
        ),
        ...document.noConnects.flatMap((noConnect) =>
          noConnect.endpoint.instanceId === instance.id
            ? [
                {
                  pinName: noConnect.endpoint.pinName,
                  objectIds: [instance.id, noConnect.id],
                  canvas: true,
                },
              ]
            : [],
        ),
      ];
      for (const reference of references) {
        if (!allowed.has(reference.pinName.toLowerCase())) {
          return {
            message: `External subcircuit Instance ${instance.id} references unknown terminal ${reference.pinName}`,
            objectIds: reference.objectIds,
          };
        }
        const terminal = reviewed?.terminals.find(
          (candidate) =>
            candidate.pinName.toLowerCase() === reference.pinName.toLowerCase(),
        );
        if (reference.canvas && terminal?.interaction === "property") {
          return {
            message: `Property-only terminal ${instance.id}.${reference.pinName} cannot own canvas geometry`,
            objectIds: reference.objectIds,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Applies structural and existing per-Document edits to one cloned Project.
 * Intermediate values may temporarily be incomplete (for example, a child is
 * added before its parent Instance); only the final Project is committed and
 * validated. No caller receives a partially applied value.
 */
export function executeProjectTransaction(
  sourceProject: CircuitProject,
  input: ProjectTransaction | unknown,
): ProjectTransactionResult {
  const project = CircuitProjectSchema.parse(sourceProject);
  const parsed = ProjectTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return rejectProjectTransaction(
      project,
      "INVALID_TRANSACTION",
      "Project transaction schema validation failed",
      parsed.error.issues.map((issue) => ({
        code: "INVALID_TRANSACTION",
        severity: "error" as const,
        message: issue.message,
        path: issue.path.map((segment) =>
          typeof segment === "symbol"
            ? (segment.description ?? "symbol")
            : segment,
        ),
      })),
    );
  }
  const transaction = parsed.data;
  if (transaction.projectId !== project.id) {
    return rejectProjectTransaction(
      project,
      "PROJECT_MISMATCH",
      `Transaction targets Project ${transaction.projectId}, not ${project.id}`,
    );
  }
  if (transaction.expectedStructureRevision !== project.structureRevision) {
    return rejectProjectTransaction(
      project,
      "STALE_STRUCTURE_REVISION",
      `Expected Project structure revision ${transaction.expectedStructureRevision}, found ${project.structureRevision}`,
    );
  }

  const candidate = structuredClone(project);
  const changedDocumentIds = new Set<string>();
  const documentResults: EditTransactionResult[] = [];
  const explicitlyTouchedDocumentIds = new Set<string>();
  const cellSymbolChangedDocumentIds = new Set<string>();
  let structuralChange = false;

  for (const [editIndex, edit] of transaction.edits.entries()) {
    if (edit.kind === "add_document") {
      if (
        candidate.documents.some((document) => document.id === edit.document.id)
      ) {
        return rejectProjectTransaction(
          project,
          "EDIT_PRECONDITION",
          `Document already exists: ${edit.document.id}`,
        );
      }
      candidate.documents.push(structuredClone(edit.document));
      changedDocumentIds.add(edit.document.id);
      structuralChange = true;
      continue;
    }

    if (edit.kind === "remove_document") {
      const index = candidate.documents.findIndex(
        (document) => document.id === edit.documentId,
      );
      if (index < 0) {
        return rejectProjectTransaction(
          project,
          "OBJECT_NOT_FOUND",
          `Document does not exist: ${edit.documentId}`,
        );
      }
      if (edit.documentId === candidate.topDocumentId) {
        return rejectProjectTransaction(
          project,
          "EDIT_PRECONDITION",
          "The top Cell cannot be deleted",
        );
      }
      if (
        candidate.simulation?.input.kind === "structured" &&
        edit.documentId === candidate.simulation.input.rootDocumentId
      ) {
        // Deleting the Testbench would leave the setup pointing nowhere, and
        // dropping the setup silently would lose authored intent; the author
        // clears or re-roots it first, in the same transaction if they like.
        return rejectProjectTransaction(
          project,
          "EDIT_PRECONDITION",
          `Cell ${edit.documentId} is the simulation root; clear or re-root the simulation setup first`,
        );
      }
      const caller = candidate.documents.flatMap((document) =>
        document.instances.flatMap((instance) => {
          const binding = instance.netlist?.binding;
          return binding?.kind === "subcircuit" &&
            binding.childDocumentId === edit.documentId
            ? [{ documentId: document.id, instanceId: instance.id }]
            : [];
        }),
      )[0];
      if (caller) {
        return rejectProjectTransaction(
          project,
          "EDIT_PRECONDITION",
          `Cell ${edit.documentId} is still referenced by ${caller.documentId}.${caller.instanceId}`,
        );
      }
      candidate.documents.splice(index, 1);
      changedDocumentIds.add(edit.documentId);
      structuralChange = true;
      continue;
    }

    if (edit.kind === "rename_project") {
      // The Project's name is what a published circuit and a saved file are
      // called, so it is renamed through the same transaction path as
      // everything else rather than by rewriting the Project object.
      if (candidate.name === edit.name) continue;
      candidate.name = edit.name;
      structuralChange = true;
      continue;
    }
    if (edit.kind === "rename_document") {
      const document = candidate.documents.find(
        (item) => item.id === edit.documentId,
      );
      if (!document) {
        return rejectProjectTransaction(
          project,
          "OBJECT_NOT_FOUND",
          `Document does not exist: ${edit.documentId}`,
        );
      }
      if (
        candidate.documents.some(
          (item) =>
            item.id !== document.id &&
            item.name.toLowerCase() === edit.name.toLowerCase(),
        )
      ) {
        return rejectProjectTransaction(
          project,
          "EDIT_PRECONDITION",
          `Cell name already exists: ${edit.name}`,
        );
      }
      if (document.name === edit.name) continue;
      document.name = edit.name;
      if (document.netlist) document.netlist.name = edit.name;
      document.revision += 1;
      changedDocumentIds.add(document.id);
      for (const parent of candidate.documents) {
        let changed = false;
        for (const instance of parent.instances) {
          const binding = instance.netlist?.binding;
          if (
            binding?.kind !== "subcircuit" ||
            binding.childDocumentId !== document.id
          )
            continue;
          instance.symbolId = hierarchicalSymbolId(edit.name);
          changed = true;
        }
        if (changed) {
          parent.revision += 1;
          changedDocumentIds.add(parent.id);
        }
      }
      structuralChange = true;
      continue;
    }

    if (edit.kind === "upsert_external_subcircuit_definition") {
      const index = candidate.externalSubcircuitDefinitions.findIndex(
        (definition) => definition.id === edit.definition.id,
      );
      if (index < 0) {
        candidate.externalSubcircuitDefinitions.push(
          structuredClone(edit.definition),
        );
      } else {
        candidate.externalSubcircuitDefinitions[index] = structuredClone(
          edit.definition,
        );
      }
      const reviewedMapping = edit.definition.presentation
        ? undefined
        : resolvePdkSymbolMappingForTerminalOrder(
            edit.definition.name,
            edit.definition.terminals.map((terminal) => terminal.name),
          );
      const externalSymbolId = externalSubcircuitSymbolId(edit.definition.id);
      for (const document of candidate.documents) {
        let changed = false;
        for (const instance of document.instances) {
          const binding = instance.netlist?.binding;
          if (
            binding?.kind !== "external-subcircuit" ||
            binding.definitionId !== edit.definition.id
          ) {
            continue;
          }
          const symbolId =
            reviewedMapping?.symbolId === instance.symbolId
              ? instance.symbolId
              : externalSymbolId;
          if (instance.symbolId === symbolId) continue;
          instance.symbolId = symbolId;
          changed = true;
        }
        if (changed) {
          document.revision += 1;
          changedDocumentIds.add(document.id);
        }
      }
      structuralChange = true;
      continue;
    }

    if (edit.kind === "remove_external_subcircuit_definition") {
      const index = candidate.externalSubcircuitDefinitions.findIndex(
        (definition) => definition.id === edit.definitionId,
      );
      if (index < 0) {
        return rejectProjectTransaction(
          project,
          "OBJECT_NOT_FOUND",
          `External subcircuit definition does not exist: ${edit.definitionId}`,
        );
      }
      const caller = candidate.documents.flatMap((document) =>
        document.instances.flatMap((instance) =>
          instance.netlist?.binding?.kind === "external-subcircuit" &&
          instance.netlist.binding.definitionId === edit.definitionId
            ? [{ documentId: document.id, instanceId: instance.id }]
            : [],
        ),
      )[0];
      if (caller) {
        return rejectProjectTransaction(
          project,
          "EDIT_PRECONDITION",
          `External subcircuit ${edit.definitionId} is still referenced by ${caller.documentId}.${caller.instanceId}`,
        );
      }
      candidate.externalSubcircuitDefinitions.splice(index, 1);
      structuralChange = true;
      continue;
    }

    if (edit.kind === "set_simulation_setup") {
      if (edit.setup === null) {
        if (candidate.simulation === undefined) continue;
        delete candidate.simulation;
        structuralChange = true;
        continue;
      }
      if (edit.setup.input.kind === "structured") {
        const rootDocumentId = edit.setup.input.rootDocumentId;
        if (
          !candidate.documents.some(
            (document) => document.id === rootDocumentId,
          )
        ) {
          return rejectProjectTransaction(
            project,
            "OBJECT_NOT_FOUND",
            `Simulation root Document does not exist: ${rootDocumentId}`,
          );
        }
      }
      // Both sides are schema outputs with the schema's key order, so equal
      // JSON is equal intent; an unchanged setup does not advance the
      // structure revision, matching `rename_project`.
      if (
        candidate.simulation !== undefined &&
        JSON.stringify(candidate.simulation) === JSON.stringify(edit.setup)
      ) {
        continue;
      }
      candidate.simulation = structuredClone(edit.setup);
      structuralChange = true;
      continue;
    }

    if (
      edit.edits.some(
        (documentEdit) =>
          documentEdit.kind === "undo" || documentEdit.kind === "redo",
      )
    ) {
      return rejectProjectTransaction(
        project,
        "EDIT_PRECONDITION",
        "Project transactions cannot contain Document history edits",
      );
    }
    explicitlyTouchedDocumentIds.add(edit.documentId);
    if (
      edit.edits.some(
        (documentEdit) => documentEdit.kind === "set_cell_symbol_presentation",
      )
    ) {
      cellSymbolChangedDocumentIds.add(edit.documentId);
    }
    const document = candidate.documents.find(
      (item) => item.id === edit.documentId,
    );
    if (!document) {
      return rejectProjectTransaction(
        project,
        "OBJECT_NOT_FOUND",
        `Document does not exist: ${edit.documentId}`,
      );
    }
    const resolver = createProjectSymbolResolver(candidate, builtInSymbols);
    const result = executeTransaction(
      document,
      {
        transactionId: `${transaction.transactionId}-document-${editIndex}`,
        documentId: edit.documentId,
        expectedRevision: edit.expectedRevision,
        actor: transaction.actor as EditActor,
        edits: edit.edits,
      },
      { symbolResolver: resolver },
    );
    documentResults.push(result);
    if (!result.ok) {
      return rejectProjectTransaction(
        project,
        "DOCUMENT_TRANSACTION_REJECTED",
        result.error.message,
        result.diagnostics,
      );
    }
    if (result.applied) {
      replaceDocument(candidate, result.document);
      changedDocumentIds.add(edit.documentId);
    }
  }

  if (cellSymbolChangedDocumentIds.size > 0) {
    const originalResolver = createProjectSymbolResolver(
      project,
      builtInSymbols,
    );
    const resolver = createProjectSymbolResolver(candidate, builtInSymbols);
    for (const parent of candidate.documents) {
      // A caller edited explicitly by the request is its own geometry
      // authority. Definition-only updates use the shared follow planner.
      if (explicitlyTouchedDocumentIds.has(parent.id)) continue;
      const originalParent = project.documents.find(
        (document) => document.id === parent.id,
      );
      if (!originalParent) continue;
      const callerIds = new Set(
        parent.instances.flatMap((instance) => {
          const binding = instance.netlist?.binding;
          return binding?.kind === "subcircuit" &&
            cellSymbolChangedDocumentIds.has(binding.childDocumentId)
            ? [instance.id]
            : [];
        }),
      );
      if (callerIds.size === 0) continue;
      const routeEdits = planInstanceSymbolGeometryRouteFollow(
        parent,
        originalParent,
        originalResolver,
        resolver,
        callerIds,
      );
      if (routeEdits.length === 0) continue;
      const routeResult = executeTransaction(
        parent,
        {
          transactionId: `${transaction.transactionId}-symbol-route-follow-${parent.id}`,
          documentId: parent.id,
          expectedRevision: parent.revision,
          actor: transaction.actor as EditActor,
          edits: routeEdits,
        },
        { symbolResolver: resolver },
      );
      documentResults.push(routeResult);
      if (!routeResult.ok) {
        return rejectProjectTransaction(
          project,
          "DOCUMENT_TRANSACTION_REJECTED",
          routeResult.error.message,
          routeResult.diagnostics,
        );
      }
      if (routeResult.applied) {
        replaceDocument(candidate, routeResult.document);
        changedDocumentIds.add(parent.id);
      }
    }
  }

  const applied =
    structuralChange ||
    documentResults.some((result) => result.ok && result.applied);
  const proposedStructureRevision =
    project.structureRevision + (applied ? 1 : 0);
  candidate.structureRevision = proposedStructureRevision;
  const externalCallerFailure = externalCallerValidationFailure(candidate);
  if (externalCallerFailure) {
    return rejectProjectTransaction(
      project,
      "INVALID_RESULT",
      externalCallerFailure.message,
      [
        {
          code: "INVALID_RESULT",
          severity: "error",
          message: externalCallerFailure.message,
          objectIds: externalCallerFailure.objectIds,
        },
      ],
    );
  }
  const validated = CircuitProjectSchema.safeParse(candidate);
  if (!validated.success) {
    return rejectProjectTransaction(
      project,
      "INVALID_RESULT",
      "Project transaction produced an invalid Project",
      validated.error.issues.map((issue) => ({
        code: "INVALID_RESULT",
        severity: "error" as const,
        message: issue.message,
        path: issue.path.map((segment) =>
          typeof segment === "symbol"
            ? (segment.description ?? "symbol")
            : segment,
        ),
      })),
    );
  }
  const proposedProject = validated.data;
  return {
    ok: true,
    applied: transaction.dryRun === true ? false : applied,
    structureRevision:
      transaction.dryRun === true
        ? project.structureRevision
        : proposedStructureRevision,
    proposedStructureRevision,
    project: transaction.dryRun === true ? project : proposedProject,
    proposedProject,
    changedDocumentIds: [...changedDocumentIds].sort(),
    documentResults,
    diagnostics: [],
  };
}

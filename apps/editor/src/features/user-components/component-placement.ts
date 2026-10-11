import {
  executeProjectTransaction,
  planCircuitComponentCapture,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { CircuitProject, Instance } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { resolveDocumentStyleProfile } from "@icm/derived";
import { createNewInstance } from "../netlist-export/netlist-authoring";
import { defaultInstanceDisplayAnnotations } from "../instance-display/default-instance-display";
import { planInsertedInstanceConnections } from "../component-insert/placement-connectivity";
import {
  sharedComponentNetlist,
  type SharedDefinitionPayload,
} from "./component-library-contract";

/** GUI preview and Agent insertion prepare the same capture without mutating a Project. */
export function prepareComponentCapture(
  project: CircuitProject,
  payload: SharedDefinitionPayload,
  identity: string,
) {
  const captured = payload.circuit
    ? planCircuitComponentCapture(project, payload, identity)
    : {
        symbolId: payload.definition.symbol.id,
        definitionId: undefined,
        edits: [
          {
            kind: "capture_component_definition" as const,
            definition: payload.definition,
          },
        ],
      };
  const preview = captured.edits.length
    ? executeProjectTransaction(project, {
        transactionId: identity + "-preview",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "component-preview" },
        edits: captured.edits,
      })
    : { ok: true as const, project };
  if (!preview.ok) throw Error(preview.error.message);
  const resolver = createProjectSymbolResolver(preview.project, builtInSymbols);
  const symbol = resolver.resolve(captured.symbolId)?.definition;
  if (!symbol) throw Error("The selected component has no resolved symbol.");
  return { ...captured, project: preview.project, resolver, symbol };
}

/** Dependencies, instance and annotations enter history as one ordinary transaction. */
export function planComponentPlacement(
  project: CircuitProject,
  documentId: string,
  payload: SharedDefinitionPayload,
  identity: string,
  placement: Instance["placement"],
  options: {
    reference?: string;
    showReference?: boolean;
    showValue?: boolean;
  } = {},
) {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw Error("The target Cell no longer exists.");
  const prepared = prepareComponentCapture(project, payload, identity);
  const instance = createNewInstance(
    document,
    {
      symbolId: prepared.symbolId,
      symbolVariantId: payload.definition.symbol.defaultVariantId,
      placement,
      netlist: prepared.definitionId
        ? {
            parameters: {},
            binding: {
              kind: "external-subcircuit",
              definitionId: prepared.definitionId,
            },
          }
        : sharedComponentNetlist(payload.definition),
    },
    {
      project: prepared.project,
      ...(options.reference ? { reference: options.reference } : {}),
    },
  );
  const annotations = defaultInstanceDisplayAnnotations(
    document,
    instance,
    prepared.resolver,
    resolveDocumentStyleProfile(document.presentation),
    {
      showDesignator: options.showReference ?? true,
      ...(options.showValue !== undefined
        ? { showValue: options.showValue }
        : {}),
      ...(payload.circuit
        ? { masterName: payload.definition.symbol.name }
        : {}),
    },
  );
  const connection = payload.circuit
    ? undefined
    : planInsertedInstanceConnections(document, prepared.resolver, instance);
  const documentEdits: SchematicEdit[] = [
    { kind: "add_instance", instance },
    ...(connection?.edits ?? []),
    ...annotations.map((annotation) => ({
      kind: "upsert_schematic_annotation" as const,
      annotation,
    })),
  ];
  const edits: ProjectStructureEdit[] = [
    ...prepared.edits,
    {
      kind: "transact_document",
      documentId,
      expectedRevision: document.revision,
      edits: documentEdits,
    },
  ];
  return {
    edits,
    instance,
    symbolId: prepared.symbolId,
    definitionId: prepared.definitionId,
    documentEdits,
    connection,
    resolver: prepared.resolver,
  };
}

export interface PendingCircuitCapture {
  payload: SharedDefinitionPayload;
  identity: string;
  projectId: string;
  documentId: string;
  structureRevision: number;
  documentRevision: number;
  library?: {
    id: string;
    revision: number;
    status: "shared" | "official" | "deleted";
  };
}

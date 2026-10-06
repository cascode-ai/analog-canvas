import { type CircuitProject, type SchematicDocument } from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./edit-schema.js";
import {
  type ProjectStructureEdit,
  executeProjectTransaction,
} from "./project-transaction.js";
import { applyInstanceNetlistEdit } from "./transaction-instance-netlist.js";
import { applyPropertyTerminalEdit } from "./transaction-property-terminal.js";
import { applyNetPowerEdit } from "./transaction-net-power.js";
import { applyPresentationLayoutEdit } from "./transaction-presentation-layout.js";
import { inheritCellPortFormatting } from "./transaction-cell-interface.js";
import {
  affectedConductorNetIds,
  normalizeSameNetConductorTopology,
} from "./conductor-topology.js";
import {
  pruneUnreachableLocalNet,
  reconcileMosBulkAfterConnectivity,
  revokeInvalidatedSupplyBulkDefaults,
} from "./transaction-connectivity.js";
import { gridAlignmentDiagnostics } from "./transaction-preflight.js";
import type { RejectEdit } from "./transaction-domain.js";

function localNetlistEdit(edit: SchematicEdit): boolean {
  return (
    edit.kind === "set_instance_netlist" ||
    (edit.kind === "bulk_patch_instance_netlist" &&
      edit.assignments.every((item) => item.reference === undefined)) ||
    edit.kind === "set_property_terminal_net" ||
    edit.kind === "create_base_net" ||
    edit.kind === "upsert_connectivity_evidence" ||
    edit.kind === "upsert_schematic_annotation"
  );
}

/**
 * Private working copy for ordered netlist preparation, NOT a validated Project
 * or commit authority. Reuses the engine's local mutations and electrical
 * housekeeping; complete validation still belongs to executeProjectTransaction.
 * Geometry/definition rewrites use that existing full path, never approximation.
 */
export function createNetlistPlanningProjection(source: CircuitProject) {
  let project = structuredClone(source);
  let resolver = createProjectSymbolResolver(project, builtInSymbols);
  const logical = new Map<
    string,
    ReturnType<typeof resolveDocumentLogicalNets>
  >();
  const reject: RejectEdit = (_code, message) => {
    throw new Error(message);
  };

  function stage(edits: ProjectStructureEdit[]) {
    if (!edits.length) return;
    const supported = edits.every((edit) =>
      edit.kind === "transact_document"
        ? edit.edits.every(localNetlistEdit)
        : edit.kind === "upsert_external_subcircuit_definition" &&
          !project.externalSubcircuitDefinitions.some(
            (item) => item.id === edit.definition.id,
          ) &&
          !project.documents.some((document) =>
            document.instances.some(
              (instance) =>
                instance.netlist?.binding?.kind === "external-subcircuit" &&
                instance.netlist.binding.definitionId === edit.definition.id,
            ),
          ),
    );
    if (!supported) {
      const result = executeProjectTransaction(project, {
        transactionId: "plan-netlist-process",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "netlist-process" },
        edits,
      });
      if (!result.ok) throw new Error(result.error.message);
      project = result.project;
      resolver = createProjectSymbolResolver(project, builtInSymbols);
      logical.clear();
      return;
    }
    for (const edit of edits) {
      if (edit.kind === "upsert_external_subcircuit_definition") {
        project.externalSubcircuitDefinitions.push(
          structuredClone(edit.definition),
        );
        resolver = createProjectSymbolResolver(project, builtInSymbols);
        continue;
      }
      if (edit.kind !== "transact_document")
        throw new Error("Unsupported planning edit");
      const draft = project.documents.find(
        (item) => item.id === edit.documentId,
      );
      if (!draft || draft.revision !== edit.expectedRevision)
        throw new Error("Netlist planning Document changed");
      // Metadata changes cannot alter supply claims or conductor geometry. Net
      // edits retain their real before-state for shared normalization rules.
      const netEdits = edit.edits.some(
        (item) =>
          item.kind !== "set_instance_netlist" &&
          item.kind !== "bulk_patch_instance_netlist",
      );
      const before: SchematicDocument = netEdits
        ? structuredClone(draft)
        : draft;
      const changedObjectIds = new Set<string>();
      const deferred = new Set<string>();
      const protectedEvidenceIds = new Set(
        edit.edits.flatMap((item) =>
          item.kind === "upsert_connectivity_evidence"
            ? [item.evidence.id]
            : [],
        ),
      );
      const deferNetPrune = (netId: string) =>
        pruneUnreachableLocalNet(draft, netId, changedObjectIds, {
          deferInto: deferred,
        });
      const context = {
        draft,
        resolver,
        changedObjectIds,
        deferNetPrune,
        reject,
      };
      let connectivityChanged = false;
      for (const item of edit.edits) {
        if (gridAlignmentDiagnostics(item, draft.presentation.grid).length)
          throw new Error(
            `Edit coordinates must align to Document grid ${draft.presentation.grid}`,
          );
        const outcome =
          item.kind === "set_instance_netlist" ||
          item.kind === "bulk_patch_instance_netlist"
            ? applyInstanceNetlistEdit(item, context)
            : item.kind === "set_property_terminal_net"
              ? applyPropertyTerminalEdit(item, context)
              : item.kind === "create_base_net" ||
                  item.kind === "upsert_connectivity_evidence"
                ? applyNetPowerEdit(item, context)
                : item.kind === "upsert_schematic_annotation"
                  ? applyPresentationLayoutEdit(item, context)
                  : undefined;
        if (!outcome?.ok)
          throw new Error("Unsupported netlist planning mutation");
        connectivityChanged ||= outcome.connectivityChanged ?? false;
      }
      if (netEdits) {
        const nets = affectedConductorNetIds(before, draft, changedObjectIds);
        if (nets.size) normalizeSameNetConductorTopology(draft, resolver, nets);
        const revoked = revokeInvalidatedSupplyBulkDefaults(
          before,
          draft,
          changedObjectIds,
          deferNetPrune,
        );
        connectivityChanged ||= revoked;
      }
      const reconciled = reconcileMosBulkAfterConnectivity(
        draft,
        changedObjectIds,
        deferNetPrune,
      );
      connectivityChanged ||= reconciled;
      const netCount = draft.nets.length;
      const evidenceCount = draft.connectivityEvidence.length;
      for (const netId of deferred)
        pruneUnreachableLocalNet(draft, netId, changedObjectIds, {
          protectedEvidenceIds,
        });
      connectivityChanged ||=
        draft.nets.length !== netCount ||
        draft.connectivityEvidence.length !== evidenceCount;
      inheritCellPortFormatting(before, draft, changedObjectIds);
      if (connectivityChanged) draft.sourceStatus = "connectivity-modified";
      else if (edit.edits.length && draft.sourceStatus === "in-sync")
        draft.sourceStatus = "geometry-only-changed";
      draft.revision += 1;
      if (netEdits || reconciled) logical.delete(draft.id);
    }
    project.structureRevision += 1;
  }
  return {
    get project() {
      return project;
    },
    stage,
    logicalNets(documentId: string) {
      let result = logical.get(documentId);
      if (!result) {
        const document = project.documents.find(
          (item) => item.id === documentId,
        );
        if (!document)
          throw new Error(`Document does not exist: ${documentId}`);
        logical.set(
          documentId,
          (result = resolveDocumentLogicalNets(document)),
        );
      }
      return result;
    },
  };
}

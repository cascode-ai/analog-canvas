import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./edit-schema.js";
import { planDirectEndpointConnection } from "./direct-contact-planner.js";
import { applyNetPowerEdit } from "./transaction-net-power.js";
import { applyRouteTopologyEdit } from "./transaction-route-topology.js";
import { applyPresentationLayoutEdit } from "./transaction-presentation-layout.js";

/**
 * The membership phase of a composite contact gesture. Use the transaction's
 * mutations, without finalizing/pruning/normalizing between contacts: later
 * contacts see surviving Net identities, and splits still address the authored
 * Route legs. This transient draft is never saved or exposed as a Document.
 */
export function createContactPlanningDraft(
  document: SchematicDocument,
  resolver: SymbolResolver,
) {
  const draft = structuredClone(document);
  const edits: SchematicEdit[] = [];
  const context = {
    draft,
    resolver,
    changedObjectIds: new Set<string>(),
    explicitlyAuthoredRouteIds: new Set<string>(),
    deferNetPrune: (_netId: string) => {},
    reject: (_code: unknown, message: string): never => {
      throw new Error(message);
    },
  };
  return {
    document: draft,
    edits,
    connect(from: RouteEndpoint, to: RouteEndpoint, newNetId: string) {
      const connection = planDirectEndpointConnection(draft, {
        from,
        to,
        newNetId,
      });
      if (!connection.ok) return connection;
      for (const edit of connection.edits) {
        if (edit.kind === "connect_endpoints")
          applyRouteTopologyEdit(edit, context);
        else if (
          edit.kind === "merge_nets" ||
          edit.kind === "remove_connectivity_evidence"
        )
          applyNetPowerEdit(edit, context);
        else if (edit.kind === "remove_schematic_annotation")
          applyPresentationLayoutEdit(edit, context);
        else throw new Error(`Unexpected contact edit: ${edit.kind}`);
        edits.push(edit);
      }
      return connection;
    },
  };
}

// Placement and moved-pin drops use the same engine contact planner.
export {
  powerConnectionForSymbol,
  placementWireSources,
  proposePlacementContact,
  proposedStandalonePowerConnection,
  proposedSupplyPortRename,
  type SymbolPowerConnection,
  type PlacementContactProposal,
} from "@icm/edit-engine";

import {
  powerConnectionForSymbol,
  placementWireSources,
  proposePlacementContact,
  proposedStandalonePowerConnection,
  type PlacementContactProposal,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import { resolveEndpointConnection } from "@icm/derived";
import type { Instance, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { planInitialMosBulkDefault } from "./mos-bulk-defaults";
import { vddPowerLabelAnnotation } from "./vdd-power-label";
import { razaviManualBulkConnectionEdits } from "../../presentation/razavi-presentation";

/** Fresh Insert and Copy drops establish connections from the destination only. */
export function planInsertedInstanceConnections(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
  visibleEndpoints: readonly WireSource[] = [
    ...document.instances
      .filter((candidate) => candidate.id !== instance.id)
      .flatMap((candidate) =>
        placementWireSources(document, resolver, candidate),
      ),
    ...document.junctions
      .filter(
        (junction) =>
          !junction.role ||
          junction.role === "branch" ||
          junction.role === "route-anchor",
      )
      .flatMap((junction) => {
        const endpoint = { kind: "junction" as const, junctionId: junction.id };
        const connection = resolveEndpointConnection(
          document,
          resolver,
          endpoint,
        );
        return connection
          ? [{ endpoint, connection, netId: junction.netId, preludeEdits: [] }]
          : [];
      }),
  ],
) {
  const contact = proposePlacementContact(
    document,
    resolver,
    instance,
    visibleEndpoints,
    document.netlist?.terminals.some((terminal) =>
      terminal.interfaceInstanceIds.includes(instance.id),
    )
      ? { powerMarker: false }
      : undefined,
  );
  if (contact.ambiguous) {
    throw new Error(
      `Cannot place ${instance.id}: the contacted point contains multiple conductors; choose one explicit connection`,
    );
  }
  const existingPowerNet = document.nets.find((net) =>
    net.terminals.some((terminal) => terminal.instanceId === instance.id),
  );
  const standalonePower: PlacementContactProposal = existingPowerNet
    ? {
        edits: [],
        matched: false,
        ambiguous: false,
        powerNetId: existingPowerNet.id,
      }
    : contact.matched
      ? { edits: [], matched: false, ambiguous: false }
      : proposedStandalonePowerConnection(document, instance);
  const powerRejection = contact.rejected ?? standalonePower.rejected;
  if (powerRejection) {
    throw new Error(`Cannot place ${instance.id}: ${powerRejection}`);
  }
  const powerNetId = standalonePower.powerNetId ?? contact.powerNetId;
  const powerConnection = powerConnectionForSymbol(instance.symbolId);
  const initialBulkDefaultEdits =
    powerConnection && powerNetId
      ? planInitialMosBulkDefault(document, powerConnection.domain, powerNetId)
      : [];
  const resolvedPowerSymbol = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  const vddPowerLabel =
    powerConnection?.domain === "vdd" && powerNetId && resolvedPowerSymbol
      ? vddPowerLabelAnnotation({
          instance,
          resolved: resolvedPowerSymbol,
          netId: powerNetId,
          grid: document.presentation.grid,
        })
      : null;
  const projectedDocument = structuredClone(document);
  if (
    !projectedDocument.instances.some(
      (candidate) => candidate.id === instance.id,
    )
  )
    projectedDocument.instances.push(instance);
  for (const edit of [...contact.edits, ...standalonePower.edits]) {
    if (edit.kind !== "connect_endpoints" || !edit.newNetId) continue;
    projectedDocument.nets.push({
      id: edit.newNetId,
      terminals: [edit.from, edit.to]
        .filter(
          (
            endpoint,
          ): endpoint is Extract<RouteEndpoint, { kind: "terminal" }> =>
            endpoint.kind === "terminal",
        )
        .map(({ instanceId, pinName }) => ({ instanceId, pinName }))
        .filter(
          (terminal, index, terminals) =>
            terminals.findIndex(
              (candidate) =>
                candidate.instanceId === terminal.instanceId &&
                candidate.pinName === terminal.pinName,
            ) === index,
        ),
    });
  }
  const edits: SchematicEdit[] = [
    ...contact.edits,
    ...standalonePower.edits,
    ...initialBulkDefaultEdits,
    ...razaviManualBulkConnectionEdits(
      projectedDocument,
      projectedDocument.instances,
    ),
    ...(vddPowerLabel &&
    !document.annotations.some(
      (annotation) =>
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === instance.id &&
        annotation.kind === "power-label",
    )
      ? [
          {
            kind: "upsert_schematic_annotation" as const,
            annotation: vddPowerLabel,
          },
        ]
      : []),
  ];
  return { edits, contact, projectedDocument };
}

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
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  supplyMarkerForSymbol,
} from "@icm/derived";
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
  visibleEndpoints?: readonly WireSource[],
  /**
   * The destination as it was before a paste. Its parts, Junctions and Wires
   * are all a pasted part may contact; how the pasted parts join one another
   * is what the copy carried, not where their drawings touch.
   */
  options: { existing?: SchematicDocument } = {},
) {
  const existing = options.existing;
  const existingInstances = existing
    ? new Set(existing.instances.map((item) => item.id))
    : null;
  const existingJunctions = existing
    ? new Set(existing.junctions.map((item) => item.id))
    : null;
  const endpoints = visibleEndpoints ?? [
    ...document.instances
      .filter(
        (candidate) =>
          candidate.id !== instance.id &&
          (!existingInstances || existingInstances.has(candidate.id)),
      )
      .flatMap((candidate) =>
        placementWireSources(document, resolver, candidate),
      ),
    ...document.junctions
      .filter(
        (junction) =>
          (!junction.role ||
            junction.role === "branch" ||
            junction.role === "route-anchor") &&
          (!existingJunctions || existingJunctions.has(junction.id)),
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
  ];
  // A formal Cell Pin is named by its Cell terminal, never by a supply claim.
  const cellPin = document.netlist?.terminals.some((terminal) =>
    terminal.interfaceInstanceIds.includes(instance.id),
  );
  const contact = proposePlacementContact(
    document,
    resolver,
    instance,
    endpoints,
    {
      ...(cellPin ? { powerMarker: false } : {}),
      ...(existing
        ? { routeIds: new Set(existing.routes.map((route) => route.id)) }
        : {}),
    },
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
  // A label bound to the Net name shows a supply claim, which a Cell Pin has
  // none of: its label, if it kept one, is bound to its terminal and copied.
  // Nor has a marker copied onto a Net its source left unnamed (markers from
  // before they claimed their supply): the copy stays as its source was.
  const unnamedCopy =
    existingPowerNet !== undefined &&
    !contact.matched &&
    !resolveDocumentLogicalNets(document).byBaseNetId.get(existingPowerNet.id)
      ?.name;
  const vddPowerLabel =
    !cellPin &&
    !unnamedCopy &&
    powerConnection?.domain === "vdd" &&
    powerNetId &&
    resolvedPowerSymbol
      ? vddPowerLabelAnnotation({
          instance,
          resolved: resolvedPowerSymbol,
          netId: powerNetId,
          grid: document.presentation.grid,
          // An existing supply keeps its name; a fresh marker claims its own.
          name:
            resolveDocumentLogicalNets(document).byBaseNetId.get(powerNetId)
              ?.name ??
            supplyMarkerForSymbol(instance.symbolId)?.name ??
            "VDD",
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

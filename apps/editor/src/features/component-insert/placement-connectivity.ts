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
  createPlacementContactContext,
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

/** Shared reads for one immutable insertion snapshot, not a persistent cache. */
export function createInsertedInstanceConnectionContext(
  document: SchematicDocument,
  resolver: SymbolResolver,
  existing?: SchematicDocument,
) {
  const contactContext = createPlacementContactContext(document, resolver);
  const existingInstances = existing
    ? new Set(existing.instances.map((item) => item.id))
    : null;
  const existingJunctions = existing
    ? new Set(existing.junctions.map((item) => item.id))
    : null;
  let endpoints: readonly WireSource[] | undefined;
  let bulkEdits: SchematicEdit[] | undefined;
  return {
    existing,
    contactContext,
    routeIds: existing
      ? new Set(existing.routes.map((route) => route.id))
      : undefined,
    get bulkEdits(): SchematicEdit[] {
      bulkEdits ??= razaviManualBulkConnectionEdits(
        document,
        document.instances,
        contactContext.logicalNets,
      );
      return structuredClone(bulkEdits);
    },
    get endpoints(): readonly WireSource[] {
      return (endpoints ??= [
        ...document.instances
          .filter(
            (candidate) =>
              !existingInstances || existingInstances.has(candidate.id),
          )
          .flatMap((candidate) =>
            placementWireSources(document, resolver, candidate, contactContext),
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
            const endpoint = {
              kind: "junction" as const,
              junctionId: junction.id,
            };
            const connection = resolveEndpointConnection(
              document,
              resolver,
              endpoint,
              contactContext.lookup,
            );
            return connection
              ? [
                  {
                    endpoint,
                    connection,
                    netId: junction.netId,
                    preludeEdits: [],
                  },
                ]
              : [];
          }),
      ]);
    },
  };
}

type InsertedInstanceConnectionContext = ReturnType<
  typeof createInsertedInstanceConnectionContext
>;

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
  options: {
    existing?: SchematicDocument;
    context?: InsertedInstanceConnectionContext;
  } = {},
) {
  const existing = options.existing;
  const context =
    options.context ??
    createInsertedInstanceConnectionContext(document, resolver, existing);
  context.contactContext.assertSnapshot(document, resolver);
  if (context.existing !== existing)
    throw new Error("Insertion context belongs to a different destination");
  const endpoints =
    visibleEndpoints ??
    context.endpoints.filter(
      (source) =>
        source.endpoint.kind !== "terminal" ||
        source.endpoint.instanceId !== instance.id,
    );
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
      context: context.contactContext,
      ...(cellPin ? { powerMarker: false } : {}),
      ...(context.routeIds ? { routeIds: context.routeIds } : {}),
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
    !context.contactContext.logicalNets.byBaseNetId.get(existingPowerNet.id)
      ?.name;
  // A pasted marker reads as its source did: the copy carries its label if
  // the source showed one, and adds none the source did not show.
  const vddPowerLabel =
    !existing &&
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
            context.contactContext.logicalNets.byBaseNetId.get(powerNetId)
              ?.name ??
            supplyMarkerForSymbol(instance.symbolId)?.name ??
            "VDD",
        })
      : null;
  const instances = document.instances.some(
    (candidate) => candidate.id === instance.id,
  )
    ? document.instances
    : [...document.instances, instance];
  const addedNets: SchematicDocument["nets"] = [];
  for (const edit of [...contact.edits, ...standalonePower.edits]) {
    if (edit.kind !== "connect_endpoints" || !edit.newNetId) continue;
    addedNets.push({
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
  // Read-only overlay for bulk policy. Mutable consumers still receive an
  // isolated Document below; copy planning only reads the resulting edits.
  const projection =
    instances === document.instances && addedNets.length === 0
      ? document
      : { ...document, instances, nets: [...document.nets, ...addedNets] };
  const edits: SchematicEdit[] = [
    ...contact.edits,
    ...standalonePower.edits,
    ...initialBulkDefaultEdits,
    ...(projection === document
      ? context.bulkEdits
      : razaviManualBulkConnectionEdits(
          projection,
          projection.instances,
          resolveDocumentLogicalNets(projection),
        )),
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
  let projectedDocument: SchematicDocument | undefined;
  return {
    edits,
    contact,
    get projectedDocument(): SchematicDocument {
      return (projectedDocument ??= structuredClone(projection));
    },
  };
}

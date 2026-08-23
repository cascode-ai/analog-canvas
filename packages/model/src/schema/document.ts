import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { SourceSpanSchema } from "./source.js";
import {
  InstanceSchema,
  NetlistIdentifierSchema,
  NetlistParameterValueSchema,
} from "./instance.js";
import {
  ConnectivityEvidenceSchema,
  NetSchema,
  NoConnectSchema,
} from "./connectivity.js";
import { JunctionSchema, RouteBranchSchema } from "./routing.js";
import { AnnotationSchema, VisualAnchorSchema } from "./annotations.js";
import { DraftingLayerSchema } from "./drafting.js";
import { flattenRichText } from "../rich-text.js";
import { semanticTextDocument } from "../semantic-text.js";
import {
  LayoutConstraintSchema,
  LayoutGroupSchema,
  MosBulkDefaultsSchema,
  PresentationIntentSchema,
} from "./presentation.js";
import type { DraftingObject, GridPoint, VisualAnchor } from "./types.js";
import { reportDuplicateIds } from "./validation.js";
export const SourceBindingSchema = z.strictObject({
  cellName: z.string().min(1),
  sourceRef: SourceSpanSchema,
});
export const CellNetlistTerminalSchema = z.strictObject({
  id: StableIdSchema,
  name: NetlistIdentifierSchema,
  netId: StableIdSchema,
  direction: z.enum(["input", "output", "inout", "passive"]),
  interfaceInstanceIds: z.array(StableIdSchema).min(1),
});
export const CellNetlistFormalParameterSchema = z.strictObject({
  name: NetlistIdentifierSchema,
  defaultValue: NetlistParameterValueSchema.optional(),
});
export const CellNetlistInterfaceSchema = z.strictObject({
  name: NetlistIdentifierSchema,
  terminals: z.array(CellNetlistTerminalSchema),
  formalParameters: z
    .array(CellNetlistFormalParameterSchema)
    .max(128)
    .default([]),
});

const SchematicDocumentBaseSchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sourceBinding: SourceBindingSchema.optional(),
  sourceStatus: z.enum([
    "in-sync",
    "geometry-only-changed",
    "connectivity-modified",
  ]),
  netlist: CellNetlistInterfaceSchema.optional(),
  instances: z.array(InstanceSchema),
  nets: z.array(NetSchema),
  connectivityEvidence: z.array(ConnectivityEvidenceSchema),
  routes: z.array(RouteBranchSchema),
  junctions: z.array(JunctionSchema),
  annotations: z.array(AnnotationSchema),
  presentation: PresentationIntentSchema,
  // Stable Net references for explicit cell-level well/substrate intent.
  mosBulkDefaults: MosBulkDefaultsSchema.optional(),
  layoutGroups: z.array(LayoutGroupSchema),
  constraints: z.array(LayoutConstraintSchema),
  noConnects: z.array(NoConnectSchema).default([]),
  // Drafting remains optional for programmatic in-memory Documents; canonical
  // factories and persisted fixtures write an explicit empty layer.
  drafting: DraftingLayerSchema.optional(),
});

function reportGridPoint(
  point: GridPoint,
  grid: number,
  path: ReadonlyArray<string | number>,
  context: z.RefinementCtx,
): void {
  for (const axis of ["x", "y"] as const) {
    if (point[axis] % grid === 0) continue;
    context.addIssue({
      code: "custom",
      message: `Document page coordinates must align to grid ${grid}`,
      path: [...path, axis],
    });
  }
}

function reportVisualAnchorGridAlignment(
  anchor: VisualAnchor,
  grid: number,
  path: ReadonlyArray<string | number>,
  context: z.RefinementCtx,
): void {
  switch (anchor.kind) {
    case "free":
      reportGridPoint(anchor.position, grid, [...path, "position"], context);
      return;
    case "object":
      reportGridPoint(
        anchor.localOffset,
        grid,
        [...path, "localOffset"],
        context,
      );
      reportGridPoint(
        anchor.fallbackPosition,
        grid,
        [...path, "fallbackPosition"],
        context,
      );
      return;
    case "route":
      // `t` and normalOffset are parametric scalars, not page coordinates.
      reportGridPoint(
        anchor.fallbackPosition,
        grid,
        [...path, "fallbackPosition"],
        context,
      );
  }
}

function reportDraftingObjectGridAlignment(
  object: DraftingObject,
  grid: number,
  path: ReadonlyArray<string | number>,
  context: z.RefinementCtx,
): void {
  reportVisualAnchorGridAlignment(
    object.anchor,
    grid,
    [...path, "anchor"],
    context,
  );
  switch (object.kind) {
    case "text":
    case "floating-symbol":
      return;
    case "arrow":
      reportVisualAnchorGridAlignment(
        object.from,
        grid,
        [...path, "from"],
        context,
      );
      reportVisualAnchorGridAlignment(
        object.to,
        grid,
        [...path, "to"],
        context,
      );
      object.waypoints?.forEach((point, index) =>
        reportGridPoint(point, grid, [...path, "waypoints", index], context),
      );
      object.curveControls?.forEach((point, index) => {
        if (point) {
          reportGridPoint(
            point,
            grid,
            [...path, "curveControls", index],
            context,
          );
        }
      });
      return;
    case "leader":
      reportVisualAnchorGridAlignment(
        object.target,
        grid,
        [...path, "target"],
        context,
      );
      return;
    case "callout":
      reportVisualAnchorGridAlignment(
        object.target,
        grid,
        [...path, "target"],
        context,
      );
      return;
    case "construction-line":
      object.points.forEach((point, index) =>
        reportGridPoint(point, grid, [...path, "points", index], context),
      );
      object.curveControls?.forEach((point, index) => {
        if (point) {
          reportGridPoint(
            point,
            grid,
            [...path, "curveControls", index],
            context,
          );
        }
      });
      return;
    case "rectangle":
      reportGridPoint(object.center, grid, [...path, "center"], context);
  }
}

export const SchematicDocumentSchema = SchematicDocumentBaseSchema.superRefine(
  (document, context) => {
    const objectCollections = [
      ...document.instances,
      ...document.nets,
      ...document.connectivityEvidence,
      ...document.routes,
      ...document.junctions,
      ...document.annotations,
      ...document.layoutGroups,
      ...document.constraints,
      ...document.noConnects,
      ...(document.drafting?.objects ?? []),
    ];
    for (const [key, netId] of Object.entries(document.mosBulkDefaults ?? {})) {
      if (!document.nets.some((net) => net.id === netId)) {
        context.addIssue({
          code: "custom",
          message: `MOS bulk default references an unknown Net: ${netId}`,
          path: ["mosBulkDefaults", key],
        });
      }
    }
    if (document.netlist) {
      const formalParameterNames = new Set<string>();
      for (const [index, parameter] of (
        document.netlist.formalParameters ?? []
      ).entries()) {
        const normalizedName = parameter.name.toLowerCase();
        if (formalParameterNames.has(normalizedName)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate Cell formal parameter: ${parameter.name}`,
            path: ["netlist", "formalParameters", index, "name"],
          });
        }
        formalParameterNames.add(normalizedName);
      }
      const terminalIds = new Set<string>();
      const terminalNames = new Set<string>();
      const interfaceInstanceIds = new Set<string>();
      for (const [
        terminalIndex,
        terminal,
      ] of document.netlist.terminals.entries()) {
        if (terminalIds.has(terminal.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate netlist terminal ID: ${terminal.id}`,
            path: ["netlist", "terminals", terminalIndex, "id"],
          });
        }
        terminalIds.add(terminal.id);
        const normalizedName = terminal.name.toLowerCase();
        if (terminalNames.has(normalizedName)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate netlist terminal name: ${terminal.name}`,
            path: ["netlist", "terminals", terminalIndex, "name"],
          });
        }
        terminalNames.add(normalizedName);
        for (const [
          markerIndex,
          interfaceInstanceId,
        ] of terminal.interfaceInstanceIds.entries()) {
          if (interfaceInstanceIds.has(interfaceInstanceId)) {
            context.addIssue({
              code: "custom",
              message: `Cell interface Instance is assigned to multiple terminals: ${interfaceInstanceId}`,
              path: [
                "netlist",
                "terminals",
                terminalIndex,
                "interfaceInstanceIds",
                markerIndex,
              ],
            });
          }
          interfaceInstanceIds.add(interfaceInstanceId);
        }
        if (!document.nets.some((net) => net.id === terminal.netId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown netlist terminal Net: ${terminal.netId}`,
            path: ["netlist", "terminals", terminalIndex, "netId"],
          });
        }
        const terminalNet = document.nets.find(
          (net) => net.id === terminal.netId,
        );
        for (const [
          markerIndex,
          interfaceInstanceId,
        ] of terminal.interfaceInstanceIds.entries()) {
          const interfaceInstance = document.instances.find(
            (instance) => instance.id === interfaceInstanceId,
          );
          if (
            !interfaceInstance ||
            !["port", "port-filled"].includes(interfaceInstance.symbolId)
          ) {
            context.addIssue({
              code: "custom",
              message: `Cell terminal requires a port or port-filled interface Instance: ${interfaceInstanceId}`,
              path: [
                "netlist",
                "terminals",
                terminalIndex,
                "interfaceInstanceIds",
                markerIndex,
              ],
            });
          }
          if (
            terminalNet &&
            !terminalNet.terminals.some(
              (candidate) =>
                candidate.instanceId === interfaceInstanceId &&
                candidate.pinName === "P",
            )
          ) {
            context.addIssue({
              code: "custom",
              message: `Cell terminal interface Instance ${interfaceInstanceId}.P is not connected to Net ${terminal.netId}`,
              path: [
                "netlist",
                "terminals",
                terminalIndex,
                "interfaceInstanceIds",
                markerIndex,
              ],
            });
          }
        }
      }
    }
    const cellSymbol = document.presentation.cellSymbol;
    if (cellSymbol) {
      if (!document.netlist) {
        context.addIssue({
          code: "custom",
          message:
            "Cell symbol presentation requires a Document Cell interface",
          path: ["presentation", "cellSymbol"],
        });
      } else {
        const terminalIds = new Set(
          document.netlist.terminals.map((terminal) => terminal.id),
        );
        const placedTerminals = new Set<string>();
        const occupiedSlots = new Set<string>();
        for (const [index, placement] of (
          cellSymbol.pinPlacements ?? []
        ).entries()) {
          if (!terminalIds.has(placement.terminalId)) {
            context.addIssue({
              code: "custom",
              message: `Cell symbol placement references unknown terminal: ${placement.terminalId}`,
              path: [
                "presentation",
                "cellSymbol",
                "pinPlacements",
                index,
                "terminalId",
              ],
            });
          }
          if (placedTerminals.has(placement.terminalId)) {
            context.addIssue({
              code: "custom",
              message: `Cell symbol terminal is placed more than once: ${placement.terminalId}`,
              path: [
                "presentation",
                "cellSymbol",
                "pinPlacements",
                index,
                "terminalId",
              ],
            });
          }
          placedTerminals.add(placement.terminalId);
          const slot = `${placement.side}:${placement.offset}`;
          if (occupiedSlots.has(slot)) {
            context.addIssue({
              code: "custom",
              message: `Cell symbol pin slot is occupied: ${slot}`,
              path: ["presentation", "cellSymbol", "pinPlacements", index],
            });
          }
          occupiedSlots.add(slot);
        }
      }
    }
    const netlistReferences = new Set<string>();
    for (const [instanceIndex, instance] of document.instances.entries()) {
      const reference = instance.netlist?.reference.toLowerCase();
      if (!reference) continue;
      if (netlistReferences.has(reference)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate netlist instance reference: ${instance.netlist!.reference}`,
          path: ["instances", instanceIndex, "netlist", "reference"],
        });
      }
      netlistReferences.add(reference);
    }
    const schematicReferences = new Set<string>();
    const formalPortInstanceIds = new Set(
      (document.netlist?.terminals ?? []).flatMap(
        (terminal) => terminal.interfaceInstanceIds,
      ),
    );
    for (const [instanceIndex, instance] of document.instances.entries()) {
      if (
        formalPortInstanceIds.has(instance.id) &&
        instance.schematicReference !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A formal Cell Port is identified by its Cell terminal name, not a schematic reference",
          path: ["instances", instanceIndex, "schematicReference"],
        });
      }
      const reference = instance.schematicReference?.toLowerCase();
      if (!reference) continue;
      if (schematicReferences.has(reference)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate schematic instance reference: ${instance.schematicReference}`,
          path: ["instances", instanceIndex, "schematicReference"],
        });
      }
      schematicReferences.add(reference);
    }
    for (const [
      annotationIndex,
      annotation,
    ] of document.annotations.entries()) {
      const binding = annotation.binding;
      if (
        (binding?.kind === "instance-designator" ||
          binding?.kind === "instance-schematic-name") &&
        formalPortInstanceIds.has(binding.instanceId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A formal Cell Port projects only its Cell terminal name annotation",
          path: ["annotations", annotationIndex, "binding"],
        });
      }
      if (!annotation.formatOverride || !binding) continue;
      const annotationNameClaim = document.connectivityEvidence.find(
        (evidence) =>
          evidence.kind === "name-claim" &&
          evidence.netId ===
            (binding.kind === "net-name" ? binding.netId : undefined) &&
          ((evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === annotation.id) ||
            (annotation.anchor.kind === "object" &&
              ((evidence.owner.kind === "free-port" &&
                evidence.owner.instanceId === annotation.anchor.objectId) ||
                (evidence.owner.kind === "power-marker" &&
                  evidence.owner.objectId === annotation.anchor.objectId)))),
      );
      const semanticContent =
        binding.kind === "cell-terminal-name"
          ? semanticTextDocument(
              document.netlist?.terminals.find(
                (terminal) => terminal.id === binding.terminalId,
              )?.name ?? "",
              "formal-port",
            )
          : binding.kind === "net-name"
            ? semanticTextDocument(
                (annotationNameClaim?.kind === "name-claim"
                  ? annotationNameClaim.name
                  : undefined) ?? "",
                annotation.kind === "power-label" ? "power-label" : "net-label",
              )
            : null;
      if (
        semanticContent &&
        flattenRichText(annotation.formatOverride) !==
          flattenRichText(semanticContent)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A bound RichText format override must preserve the semantic name text",
          path: ["annotations", annotationIndex, "formatOverride"],
        });
      }
    }
    for (const [instanceIndex, instance] of document.instances.entries()) {
      const binding = instance.mosBulkBinding;
      if (!binding) continue;
      const net = document.nets.find(
        (candidate) => candidate.id === binding.netId,
      );
      if (
        !net?.terminals.some(
          (terminal) =>
            terminal.instanceId === instance.id && terminal.pinName === "B",
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `MOS bulk binding is not materialized on Net: ${binding.netId}`,
          path: ["instances", instanceIndex, "mosBulkBinding"],
        });
      }
    }
    reportDuplicateIds(objectCollections, "objects", context);
    const grid = document.presentation.grid;
    document.instances.forEach((instance, index) => {
      if (instance.placement) {
        reportGridPoint(
          instance.placement.position,
          grid,
          ["instances", index, "placement", "position"],
          context,
        );
      }
    });
    document.routes.forEach((route, routeIndex) => {
      route.waypoints.forEach((point, pointIndex) =>
        reportGridPoint(
          point,
          grid,
          ["routes", routeIndex, "waypoints", pointIndex],
          context,
        ),
      );
    });
    document.junctions.forEach((junction, index) =>
      reportGridPoint(
        junction.position,
        grid,
        ["junctions", index, "position"],
        context,
      ),
    );
    document.annotations.forEach((annotation, index) =>
      reportVisualAnchorGridAlignment(
        annotation.anchor,
        grid,
        ["annotations", index, "anchor"],
        context,
      ),
    );
    document.drafting?.objects.forEach((object, index) =>
      reportDraftingObjectGridAlignment(
        object,
        grid,
        ["drafting", "objects", index],
        context,
      ),
    );

    const instanceIds = new Set(
      document.instances.map((instance) => instance.id),
    );
    const netIds = new Set(document.nets.map((net) => net.id));
    const netById = new Map(document.nets.map((net) => [net.id, net]));
    const junctionById = new Map(
      document.junctions.map((junction) => [junction.id, junction]),
    );
    const anchorObjectIds = new Set([
      ...document.instances.map((item) => item.id),
      ...document.junctions.map((item) => item.id),
    ]);
    const attachableIds = new Set([
      ...anchorObjectIds,
      ...document.nets.map((item) => item.id),
      ...document.routes.map((item) => item.id),
    ]);
    const layoutObjectIds = new Set([
      ...attachableIds,
      ...document.annotations.map((item) => item.id),
    ]);
    const terminalNetByKey = new Map<string, string>();

    for (const [evidenceIndex, evidence] of (
      document.connectivityEvidence ?? []
    ).entries()) {
      const evidencePath = ["connectivityEvidence", evidenceIndex] as const;
      if (evidence.kind === "explicit-equivalence") {
        const seenMembers = new Set<string>();
        for (const [memberIndex, netId] of evidence.memberNetIds.entries()) {
          if (!netIds.has(netId)) {
            context.addIssue({
              code: "custom",
              message: `Connectivity evidence references an unknown Net: ${netId}`,
              path: [...evidencePath, "memberNetIds", memberIndex],
            });
          }
          if (seenMembers.has(netId)) {
            context.addIssue({
              code: "custom",
              message: `Duplicate explicit-equivalence member: ${netId}`,
              path: [...evidencePath, "memberNetIds", memberIndex],
            });
          }
          seenMembers.add(netId);
        }
        continue;
      }
      if (!netIds.has(evidence.netId)) {
        context.addIssue({
          code: "custom",
          message: `Connectivity evidence references an unknown Net: ${evidence.netId}`,
          path: [...evidencePath, "netId"],
        });
      }
      if (evidence.kind !== "name-claim") continue;
      const claimedNet = netById.get(evidence.netId);
      const owner = evidence.owner;
      if (owner.kind === "net-label") {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === owner.annotationId,
        );
        if (
          !annotation ||
          (annotation.kind !== "net-label" &&
            annotation.kind !== "power-label") ||
          annotation.netId !== evidence.netId
        ) {
          context.addIssue({
            code: "custom",
            message: `Name-claim owner is not a matching Net Label: ${owner.annotationId}`,
            path: [...evidencePath, "owner", "annotationId"],
          });
        }
      } else if (owner.kind === "free-port") {
        const instance = document.instances.find(
          (candidate) => candidate.id === owner.instanceId,
        );
        const net = netById.get(evidence.netId);
        if (
          !instance ||
          (instance.symbolId !== "port" &&
            instance.symbolId !== "port-filled") ||
          !net?.terminals.some(
            (terminal) =>
              terminal.instanceId === instance.id && terminal.pinName === "P",
          )
        ) {
          context.addIssue({
            code: "custom",
            message: `Name-claim owner is not a matching free Port: ${owner.instanceId}`,
            path: [...evidencePath, "owner", "instanceId"],
          });
        }
      } else if (owner.kind === "power-marker") {
        const markerMatchesNet =
          document.instances.some(
            (candidate) =>
              candidate.id === owner.objectId &&
              claimedNet?.terminals.some(
                (terminal) => terminal.instanceId === candidate.id,
              ),
          ) ||
          document.annotations.some(
            (candidate) =>
              candidate.id === owner.objectId &&
              candidate.netId === evidence.netId,
          ) ||
          document.junctions.some(
            (candidate) =>
              candidate.id === owner.objectId &&
              candidate.netId === evidence.netId,
          ) ||
          document.routes.some(
            (candidate) =>
              candidate.id === owner.objectId &&
              candidate.netId === evidence.netId,
          );
        if (!markerMatchesNet) {
          context.addIssue({
            code: "custom",
            message: `Name-claim power owner does not match Net: ${owner.objectId}`,
            path: [...evidencePath, "owner", "objectId"],
          });
        }
      }
    }

    for (const [
      annotationIndex,
      annotation,
    ] of document.annotations.entries()) {
      const anchor = annotation.anchor;
      if (anchor.kind === "object" && !anchorObjectIds.has(anchor.objectId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown annotation anchor target: ${anchor.objectId}`,
          path: ["annotations", annotationIndex, "anchor", "objectId"],
        });
      }
      if (
        anchor.kind === "route" &&
        !document.routes.some((route) => route.id === anchor.routeId)
      ) {
        context.addIssue({
          code: "custom",
          message: `Unknown annotation route anchor: ${anchor.routeId}`,
          path: ["annotations", annotationIndex, "anchor", "routeId"],
        });
      }
      if (annotation.netId !== undefined && !netIds.has(annotation.netId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown annotation Net: ${annotation.netId}`,
          path: ["annotations", annotationIndex, "netId"],
        });
      }
    }
    for (const [collectionName, collection] of [
      ["layoutGroups", document.layoutGroups],
      ["constraints", document.constraints],
    ] as const) {
      for (const [collectionIndex, item] of collection.entries()) {
        const seen = new Set<string>();
        for (const [objectIndex, objectId] of item.objectIds.entries()) {
          if (seen.has(objectId)) {
            context.addIssue({
              code: "custom",
              message: `Duplicate layout object: ${objectId}`,
              path: [collectionName, collectionIndex, "objectIds", objectIndex],
            });
          }
          seen.add(objectId);
          if (!layoutObjectIds.has(objectId)) {
            context.addIssue({
              code: "custom",
              message: `Unknown layout object: ${objectId}`,
              path: [collectionName, collectionIndex, "objectIds", objectIndex],
            });
          }
        }
      }
    }

    for (const [netIndex, net] of document.nets.entries()) {
      const terminalKeys = new Set<string>();
      for (const [terminalIndex, terminal] of net.terminals.entries()) {
        const terminalKey = `${terminal.instanceId}\u0000${terminal.pinName}`;
        if (terminalKeys.has(terminalKey)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate terminal on net: ${terminal.instanceId}.${terminal.pinName}`,
            path: ["nets", netIndex, "terminals", terminalIndex],
          });
        }
        terminalKeys.add(terminalKey);
        const terminalOwner = terminalNetByKey.get(terminalKey);
        if (terminalOwner && terminalOwner !== net.id) {
          context.addIssue({
            code: "custom",
            message: `Terminal belongs to multiple nets: ${terminal.instanceId}.${terminal.pinName}`,
            path: ["nets", netIndex, "terminals", terminalIndex],
          });
        } else {
          terminalNetByKey.set(terminalKey, net.id);
        }
        if (!instanceIds.has(terminal.instanceId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown terminal instance: ${terminal.instanceId}`,
            path: ["nets", netIndex, "terminals", terminalIndex, "instanceId"],
          });
        }
      }
    }

    const noConnectEndpointKeys = new Set<string>();
    for (const [noConnectIndex, noConnect] of document.noConnects.entries()) {
      const endpoint = noConnect.endpoint;
      let key: string;
      let netOwner: string | undefined;
      if (!instanceIds.has(endpoint.instanceId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown NoConnect terminal instance: ${endpoint.instanceId}`,
          path: ["noConnects", noConnectIndex, "endpoint", "instanceId"],
        });
      }
      key = `${endpoint.instanceId}\u0000${endpoint.pinName}`;
      netOwner = terminalNetByKey.get(key);
      if (netOwner) {
        context.addIssue({
          code: "custom",
          message: `NoConnect endpoint is already connected to net: ${netOwner}`,
          path: ["noConnects", noConnectIndex, "endpoint"],
        });
      }
      if (noConnectEndpointKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate NoConnect on the same endpoint",
          path: ["noConnects", noConnectIndex, "endpoint"],
        });
      }
      noConnectEndpointKeys.add(key);
    }

    for (const [junctionIndex, junction] of document.junctions.entries()) {
      if (!netIds.has(junction.netId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown junction net: ${junction.netId}`,
          path: ["junctions", junctionIndex, "netId"],
        });
      }
    }

    for (const [routeIndex, route] of document.routes.entries()) {
      if (!netIds.has(route.netId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown route net: ${route.netId}`,
          path: ["routes", routeIndex, "netId"],
        });
        continue;
      }
      const routeNet = netById.get(route.netId);
      for (const endpointName of ["from", "to"] as const) {
        const endpoint = route[endpointName];
        if (
          endpoint.kind === "terminal" &&
          !instanceIds.has(endpoint.instanceId)
        ) {
          context.addIssue({
            code: "custom",
            message: `Unknown route terminal instance: ${endpoint.instanceId}`,
            path: ["routes", routeIndex, endpointName, "instanceId"],
          });
        } else if (
          endpoint.kind === "terminal" &&
          routeNet &&
          !routeNet.terminals.some(
            (terminal) =>
              terminal.instanceId === endpoint.instanceId &&
              terminal.pinName === endpoint.pinName,
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Route terminal endpoint must be a member of the route net",
            path: ["routes", routeIndex, endpointName],
          });
        }
        if (endpoint.kind === "junction") {
          const junction = junctionById.get(endpoint.junctionId);
          if (!junction) {
            context.addIssue({
              code: "custom",
              message: `Unknown route junction: ${endpoint.junctionId}`,
              path: ["routes", routeIndex, endpointName, "junctionId"],
            });
          } else if (junction.netId !== route.netId) {
            context.addIssue({
              code: "custom",
              message:
                "Route and endpoint junction must belong to the same net",
              path: ["routes", routeIndex, endpointName, "junctionId"],
            });
          }
        }
      }
    }
  },
);

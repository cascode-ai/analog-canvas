import { richTextPresentsIdentifier } from "../identifier-text.js";
import { cellSymbolPinContainmentProblems } from "../cell-symbol-layout.js";
import { projectCellInterface } from "../cell-interface-projection.js";
import { cellSymbolArtworkIssues } from "../circuit-component.js";
import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { SourceSpanSchema, ImportReferenceSchema } from "./source.js";
import {
  InstanceSchema,
  NetlistIdentifierSchema,
  NetlistParameterValueSchema,
} from "./instance.js";
import {
  ConnectivityEvidenceSchema,
  NetSchema,
  InductorCouplingSchema,
  NoConnectSchema,
  SignalDeclarationSchema,
} from "./connectivity.js";
import { JunctionSchema, RouteBranchSchema } from "./routing.js";
import { AnnotationSchema } from "./annotations.js";
import { DraftingLayerSchema } from "./drafting.js";
import { boundAnnotationName } from "./bound-annotation-text.js";
import {
  LayoutConstraintSchema,
  LayoutGroupSchema,
  MosBulkDefaultsSchema,
  PresentationIntentSchema,
} from "./presentation.js";
import type { GridPoint } from "./types.js";
import { reportDuplicateIds } from "./validation.js";
import { electricalConnectionGrid } from "../coordinate-domain.js";
import { routeElectricalConnections } from "../route-path.js";
const SourceBindingSchema = z.strictObject({
  cellName: z.string().min(1),
  sourceRef: SourceSpanSchema,
});
export const CellNetlistTerminalSchema = z
  .strictObject({
    id: StableIdSchema,
    name: NetlistIdentifierSchema,
    netId: StableIdSchema,
    direction: z.enum(["input", "output", "inout", "passive"]),
    interfaceInstanceIds: z.array(StableIdSchema).max(1),
    interfaceAnnotationId: StableIdSchema.optional(),
    signal: SignalDeclarationSchema.optional(),
  })
  .superRefine((terminal, context) => {
    if (
      terminal.signal &&
      (terminal.signal.expression !== terminal.name ||
        terminal.signal.members[0]?.netId !== terminal.netId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Cell signal must match its displayed name and first member Net",
        path: ["signal"],
      });
    }
    if (
      terminal.interfaceInstanceIds.length +
        (terminal.interfaceAnnotationId ? 1 : 0) !==
      1
    ) {
      context.addIssue({
        code: "custom",
        message: "Cell terminal requires exactly one interface owner",
        path: ["interfaceInstanceIds"],
      });
    }
  });
const CellNetlistFormalParameterSchema = z.strictObject({
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
  importReference: ImportReferenceSchema.optional(),
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
  // Omitted rather than empty, so a Document without couplings keeps the
  // exact shape it had before they existed.
  inductorCouplings: z.array(InductorCouplingSchema).optional(),
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

export const SchematicDocumentSchema = SchematicDocumentBaseSchema.superRefine(
  (document, context) => {
    const objectCollections = [
      ...document.instances,
      ...document.nets,
      ...document.connectivityEvidence,
      ...document.routes,
      ...document.routes.flatMap((route) => route.legs),
      ...document.routes.flatMap((route) =>
        route.legs.flatMap((leg) =>
          leg.to.kind === "bend" ? [{ id: leg.to.bendId }] : [],
        ),
      ),
      ...document.junctions,
      ...document.annotations,
      ...document.layoutGroups,
      ...document.constraints,
      ...document.noConnects,
      ...(document.inductorCouplings ?? []),
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
      const cellPinInstanceIds = new Set<string>();
      const cellPinAnnotationIds = new Set<string>();
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
        if (terminal.interfaceAnnotationId) {
          if (cellPinAnnotationIds.has(terminal.interfaceAnnotationId)) {
            context.addIssue({
              code: "custom",
              message: `Cell interface Annotation is assigned to multiple terminals: ${terminal.interfaceAnnotationId}`,
              path: [
                "netlist",
                "terminals",
                terminalIndex,
                "interfaceAnnotationId",
              ],
            });
          }
          cellPinAnnotationIds.add(terminal.interfaceAnnotationId);
          const annotation = document.annotations.find(
            (candidate) => candidate.id === terminal.interfaceAnnotationId,
          );
          if (
            annotation?.kind !== "power-label" ||
            annotation.netId !== terminal.netId
          ) {
            context.addIssue({
              code: "custom",
              message: `Cell terminal requires a Power Label on Net ${terminal.netId}: ${terminal.interfaceAnnotationId}`,
              path: [
                "netlist",
                "terminals",
                terminalIndex,
                "interfaceAnnotationId",
              ],
            });
          }
          const ownedClaim = document.connectivityEvidence.find(
            (evidence) =>
              evidence.kind === "name-claim" &&
              evidence.netId === terminal.netId &&
              evidence.name === terminal.name &&
              evidence.scope === "local" &&
              evidence.powerDomain === "vdd" &&
              evidence.owner.kind === "power-marker" &&
              evidence.owner.objectId === terminal.interfaceAnnotationId,
          );
          if (!ownedClaim) {
            context.addIssue({
              code: "custom",
              message: `Power Rail Cell terminal requires a matching local VDD name claim: ${terminal.interfaceAnnotationId}`,
              path: [
                "netlist",
                "terminals",
                terminalIndex,
                "interfaceAnnotationId",
              ],
            });
          }
        }
        for (const [
          markerIndex,
          interfaceInstanceId,
        ] of terminal.interfaceInstanceIds.entries()) {
          if (cellPinInstanceIds.has(interfaceInstanceId)) {
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
          cellPinInstanceIds.add(interfaceInstanceId);
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
            !["port", "port-filled", "vdd-port"].includes(
              interfaceInstance.symbolId,
            )
          ) {
            context.addIssue({
              code: "custom",
              message: `Cell terminal requires a Port or VDD Power interface Instance: ${interfaceInstanceId}`,
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
        for (const message of cellSymbolPinContainmentProblems(
          projectCellInterface(document.netlist).ports,
          cellSymbol,
        ))
          context.addIssue({
            code: "custom",
            message,
            path: ["presentation", "cellSymbol"],
          });
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
        if (cellSymbol.artwork)
          for (const issue of cellSymbolArtworkIssues(
            cellSymbol.artwork,
            projectCellInterface(document.netlist).ports,
          ))
            context.addIssue({
              code: "custom",
              message: `${document.netlist.name}'s custom symbol: ${issue.message}`,
              path: ["presentation", "cellSymbol", "artwork", ...issue.path],
            });
      }
    }
    const instanceReferences = new Set<string>();
    const formalPortInstanceIds = new Set(
      (document.netlist?.terminals ?? []).flatMap(
        (terminal) => terminal.interfaceInstanceIds,
      ),
    );
    for (const [instanceIndex, instance] of document.instances.entries()) {
      if (
        (instance.symbolId === "port" || instance.symbolId === "port-filled") &&
        !formalPortInstanceIds.has(instance.id)
      ) {
        context.addIssue({
          code: "custom",
          message: `A port or port-filled Instance must own exactly one Cell terminal: ${instance.id}`,
          path: ["instances", instanceIndex],
        });
      }
      if (
        formalPortInstanceIds.has(instance.id) &&
        instance.reference !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A formal Cell Pin is identified by its Cell terminal name, not an Instance reference",
          path: ["instances", instanceIndex, "reference"],
        });
      }
      if (
        (instance.symbolId === "ground" || instance.symbolId === "vdd-port") &&
        instance.reference !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A power marker is identified by its visible Net name, not an Instance reference",
          path: ["instances", instanceIndex, "reference"],
        });
      }
      const reference = instance.reference?.toLowerCase();
      if (!reference) continue;
      if (instanceReferences.has(reference)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate Instance reference: ${instance.reference}`,
          path: ["instances", instanceIndex, "reference"],
        });
      }
      instanceReferences.add(reference);
    }
    for (const [
      annotationIndex,
      annotation,
    ] of document.annotations.entries()) {
      const binding = annotation.binding;
      if (
        binding?.kind === "net-name" &&
        (binding.memberEndpoint || binding.memberEndpoints)
      ) {
        const selectedMembers = binding.memberEndpoints ?? [
          binding.memberEndpoint!,
        ];
        const route =
          annotation.anchor.kind === "route"
            ? document.routes.find(
                (route) =>
                  annotation.anchor.kind === "route" &&
                  route.id === annotation.anchor.routeId,
              )
            : undefined;
        const edges = route ? routeElectricalConnections(route) : [];
        const matches =
          route &&
          route.netId === binding.netId &&
          !(binding.memberEndpoint && binding.memberEndpoints) &&
          edges.length === selectedMembers.length &&
          selectedMembers.every((selected, index) =>
            edges[index]!.endpoints.some(
              (endpoint) =>
                endpoint.kind === selected.kind &&
                endpoint.memberId === selected.memberId &&
                (endpoint.kind === "terminal" && selected.kind === "terminal"
                  ? endpoint.instanceId === selected.instanceId &&
                    endpoint.pinName === selected.pinName
                  : endpoint.kind === "junction" &&
                    selected.kind === "junction" &&
                    endpoint.junctionId === selected.junctionId),
            ),
          );
        if (!matches)
          context.addIssue({
            code: "custom",
            message:
              "Bus selector must reference its branch's selected endpoint and Net",
            path: ["annotations", annotationIndex, "binding"],
          });
      }
      if (
        binding?.kind === "instance-reference" &&
        formalPortInstanceIds.has(binding.instanceId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A formal Cell Pin projects only its Cell terminal name annotation",
          path: ["annotations", annotationIndex, "binding"],
        });
      }
      if (!annotation.formatOverride || !binding) continue;
      const semanticName = boundAnnotationName(document, annotation);
      if (
        semanticName !== null &&
        !richTextPresentsIdentifier(annotation.formatOverride, semanticName)
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
    // Existing documents may use another placement pitch; the electrical
    // lattice must divide both that pitch and the Symbol connection pitch.
    const electricalGrid = electricalConnectionGrid(grid);
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
      route.legs.forEach((leg, legIndex) => {
        if (leg.to.kind !== "bend") return;
        reportGridPoint(
          leg.to.position,
          electricalGrid,
          ["routes", routeIndex, "legs", legIndex, "to", "position"],
          context,
        );
      });
    });
    document.junctions.forEach((junction, index) =>
      reportGridPoint(
        junction.position,
        electricalGrid,
        ["junctions", index, "position"],
        context,
      ),
    );
    // Since schema 29, annotations and drafting objects position at 1-unit
    // precision (their point schemas already enforce integers). The Document
    // grid remains the coarse placement contract. Electrical bends and
    // Junctions may use the finer connection lattice to reach dense pins.

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
      ...(document.drafting?.objects ?? []).map((item) => item.id),
    ]);
    const terminalNetByKey = new Map<string, string>();

    for (const [evidenceIndex, evidence] of (
      document.connectivityEvidence ?? []
    ).entries()) {
      const evidencePath = ["connectivityEvidence", evidenceIndex] as const;
      if (!netIds.has(evidence.netId)) {
        context.addIssue({
          code: "custom",
          message: `Connectivity evidence references an unknown Net: ${evidence.netId}`,
          path: [...evidencePath, "netId"],
        });
      }
      if (evidence.kind !== "name-claim") continue;
      if (
        evidence.signal &&
        (evidence.signal.expression !== evidence.name ||
          evidence.signal.members[0]?.netId !== evidence.netId ||
          evidence.signal.members.some((member) => !netIds.has(member.netId)))
      ) {
        context.addIssue({
          code: "custom",
          message: "Signal name claim must match its name and member Nets",
          path: [...evidencePath, "signal"],
        });
      }
      if (
        evidence.signal &&
        evidence.signal.members.length > 1 &&
        !document.routes.some(
          (route) =>
            route.members?.length === evidence.signal!.members.length &&
            route.members.every(
              (member, index) =>
                member.id === evidence.signal!.members[index]!.id &&
                member.netId === evidence.signal!.members[index]!.netId,
            ),
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Bus Label members must follow one authored conductor in order",
          path: [...evidencePath, "signal", "members"],
        });
      }
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
      } else if (owner.kind === "global-declaration") {
        const sourceMatchesNet = document.connectivityEvidence.some(
          (candidate) =>
            candidate.kind === "spice-source" &&
            candidate.netId === evidence.netId &&
            candidate.sourceNetId === owner.sourceNetId,
        );
        if (!sourceMatchesNet) {
          context.addIssue({
            code: "custom",
            message: `Global declaration has no matching SPICE source owner: ${owner.sourceNetId}`,
            path: [...evidencePath, "owner", "sourceNetId"],
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
        const terminalKey = `${terminal.instanceId}\u0000${terminal.pinName}\u0000${terminal.memberId ?? ""}`;
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
      key = `${endpoint.instanceId}\u0000${endpoint.pinName}\u0000${endpoint.memberId ?? ""}`;
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

    const couplingPairs = new Set<string>();
    const couplingNames = new Set<string>();
    for (const [index, coupling] of (
      document.inductorCouplings ?? []
    ).entries()) {
      const path = ["inductorCouplings", index];
      for (const [memberIndex, member] of coupling.members.entries()) {
        if (!instanceIds.has(member.instanceId))
          context.addIssue({
            code: "custom",
            message: `Unknown coupled inductor instance: ${member.instanceId}`,
            path: [...path, "members", memberIndex, "instanceId"],
          });
      }
      const [first, second] = coupling.members.map(
        (member) => member.instanceId,
      );
      if (first === second)
        context.addIssue({
          code: "custom",
          message: "An inductor coupling needs two different inductors",
          path: [...path, "members"],
        });
      const pair = [first, second].sort().join("\u0000");
      if (couplingPairs.has(pair))
        context.addIssue({
          code: "custom",
          message: "These two inductors are already coupled",
          path: [...path, "members"],
        });
      couplingPairs.add(pair);
      const name = coupling.name.toLowerCase();
      if (couplingNames.has(name))
        context.addIssue({
          code: "custom",
          message: `Duplicate inductor coupling name: ${coupling.name}`,
          path: [...path, "name"],
        });
      couplingNames.add(name);
    }

    for (const [junctionIndex, junction] of document.junctions.entries()) {
      if (
        junction.members &&
        (junction.members[0]?.netId !== junction.netId ||
          new Set(junction.members.map((member) => member.id)).size !==
            junction.members.length ||
          junction.members.some((member) => !netIds.has(member.netId)))
      ) {
        context.addIssue({
          code: "custom",
          message: "Bus junction requires unique members on existing Nets",
          path: ["junctions", junctionIndex, "members"],
        });
      }
      if (
        junction.contactAnchor &&
        !document.nets.some(
          (net) =>
            net.id === junction.netId &&
            net.terminals.some(
              (terminal) =>
                terminal.instanceId === junction.contactAnchor!.instanceId &&
                terminal.pinName === junction.contactAnchor!.pinName,
            ),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "A junction contact anchor must name a terminal on its Net",
          path: ["junctions", junctionIndex, "contactAnchor"],
        });
      }
      if (!netIds.has(junction.netId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown junction net: ${junction.netId}`,
          path: ["junctions", junctionIndex, "netId"],
        });
      }
    }

    for (const [routeIndex, route] of document.routes.entries()) {
      if (route.legs.at(-1)?.to.kind !== "endpoint") continue;
      for (const edge of routeElectricalConnections(route)) {
        const memberNet = netById.get(edge.netId);
        for (const endpoint of edge.endpoints) {
          const belongs =
            endpoint.kind === "terminal"
              ? memberNet?.terminals.some(
                  (terminal) =>
                    terminal.instanceId === endpoint.instanceId &&
                    terminal.pinName === endpoint.pinName &&
                    terminal.memberId === endpoint.memberId,
                )
              : endpoint.memberId
                ? junctionById
                    .get(endpoint.junctionId)
                    ?.members?.some(
                      (member) =>
                        member.id === endpoint.memberId &&
                        member.netId === edge.netId,
                    )
                : !junctionById.get(endpoint.junctionId)?.members &&
                  junctionById.get(endpoint.junctionId)?.netId === edge.netId;
          if (!belongs)
            context.addIssue({
              code: "custom",
              message:
                "Route electrical endpoint must belong to its member Net",
              path: ["routes", routeIndex],
            });
        }
      }
      if (!netIds.has(route.netId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown route net: ${route.netId}`,
          path: ["routes", routeIndex, "netId"],
        });
        continue;
      }
      const routeNet = netById.get(route.netId);
      const finalTarget = route.legs.at(-1)?.to;
      const routeEndpoints = [
        {
          endpoint: route.start,
          path: ["routes", routeIndex, "start"] as (string | number)[],
        },
        {
          endpoint:
            finalTarget?.kind === "endpoint" ? finalTarget.endpoint : undefined,
          path: [
            "routes",
            routeIndex,
            "legs",
            route.legs.length - 1,
            "to",
            "endpoint",
          ] as (string | number)[],
        },
      ];
      for (const { endpoint, path } of routeEndpoints) {
        if (!endpoint) continue;
        if (
          endpoint.kind === "terminal" &&
          !instanceIds.has(endpoint.instanceId)
        ) {
          context.addIssue({
            code: "custom",
            message: `Unknown route terminal instance: ${endpoint.instanceId}`,
            path: [...path, "instanceId"],
          });
        } else if (
          endpoint.kind === "terminal" &&
          !route.members &&
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
            path,
          });
        }
        if (endpoint.kind === "junction") {
          const junction = junctionById.get(endpoint.junctionId);
          if (!junction) {
            context.addIssue({
              code: "custom",
              message: `Unknown route junction: ${endpoint.junctionId}`,
              path: [...path, "junctionId"],
            });
          } else if (
            !route.members &&
            (endpoint.memberId
              ? junction.members?.find(
                  (member) => member.id === endpoint.memberId,
                )?.netId
              : junction.netId) !== route.netId
          ) {
            context.addIssue({
              code: "custom",
              message:
                "Route and endpoint junction must belong to the same net",
              path: [...path, "junctionId"],
            });
          }
        }
      }
    }
  },
);

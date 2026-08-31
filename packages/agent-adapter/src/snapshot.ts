import {
  electricalTopologyHash,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  resolveMosBulkConnection,
  resolveDraftingObjectGeometry,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import { transformPoint } from "@icm/model";
import type {
  CircuitProject,
  Point,
  Rect,
  SchematicDocument,
} from "@icm/model";
import type { SymbolPin, SymbolResolver } from "@icm/symbols";

import { utf8ByteLength } from "./platform.js";
import {
  agentProjectDiagnostics,
  agentVisualDiagnostics,
} from "./diagnostics.js";
import {
  AGENT_SNAPSHOT_VERSION,
  AgentSessionSnapshotSchema,
} from "./schema.js";
import type {
  AgentDiagnostic,
  AgentSessionSnapshot,
  AgentSnapshotDocument,
} from "./schema.js";

export interface BuildAgentSessionSnapshotOptions {
  project?: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  includeSourceSpans?: boolean;
}

function stableValue(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(stableValue);
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, value]) => [key, stableValue(value)]),
    );
  }
  return input;
}

export function canonicalSnapshotContent(input: unknown): string {
  return JSON.stringify(stableValue(input));
}

function pointBounds(point: Point): Rect {
  return { x: point.x, y: point.y, width: 1, height: 1 };
}

function enclosingBounds(items: readonly Rect[]): Rect | null {
  if (items.length === 0) return null;
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function placedInstanceBounds(
  document: SchematicDocument,
  instanceId: string,
  resolver: SymbolResolver,
): Rect | null {
  const instance = document.instances.find((item) => item.id === instanceId);
  if (!instance?.placement) return null;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return null;
  const box = resolved.definition.viewBox;
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ].map((point) =>
    transformPoint(point, instance.placement!.position, instance.placement!),
  );
  const x = Math.min(...corners.map((point) => point.x));
  const y = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function instanceTarget(
  instance: SchematicDocument["instances"][number],
): string | null {
  const provenance = instance.importProvenance;
  if (provenance) return provenance.sourceTarget;
  const binding = instance.netlist?.binding;
  if (!binding) return null;
  if (binding.kind === "primitive") return `primitive:${binding.deviceClass}`;
  if (binding.kind === "model") return `model:${binding.name}`;
  if (binding.kind === "subcircuit") {
    return `subcircuit:${binding.childDocumentId}`;
  }
  if (binding.kind === "external-subcircuit") {
    return `subcircuit:${binding.definitionId}`;
  }
  return `subcircuit:${binding.name}`;
}

function instanceMasterName(
  options: BuildAgentSessionSnapshotOptions,
  instance: SchematicDocument["instances"][number],
): string | null {
  const binding = instance.netlist?.binding;
  if (binding?.kind === "model" || binding?.kind === "unresolved-subcircuit") {
    return binding.name;
  }
  if (binding?.kind === "subcircuit") {
    return (
      options.project?.documents.find(
        (document) => document.id === binding.childDocumentId,
      )?.netlist?.name ?? null
    );
  }
  if (binding?.kind === "external-subcircuit") {
    return (
      options.project?.externalSubcircuitDefinitions.find(
        (definition) => definition.id === binding.definitionId,
      )?.name ?? null
    );
  }
  return instance.importProvenance?.sourceMasterName ?? null;
}

function subcircuitTargetName(target: string | null): string | null {
  const prefix = "subcircuit:";
  return target?.toLowerCase().startsWith(prefix)
    ? target.slice(prefix.length)
    : null;
}

function projectDocuments(
  options: BuildAgentSessionSnapshotOptions,
): readonly SchematicDocument[] {
  if (!options.project) return [options.document];
  return options.project.documents.map((document) =>
    document.id === options.document.id ? options.document : document,
  );
}

function projectIndex(options: BuildAgentSessionSnapshotOptions) {
  const documents = projectDocuments(options);
  const documentIdByName = new Map<string, string>();
  for (const document of documents) {
    documentIdByName.set(document.id.toLowerCase(), document.id);
    documentIdByName.set(document.name.toLowerCase(), document.id);
    if (document.sourceBinding) {
      documentIdByName.set(
        document.sourceBinding.cellName.toLowerCase(),
        document.id,
      );
    }
  }
  return {
    id: options.project?.id ?? `project-${options.document.id}`,
    name: options.project?.name ?? options.document.name,
    structureRevision: options.project?.structureRevision ?? 0,
    topDocumentId: options.project?.topDocumentId ?? options.document.id,
    documents: [...documents]
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((document) => ({
        id: document.id,
        name: document.name,
        instanceCount: document.instances.length,
        netCount: resolveDocumentLogicalNets(document).groups.length,
        references: document.instances
          .flatMap((instance) => {
            const targetName = subcircuitTargetName(instanceTarget(instance));
            return targetName
              ? [
                  {
                    instanceId: instance.id,
                    targetName,
                    targetDocumentId:
                      documentIdByName.get(targetName.toLowerCase()) ?? null,
                  },
                ]
              : [];
          })
          .sort((left, right) =>
            left.instanceId.localeCompare(right.instanceId, "en"),
          ),
      })),
  };
}

function diagnosticSnapshot(
  project: CircuitProject | undefined,
  document: SchematicDocument,
  resolver: SymbolResolver,
): AgentDiagnostic[] {
  return project
    ? agentProjectDiagnostics(project, resolver, document.id, document.revision)
    : agentVisualDiagnostics(document, resolver);
}

function documentSnapshot(
  options: BuildAgentSessionSnapshotOptions,
): AgentSnapshotDocument {
  const { document, resolver } = options;
  const logicalNets = resolveDocumentLogicalNets(document);
  const terminalNetByKey = new Map<string, string>();
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      terminalNetByKey.set(
        `${terminal.instanceId}\u0000${terminal.pinName}`,
        logicalNets.byBaseNetId.get(net.id)?.id ?? net.id,
      );
    }
  }
  const instances = [...document.instances]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((instance) => {
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      const pinByName = new Map<string, SymbolPin | undefined>(
        (resolved?.definition.pins ?? []).map((pin) => [pin.name, pin]),
      );
      for (const net of document.nets) {
        for (const terminal of net.terminals) {
          if (
            terminal.instanceId === instance.id &&
            !pinByName.has(terminal.pinName)
          ) {
            pinByName.set(terminal.pinName, undefined);
          }
        }
      }
      const hidden = new Set(resolved?.variant?.hiddenPinNames ?? []);
      const parameters = Object.fromEntries(
        Object.entries(instance.netlist?.parameters ?? {}).sort(
          ([left], [right]) => left.localeCompare(right, "en"),
        ),
      );
      const target = instanceTarget(instance);
      const model = target?.toLowerCase().startsWith("model:")
        ? target.slice("model:".length)
        : null;
      const mosBulk = resolveMosBulkConnection(document, instance);
      return {
        id: instance.id,
        reference: instance.reference ?? null,
        masterName: instanceMasterName(options, instance),
        symbolId: instance.symbolId,
        symbolVariantId: instance.symbolVariantId ?? null,
        target,
        model,
        parameters,
        ...(instance.netlist
          ? {
              netlist: {
                ...(instance.netlist.binding
                  ? { binding: instance.netlist.binding }
                  : {}),
                parameters: Object.fromEntries(
                  Object.entries(instance.netlist.parameters).sort(
                    ([left], [right]) => left.localeCompare(right, "en"),
                  ),
                ),
                ...(instance.importProvenance?.terminalMapping
                  ? {
                      terminalMapping: [
                        ...instance.importProvenance.terminalMapping,
                      ]
                        .sort(
                          (left, right) =>
                            left.sourcePosition - right.sourcePosition,
                        )
                        .map((terminal) => ({ ...terminal })),
                    }
                  : {}),
              },
            }
          : {}),
        placement: instance.placement
          ? structuredClone(instance.placement)
          : null,
        bounds: placedInstanceBounds(document, instance.id, resolver),
        pins: [...pinByName.entries()]
          .sort(([left], [right]) => left.localeCompare(right, "en"))
          .map(([name, pin]) => {
            const effectivePin =
              resolved?.variant?.auxiliaryPins?.find(
                (candidate) => candidate.name === name,
              ) ?? pin;
            const connection = resolveEndpointConnection(document, resolver, {
              kind: "terminal",
              instanceId: instance.id,
              pinName: name,
            });
            return {
              name,
              role: pin?.role ?? null,
              direction: effectivePin?.direction ?? null,
              visibility: pin
                ? hidden.has(name)
                  ? ("conditional" as const)
                  : pin.presentation.visibility
                : ("unknown" as const),
              localPosition: effectivePin ? { ...effectivePin.at } : null,
              connection: connection
                ? {
                    contactPoint: { ...connection.contactPoint },
                    gridLanding: { ...connection.gridLanding },
                    escapePath: connection.escapePath.map((point) => ({
                      ...point,
                    })),
                    outward: connection.outward
                      ? { ...connection.outward }
                      : null,
                  }
                : null,
              netId:
                terminalNetByKey.get(`${instance.id}\u0000${name}`) ?? null,
            };
          }),
        ...(mosBulk
          ? {
              mosBulk: {
                status: mosBulk.status,
                netId: mosBulk.net?.id ?? null,
              },
            }
          : {}),
        ...(options.includeSourceSpans && instance.sourceRef
          ? { sourceRef: structuredClone(instance.sourceRef) }
          : {}),
      };
    });

  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const routes = [...document.routes]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((route) => {
      const geometry = routingGeometry.routes.get(route.id);
      return {
        id: route.id,
        netId: logicalNets.byBaseNetId.get(route.netId)?.id ?? route.netId,
        start: structuredClone(route.start),
        legs: structuredClone(route.legs),
        ...(route.presentation ? { presentation: route.presentation } : {}),
        polyline: geometry ? [...geometry.centerline] : null,
      };
    });

  const bounds = enclosingBounds([
    ...instances.flatMap((instance) =>
      instance.bounds ? [instance.bounds] : [],
    ),
    ...document.junctions.map((junction) => pointBounds(junction.position)),
    ...document.annotations.map((annotation) =>
      pointBounds(
        annotation.anchor.kind === "free"
          ? annotation.anchor.position
          : annotation.anchor.fallbackPosition,
      ),
    ),
    ...routes.flatMap(
      (route) => route.polyline?.map((point) => pointBounds(point)) ?? [],
    ),
  ]);

  return {
    id: document.id,
    name: document.name,
    revision: document.revision,
    sourceStatus: document.sourceStatus,
    ...(document.sourceBinding
      ? {
          sourceBinding: {
            cellName: document.sourceBinding.cellName,
            ...(options.includeSourceSpans
              ? { sourceRef: structuredClone(document.sourceBinding.sourceRef) }
              : {}),
          },
        }
      : {}),
    bounds,
    presentation: structuredClone(document.presentation),
    cellInterface: document.netlist
      ? {
          name: document.netlist.name,
          terminals: document.netlist.terminals.map((terminal) => ({
            ...terminal,
          })),
        }
      : null,
    instances,
    nets: [...logicalNets.groups].map((net) => ({
      id: net.id,
      name: net.name ?? null,
      scope: net.scope ?? "local",
      powerDomain: net.powerDomain,
      terminals: document.nets
        .filter((baseNet) => net.baseNetIds.includes(baseNet.id))
        .flatMap((baseNet) => baseNet.terminals)
        .sort(
          (left, right) =>
            left.instanceId.localeCompare(right.instanceId, "en") ||
            left.pinName.localeCompare(right.pinName, "en"),
        ),
      routeIds: document.routes
        .filter((route) => net.baseNetIds.includes(route.netId))
        .map((route) => route.id)
        .sort((left, right) => left.localeCompare(right, "en")),
      junctionIds: document.junctions
        .filter((junction) => net.baseNetIds.includes(junction.netId))
        .map((junction) => junction.id)
        .sort((left, right) => left.localeCompare(right, "en")),
    })),
    routes,
    junctions: [...document.junctions]
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((junction) => ({
        ...structuredClone(junction),
        netId:
          logicalNets.byBaseNetId.get(junction.netId)?.id ?? junction.netId,
      })),
    noConnects: [...document.noConnects]
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((noConnect) => structuredClone(noConnect)),
    annotations: [...document.annotations]
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((annotation) => structuredClone(annotation)),
    // ADR 0010 WP-R4: each drafting object carries its canonical shape plus the
    // derived resolved geometry (position(s)/bounds/diagnostics) from the
    // single resolveDraftingObjectGeometry entry; the Document's anchor JSON is
    // unchanged.
    drafting: {
      objects: [...(document.drafting?.objects ?? [])]
        .sort((left, right) => left.id.localeCompare(right.id, "en"))
        .map((object) => {
          const geometry = resolveDraftingObjectGeometry(
            document,
            resolver,
            object,
          );
          return {
            object: structuredClone(object),
            resolvedGeometry: geometry,
            diagnostics: geometry.diagnostics,
          };
        }),
    },
    layoutGroups: [...document.layoutGroups]
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((group) => structuredClone(group)),
    constraints: [...document.constraints]
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((constraint) => structuredClone(constraint)),
    diagnostics: diagnosticSnapshot(options.project, document, resolver),
  };
}

export function buildAgentSessionSnapshot(
  options: BuildAgentSessionSnapshotOptions,
): AgentSessionSnapshot {
  const content = {
    project: projectIndex(options),
    document: documentSnapshot(options),
  };
  const canonical = canonicalSnapshotContent(content);
  // ADR 0010: the Snapshot identity hash covers only electrical facts
  // (instances and pin inventory, Nets and their terminal membership,
  // hierarchical edges). Placement, route geometry, Junction placement,
  // annotations, drafting objects, and diagnostics never change it, so
  // an electrically identical Document hashes identically across presentation
  // edits. When only a single Document is available (no Project view), the
  // hash is computed over that one Document's electrical projection.
  const projectView: Pick<
    CircuitProject,
    "id" | "topDocumentId" | "documents"
  > = options.project ?? {
    id: "anonymous",
    topDocumentId: options.document.id,
    documents: [options.document],
  };
  const topologyHash = electricalTopologyHash(projectView);
  return AgentSessionSnapshotSchema.parse({
    snapshotVersion: AGENT_SNAPSHOT_VERSION,
    electricalTopologyHash: topologyHash,
    byteLength: utf8ByteLength(canonical),
    ...content,
  });
}

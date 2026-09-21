import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

export interface VersionFieldChange {
  path: string;
  before: string;
  after: string;
}
export interface VersionComponentChange {
  documentId: string;
  instanceId: string;
  name: string;
  status: "added" | "removed" | "modified";
  fields: VersionFieldChange[];
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, ordered(item)]),
    );
  return value;
}
function printable(value: unknown): string {
  return value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(ordered(value));
}
function fields(
  before: unknown,
  after: unknown,
  path = "",
): VersionFieldChange[] {
  if (JSON.stringify(ordered(before)) === JSON.stringify(ordered(after)))
    return [];
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (record(before) && record(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) =>
        fields(before[key], after[key], path ? `${path}.${key}` : key),
      );
  return [{ path, before: printable(before), after: printable(after) }];
}

function componentFacts(project: CircuitProject, document: SchematicDocument) {
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const logical = resolveDocumentLogicalNets(document);
  const profile = resolveDocumentStyleProfile(document.presentation);
  const {
    wire: _wire,
    annotation: _annotation,
    ...componentStrokes
  } = profile.strokes;
  // Ignore generated Net/route identities. Compare the actual terminal membership,
  // explicit signal names, supplies and Cell interface carried by each logical Net.
  const connections = new Map<string, Record<string, unknown>>();
  const netFacts = new Map<string, unknown>();
  for (const group of logical.groups) {
    const nets = document.nets.filter((net) =>
      group.baseNetIds.includes(net.id),
    );
    const terminals = nets.flatMap((net) => net.terminals);
    const fact = {
      name: group.name,
      scope: group.scope,
      powerDomain: group.powerDomain,
      terminals: [
        ...new Set(
          terminals.map((terminal) =>
            JSON.stringify([terminal.instanceId, terminal.pinName]),
          ),
        ),
      ]
        .sort()
        .map((key) => JSON.parse(key) as [string, string]),
      ports: document.netlist?.terminals
        .filter((terminal) => group.baseNetIds.includes(terminal.netId))
        .map((terminal) => ({
          name: terminal.name,
          direction: terminal.direction,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    for (const id of group.baseNetIds) netFacts.set(id, fact);
    for (const terminal of terminals) {
      const pins = connections.get(terminal.instanceId) ?? {};
      pins[terminal.pinName] = fact;
      connections.set(terminal.instanceId, pins);
    }
  }
  const definitionById = new Map(
    (project.componentDefinitions ?? []).map((definition) => [
      definition.symbol.id,
      definition,
    ]),
  );
  return (instance: Instance) => {
    const {
      id: _id,
      sourceRef: _source,
      importProvenance: _provenance,
      mosBulkBinding,
      ...authored
    } = instance;
    const binding = instance.netlist?.binding;
    const external =
      binding?.kind === "external-subcircuit"
        ? project.externalSubcircuitDefinitions.find(
            (definition) => definition.id === binding.definitionId,
          )
        : undefined;
    return {
      ...authored,
      bulk: mosBulkBinding
        ? {
            origin: mosBulkBinding.origin,
            net: netFacts.get(mosBulkBinding.netId),
          }
        : undefined,
      connections: connections.get(instance.id) ?? {},
      noConnects: document.noConnects
        .filter((item) => item.endpoint.instanceId === instance.id)
        .map((item) => item.endpoint.pinName)
        .sort(),
      labels: document.annotations
        .filter(
          (annotation) =>
            (annotation.anchor.kind === "object" &&
              annotation.anchor.objectId === instance.id) ||
            ((annotation.binding?.kind === "instance-reference" ||
              annotation.binding?.kind === "instance-value") &&
              annotation.binding.instanceId === instance.id),
        )
        .map(({ id: _annotationId, ...annotation }) => annotation)
        .sort((a, b) => printable(a).localeCompare(printable(b))),
      symbol: resolver.resolve(instance.symbolId, instance.symbolVariantId),
      electricalDefinition: definitionById.get(instance.symbolId)?.electrical,
      subcircuitDefinition: definitionById.get(instance.symbolId)?.subcircuit,
      externalDefinition: external,
      cellParameters: document.netlist?.formalParameters,
      style: {
        foreground: instance.styleOverride?.foreground ?? profile.foreground,
        strokes: componentStrokes,
        typography: profile.typography,
      },
    };
  };
}

/** Compare stable authored identities; never guess matches from reused names. */
export function compareGalleryVersions(
  before: CircuitProject,
  after: CircuitProject,
): VersionComponentChange[] {
  const changes: VersionComponentChange[] = [];
  const documentIds = [
    ...new Set(
      [...before.documents, ...after.documents].map((document) => document.id),
    ),
  ];
  for (const documentId of documentIds) {
    const oldDocument = before.documents.find(
      (document) => document.id === documentId,
    );
    const newDocument = after.documents.find(
      (document) => document.id === documentId,
    );
    const oldFacts = oldDocument && componentFacts(before, oldDocument);
    const newFacts = newDocument && componentFacts(after, newDocument);
    const oldById = new Map(
      oldDocument?.instances.map((instance) => [instance.id, instance]),
    );
    const newById = new Map(
      newDocument?.instances.map((instance) => [instance.id, instance]),
    );
    for (const instanceId of new Set([...oldById.keys(), ...newById.keys()])) {
      const oldInstance = oldById.get(instanceId);
      const newInstance = newById.get(instanceId);
      const changed = fields(
        oldInstance && oldFacts!(oldInstance),
        newInstance && newFacts!(newInstance),
      );
      if (changed.length)
        changes.push({
          documentId,
          instanceId,
          name: newInstance?.reference ?? oldInstance?.reference ?? instanceId,
          status: !oldInstance
            ? "added"
            : !newInstance
              ? "removed"
              : "modified",
          fields: oldInstance && newInstance ? changed : [],
        });
    }
  }
  return changes;
}

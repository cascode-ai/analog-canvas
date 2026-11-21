import type {
  CircuitProject,
  Instance,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { foldNetName, scalarCellTerminals } from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveDocumentStyleProfile,
  type ResolvedLogicalNet,
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

type NetFact = {
  name: ResolvedLogicalNet["name"];
  scope: ResolvedLogicalNet["scope"];
  powerDomain: ResolvedLogicalNet["powerDomain"];
  terminals: string[][];
  ports?: { name: string; direction: string }[] | undefined;
};

type MemberFact = {
  name: string;
  net: NetFact | null;
};

type TerminalRef = Omit<Extract<RouteEndpoint, { kind: "terminal" }>, "kind">;

function memberChanges(
  before: ReadonlyMap<string, MemberFact>,
  after: ReadonlyMap<string, MemberFact>,
): VersionFieldChange[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const names = keys.map((key) => (after.get(key) ?? before.get(key))!.name);
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return keys.flatMap((key, index) => {
    const oldMember = before.get(key);
    const newMember = after.get(key);
    const label = names[index]!;
    const name =
      counts.get(label)! > 1 && (!oldMember || !newMember)
        ? `${label} (${newMember ? "current" : "historical"})`
        : label;
    const oldNoConnect = oldMember?.net === null;
    const newNoConnect = newMember?.net === null;
    const oldNet = oldMember?.net ?? undefined;
    const newNet = newMember?.net ?? undefined;
    const path = `connections.${name}`;
    const oldValue = oldNet?.name ?? printable(oldNet);
    const newValue = newNet?.name ?? printable(newNet);
    const changes =
      oldValue === newValue
        ? fields(oldNet, newNet, path)
        : [{ path, before: oldValue, after: newValue }];
    if (oldNoConnect !== newNoConnect)
      changes.push({
        path: `noConnects.${name}`,
        before: oldNoConnect ? "No Connect" : "—",
        after: newNoConnect ? "No Connect" : "—",
      });
    return changes;
  });
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
  const connections = new Map<string, Map<string, NetFact>>();
  const netFacts = new Map<string, NetFact>();
  const membersByInstance = new Map<string, Map<string, MemberFact>>();
  const instances = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const children = new Map(project.documents.map((child) => [child.id, child]));
  const ports = new Map(
    document.netlist?.terminals.flatMap((terminal) =>
      terminal.interfaceInstanceIds.map((id) => [id, terminal] as const),
    ),
  );
  const formalTerminals = scalarCellTerminals(document.netlist);
  function declaration({ instanceId, pinName }: TerminalRef) {
    const folded = foldNetName(pinName);
    const port = folded === "p" ? ports.get(instanceId) : undefined;
    if (port) return port;
    const binding = instances.get(instanceId)?.netlist?.binding;
    return binding?.kind === "subcircuit"
      ? children
          .get(binding.childDocumentId)
          ?.netlist?.terminals.find(
            (terminal) => foldNetName(terminal.name) === folded,
          )
      : undefined;
  }
  const terminalKey = (terminal: TerminalRef) =>
    JSON.stringify([
      terminal.instanceId,
      terminal.memberId
        ? (declaration(terminal)?.id ?? foldNetName(terminal.pinName))
        : terminal.pinName,
      terminal.memberId,
    ]);
  function memberName(terminal: TerminalRef): string {
    const instance = instances.get(terminal.instanceId);
    const pins =
      instance &&
      resolver.resolve(instance.symbolId, instance.symbolVariantId)?.definition
        .pins;
    const pin = pins?.find(
      (pin) => foldNetName(pin.name) === foldNetName(terminal.pinName),
    );
    const formal = declaration(terminal);
    const members = formal?.signal?.members ?? pin?.signalMembers;
    const name = members?.find(
      (member) => member.id === terminal.memberId,
    )?.name;
    if (!name) return `${terminal.pinName} (${terminal.memberId})`;
    const foldedName = foldNetName(name);
    return pins?.some(
      (other) =>
        other !== pin &&
        (foldNetName(other.name) === foldedName ||
          other.signalMembers?.some(
            (member) => foldNetName(member.name) === foldedName,
          )),
    )
      ? `${formal?.name ?? pin?.name ?? terminal.pinName} · ${name}`
      : name;
  }
  function recordMember(terminal: TerminalRef, net: MemberFact["net"]) {
    const members =
      membersByInstance.get(terminal.instanceId) ??
      new Map<string, MemberFact>();
    members.set(terminalKey(terminal), { name: memberName(terminal), net });
    membersByInstance.set(terminal.instanceId, members);
  }
  for (const group of logical.groups) {
    const nets = document.nets.filter((net) =>
      group.baseNetIds.includes(net.id),
    );
    const terminals = nets.flatMap((net) => net.terminals);
    const fact: NetFact = {
      name: group.name,
      scope: group.scope,
      powerDomain: group.powerDomain,
      terminals: [...new Set(terminals.map(terminalKey))].sort().map((key) => {
        const [instanceId, pinName, memberId] = JSON.parse(key) as [
          string,
          string,
          string | null,
        ];
        return memberId
          ? [instanceId, pinName, memberId]
          : [instanceId, pinName];
      }),
      ports: formalTerminals
        .filter((terminal) => group.baseNetIds.includes(terminal.netId))
        .map((terminal) => ({
          name: terminal.name,
          direction: terminal.direction,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    for (const id of group.baseNetIds) netFacts.set(id, fact);
    for (const terminal of terminals) {
      if (terminal.memberId) {
        recordMember(terminal, fact);
        continue;
      }
      const pins =
        connections.get(terminal.instanceId) ?? new Map<string, NetFact>();
      pins.set(terminal.pinName, fact);
      connections.set(terminal.instanceId, pins);
    }
  }
  for (const { endpoint } of document.noConnects)
    if (endpoint.memberId) recordMember(endpoint, null);
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
      members:
        membersByInstance.get(instance.id) ?? new Map<string, MemberFact>(),
      authored: {
        ...authored,
        bulk: mosBulkBinding
          ? {
              origin: mosBulkBinding.origin,
              net: netFacts.get(mosBulkBinding.netId),
            }
          : undefined,
        connections: Object.fromEntries(connections.get(instance.id) ?? []),
        noConnects: document.noConnects
          .filter(
            ({ endpoint }) =>
              endpoint.instanceId === instance.id && !endpoint.memberId,
          )
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
      const oldComponent = oldInstance && oldFacts!(oldInstance);
      const newComponent = newInstance && newFacts!(newInstance);
      const changed =
        oldComponent && newComponent
          ? [
              ...fields(oldComponent.authored, newComponent.authored),
              ...memberChanges(oldComponent.members, newComponent.members),
            ]
          : [];
      if (!oldInstance || !newInstance || changed.length)
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

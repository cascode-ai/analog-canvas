import {
  foldNetName,
  isFrozenSnapshot,
  readDocumentChangeJournal,
  type CircuitProject,
  type HierarchyFrame,
  type SchematicDocument,
} from "@icm/model";
import {
  stableResolverSource,
  type SymbolPin,
  type SymbolResolver,
} from "@icm/symbols";
import type {
  DocumentConnectivityIndex,
  GlobalNetGroup,
  HierarchyConnectivityIndex,
  HierarchyEdge,
  NetObjectRef,
  ProjectConnectivityIndex,
} from "./connectivity-index.js";

type Instances = SchematicDocument["instances"];
type Instance = Instances[number];
type Terminals = NonNullable<SchematicDocument["netlist"]>["terminals"];
type GlobalNames = readonly { foldedName: string; netId: string }[];
type Relations = Pick<ProjectConnectivityIndex, "hierarchy" | "globalNets">;
const emptyTerminals: Terminals = [];
const emptyPins: readonly SymbolPin[] = [];
interface StructuralInstances {
  calls: Instances;
  positions: number[];
}
const callersByInstances = new WeakMap<Instances, StructuralInstances>();

function structuralInstances(
  document: SchematicDocument,
  index: DocumentConnectivityIndex,
  committed: boolean,
): Instances {
  if (committed) {
    const known = callersByInstances.get(document.instances);
    if (known) return known.calls;
    const change = readDocumentChangeJournal(document);
    const previous = change && callersByInstances.get(change.before.instances);
    // Preserve authored order, including collation ties, when existing callers
    // remain in their slots. A newly introduced call must be a changed row.
    if (
      change &&
      previous &&
      previous.positions.every(
        (position, i) => document.instances[position] === previous.calls[i],
      ) &&
      change.rows.every(
        (row) =>
          row.collection !== "instances" ||
          index.instancesById.get(row.id)?.netlist?.binding?.kind !==
            "subcircuit",
      )
    ) {
      callersByInstances.set(document.instances, previous);
      return previous.calls;
    }
  }
  const calls: Instances = [];
  const positions: number[] = [];
  for (const [position, instance] of document.instances.entries()) {
    if (instance.netlist?.binding?.kind !== "subcircuit") continue;
    calls.push(instance);
    if (committed) positions.push(position);
  }
  if (committed)
    callersByInstances.set(document.instances, { calls, positions });
  return calls;
}

interface CallPart {
  call: HierarchyFrame;
  edges: HierarchyEdge[];
  terminals: Terminals;
  formalNets: string;
  pins: readonly SymbolPin[];
}
const partsByInstance = new WeakMap<Instance, CallPart>();

function callEdges(
  call: HierarchyFrame,
  terminals: Terminals,
  pins: readonly SymbolPin[],
  childIndex: DocumentConnectivityIndex,
): HierarchyEdge[] {
  const edges: HierarchyEdge[] = [];
  for (const pin of pins) {
    const childTerminals = terminals.filter(
      (terminal) => foldNetName(terminal.name) === foldNetName(pin.name),
    );
    if (pin.signalMembers?.length) {
      for (const parentMember of pin.signalMembers) {
        const matches = childTerminals.flatMap((terminal) =>
          (terminal.signal?.members ?? []).flatMap((member) =>
            member.id === parentMember.id ? [{ terminal, member }] : [],
          ),
        );
        // Use the captured formal identity, never a member's position or
        // spelling. Missing/ambiguous mappings cannot create trace edges.
        const match = matches[0];
        if (matches.length !== 1 || !match) continue;
        const { terminal, member } = match;
        if (!childIndex.logicalNetByBaseNetId.has(member.netId)) continue;
        edges.push({
          parentDocumentId: call.parentDocumentId,
          instanceId: call.instanceId,
          parentPinName: pin.name,
          parentMemberId: parentMember.id,
          parentMemberName: parentMember.name,
          childDocumentId: call.childDocumentId,
          childTerminalName: terminal.name,
          childMemberId: member.id,
          childMemberName: member.name,
          childNetId: member.netId,
        });
      }
      continue;
    }
    if (
      childTerminals.some(
        (terminal) => (terminal.signal?.members.length ?? 0) > 1,
      )
    )
      continue;
    const childTerminal = childTerminals[0];
    if (!childTerminal) continue;
    const logicalId = childIndex.logicalNetByBaseNetId.get(
      childTerminal.netId,
    )?.netId;
    // A name identifies the projected interface pin, not electrical
    // equivalence. Only preserve an edge when every authored member is
    // already connected by the child's independent connectivity facts.
    if (
      !logicalId ||
      childTerminals.some(
        (terminal) =>
          childIndex.logicalNetByBaseNetId.get(terminal.netId)?.netId !==
          logicalId,
      )
    )
      continue;
    edges.push({
      parentDocumentId: call.parentDocumentId,
      instanceId: call.instanceId,
      parentPinName: pin.name,
      childDocumentId: call.childDocumentId,
      childTerminalName: childTerminal.name,
      childNetId: childTerminal.netId,
    });
  }

  return edges;
}

function combineCalls(parts: CallPart[]): HierarchyConnectivityIndex {
  const calls = parts.map((part) => part.call);
  const edges = parts.flatMap((part) => part.edges);
  edges.sort(
    (a, b) =>
      a.parentDocumentId.localeCompare(b.parentDocumentId, "en") ||
      a.instanceId.localeCompare(b.instanceId, "en") ||
      a.parentPinName.localeCompare(b.parentPinName, "en") ||
      (a.parentMemberId ?? "").localeCompare(b.parentMemberId ?? "", "en"),
  );
  calls.sort(
    (a, b) =>
      a.parentDocumentId.localeCompare(b.parentDocumentId, "en") ||
      a.instanceId.localeCompare(b.instanceId, "en") ||
      a.childDocumentId.localeCompare(b.childDocumentId, "en"),
  );
  return { calls, edges };
}

interface CellGlobals {
  id: string;
  names: GlobalNames;
}
function sortRefs(left: NetObjectRef, right: NetObjectRef) {
  return (
    left.documentId.localeCompare(right.documentId, "en") ||
    left.netId.localeCompare(right.netId, "en")
  );
}

function combineGlobals(
  cells: CellGlobals[],
): ReadonlyMap<string, GlobalNetGroup> {
  const groups = new Map<string, NetObjectRef[]>();
  for (const { id, names } of cells) {
    for (const { foldedName, netId } of names) {
      const refs = groups.get(foldedName) ?? [];
      refs.push({ documentId: id, netId });
      groups.set(foldedName, refs);
    }
  }
  return new Map(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([foldedName, nets]) => [
        foldedName,
        {
          foldedName,
          nets: nets.sort(sortRefs),
        },
      ]),
  );
}

interface ParentCalls {
  id: string;
  instances: Instances;
}
interface HierarchyInputs {
  resolver: object | undefined;
  parents: ParentCalls[];
  children: Map<
    string,
    {
      index: DocumentConnectivityIndex | undefined;
      terminals: Terminals | undefined;
    }
  >;
  parts: CallPart[];
  hierarchy: HierarchyConnectivityIndex;
}
function buildHierarchy(
  resolver: SymbolResolver,
  source: object | undefined,
  parents: ParentCalls[],
  children: ReadonlyMap<string, SchematicDocument>,
  documents: ReadonlyMap<string, DocumentConnectivityIndex>,
  previous: HierarchyInputs | undefined,
): HierarchyInputs {
  // Missing children also participate: installing a formerly absent definition
  // creates a structural call even when the symbol has no matching Pins.
  if (
    source &&
    previous?.resolver === source &&
    previous.parents.length === parents.length &&
    parents.every(
      (parent, i) =>
        parent.id === previous.parents[i]?.id &&
        parent.instances === previous.parents[i]?.instances,
    ) &&
    [...previous.children].every(
      ([id, child]) =>
        documents.get(id) === child.index &&
        children.get(id)?.netlist?.terminals === child.terminals,
    )
  )
    return previous;
  const dependencies: HierarchyInputs["children"] = new Map();
  const formalNetsByCell = new Map<string, string>();
  const parts: CallPart[] = [];
  for (const parent of parents) {
    for (const instance of parent.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind !== "subcircuit") continue;
      const childId = binding.childDocumentId;
      const child = children.get(childId);
      const childIndex = documents.get(childId);
      if (!dependencies.has(childId))
        dependencies.set(childId, {
          index: childIndex,
          terminals: child?.netlist?.terminals,
        });
      if (!child || !childIndex) continue;
      const terminals = child.netlist?.terminals ?? emptyTerminals;
      let formalNets = formalNetsByCell.get(childId);
      if (formalNets === undefined) {
        // Only the Logical Net of a scalar formal and membership of a bus
        // formal enter an edge. A change to any other Net need not touch it.
        formalNets = JSON.stringify(
          terminals.map((t) => [
            childIndex.logicalNetByBaseNetId.get(t.netId)?.netId,
            t.signal?.members.map((m) =>
              childIndex.logicalNetByBaseNetId.has(m.netId),
            ),
          ]),
        );
        formalNetsByCell.set(childId, formalNets);
      }
      const pins =
        resolver.resolve(instance.symbolId, instance.symbolVariantId)
          ?.definition.pins ?? emptyPins;
      const known = source ? partsByInstance.get(instance) : undefined;
      if (
        known &&
        known.call.parentDocumentId === parent.id &&
        known.call.childDocumentId === childId &&
        known.terminals === terminals &&
        known.formalNets === formalNets &&
        known.pins === pins
      ) {
        parts.push(known);
        continue;
      }
      const call = {
        parentDocumentId: parent.id,
        instanceId: instance.id,
        childDocumentId: childId,
      };
      const part = {
        call,
        edges: callEdges(call, terminals, pins, childIndex),
        terminals,
        formalNets,
        pins,
      };
      if (source) partsByInstance.set(instance, part);
      parts.push(part);
    }
  }
  const hierarchy =
    previous?.parts.length === parts.length &&
    parts.every((part, i) => part === previous.parts[i])
      ? previous.hierarchy
      : combineCalls(parts);
  return {
    resolver: source,
    parents,
    children: dependencies,
    parts,
    hierarchy,
  };
}

interface Assembly {
  hierarchy: HierarchyInputs;
  cells: CellGlobals[];
  globalNets: Relations["globalNets"];
}
function updateGlobals(
  cells: CellGlobals[],
  previous: Assembly | undefined,
): Relations["globalNets"] {
  if (
    !previous ||
    cells.length !== previous.cells.length ||
    cells.some((cell, i) => cell.id !== previous.cells[i]?.id)
  )
    return combineGlobals(cells);
  const changedCells = new Set<string>();
  const replacements = new Map<string, NetObjectRef[]>();
  for (const [i, cell] of cells.entries()) {
    const before = previous.cells[i]?.names ?? [];
    if (cell.names === before) continue;
    changedCells.add(cell.id);
    for (const { foldedName } of before) {
      if (!replacements.has(foldedName)) replacements.set(foldedName, []);
    }
    for (const { foldedName, netId } of cell.names) {
      const refs = replacements.get(foldedName) ?? [];
      refs.push({ documentId: cell.id, netId });
      replacements.set(foldedName, refs);
    }
  }
  if (!replacements.size) return previous.globalNets;
  const groups = new Map(previous.globalNets);
  const order = new Map(cells.map((cell, i) => [cell.id, i]));
  for (const [foldedName, replacementsForName] of replacements) {
    const previousGroup = groups.get(foldedName);
    const nets = [
      ...(previousGroup?.nets.filter(
        (ref) => !changedCells.has(ref.documentId),
      ) ?? []),
      ...replacementsForName,
    ];
    if (!nets.length) {
      groups.delete(foldedName);
      continue;
    }
    // The full stable sort breaks collation ties by authored Cell order,
    // and then by the order of the members supplied by that Cell.
    nets.sort(
      (a, b) =>
        sortRefs(a, b) ||
        (order.get(a.documentId) ?? 0) - (order.get(b.documentId) ?? 0),
    );
    if (
      previousGroup?.nets.length === nets.length &&
      nets.every(
        (net, i) =>
          net.documentId === previousGroup.nets[i]?.documentId &&
          net.netId === previousGroup.nets[i]?.netId,
      )
    )
      continue;
    groups.set(foldedName, { foldedName, nets });
  }
  const entries = [...groups].sort(([a], [b]) => a.localeCompare(b, "en"));
  // Distinct spellings can collate equally. Their key order then depends
  // on where each name first appeared in the authored Cells.
  if (
    entries.some(([name], i) => {
      const prior = entries[i - 1];
      return prior && name.localeCompare(prior[0], "en") === 0;
    })
  )
    return combineGlobals(cells);
  return new Map(entries);
}

const assemblies = new WeakMap<CircuitProject, Assembly>();
let lastAssembly: WeakRef<Assembly> | undefined;

export function buildProjectConnectivityRelations(
  project: CircuitProject,
  resolver: SymbolResolver,
  documents: ReadonlyMap<string, DocumentConnectivityIndex>,
  globalsForCell: (index: DocumentConnectivityIndex) => GlobalNames,
  shared = false,
): Relations {
  const committed = shared && isFrozenSnapshot(project);
  const previous = committed
    ? (assemblies.get(project) ?? lastAssembly?.deref())
    : undefined;
  const children = new Map(project.documents.map((doc) => [doc.id, doc]));
  const cells: CellGlobals[] = [];
  const parents: ParentCalls[] = [];
  for (const doc of project.documents) {
    const index = documents.get(doc.id);
    if (!index) throw new Error(`Missing connectivity for Cell ${doc.id}`);
    cells.push({ id: doc.id, names: globalsForCell(index) });
    const instances = structuralInstances(doc, index, committed);
    if (instances.length) parents.push({ id: doc.id, instances });
  }
  const hierarchy = buildHierarchy(
    resolver,
    committed ? stableResolverSource(resolver) : undefined,
    parents,
    children,
    documents,
    previous?.hierarchy,
  );
  const globalNets = updateGlobals(cells, previous);
  if (committed) {
    const assembly = { cells, hierarchy, globalNets };
    assemblies.set(project, assembly);
    lastAssembly = new WeakRef(assembly);
  }
  return { hierarchy: hierarchy.hierarchy, globalNets };
}

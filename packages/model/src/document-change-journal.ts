import type { CircuitProject, SchematicDocument } from "./schema/types.js";
import { freezeSnapshot, isFrozenSnapshot } from "./immutable-snapshot.js";
import { routeEnd } from "./route-path.js";

const rowCollections = [
  "instances",
  "nets",
  "junctions",
  "routes",
  "annotations",
  "connectivityEvidence",
  "noConnects",
  "layoutGroups",
  "constraints",
  "instanceGroups",
  "inductorCouplings",
] as const;
type Collection =
  (typeof rowCollections)[number] | "drafting.objects" | "netlist.terminals";
interface ChangedRow {
  readonly collection: Collection;
  readonly id: string;
  readonly change: "added" | "updated" | "removed";
}
type Field = keyof SchematicDocument;

/** Actual differences between installed snapshots; identifiers are scoped to this Cell. */
export interface DocumentChangeJournal {
  readonly fields: readonly Field[];
  readonly rows: readonly ChangedRow[];
  readonly beforeNetIds: readonly string[];
  readonly afterNetIds: readonly string[];
  readonly geometryObjectIds: readonly string[];
}

const transitions = new WeakMap<
  SchematicDocument,
  {
    previous: WeakRef<SchematicDocument>;
    journal: DocumentChangeJournal;
  }
>();

/** Match only the changed middle. An edit at the end of an 8k-Net Cell
 * does not need to allocate an 8k-entry lookup for its unchanged prefix. */
function compareRows<T extends { id: string }>(
  before: readonly T[] = [],
  after: readonly T[] = [],
  changed: (old: T | undefined, next: T | undefined) => void,
) {
  if (before === after) return;
  let first = 0,
    oldEnd = before.length,
    newEnd = after.length;
  while (first < oldEnd && first < newEnd && before[first] === after[first])
    first++;
  while (
    oldEnd > first &&
    newEnd > first &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const oldRows = new Map<string, T>();
  for (let i = first; i < oldEnd; i++) oldRows.set(before[i]!.id, before[i]!);
  for (let i = first; i < newEnd; i++) {
    const row = after[i]!,
      old = oldRows.get(row.id);
    if (old !== row) changed(old, row);
    oldRows.delete(row.id);
  }
  for (const old of oldRows.values()) changed(old, undefined);
}

function collectJournal(
  source: SchematicDocument,
  document: SchematicDocument,
): DocumentChangeJournal {
  const fields = [
    ...new Set([...Object.keys(source), ...Object.keys(document)] as Field[]),
  ].filter((key) => source[key] !== document[key]);
  const rows: ChangedRow[] = [],
    geometry = new Set<string>();
  const previousNets = new Set<string>(),
    nextNets = new Set<string>(),
    retainedInstances = new Set<string>();
  function collect<T extends { id: string }>(
    collection: Collection,
    before: readonly T[] | undefined,
    after: readonly T[] | undefined,
    dependencies?: (item: T, nets: Set<string>) => void,
  ) {
    compareRows(before, after, (old, next) => {
      rows.push({
        collection,
        id: (next ?? old)!.id,
        change: old && next ? "updated" : next ? "added" : "removed",
      });
      if (old) dependencies?.(old, previousNets);
      if (next) dependencies?.(next, nextNets);
      if (old && next && collection === "instances")
        retainedInstances.add(old.id);
    });
  }
  collect("instances", source.instances, document.instances, (item) => {
    geometry.add(item.id);
  });
  collect("nets", source.nets, document.nets, (net, nets) => {
    nets.add(net.id);
  });
  collect("routes", source.routes, document.routes, (route, nets) => {
    geometry.add(route.id);
    for (const endpoint of [route.start, routeEnd(route)])
      geometry.add(
        endpoint.kind === "terminal"
          ? endpoint.instanceId
          : endpoint.junctionId,
      );
    nets.add(route.netId);
    for (const member of route.members ?? []) nets.add(member.netId);
  });
  collect(
    "junctions",
    source.junctions,
    document.junctions,
    (junction, nets) => {
      geometry.add(junction.id);
      if (junction.contactAnchor)
        geometry.add(junction.contactAnchor.instanceId);
      nets.add(junction.netId);
      for (const member of junction.members ?? []) nets.add(member.netId);
    },
  );
  collect(
    "connectivityEvidence",
    source.connectivityEvidence,
    document.connectivityEvidence,
    (evidence, nets) => {
      nets.add(evidence.netId);
      if (evidence.kind === "name-claim")
        for (const member of evidence.signal?.members ?? [])
          nets.add(member.netId);
    },
  );
  collect(
    "annotations",
    source.annotations,
    document.annotations,
    (label, nets) => {
      geometry.add(label.id);
      if (label.netId) nets.add(label.netId);
      if (label.anchor.kind === "route") geometry.add(label.anchor.routeId);
      if (label.anchor.kind === "object") geometry.add(label.anchor.objectId);
      if (label.binding?.kind === "net-name") nets.add(label.binding.netId);
    },
  );
  collect(
    "netlist.terminals",
    source.netlist?.terminals,
    document.netlist?.terminals,
    (terminal, nets) => {
      nets.add(terminal.netId);
      for (const member of terminal.signal?.members ?? [])
        nets.add(member.netId);
    },
  );
  collect(
    "drafting.objects",
    source.drafting?.objects,
    document.drafting?.objects,
    (object) => {
      geometry.add(object.id);
    },
  );
  for (const key of [
    "noConnects",
    "layoutGroups",
    "constraints",
    "instanceGroups",
    "inductorCouplings",
  ] as const)
    collect<{ id: string }>(key, source[key], document[key]);
  // Added/removed Instances can only have memberships in changed Net rows:
  // the model checks every terminal's Instance and every contact anchor.
  // Existing Instances can move without changing those rows.
  if (retainedInstances.size)
    for (const [doc, nets] of [
      [source, previousNets],
      [document, nextNets],
    ] as const) {
      for (const net of doc.nets)
        if (net.terminals.some((t) => retainedInstances.has(t.instanceId)))
          nets.add(net.id);
      for (const junction of doc.junctions)
        if (
          junction.contactAnchor &&
          retainedInstances.has(junction.contactAnchor.instanceId)
        ) {
          geometry.add(junction.id);
          nets.add(junction.netId);
        }
    }
  return freezeSnapshot({
    fields,
    rows,
    beforeNetIds: [...previousNets].sort(),
    afterNetIds: [...nextNets].sort(),
    geometryObjectIds: [...geometry].sort(),
  });
}

/** Called only on a successful Project/History installation after structural sharing. */
export function recordCommittedDocumentChanges(
  before: CircuitProject,
  after: CircuitProject,
): void {
  if (
    !isFrozenSnapshot(before) ||
    !isFrozenSnapshot(after) ||
    before.documents === after.documents ||
    before.id !== after.id
  )
    return;
  const previous = new Map(
    before.documents.map((document) => [document.id, document]),
  );
  for (const document of after.documents) {
    const source = previous.get(document.id);
    if (!source || source === document) continue;
    transitions.set(document, {
      previous: new WeakRef(source),
      journal: collectJournal(source, document),
    });
  }
}

/** @internal Pins the committed change contract for incremental connectivity. The previous Cell can expire independently. */
export function readDocumentChangeJournal(after: SchematicDocument) {
  const transition = transitions.get(after);
  const before = transition?.previous.deref();
  return before && transition ? { before, ...transition.journal } : undefined;
}

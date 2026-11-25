import {
  type Annotation,
  type AnnotationNameClaimReader,
  type DocumentChangeJournal,
  type Net,
  type SchematicDocument,
} from "@icm/model";
import { InMemorySymbolResolver, type SymbolResolver } from "@icm/symbols";
import { resolveAnnotationName } from "./annotation-text.js";
import type { DocumentDerivedContext } from "./document-derived-context.js";
import { endpointKey } from "./endpoint.js";

const localFields = new Set<keyof SchematicDocument>([
  "revision",
  "name",
  "sourceStatus",
  "instances",
  "routes",
  "nets",
  "junctions",
  "annotations",
  "connectivityEvidence",
  "drawingOrder",
  "noConnects",
  "mosBulkDefaults",
]);

function scalarNet(net: Net) {
  return !net.terminals.some((pin) => pin.memberId);
}

function localLabel(label: Annotation) {
  return (
    (label.kind !== "net-label" && label.kind !== "power-label") ||
    (label.binding?.kind === "net-name" &&
      label.binding.netId === label.netId &&
      !label.binding.memberEndpoint &&
      !label.binding.memberEndpoints)
  );
}

/** Imported guidance and bus lanes can depend on another conductor without a
 * write on this one. Recheck only modified/new rows of an already scalar Cell. */
export function hasLocalRecordDependencies(
  document: SchematicDocument,
  context: DocumentDerivedContext,
  previousLocal: boolean,
  journal: DocumentChangeJournal | undefined,
) {
  if (
    document.importReference ||
    context.directRoutingGeometry !== context.routingGeometry
  )
    return false;
  if (previousLocal && journal) {
    return journal.rows.every((row) => {
      if (row.change === "removed") return true;
      if (row.collection === "nets")
        return scalarNet(context.netsById.get(row.id)!);
      if (row.collection === "annotations")
        return localLabel(context.annotationsById.get(row.id)!);
      if (row.collection === "junctions")
        return !context.junctionsById.get(row.id)?.members;
      if (row.collection === "routes")
        return !context.routesById.get(row.id)?.members;
      return true;
    });
  }
  return (
    document.nets.every(scalarNet) &&
    document.annotations.every(localLabel) &&
    !document.routes.some((route) => route.members) &&
    !document.junctions.some((junction) => junction.members)
  );
}

/** Connectivity reads symbol artwork and pins. A new Project resolver after a
 * model fill can still share every original immutable definition and variant. */
export function sameConnectivitySymbols(
  before: SchematicDocument,
  previous: SymbolResolver,
  next: SymbolResolver,
) {
  if (
    !InMemorySymbolResolver.hasStableDefinitions(previous) ||
    !InMemorySymbolResolver.hasStableDefinitions(next)
  )
    return false;
  if (previous === next) return true;
  const seen = new Map<string, Set<string | undefined>>();
  for (const { symbolId, symbolVariantId } of before.instances) {
    const variants = seen.get(symbolId) ?? new Set<string | undefined>();
    if (variants.has(symbolVariantId)) continue;
    variants.add(symbolVariantId);
    seen.set(symbolId, variants);
    const a = previous.resolve(symbolId, symbolVariantId),
      b = next.resolve(symbolId, symbolVariantId);
    if (a?.definition !== b?.definition || a?.variant !== b?.variant)
      return false;
  }
  return true;
}

export function changedRecordOwners(journal: DocumentChangeJournal) {
  if (!journal.fields.every((field) => localFields.has(field)))
    return undefined;
  return new Set([...journal.beforeNetIds, ...journal.afterNetIds]);
}

function sameRows<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  return (
    a === b ||
    Boolean(
      a && b && a.length === b.length && a.every((row, i) => row === b[i]),
    )
  );
}

export interface RecordInputs {
  document: SchematicDocument;
  index: DocumentDerivedContext;
  claims: AnnotationNameClaimReader;
}

/** Derived label anchors may move when only an unrelated object's geometry
 * changes. Reordered rows also matter when their distinct IDs collate equally. */
export function sameRecordInputs(
  netId: string,
  before: RecordInputs,
  after: RecordInputs,
) {
  if (
    before.document.routes !== after.document.routes &&
    !sameRows(
      before.index.routesByNetId.get(netId),
      after.index.routesByNetId.get(netId),
    )
  )
    return false;
  if (
    before.document.junctions !== after.document.junctions &&
    !sameRows(
      before.index.junctionsByNetId.get(netId),
      after.index.junctionsByNetId.get(netId),
    )
  )
    return false;
  if (
    before.document.annotations !== after.document.annotations &&
    !sameRows(
      before.index.annotationsByNetId.get(netId),
      after.index.annotationsByNetId.get(netId),
    )
  )
    return false;
  const oldLabels = before.index.netLabelBindingsByNetId.get(netId);
  const labels = after.index.netLabelBindingsByNetId.get(netId);
  if (!oldLabels && !labels) return true;
  if (!oldLabels || !labels || labels.length !== oldLabels.length) return false;
  return labels.every((entry, i) => {
    const old = oldLabels[i]!;
    if (
      entry.annotationId !== old.annotationId ||
      endpointKey(entry.endpoint) !== endpointKey(old.endpoint)
    )
      return false;
    const name = (ctx: RecordInputs) =>
      resolveAnnotationName(
        ctx.document,
        ctx.index.annotationsById.get(entry.annotationId)!,
        ctx.index.logicalNetResolution,
        ctx.claims,
      );
    return name(before) === name(after);
  });
}

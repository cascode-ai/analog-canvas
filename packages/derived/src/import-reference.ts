import {
  foldNetName,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { ConnectionGraph } from "./connection-graph.js";
import {
  deriveNetConnectivity,
  deriveNetConnectivityContext,
} from "./connectivity.js";
import type { DocumentDerivedContext } from "./document-derived-context.js";
import {
  endpointKey,
  isVisibleEndpoint,
  resolveEndpointPoint,
} from "./endpoint.js";
import {
  deriveRoutingGuidance,
  type RoutingGuide,
  type RoutingGuidanceComponent,
  type RoutingGuidanceNode,
} from "./routing-guidance.js";

export interface ImportReferenceIssue {
  code:
    | "IMPORT_REFERENCE_UNAVAILABLE"
    | "IMPORT_REFERENCE_OPEN"
    | "IMPORT_REFERENCE_SHORT"
    | "IMPORT_REFERENCE_SCOPE_CHANGED"
    | "IMPORT_REFERENCE_MISSING_ENDPOINT"
    | "IMPORT_REFERENCE_UNPLACED";
  sourceNetIds: string[];
  instanceIds: string[];
  message: string;
}
export interface ImportReferenceAssessment {
  available: boolean;
  guides: RoutingGuide[];
  issues: ImportReferenceIssue[];
}

/** Compare a Cell definition with its frozen import, never with provenance lineage.
 * Parent-instance wiring is compared in the parent definition: repeated child
 * Ports on the same parent node are expected, not a child-definition short.
 */
export function assessImportReference(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: DocumentDerivedContext = deriveNetConnectivityContext(
    document,
    resolver,
  ),
): ImportReferenceAssessment {
  if (
    context.documentId !== document.id ||
    context.documentRevision !== document.revision
  )
    throw new Error("Import reference received a stale DocumentDerivedContext");
  const reference = document.importReference;
  if (!reference)
    return {
      available: false,
      guides: [],
      issues:
        document.sourceBinding ||
        document.connectivityEvidence.some((e) => e.kind === "spice-source")
          ? [
              {
                code: "IMPORT_REFERENCE_UNAVAILABLE",
                sourceNetIds: [],
                instanceIds: [],
                message:
                  "Original import reference is unavailable; source provenance cannot reconstruct routing targets.",
              },
            ]
          : [],
    };
  const issues: ImportReferenceIssue[] = [];
  const owner = new Map<string, string>();
  const expressed = new ConnectionGraph();
  for (const net of document.nets) {
    for (const terminal of net.terminals)
      owner.set(endpointKey({ kind: "terminal", ...terminal }), net.id);
    for (const component of deriveNetConnectivity(
      document,
      resolver,
      net,
      context,
    ).components)
      expressed.join(component.nodes.map((n) => n.key));
  }
  // Only actual naming owners add virtual drawing edges. Mere imported Net
  // membership must not make a newly imported, unrouted sheet look complete.
  const names = new Map<string, string[]>();
  const nameOwner = (netId: string, name: string, key: string) => {
    const logical = context.logicalNetResolution.byBaseNetId.get(netId);
    if (!logical) return;
    const identity = `${logical.id}\u0000${foldNetName(name)}`;
    const members = names.get(identity) ?? [];
    members.push(key);
    names.set(identity, members);
  };
  for (const terminal of document.netlist?.terminals ?? []) {
    for (const instanceId of terminal.interfaceInstanceIds)
      nameOwner(
        terminal.netId,
        terminal.name,
        endpointKey({ kind: "terminal", instanceId, pinName: "P" }),
      );
  }
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "name-claim") continue;
    const net = document.nets.find((n) => n.id === evidence.netId);
    if (!net) continue;
    if (evidence.owner.kind === "global-declaration") {
      for (const terminal of net.terminals)
        nameOwner(
          net.id,
          evidence.name,
          endpointKey({ kind: "terminal", ...terminal }),
        );
    } else if (evidence.owner.kind === "net-label") {
      const annotationId = evidence.owner.annotationId;
      const binding = context.netLabelBindingsByNetId
        .get(net.id)
        ?.find((b) => b.annotationId === annotationId);
      if (binding)
        nameOwner(net.id, evidence.name, endpointKey(binding.endpoint));
    } else {
      const objectId = evidence.owner.objectId;
      for (const terminal of net.terminals.filter(
        (t) => t.instanceId === objectId,
      ))
        nameOwner(
          net.id,
          evidence.name,
          endpointKey({ kind: "terminal", ...terminal }),
        );
      const binding = context.netLabelBindingsByNetId
        .get(net.id)
        ?.find((b) => b.annotationId === objectId);
      if (binding)
        nameOwner(net.id, evidence.name, endpointKey(binding.endpoint));
    }
  }
  for (const members of names.values()) expressed.join(members);
  const guides: RoutingGuide[] = [];
  const sourcesByCurrent = new Map<string, Set<string>>();
  for (const source of reference.nets) {
    const electrical = new Set<string>();
    let unbound = false;
    let scopeChanged = false;
    const components = new Map<
      string,
      Omit<RoutingGuidanceComponent, "nodes"> & { nodes: RoutingGuidanceNode[] }
    >();
    for (const terminal of source.terminals) {
      const instance = context.instancesById.get(terminal.instanceId);
      const pinName =
        "sourcePosition" in terminal
          ? instance?.importProvenance?.terminalMapping?.find(
              (m) => m.sourcePosition === terminal.sourcePosition,
            )?.pinName
          : terminal.pinName;
      if (
        !instance ||
        !pinName ||
        !resolver
          .resolve(instance.symbolId, instance.symbolVariantId)
          ?.definition.pins.some((p) => p.name === pinName)
      ) {
        issues.push({
          code: "IMPORT_REFERENCE_MISSING_ENDPOINT",
          sourceNetIds: [source.id],
          instanceIds: [terminal.instanceId],
          message: `Original ${source.name} endpoint ${terminal.instanceId} is missing or no longer mapped.`,
        });
        continue;
      }
      const endpoint: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName,
      };
      const key = endpointKey(endpoint);
      const netId = owner.get(key) ?? null;
      const logical = netId
        ? context.logicalNetResolution.byBaseNetId.get(netId)
        : undefined;
      unbound ||= netId === null;
      if (logical)
        scopeChanged ||=
          (logical.scope ?? "local") !== source.scope ||
          (source.scope === "global" &&
            foldNetName(logical.name ?? "") !== foldNetName(source.name));
      const electricalId = logical?.id ?? `unbound:${key}`;
      electrical.add(electricalId);
      const memberships =
        sourcesByCurrent.get(electricalId) ?? new Set<string>();
      memberships.add(source.id);
      sourcesByCurrent.set(electricalId, memberships);
      if (!instance.placement) {
        issues.push({
          code: "IMPORT_REFERENCE_UNPLACED",
          sourceNetIds: [source.id],
          instanceIds: [instance.id],
          message: `Original ${source.name} endpoint ${instance.reference ?? instance.id}.${pinName} is not placed.`,
        });
        continue;
      }
      if (!isVisibleEndpoint(document, resolver, endpoint, context)) continue;
      const point = resolveEndpointPoint(document, resolver, endpoint, context);
      if (!point) continue;
      const root = expressed.root(key);
      const component = components.get(root) ?? { id: root, netId, nodes: [] };
      // Each node keeps its actual Base Net; virtual naming can span several.
      component.nodes.push({ key, endpoint, point, priority: 1 });
      components.set(root, component);
    }
    if (scopeChanged)
      issues.push({
        code: "IMPORT_REFERENCE_SCOPE_CHANGED",
        sourceNetIds: [source.id],
        instanceIds: [],
        message: `Original ${source.scope} Net ${source.name} has a different current scope or global identity.`,
      });
    if (electrical.size > 1 || unbound)
      issues.push({
        code: "IMPORT_REFERENCE_OPEN",
        sourceNetIds: [source.id],
        instanceIds: [],
        message: unbound
          ? `Original Net ${source.name} has an electrically unbound endpoint.`
          : `Original Net ${source.name} is split across ${electrical.size} current electrical nodes.`,
      });
    const candidateGuides = deriveRoutingGuidance({
      netId: [...components.values()].find((c) => c.netId)?.netId ?? source.id,
      sourceNetId: source.id,
      components: [...components.values()],
    });
    guides.push(
      ...candidateGuides.map((guide) => ({
        ...guide,
        fromNetId: owner.get(endpointKey(guide.from)) ?? null,
        toNetId: owner.get(endpointKey(guide.to)) ?? null,
      })),
    );
  }
  for (const [current, sources] of sourcesByCurrent)
    if (sources.size > 1) {
      const original = reference.nets.filter((net) => sources.has(net.id));
      issues.push({
        code: "IMPORT_REFERENCE_SHORT",
        sourceNetIds: [...sources].sort(),
        instanceIds: [
          ...new Set(
            original.flatMap((net) => net.terminals.map((t) => t.instanceId)),
          ),
        ].filter((id) => context.instancesById.has(id)),
        message: `Current node ${context.logicalNetResolution.byId.get(current)?.name ?? "(unnamed)"} joins distinct original Nets [${original.map((net) => net.name).join(", ")}] (Cell-definition comparison).`,
      });
    }
  return { available: true, guides, issues };
}

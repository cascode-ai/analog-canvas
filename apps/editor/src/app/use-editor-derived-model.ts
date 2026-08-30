import { useMemo } from "react";

import {
  buildProjectSearchIndex,
  deriveCrossings,
  diagnoseProjectSnapshot,
  diagnoseVisualQuality,
  endpointKey,
  isMosBulkTerminal,
  isVisibleEndpoint,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  traceHierarchyNet,
} from "@icm/derived";
import type {
  Flightline,
  HierarchyFrame,
  ProjectConnectivityIndex,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import { analyzeDesignNetlist } from "@icm/netlist";
import type {
  CircuitProject,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { summarizeVisualDiagnostics } from "../features/selection/selection-inspector-details";
import {
  endpointNetId,
  type RouteGeometryRecord,
} from "../features/wiring/route-interaction-geometry";

export type RoutingGuidanceView = "focused" | "all" | "hidden";

export interface HighlightedNetOrigin {
  documentId: string;
  netId: string;
  hierarchyPath: readonly HierarchyFrame[];
  endpoint?: RouteEndpoint;
}

interface UseEditorDerivedModelOptions {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  projectConnectivityIndex: ProjectConnectivityIndex;
  documentStack: readonly HierarchyFrame[];
  highlightedNetOrigin: HighlightedNetOrigin | null;
  selectedHighlightNetId: string | null;
  selectedHighlightEndpoint: RouteEndpoint | undefined;
  searchQuery: string;
  routingGuidanceView: RoutingGuidanceView;
  wireSource: WireSource | null;
  bulkDrawInstanceId: string | null;
}

function hierarchyPathsMatch(
  left: readonly HierarchyFrame[],
  right: readonly HierarchyFrame[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (frame, index) =>
        frame.parentDocumentId === right[index]?.parentDocumentId &&
        frame.instanceId === right[index]?.instanceId &&
        frame.childDocumentId === right[index]?.childDocumentId,
    )
  );
}

export function displayedRoutingGuidance(
  flightlines: readonly Flightline[],
  view: RoutingGuidanceView,
  focusedNetIds: ReadonlySet<string>,
  highlightedNetId: string | null,
): readonly Flightline[] {
  if (view === "hidden") return [];
  const scoped =
    view === "focused" && focusedNetIds.size > 0
      ? flightlines.filter((flightline) =>
          [flightline.netId, flightline.fromNetId, flightline.toNetId].some(
            (netId) => focusedNetIds.has(netId),
          ),
        )
      : flightlines;
  return highlightedNetId
    ? scoped.filter(
        (flightline) =>
          ![
            flightline.netId,
            flightline.fromNetId,
            flightline.toNetId,
          ].includes(highlightedNetId),
      )
    : scoped;
}

function visibleWireSources(
  document: SchematicDocument,
  resolver: SymbolResolver,
): WireSource[] {
  return [
    ...document.instances.flatMap((instance) => {
      if (!instance.placement) return [];
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!resolved) return [];
      return resolved.definition.pins
        .filter((pin) =>
          isVisibleEndpoint(document, resolver, {
            kind: "terminal",
            instanceId: instance.id,
            pinName: pin.name,
          }),
        )
        .flatMap((pin): WireSource[] => {
          const endpoint: RouteEndpoint = {
            kind: "terminal",
            instanceId: instance.id,
            pinName: pin.name,
          };
          const connection = resolveEndpointConnection(
            document,
            resolver,
            endpoint,
          );
          return connection
            ? [
                {
                  endpoint,
                  connection,
                  netId: endpointNetId(document, endpoint),
                  preludeEdits: [],
                  ...(isMosBulkTerminal(document, endpoint)
                    ? { routePresentation: "bulk-dashed" as const }
                    : {}),
                },
              ]
            : [];
        });
    }),
    ...document.junctions
      .filter((junction) => {
        const role = junction.role ?? "branch";
        return role === "branch" || role === "route-anchor";
      })
      .flatMap((junction): WireSource[] => {
        const endpoint: RouteEndpoint = {
          kind: "junction",
          junctionId: junction.id,
        };
        const connection = resolveEndpointConnection(
          document,
          resolver,
          endpoint,
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
  ];
}

function visibleBulkWireSources(
  document: SchematicDocument,
  resolver: SymbolResolver,
  bulkDrawInstanceId: string | null,
): WireSource[] {
  return document.instances.flatMap((instance): WireSource[] => {
    if (!instance.placement || bulkDrawInstanceId !== instance.id) return [];
    const endpoint: RouteEndpoint = {
      kind: "terminal",
      instanceId: instance.id,
      pinName: "B",
    };
    const connection = resolveEndpointConnection(document, resolver, endpoint);
    return connection
      ? [
          {
            endpoint,
            connection,
            netId: endpointNetId(document, endpoint),
            preludeEdits: [],
            routePresentation: "bulk-dashed",
          },
        ]
      : [];
  });
}

/**
 * One revision-scoped read model for editor consumers. It owns no interaction
 * state and emits no edits; App supplies the current session focus only.
 */
export function useEditorDerivedModel({
  project,
  document,
  resolver,
  projectConnectivityIndex,
  documentStack,
  highlightedNetOrigin,
  selectedHighlightNetId,
  selectedHighlightEndpoint,
  searchQuery,
  routingGuidanceView,
  wireSource,
  bulkDrawInstanceId,
}: UseEditorDerivedModelOptions) {
  const documentConnectivity = projectConnectivityIndex.documents.get(
    document.id,
  );
  const logicalNets = useMemo(
    () => resolveDocumentLogicalNets(document),
    [document],
  );
  const routeGeometryRecords = useMemo(
    () =>
      document.routes.flatMap((route): RouteGeometryRecord[] => {
        const geometry = documentConnectivity?.routingGeometry.routes.get(
          route.id,
        );
        return geometry ? [{ route, geometry }] : [];
      }),
    [document, documentConnectivity],
  );
  const netlistAnalysis = useMemo(
    () => analyzeDesignNetlist(project),
    [project],
  );
  const highlightedTrace = useMemo(
    () =>
      highlightedNetOrigin
        ? traceHierarchyNet(
            projectConnectivityIndex,
            highlightedNetOrigin.documentId,
            highlightedNetOrigin.netId,
            highlightedNetOrigin.endpoint,
            highlightedNetOrigin.hierarchyPath,
          )
        : undefined,
    [highlightedNetOrigin, projectConnectivityIndex],
  );
  const highlightedNet = useMemo(
    () =>
      highlightedTrace?.highlights.find(
        (highlight) =>
          highlight.documentId === document.id &&
          hierarchyPathsMatch(highlight.hierarchyPath, documentStack),
      ),
    [document.id, documentStack, highlightedTrace],
  );
  const highlightedNetId = highlightedNet?.netId ?? null;
  const selectedHighlightIsActive = Boolean(
    selectedHighlightNetId &&
    highlightedNetOrigin?.documentId === document.id &&
    hierarchyPathsMatch(highlightedNetOrigin.hierarchyPath, documentStack) &&
    highlightedNetOrigin.netId === selectedHighlightNetId &&
    (!highlightedNetOrigin.endpoint ||
      (selectedHighlightEndpoint &&
        endpointKey(highlightedNetOrigin.endpoint) ===
          endpointKey(selectedHighlightEndpoint))),
  );
  const liveDiagnosticSnapshot = useMemo(
    () => diagnoseProjectSnapshot(project, resolver, projectConnectivityIndex),
    [project, projectConnectivityIndex, resolver],
  );
  const electricalDiagnostics = useMemo(
    () =>
      liveDiagnosticSnapshot.diagnostics.filter(
        (diagnostic) => diagnostic.domain === "erc",
      ),
    [liveDiagnosticSnapshot],
  );
  const projectSearchIndex = useMemo(
    () =>
      buildProjectSearchIndex(project, {
        connectivityIndex: projectConnectivityIndex,
      }),
    [project, projectConnectivityIndex],
  );
  const searchResults = useMemo(
    () => projectSearchIndex.search(searchQuery),
    [projectSearchIndex, searchQuery],
  );
  const flightlines = useMemo(
    () => [
      ...new Map(
        [...(documentConnectivity?.logicalNets.values() ?? [])]
          .flatMap((net) => net.routingGuidance)
          .map((line) => [line.id, line] as const),
      ).values(),
    ],
    [documentConnectivity],
  );
  const displayedFlightlines = useMemo(() => {
    const focusedNetIds = new Set(
      [wireSource?.netId, selectedHighlightNetId, highlightedNetId].filter(
        (netId): netId is string => netId !== null && netId !== undefined,
      ),
    );
    return displayedRoutingGuidance(
      flightlines,
      routingGuidanceView,
      focusedNetIds,
      highlightedNetId,
    );
  }, [
    flightlines,
    highlightedNetId,
    routingGuidanceView,
    selectedHighlightNetId,
    wireSource?.netId,
  ]);
  const crossings = useMemo(
    () =>
      deriveCrossings(
        document,
        resolver,
        documentConnectivity?.routingGeometry,
      ),
    [document, documentConnectivity, resolver],
  );
  const visualDiagnostics = useMemo(
    () =>
      diagnoseVisualQuality(document, resolver, {
        ...(documentConnectivity
          ? {
              routingGeometry: documentConnectivity.routingGeometry,
              contactEvidence: documentConnectivity.contactEvidence,
            }
          : {}),
      }),
    [document, documentConnectivity, resolver],
  );
  const visualDiagnosticSummary = useMemo(
    () => summarizeVisualDiagnostics(visualDiagnostics),
    [visualDiagnostics],
  );
  const visibleEndpoints = useMemo(
    () => visibleWireSources(document, resolver),
    [document, resolver],
  );
  const visibleBulkEndpoints = useMemo(
    () => visibleBulkWireSources(document, resolver, bulkDrawInstanceId),
    [bulkDrawInstanceId, document, resolver],
  );
  const wiringEndpoints = useMemo(() => {
    const byKey = new Map<string, WireSource>();
    for (const endpoint of [...visibleEndpoints, ...visibleBulkEndpoints]) {
      byKey.set(endpointKey(endpoint.endpoint), endpoint);
    }
    return [...byKey.values()];
  }, [visibleBulkEndpoints, visibleEndpoints]);
  const contactComponents = useMemo(
    () =>
      [...(documentConnectivity?.logicalNets.values() ?? [])].flatMap(
        (net) => net.routedComponents,
      ),
    [documentConnectivity],
  );

  return {
    projectConnectivityIndex,
    logicalNets,
    routeGeometryRecords,
    netlistAnalysis,
    highlightedTrace,
    highlightedNet,
    highlightedNetId,
    selectedHighlightIsActive,
    liveDiagnosticSnapshot,
    electricalDiagnostics,
    searchResults,
    flightlines,
    displayedFlightlines,
    crossings,
    visualDiagnostics,
    visualDiagnosticSummary,
    visibleEndpoints,
    wiringEndpoints,
    contactComponents,
  };
}

import { createRoutePath } from "@icm/model";
import type { WireSource } from "@icm/edit-engine";
import {
  resolveDocumentRoutingGeometry,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorCanvasHitLayer } from "./editor-canvas-hit-layer";

function emptyEndpointProps(document = createEmptyDocument("cell", "Cell")) {
  return {
    document,
    endpoints: [] as WireSource[],
    tool: "pointer" as const,
    selectedRoute: undefined,
    selectedRouteSegmentIndex: null,
    selectedEndpoint: null,
    supplementalJunctionIds: [],
    endpointLabel: vi.fn(),
    endpointHitRadius: 6,
    onEndpointActions: vi.fn(),
    onRouteStretch: vi.fn(),
    onJunctionSelect: vi.fn(),
    onWireEndpoint: vi.fn(),
  };
}

function emptySelectionProps(document = createEmptyDocument("cell", "Cell")) {
  return {
    document,
    resolver: new InMemorySymbolResolver(builtInSymbols),
    routeGeometryRecords: [],
    styleProfile: resolveDocumentStyleProfile(document.presentation),
    tool: "pointer" as const,
    selectedInstanceIds: [],
    selectedRouteId: null,
    supplementalRouteIds: [],
    selectedInternalRouteIds: new Set<string>(),
    selectedAnnotationId: null,
    supplementalAnnotationIds: [],
    cellSymbolLayoutInstanceId: null,
    wouldMoveIds: new Set<string>(),
    onInstanceClick: vi.fn(),
    onInstanceOpen: vi.fn(),
    onInstancePointerDown: vi.fn(),
    onInstanceContextMenu: vi.fn(),
    onRoutePointerDown: vi.fn(),
    onAnnotationPointerDown: vi.fn(),
    onAnnotationContextMenu: vi.fn(),
    onAnnotationEdit: vi.fn(),
  };
}

describe("editor canvas hit layer", () => {
  it("renders a selected route from resolved geometry", () => {
    const document = createEmptyDocument("cell", "Cell");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "a", netId: "net", position: { x: 0, y: 0 }, role: "route-anchor" },
      {
        id: "b",
        netId: "net",
        position: { x: 40, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route",
        netId: "net",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const selection = emptySelectionProps(document);
    const geometry = resolveDocumentRoutingGeometry(
      document,
      selection.resolver,
    ).routes.get("route")!;
    const markup = renderToStaticMarkup(
      <EditorCanvasHitLayer
        selection={{
          ...selection,
          routeGeometryRecords: [{ route: document.routes[0]!, geometry }],
          selectedRouteId: "route",
        }}
        endpoints={emptyEndpointProps(document)}
      />,
    );
    expect(markup).toContain('data-testid="route-hit-route"');
    expect(markup).toContain('class="route-hit selected"');
  });

  it("marks the selected junction endpoint active", () => {
    const document = createEmptyDocument("cell", "Cell");
    const endpoint = { kind: "junction" as const, junctionId: "j1" };
    const source: WireSource = {
      endpoint,
      netId: "net",
      connection: {
        endpoint,
        contactPoint: { x: 10, y: 20 },
        gridLanding: { x: 10, y: 20 },
        escapePath: [],
        outward: null,
      },
      preludeEdits: [],
    };
    const markup = renderToStaticMarkup(
      <EditorCanvasHitLayer
        selection={emptySelectionProps(document)}
        endpoints={{
          ...emptyEndpointProps(document),
          endpoints: [source],
          selectedEndpoint: source,
          endpointLabel: () => "junction-j1",
        }}
      />,
    );
    expect(markup).toContain('data-testid="junction-j1"');
    expect(markup).toContain('class="endpoint-hit active"');
  });

  it("keeps endpoints between routes and annotations in hit order", () => {
    const document = createEmptyDocument("cell", "Cell");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "a", netId: "net", position: { x: 0, y: 0 }, role: "route-anchor" },
      {
        id: "b",
        netId: "net",
        position: { x: 40, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route",
        netId: "net",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.annotations.push({
      id: "note",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_1" }] },
      anchor: {
        kind: "route",
        routeId: "route",
        legId: document.routes[0]!.legs[0]!.id,
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 20, y: -14 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const selection = emptySelectionProps(document);
    const geometry = resolveDocumentRoutingGeometry(
      document,
      selection.resolver,
    ).routes.get("route")!;
    const endpoint = { kind: "junction" as const, junctionId: "a" };
    const source: WireSource = {
      endpoint,
      netId: "net",
      connection: {
        endpoint,
        contactPoint: { x: 0, y: 0 },
        gridLanding: { x: 0, y: 0 },
        escapePath: [],
        outward: null,
      },
      preludeEdits: [],
    };
    const markup = renderToStaticMarkup(
      <EditorCanvasHitLayer
        selection={{
          ...selection,
          routeGeometryRecords: [{ route: document.routes[0]!, geometry }],
        }}
        endpoints={{
          ...emptyEndpointProps(document),
          endpoints: [source],
          endpointLabel: () => "junction-a",
        }}
      />,
    );
    expect(markup.indexOf('data-testid="route-hit-route"')).toBeLessThan(
      markup.indexOf('data-testid="junction-a"'),
    );
    expect(markup.indexOf('data-testid="junction-a"')).toBeLessThan(
      markup.indexOf('data-testid="annotation-hit-note"'),
    );
  });
});

describe("endpoint hit targets at any zoom", () => {
  it("draws the hit circle at the radius the view asks for", () => {
    // Zoomed out, the caller passes a larger document radius so the target
    // keeps its size on screen; the layer must use it verbatim.
    const document = createEmptyDocument("cell", "Cell");
    const markup = renderToStaticMarkup(
      <EditorCanvasHitLayer
        selection={emptySelectionProps(document)}
        endpoints={{
          ...emptyEndpointProps(document),
          endpoints: [
            {
              endpoint: { kind: "junction", junctionId: "j1" },
              netId: "net-1",
              connection: { contactPoint: { x: 10, y: 20 } },
              preludeEdits: [],
            } as unknown as WireSource,
          ],
          endpointLabel: () => "endpoint-j1",
          endpointHitRadius: 12,
        }}
      />,
    );
    expect(markup).toContain('r="12"');
  });
});

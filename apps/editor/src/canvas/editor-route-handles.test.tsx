import { createRoutePath } from "@icm/model";
import { resolveRouteGeometry } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorRouteHandles } from "./editor-route-handles";

describe("editor route handles", () => {
  it("centers the selected loose-route handle on its route", () => {
    const document = createEmptyDocument("cell", "Cell");
    document.nets.push({ id: "net-1", terminals: [] });
    document.junctions.push(
      {
        id: "j1",
        netId: "net-1",
        position: { x: 0, y: 20 },
        role: "route-anchor",
      },
      {
        id: "j2",
        netId: "net-1",
        position: { x: 100, y: 20 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-1",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const route = document.routes[0]!;
    const geometry = resolveRouteGeometry(
      document,
      new InMemorySymbolResolver(builtInSymbols),
      route,
    );
    if (!geometry) throw new Error("Fixture route must resolve");

    const markup = renderToStaticMarkup(
      <svg>
        <EditorRouteHandles
          document={document}
          routeGeometryRecords={[{ route, geometry }]}
          selectedRouteId={route.id}
          selectedRouteSegmentIndex={0}
          routeStretchPreview={null}
          tool="pointer"
          onHandlePointerDown={vi.fn()}
        />
      </svg>,
    );

    expect(markup).toContain('data-testid="route-handle-route-1"');
    expect(markup).toContain(
      'data-testid="route-endpoint-handle-route-1-start"',
    );
    expect(markup).toContain('data-testid="route-endpoint-handle-route-1-end"');
    expect(markup).toContain('cx="50"');
    expect(markup).toContain('cy="20.5"');
  });

  it("offers a resize grip on an end anchored to a pin", () => {
    // Re-pointing an existing wire is an ordinary edit. While a pin-anchored
    // end had no grip, the only way to rewire one was to delete the wire and
    // draw it again.
    const document = createEmptyDocument("cell", "Cell");
    document.presentation.grid = 10;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    } as (typeof document)["instances"][number]);
    document.nets.push({
      id: "net-1",
      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });
    document.junctions.push({
      id: "j2",
      netId: "net-1",
      position: { x: 100, y: 20 },
      role: "route-anchor",
    });
    document.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-1",
        start: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const route = document.routes[0]!;
    const geometry = resolveRouteGeometry(
      document,
      new InMemorySymbolResolver(builtInSymbols),
      route,
    );
    if (!geometry) throw new Error("Fixture route must resolve");

    const markup = renderToStaticMarkup(
      <svg>
        <EditorRouteHandles
          document={document}
          routeGeometryRecords={[{ route, geometry }]}
          selectedRouteId={route.id}
          selectedRouteSegmentIndex={0}
          routeStretchPreview={null}
          tool="pointer"
          onHandlePointerDown={vi.fn()}
        />
      </svg>,
    );

    expect(markup).toContain(
      'data-testid="route-endpoint-handle-route-1-start"',
    );
    expect(markup).toContain('data-testid="route-endpoint-handle-route-1-end"');
    // The pin's own contact point, so the grip sits exactly on the wire end.
    expect(markup).toContain('cx="0" cy="20"');
  });
});

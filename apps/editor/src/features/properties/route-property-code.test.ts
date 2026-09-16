import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  createRoutePath,
  type Annotation,
} from "@icm/model";

import {
  parseRoutePropertyCode,
  routePropertyCodeAdapter,
  routePropertyCodeValue,
  serializeRoutePropertyCode,
} from "./route-property-code";

function fixture(scope: "local" | "global" = "local") {
  const document = createEmptyDocument("doc", "Route");
  document.nets.push({ id: "net-1", terminals: [] });
  document.junctions.push(
    {
      id: "j1",
      netId: "net-1",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "j2",
      netId: "net-1",
      position: { x: 100, y: 0 },
      role: "route-anchor",
    },
  );
  const route = createRoutePath({
    id: "route-1",
    netId: "net-1",
    start: { kind: "junction", junctionId: "j1" },
    end: { kind: "junction", junctionId: "j2" },
    bends: [],
    modes: ["manual"],
  });
  document.routes.push(route);
  const netLabel: Annotation = {
    id: "net-label-route-1",
    kind: "net-label",
    netId: "net-1",
    binding: { kind: "net-name", netId: "net-1" },
    anchor: { kind: "free", position: { x: 50, y: -8 } },
    alignment: "middle",
    rotation: 0,
    locked: false,
    content: { runs: [{ kind: "text", value: "OUT" }] },
  };
  document.annotations.push(netLabel);
  document.connectivityEvidence.push({
    id: "claim-1",
    kind: "name-claim",
    netId: "net-1",
    name: "OUT",
    scope,
    owner: { kind: "net-label", annotationId: netLabel.id },
  });
  return { document, route, netLabel };
}

describe("Route property code", () => {
  it("projects an unnamed default Route as compact JSON", () => {
    const { document, route } = fixture();
    const value = routePropertyCodeValue(document, route, null);
    expect(value).toEqual({
      net: { name: "", scope: "local" },
      appearance: {
        color: "auto",
        lineStyle: "solid",
        directionArrow: "none",
      },
    });
    expect(serializeRoutePropertyCode(value)).toContain('"name": ""');
  });

  it("projects authored name, global scope, color, dash and arrow", () => {
    const { document, route, netLabel } = fixture("global");
    route.styleOverride = {
      color: "#123456",
      lineStyle: "dashed",
      arrow: "middle",
    };
    expect(routePropertyCodeValue(document, route, netLabel)).toEqual({
      net: { name: "OUT", scope: "global" },
      appearance: {
        color: "#123456",
        lineStyle: "dashed",
        directionArrow: "middle",
      },
    });
  });

  it("rejects invalid JSON and unsupported Route values", () => {
    expect(parseRoutePropertyCode("{").ok).toBe(false);
    expect(
      parseRoutePropertyCode(
        JSON.stringify({
          net: { name: "OUT", scope: "project" },
          appearance: {
            color: "auto",
            lineStyle: "solid",
            directionArrow: "none",
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("offers safe inline changes for the enumerated fields", () => {
    const { document, route, netLabel } = fixture();
    const source = serializeRoutePropertyCode(
      routePropertyCodeValue(document, route, netLabel),
    );
    const adapter = routePropertyCodeAdapter();
    expect(adapter.spans(source).map((span) => span.field.path)).toEqual(
      expect.arrayContaining([
        "net.scope",
        "appearance.color",
        "appearance.lineStyle",
        "appearance.directionArrow",
      ]),
    );
    const changes = adapter.changes(source, {
      "net.scope": "global",
      "appearance.lineStyle": "dotted",
    });
    let changed = source;
    for (const change of [...changes].reverse())
      changed =
        changed.slice(0, change.from) +
        change.insert +
        changed.slice(change.to);
    expect(parseRoutePropertyCode(changed)).toMatchObject({
      ok: true,
      value: {
        net: { scope: "global" },
        appearance: { lineStyle: "dotted" },
      },
    });
  });
});

import {
  createEmptyDocument,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import { resolveEndpointConnection } from "@icm/derived";
import {
  compileWireDraft,
  type WireDraftStep,
  type WireSource,
} from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { automaticWireDraftSteps } from "./automatic-wire-routing";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function instance(
  document: SchematicDocument,
  id: string,
  symbolId: string,
  position: Point,
): void {
  document.instances.push({
    id,
    symbolId,
    placement: { position, rotation: 0, mirror: "none" },
  });
}

function source(
  document: SchematicDocument,
  instanceId: string,
  pinName: string,
): WireSource {
  const endpoint: RouteEndpoint = { kind: "terminal", instanceId, pinName };
  const connection = resolveEndpointConnection(document, resolver, endpoint);
  if (!connection) throw new Error(`Cannot resolve ${instanceId}.${pinName}`);
  return { endpoint, connection, netId: null, preludeEdits: [] };
}

function junctionSource(point: Point, suffix: string): WireSource {
  return {
    endpoint: { kind: "junction", junctionId: `J-${suffix}` },
    connection: {
      endpoint: { kind: "junction", junctionId: `J-${suffix}` },
      contactPoint: point,
      gridLanding: point,
      escapePath: [],
      outward: null,
    },
    netId: null,
    preludeEdits: [],
  };
}

function blockedDocument(blockerY: number): SchematicDocument {
  const document = createEmptyDocument("main", "Main");
  instance(document, "M1", "nmos", { x: 200, y: 200 });
  instance(document, "M2", "nmos", { x: 600, y: 400 });
  instance(document, "R1", "resistor", { x: 400, y: blockerY });
  return document;
}

describe("automatic orthogonal wire routing", () => {
  it("chooses the other simple corner when the default crosses a symbol", () => {
    const document = blockedDocument(200);
    const steps = automaticWireDraftSteps(
      document,
      resolver,
      source(document, "M1", "G"),
      source(document, "M2", "G"),
      [],
      "orthogonal",
      "auto",
    );

    expect(steps.map(({ point }) => point)).toEqual([
      { x: 170, y: 200 },
      { x: 170, y: 400 },
      { x: 570, y: 400 },
    ]);
  });

  it("keeps a straight pass through a visible pin as an electrical contact", () => {
    const document = createEmptyDocument("main", "Main");
    instance(document, "R1", "resistor", { x: 400, y: 180 });
    expect(
      automaticWireDraftSteps(
        document,
        resolver,
        junctionSource({ x: 200, y: 200 }, "from"),
        junctionSource({ x: 600, y: 200 }, "to"),
        [],
        "orthogonal",
        "auto",
      ),
    ).toEqual([]);
  });

  it.each([
    ["D", { x: 400, y: 500 }],
    ["G", { x: 400, y: 400 }],
    ["S", { x: 400, y: 300 }],
    ["B", { x: 400, y: 400 }],
  ] as const)(
    "approaches the %s terminal from outside its symbol",
    (pin, point) => {
      const document = createEmptyDocument("main", "Main");
      instance(document, "M1", "nmos", { x: 600, y: 400 });
      const from = junctionSource(point, `to-${pin}`);
      const to = source(document, "M1", pin);
      const steps = automaticWireDraftSteps(
        document,
        resolver,
        from,
        to,
        [],
        "orthogonal",
        "auto",
      );
      const points = compileWireDraft(
        from,
        to,
        steps,
        "orthogonal",
        "auto",
      ).points;
      const terminal = points.at(-1)!;
      const beforeTerminal = points.at(-2)!;
      const outward = to.connection.outward!;

      expect(
        (beforeTerminal.x - terminal.x) * outward.x +
          (beforeTerminal.y - terminal.y) * outward.y,
      ).toBeGreaterThan(0);
    },
  );

  it("leaves a bottom terminal outward before choosing the remaining route", () => {
    const document = createEmptyDocument("main", "Main");
    instance(document, "M1", "nmos", { x: 600, y: 400 });
    const from = source(document, "M1", "S");
    const to = junctionSource({ x: 400, y: 300 }, "from-source");
    const steps = automaticWireDraftSteps(
      document,
      resolver,
      from,
      to,
      [],
      "orthogonal",
      "auto",
    );
    const points = compileWireDraft(
      from,
      to,
      steps,
      "orthogonal",
      "auto",
    ).points;
    const terminal = points[0]!;
    const afterTerminal = points[1]!;
    const outward = from.connection.outward!;

    expect(
      (afterTerminal.x - terminal.x) * outward.x +
        (afterTerminal.y - terminal.y) * outward.y,
    ).toBeGreaterThan(0);
  });

  it("never changes a point or corner mode the user chose", () => {
    const document = blockedDocument(200);
    const authored: WireDraftStep[] = [
      {
        point: { x: 300, y: 320 },
        routingMode: "orthogonal",
        cornerOrder: "horizontal-first",
      },
    ];
    expect(
      automaticWireDraftSteps(
        document,
        resolver,
        source(document, "M1", "G"),
        source(document, "M2", "G"),
        authored,
        "orthogonal",
        "auto",
      ),
    ).toBe(authored);
  });
});

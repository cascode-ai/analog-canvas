import {
  createEmptyDocument,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import { resolveEndpointConnection } from "@icm/derived";
import type { WireDraftStep, WireSource } from "@icm/edit-engine";
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

    expect(steps.map(({ point }) => point)).toEqual([{ x: 180, y: 400 }]);
  });

  it("keeps a straight pass through a visible pin as an electrical contact", () => {
    const document = blockedDocument(180);
    expect(
      automaticWireDraftSteps(
        document,
        resolver,
        source(document, "M1", "G"),
        source(document, "M2", "G"),
        [],
        "orthogonal",
        "auto",
      ),
    ).toEqual([]);
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

import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { deriveNetConnectivityContext } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { createRouteClearance } from "./route-clearance.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function clearance(document: SchematicDocument) {
  return createRouteClearance(
    document,
    resolver,
    deriveNetConnectivityContext(document, resolver),
    { logicalIds: new Set(), endpointKeys: new Set() },
  );
}

describe("route clearance", () => {
  // M1 draws no body pin at (120, 100), nor M2 at (180, 100): the
  // 3-terminal variant hides B and its lead.
  const pair = () => {
    const document = createEmptyDocument("doc", "Pair");
    document.instances = [
      { id: "M1", x: 100, mirror: "none" as const },
      { id: "M2", x: 200, mirror: "horizontal" as const },
    ].map(({ id, x, mirror }) => ({
      id,
      reference: id,
      symbolId: "pmos",
      symbolVariantId: "textbook-3terminal",
      placement: { position: { x, y: 100 }, rotation: 0, mirror },
    }));
    return document;
  };

  it("lets a wire pass where a 3-terminal MOS hides its body pin", () => {
    const check = clearance(pair());
    expect(
      check.conflict(
        [
          { x: 114, y: 100 },
          { x: 186, y: 100 },
        ],
        [undefined, undefined],
      ),
    ).toBeNull();
    expect(
      check.conflict(
        [
          { x: 90, y: 100 },
          { x: 186, y: 100 },
        ],
        [undefined, undefined],
      ),
    ).toMatch(/^passes through M1 /u);
  });

  it("names where a path crosses another Net's wire, not where it ends on one", () => {
    const document = pair();
    document.nets = [{ id: "A", terminals: [] }];
    document.junctions = [
      { id: "J1", netId: "A", position: { x: 150, y: 0 } },
      { id: "J2", netId: "A", position: { x: 150, y: 200 } },
    ];
    document.routes = [
      createRoutePath({
        id: "wire",
        netId: "A",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["auto"],
      }),
    ];
    expect(
      clearance(document).crossings([
        { x: 120, y: 100 },
        { x: 180, y: 100 },
      ]),
    ).toEqual([{ routeId: "wire", net: "A", point: { x: 150, y: 100 } }]);
  });
});

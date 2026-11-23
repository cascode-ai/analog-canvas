import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { routingEndpointLookup } from "./route-path-read.js";
import { validateRoute } from "./transaction-routing.js";

it("validates a phase of scalar routes with bounded net reads", () => {
  const document = createEmptyDocument("sheet", "Sheet");
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  let netReads = 0;
  for (let i = 0; i < 32; i++) {
    const netId = "net-" + i;
    document.nets.push({
      get id() {
        netReads++;
        return netId;
      },
      terminals: [],
    });
    const start = { kind: "junction" as const, junctionId: "left-" + i };
    const end = { kind: "junction" as const, junctionId: "right-" + i };
    document.junctions.push(
      { id: start.junctionId, netId, position: { x: 0, y: 10 * i } },
      { id: end.junctionId, netId, position: { x: 20, y: 10 * i } },
    );
    document.routes.push(
      createRoutePath({
        id: "route-" + i,
        netId,
        start,
        end,
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  const lookup = routingEndpointLookup(document);
  netReads = 0;
  for (const route of document.routes) {
    expect(
      validateRoute(document, route, resolver, undefined, "committed", lookup),
    ).toBeNull();
  }
  expect(netReads).toBeLessThanOrEqual(6 * document.nets.length);
});

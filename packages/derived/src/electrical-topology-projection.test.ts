import {
  createEmptyDocument,
  createRoutePath,
  freezeSnapshot,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { deriveElectricalTopologyProjection } from "./electrical-topology-projection.js";
import { buildDocumentDerivedContext } from "./document-derived-context.js";

describe("electrical topology projection", () => {
  it("shares owned contact facts across independently constructed equivalent symbol resolvers", () => {
    const document = createEmptyDocument("shared", "Shared");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    freezeSnapshot(document);
    const first = buildDocumentDerivedContext(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );
    const second = buildDocumentDerivedContext(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );
    expect(second.contactEvidence).toBe(first.contactEvidence);
    expect(second.routingGeometry).toBe(first.routingGeometry);
  });

  it("refreshes contact facts after a mutable draft changes without a revision", () => {
    const document = createEmptyDocument("draft", "Draft");
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net", position: { x: 0, y: 0 } },
    );
    const first = deriveElectricalTopologyProjection(document, resolver);
    expect(first.endpointToPhysicalComponent.get("junction:J1")).toBe(
      first.endpointToPhysicalComponent.get("junction:J2"),
    );
    document.junctions[1]!.position.x = 100;
    const changed = deriveElectricalTopologyProjection(document, resolver);
    expect(changed.endpointToPhysicalComponent.get("junction:J1")).not.toBe(
      changed.endpointToPhysicalComponent.get("junction:J2"),
    );
  });

  it("refreshes owned-document contacts when the same resolver changes pin geometry", () => {
    const document = createEmptyDocument("resolver", "Resolver");
    const resistor = builtInSymbols.find((symbol) => symbol.id === "resistor")!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "net",
      terminals: [{ instanceId: "R1", pinName: "1" }],
    });
    document.junctions.push({
      id: "J1",
      netId: "net",
      position: { ...resistor.pins[0]!.at },
    });
    freezeSnapshot(document);
    let catalog = new InMemorySymbolResolver([resistor]);
    const resolver = {
      resolve: (id: string, variant?: string) => catalog.resolve(id, variant),
    };
    const first = deriveElectricalTopologyProjection(document, resolver);
    expect(first.endpointToPhysicalComponent.get("junction:J1")).toBe(
      first.endpointToPhysicalComponent.get("terminal:R1:1"),
    );
    const moved = structuredClone(resistor);
    moved.pins[0]!.at.x += 100;
    delete moved.pins[0]!.routing;
    catalog = new InMemorySymbolResolver([moved]);
    const changed = deriveElectricalTopologyProjection(document, resolver);
    expect(changed.endpointToPhysicalComponent.get("junction:J1")).not.toBe(
      changed.endpointToPhysicalComponent.get("terminal:R1:1"),
    );
  });

  it("derives Net, physical component, naming, Route and Junction facts", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-a", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net-a", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net-a", position: { x: 100, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "route-a",
        netId: "net-a",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.connectivityEvidence.push({
      id: "claim-a",
      kind: "name-claim",
      netId: "net-a",
      name: "VOUT",
      owner: { kind: "net-label", annotationId: "label-a" },
      scope: "local",
    });

    const projection = deriveElectricalTopologyProjection(document);
    expect(projection.endpointToBaseNet).toEqual(
      new Map([
        ["junction:J1", "net-a"],
        ["junction:J2", "net-a"],
      ]),
    );
    expect(projection.endpointToPhysicalComponent.get("junction:J1")).toBe(
      projection.endpointToPhysicalComponent.get("junction:J2"),
    );
    expect(projection.routeIncidence.get("route-a")).toEqual([
      "junction:J1",
      "junction:J2",
    ]);
    expect(projection.junctionIncidence.get("J1")).toEqual(["route-a"]);
    expect(projection.nameClaimsByOwner.get("net-label:label-a")).toMatchObject(
      { netId: "net-a", name: "VOUT", scope: "local" },
    );
  });
});

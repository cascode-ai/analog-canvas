import { createEmptyDocument, createRoutePath, routeEnd } from "@icm/model";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { EditTransactionSchema, executeTransaction } from "./transaction.js";
import { physicalContactLicenseForTransaction } from "./transaction-connectivity.js";
import { nextPhysicalContactOperation } from "./transaction-connectivity-normalizer.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function transaction(
  document: SchematicDocument,
  edits: unknown[],
  suffix = "edit",
) {
  return {
    transactionId: `contact-license-${suffix}-${document.revision}`,
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human" as const, id: "contact-license-test" },
    edits,
  };
}

/**
 * A conductor on net-1 from A.P (140,300) to B.P (460,300), with a foreign
 * Junction J2 (net-2) parked on its interior — visually coincident but
 * electrically separate, exactly like a Crossing. Every test then runs a
 * licensed contact elsewhere on the conductor and asserts J2 stays foreign.
 */
function fixture(options: {
  keepInstances: readonly string[];
  parkedJunctionX: number;
}): SchematicDocument {
  const document = parseProject(
    readFileSync(
      resolve(process.cwd(), "fixtures/projects/port-nets/project.icproj.json"),
      "utf8",
    ),
  ).documents[0]!;
  document.instances = document.instances.filter((instance) =>
    options.keepInstances.includes(instance.id),
  );
  const wireMembers = options.keepInstances.filter((id) =>
    ["A", "B", "E"].includes(id),
  );
  document.nets = [
    {
      id: "net-1",
      terminals: wireMembers.map((instanceId) => ({
        instanceId,
        pinName: "P",
      })),
    },
    { id: "net-2", terminals: [] },
  ];
  document.junctions = [
    {
      id: "J2",
      netId: "net-2",
      position: { x: options.parkedJunctionX, y: 300 },
    },
  ];
  document.netlist!.terminals = options.keepInstances
    .filter((id) => id !== "RX")
    .map((instanceId) => ({
      id: `cell-terminal-${instanceId.toLowerCase()}`,
      name: instanceId,
      netId: instanceId === "D" ? "net-3" : "net-1",
      direction: "passive" as const,
      interfaceInstanceIds: [instanceId],
    }));
  if (options.keepInstances.includes("D")) {
    document.nets.push({
      id: "net-3",
      terminals: [{ instanceId: "D", pinName: "P" }],
    });
    document.instances.find((instance) => instance.id === "D")!.placement = {
      position: { x: 240, y: 340 },
      rotation: 0,
      mirror: "none",
    };
  }
  if (options.keepInstances.includes("E")) {
    document.instances.find((instance) => instance.id === "E")!.placement = {
      position: { x: 250, y: 300 },
      rotation: 270,
      mirror: "none",
    };
  }
  document.connectivityEvidence = [];
  // Install the persisted baseline directly. Running a set_route_path
  // transaction here would itself be a Route-edit gesture and correctly bond
  // E when this fixture includes it, obscuring the typed-attach boundary the
  // tests below are meant to isolate.
  document.routes = [
    createRoutePath({
      id: "route-h",
      netId: "net-1",
      start: { kind: "terminal", instanceId: "A", pinName: "P" },
      end: { kind: "terminal", instanceId: "B", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  return document;
}

function attachEdit(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
  firstRouteId: string,
): unknown {
  const route = document.routes.find(
    (candidate) => candidate.id === "route-h",
  )!;
  return {
    kind: "attach_endpoint_to_route",
    endpoint,
    routeId: "route-h",
    point: { x: 250, y: 300 },
    legId: route.legs[0]!.id,
    firstRouteId,
    secondRouteId: "route-h-b",
  };
}

function junctionNetIds(document: SchematicDocument): Record<string, string> {
  return Object.fromEntries(
    document.junctions.map((junction) => [junction.id, junction.netId]),
  );
}

describe("physical contact license", () => {
  it("does no whole-Document contact search without an explicit license", () => {
    const document = fixture({
      keepInstances: ["A", "B"],
      parkedJunctionX: 250,
    });
    const move = transaction(document, [
      {
        kind: "move_instance",
        instanceId: "A",
        position: { x: 160, y: 300 },
      },
    ]);
    const license = physicalContactLicenseForTransaction(
      EditTransactionSchema.parse(move),
    );

    expect(license.objectIds.size).toBe(0);
    expect(license.endpointKeys.size).toBe(0);
    expect(license.routePoints.size).toBe(0);
    expect(license.routeGeometryPoints.size).toBe(0);
    expect(
      nextPhysicalContactOperation(document, resolver, license),
    ).toBeNull();
  });

  it("keeps a typed attach from bonding the rest of the conductor, regardless of split ID reuse", () => {
    const endpoint: RouteEndpoint = {
      kind: "terminal",
      instanceId: "E",
      pinName: "P",
    };
    // Same attach twice: once with a fresh first-half ID, once reusing the
    // original Route ID for the first half. The parked foreign Junction sits
    // on the first half either way; which ID string the caller picked must
    // not change the electrical outcome (audit finding #1).
    for (const firstRouteId of ["route-h-a", "route-h"]) {
      const document = fixture({
        keepInstances: ["A", "B", "E"],
        parkedJunctionX: 200,
      });
      const result = executeTransaction(
        document,
        transaction(
          document,
          [attachEdit(document, endpoint, firstRouteId)],
          firstRouteId,
        ),
        context,
      );
      if (!result.ok) throw new Error(result.error.message);
      expect(junctionNetIds(result.document)).toEqual({ J2: "net-2" });
      expect(result.document.nets.map((net) => net.id).sort()).toEqual([
        "net-1",
        "net-2",
      ]);
    }
  });

  it("does not license the split products of a Junction-forced split", () => {
    // Adding J1 on the interior licenses J1 alone; the split it forces must
    // not open the conductor's far half to the parked foreign Junction J2.
    const document = fixture({
      keepInstances: ["A", "B"],
      parkedJunctionX: 350,
    });
    const result = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "add_junction",
          junctionId: "J1",
          netId: "net-1",
          position: { x: 250, y: 300 },
        },
      ]),
      context,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(junctionNetIds(result.document)).toEqual({
      J1: "net-1",
      J2: "net-2",
    });
    expect(result.document.nets.map((net) => net.id).sort()).toEqual([
      "net-1",
      "net-2",
    ]);
  });

  it("does not retrofit a terminal that already rested on the Route", () => {
    const document = fixture({
      keepInstances: ["A", "B", "E"],
      parkedJunctionX: 200,
    });
    document.nets.find((net) => net.id === "net-1")!.terminals = document.nets
      .find((net) => net.id === "net-1")!
      .terminals.filter((terminal) => terminal.instanceId !== "E");
    document.nets.push({
      id: "net-3",
      terminals: [{ instanceId: "E", pinName: "P" }],
    });
    document.netlist!.terminals.find(
      (terminal) => terminal.interfaceInstanceIds[0] === "E",
    )!.netId = "net-3";
    const originalRoute = document.routes[0]!;
    const result = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: originalRoute.id,
            netId: originalRoute.netId,
            start: originalRoute.start,
            end: routeEnd(originalRoute),
            bends: [
              { x: 350, y: 300 },
              { x: 350, y: 320 },
              { x: 460, y: 320 },
            ],
            modes: ["manual", "manual", "manual", "manual"],
          }),
        },
      ]),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(
      result.document.nets.find((net) =>
        net.terminals.some((terminal) => terminal.instanceId === "E"),
      )?.id,
    ).toBe("net-3");
    expect(result.document.routes[0]?.netId).toBe("net-1");
  });

  it("does not turn a preserved corner overlap into a contact during group translation", () => {
    const document = createEmptyDocument(
      "translated-overlap",
      "Translated overlap",
    );
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 0, y: 20 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 200, y: 20 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-wire",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-wire",
        netId: "net-wire",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [{ x: 200, y: 40 }],
        modes: ["manual", "manual"],
      }),
    );
    const result = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "move_instance",
          instanceId: "R1",
          position: { x: 50, y: 70 },
        },
        {
          kind: "move_instance",
          instanceId: "R2",
          position: { x: 250, y: 70 },
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "route-wire",
            netId: "net-wire",
            start: { kind: "terminal", instanceId: "R1", pinName: "2" },
            end: { kind: "terminal", instanceId: "R2", pinName: "1" },
            bends: [{ x: 250, y: 90 }],
            modes: ["manual", "manual"],
          }),
        },
      ]),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes).toHaveLength(1);
    expect(result.document.nets[0]!.terminals).toEqual([
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
    ]);
  });

  it("licenses only the attached pin, not the instance's other pins", () => {
    // RX pin 1 attaches at (250,300); RX pin 2 is parked exactly on port D's
    // pin at (250,340). The attach names pin 1 only, so pin 2 must stay off
    // D's net.
    const document = fixture({
      keepInstances: ["A", "B", "D"],
      parkedJunctionX: 200,
    });
    document.instances.push({
      id: "RX",
      symbolId: "resistor",
      placement: {
        position: { x: 250, y: 320 },
        rotation: 0,
        mirror: "none",
      },
    });
    const result = executeTransaction(
      document,
      transaction(document, [
        attachEdit(
          document,
          { kind: "terminal", instanceId: "RX", pinName: "1" },
          "route-h-a",
        ),
      ]),
      context,
    );
    if (!result.ok) throw new Error(result.error.message);
    const netOf = (pinName: string) =>
      result.document.nets.find((net) =>
        net.terminals.some(
          (candidate) =>
            candidate.instanceId === "RX" && candidate.pinName === pinName,
        ),
      )?.id ?? null;
    expect(netOf("1")).toBe("net-1");
    expect(netOf("2")).toBeNull();
    expect(
      result.document.nets.find((net) => net.id === "net-3")!.terminals,
    ).toEqual([{ instanceId: "D", pinName: "P" }]);
  });
});

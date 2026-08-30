import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  endpointKey,
} from "@icm/derived";
import {
  createEmptyDocument,
  createRoutePath,
  routeEnd,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { normalizeSameNetConductorTopology } from "./conductor-topology.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function junction(
  id: string,
  x: number,
  y: number,
  role: "branch" | "route-anchor" = "route-anchor",
) {
  return { id, netId: "net-1", position: { x, y }, role } as const;
}

function endpoint(junctionId: string) {
  return { kind: "junction" as const, junctionId };
}

function route(
  id: string,
  start: string,
  end: string,
  bends: readonly { x: number; y: number }[] = [],
) {
  return createRoutePath({
    id,
    netId: "net-1",
    start: endpoint(start),
    end: endpoint(end),
    bends,
    modes: Array.from({ length: bends.length + 1 }, () => "manual" as const),
  });
}

function documentWith(
  junctions: SchematicDocument["junctions"],
  routes: SchematicDocument["routes"],
): SchematicDocument {
  const document = createEmptyDocument("main", "Main");
  document.nets.push({ id: "net-1", terminals: [] });
  document.junctions.push(...junctions);
  document.routes.push(...routes);
  return document;
}

describe("same-Net conductor topology normalization", () => {
  it("unions an overlapping branch path and materializes its missing T vertex", () => {
    const document = documentWith(
      [
        junction("left", 0, 0),
        junction("right", 100, 0),
        junction("top", 50, 50),
      ],
      [
        route("trunk", "left", "right"),
        route("overlapping-branch", "top", "right", [{ x: 50, y: 0 }]),
      ],
    );

    const result = normalizeSameNetConductorTopology(document, resolver);

    expect(result.changed).toBe(true);
    expect(document.routes).toHaveLength(3);
    const branch = document.junctions.find(
      (candidate) => candidate.position.x === 50 && candidate.position.y === 0,
    );
    expect(branch).toMatchObject({ netId: "net-1", role: "branch" });
    expect(
      document.routes.filter((candidate) =>
        [candidate.start, routeEnd(candidate)].some(
          (candidateEndpoint) =>
            candidateEndpoint.kind === "junction" &&
            candidateEndpoint.junctionId === branch?.id,
        ),
      ),
    ).toHaveLength(3);
    const contact = deriveDocumentContactEvidence(
      document,
      resolver,
    ).contacts.find(
      (candidate) => candidate.point.x === 50 && candidate.point.y === 0,
    );
    expect(contact && contactRequiresJunctionDot(contact)).toBe(true);
  });

  it("materializes a branch endpoint that lands on a Route interior", () => {
    const document = documentWith(
      [
        junction("left", 0, 0),
        junction("right", 100, 0),
        junction("top", 50, 50),
        junction("tap", 50, 0),
      ],
      [route("trunk", "left", "right"), route("branch", "top", "tap")],
    );

    normalizeSameNetConductorTopology(document, resolver);

    expect(document.routes).toHaveLength(3);
    expect(
      document.routes.filter((candidate) =>
        [candidate.start, routeEnd(candidate)].some(
          (candidateEndpoint) =>
            candidateEndpoint.kind === "junction" &&
            candidateEndpoint.junctionId === "tap",
        ),
      ),
    ).toHaveLength(3);
    const contact = deriveDocumentContactEvidence(
      document,
      resolver,
    ).contacts.find(
      (candidate) => candidate.point.x === 50 && candidate.point.y === 0,
    );
    expect(contact && contactRequiresJunctionDot(contact)).toBe(true);
  });

  it("does not connect a geometric crossing without an authored contact", () => {
    const document = documentWith(
      [
        junction("left", 0, 50),
        junction("right", 100, 50),
        junction("top", 50, 0),
        junction("bottom", 50, 100),
      ],
      [
        route("horizontal", "left", "right"),
        route("vertical", "top", "bottom"),
      ],
    );
    const before = structuredClone(document);

    const result = normalizeSameNetConductorTopology(document, resolver);

    expect(result.changed).toBe(false);
    expect(document).toEqual(before);
  });

  it("coalesces the two collinear survivors of a removed branch", () => {
    const document = documentWith(
      [
        junction("left", 0, 0),
        junction("middle", 50, 0, "branch"),
        junction("right", 100, 0),
      ],
      [
        route("left-arm", "left", "middle"),
        route("right-arm", "middle", "right"),
      ],
    );

    const result = normalizeSameNetConductorTopology(document, resolver);

    expect(result.changed).toBe(true);
    expect(document.routes).toHaveLength(1);
    expect(document.junctions.map((candidate) => candidate.id)).toEqual([
      "left",
      "right",
    ]);
    expect(
      new Set([
        endpointKey(document.routes[0]!.start),
        endpointKey(routeEnd(document.routes[0]!)),
      ]),
    ).toEqual(new Set(["junction:left", "junction:right"]));
  });

  it("deduplicates coincident Route coverage", () => {
    const document = documentWith(
      [junction("left", 0, 0), junction("right", 100, 0)],
      [route("first", "left", "right"), route("second", "left", "right")],
    );

    normalizeSameNetConductorTopology(document, resolver);

    expect(document.routes).toHaveLength(1);
    expect(document.routes[0]!.id).toBe("first");
  });

  it("retains deterministic per-wire styling when coverage is deduplicated", () => {
    const document = documentWith(
      [junction("left", 0, 0), junction("right", 100, 0)],
      [route("first", "left", "right"), route("second", "left", "right")],
    );
    document.routes[0]!.styleOverride = { color: "#123456" };
    document.routes[1]!.styleOverride = { color: "#ABCDEF" };

    normalizeSameNetConductorTopology(document, resolver);

    expect(document.routes).toHaveLength(1);
    expect(document.routes[0]).toMatchObject({
      id: "first",
      styleOverride: { color: "#123456" },
    });
  });

  it("does not union an ordinary wire with a MOS bulk presentation", () => {
    const document = documentWith(
      [junction("left", 0, 0), junction("right", 100, 0)],
      [route("wire", "left", "right"), route("bulk", "left", "right")],
    );
    document.routes[1]!.presentation = "bulk-dashed";
    const before = structuredClone(document);

    const result = normalizeSameNetConductorTopology(document, resolver);

    expect(result.changed).toBe(false);
    expect(document).toEqual(before);
  });

  it("remaps Route annotations and layout ownership onto the union", () => {
    const document = documentWith(
      [junction("left", 0, 0), junction("right", 100, 0)],
      [route("first", "left", "right"), route("second", "left", "right")],
    );
    document.annotations.push({
      id: "current",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I" }] },
      anchor: {
        kind: "route",
        routeId: "second",
        legId: document.routes[1]!.legs[0]!.id,
        t: 0.5,
        normalOffset: 0,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 50, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    document.layoutGroups.push({
      id: "group",
      kind: "custom",
      objectIds: ["second"],
      locked: false,
    });

    normalizeSameNetConductorTopology(document, resolver);

    expect(document.annotations[0]?.anchor).toMatchObject({
      kind: "route",
      routeId: "first",
    });
    expect(document.layoutGroups[0]?.objectIds).toEqual(["first"]);
  });

  it("retargets Route-owned Net evidence when a duplicate identity is removed", () => {
    const document = documentWith(
      [junction("left", 0, 0), junction("right", 100, 0)],
      [route("first", "left", "right"), route("second", "left", "right")],
    );
    document.connectivityEvidence.push({
      id: "wire-name",
      kind: "name-claim",
      netId: "net-1",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "second" },
    });

    normalizeSameNetConductorTopology(document, resolver);

    expect(document.connectivityEvidence[0]).toMatchObject({
      owner: { kind: "power-marker", objectId: "first" },
    });
  });

  it("leaves an already canonical three-arm Junction unchanged", () => {
    const document = documentWith(
      [
        junction("left", 0, 0),
        junction("middle", 50, 0, "branch"),
        junction("right", 100, 0),
        junction("top", 50, 50),
      ],
      [
        route("left-arm", "left", "middle"),
        route("right-arm", "middle", "right"),
        route("top-arm", "top", "middle"),
      ],
    );
    const before = structuredClone(document);

    const result = normalizeSameNetConductorTopology(document, resolver);

    expect(result.changed).toBe(false);
    expect(document).toEqual(before);
  });

  it("normalizes a newly authored overlapping Route in the transaction boundary", () => {
    const document = documentWith(
      [
        junction("left", 0, 0),
        junction("right", 100, 0),
        junction("top", 50, 50),
      ],
      [route("trunk", "left", "right")],
    );
    const overlapping = route("overlapping-branch", "top", "right", [
      { x: 50, y: 0 },
    ]);

    const result = executeTransaction(
      document,
      {
        transactionId: "normalize-new-overlap",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        dryRun: false,
        edits: [{ kind: "set_route_path", route: overlapping }],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toHaveLength(3);
    expect(
      result.document.junctions.some(
        (candidate) =>
          candidate.position.x === 50 && candidate.position.y === 0,
      ),
    ).toBe(true);
  });

  it("does not normalize a dirty but unrelated Net", () => {
    const document = documentWith(
      [
        junction("left", 0, 0),
        junction("middle", 50, 0, "branch"),
        junction("right", 100, 0),
      ],
      [
        route("left-arm", "left", "middle"),
        route("right-arm", "middle", "right"),
      ],
    );
    document.nets.push({ id: "net-2", terminals: [] });

    const result = executeTransaction(
      document,
      {
        transactionId: "unrelated-junction",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        dryRun: false,
        edits: [
          {
            kind: "add_junction",
            junctionId: "isolated",
            netId: "net-2",
            position: { x: 0, y: 100 },
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes.map((candidate) => candidate.id)).toEqual([
      "left-arm",
      "right-arm",
    ]);
    expect(result.document.junctions.map((candidate) => candidate.id)).toEqual([
      "left",
      "middle",
      "right",
      "isolated",
    ]);
  });

  it("coalesces the trunk after a branch Route is cut", () => {
    const document = documentWith(
      [
        junction("left", 0, 0),
        junction("middle", 50, 0, "branch"),
        junction("right", 100, 0),
        junction("top", 50, 50),
      ],
      [
        route("left-arm", "left", "middle"),
        route("right-arm", "middle", "right"),
        route("branch-arm", "middle", "top"),
      ],
    );

    const result = executeTransaction(
      document,
      {
        transactionId: "cut-and-coalesce",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        dryRun: false,
        edits: [{ kind: "cut_connection", routeId: "branch-arm" }],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toHaveLength(1);
    expect(result.document.junctions.some(({ id }) => id === "middle")).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  routeEndpoints,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction } from "./transaction.js";
import type { SchematicEdit } from "./edit-schema.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const pin = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "1",
});
function fixture() {
  const d = createEmptyDocument("rebuild", "Connectivity rebuild");
  for (const [id, x, y] of [
    ["a", 0, 0],
    ["b", 100, 0],
    ["c", 100, 100],
    ["d", 200, 100],
  ] as const) {
    d.instances.push({
      id,
      symbolId: "resistor",
      placement: { position: { x, y }, rotation: 0, mirror: "none" },
    });
  }
  return d;
}
function wire(
  id: string,
  from: string,
  to: string,
  netId = "hint",
): SchematicEdit {
  return {
    kind: "set_route_path",
    route: createRoutePath({
      id,
      netId,
      start: pin(from),
      end: pin(to),
      bends: [],
      modes: ["manual"],
    }),
  };
}
function commit(d: SchematicDocument, edits: SchematicEdit[]) {
  const r = executeTransaction(
    d,
    {
      transactionId: `edit-${d.revision}`,
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "human", id: "test" },
      edits,
    },
    { symbolResolver: resolver },
  );
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error(r.error.message);
  return r.document;
}
function groups(d: SchematicDocument) {
  return d.nets
    .map((n) =>
      n.terminals
        .map((p) => p.instanceId)
        .sort()
        .join(","),
    )
    .filter(Boolean)
    .sort();
}
describe("connectivity reconstructed from final wire topology", () => {
  it("adds an independent wire without repeatedly scanning every other Net's Routes", () => {
    const before = createEmptyDocument("many-nets", "Many Nets");
    for (let index = 0; index < 30; index++) {
      const netId = `net-${index}`;
      before.nets.push({ id: netId, terminals: [] });
      before.junctions.push(
        { id: `a-${index}`, netId, position: { x: 0, y: index * 100 } },
        { id: `b-${index}`, netId, position: { x: 100, y: index * 100 } },
      );
      before.routes.push(
        createRoutePath({
          id: `route-${index}`,
          netId,
          start: { kind: "junction", junctionId: `a-${index}` },
          end: { kind: "junction", junctionId: `b-${index}` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const originalFilter = Array.prototype.filter;
    let fullRouteSweeps = 0;
    Array.prototype.filter = function (
      this: unknown[],
      ...args: Parameters<typeof originalFilter>
    ) {
      const first = this[0] as { start?: unknown; legs?: unknown } | undefined;
      if (this.length >= 30 && first?.start && first.legs) fullRouteSweeps++;
      return originalFilter.apply(this, args);
    } as typeof originalFilter;
    let after: SchematicDocument;
    try {
      after = commit(before, [
        {
          kind: "add_junction",
          junctionId: "fresh-a",
          netId: "fresh",
          position: { x: 5000, y: 0 },
          createNet: true,
        },
        {
          kind: "add_junction",
          junctionId: "fresh-b",
          netId: "fresh",
          position: { x: 5100, y: 0 },
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "fresh-wire",
            netId: "fresh",
            start: { kind: "junction", junctionId: "fresh-a" },
            end: { kind: "junction", junctionId: "fresh-b" },
            bends: [],
            modes: ["manual"],
          }),
        },
      ]);
    } finally {
      Array.prototype.filter = originalFilter;
    }
    expect(after.routes.slice(0, 30)).toEqual(before.routes);
    expect(after.nets).toEqual([
      ...before.nets,
      { id: "fresh", terminals: [] },
    ]);
    expect(after.revision).toBe(before.revision + 1);
    expect(fullRouteSweeps).toBeLessThan(20);
  });
  it("repointing a wire detaches its old pin and connects the new one", () => {
    const before = commit(fixture(), [wire("ab", "a", "b")]);
    const after = commit(before, [wire("ab", "a", "c")]);
    expect(groups(after)).toEqual(["a,c", "b"]);
    expect(groups(before)).toEqual(["a,b"]);
  });
  it("keeps a replacement path regardless of cut/draw order", () => {
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
    ]);
    const cut: SchematicEdit = { kind: "cut_connection", routeId: "ab" };
    for (const edits of [
      [cut, wire("ac", "a", "c")],
      [wire("ac", "a", "c"), cut],
    ]) {
      const after = commit(before, edits);
      expect(groups(after)).toEqual(["a,b,c"]);
      expect(after.routes.map((r) => r.id).sort()).toEqual(["ac", "bc"]);
    }
  });
  it("cuts a bridge into separate networks, retaining alternate paths", () => {
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
      wire("cd", "c", "d"),
    ]);
    expect(
      groups(commit(before, [{ kind: "cut_connection", routeId: "bc" }])),
    ).toEqual(["a,b", "c,d"]);
  });
  it("cuts or only unroutes the same span without touching an independent conductor", () => {
    const document = fixture();
    document.instances[3]!.placement!.position = { x: 0, y: 100 };
    for (const [id, x] of [
      ["e", 0],
      ["f", 100],
    ] as const) {
      document.instances.push({
        id,
        symbolId: "resistor",
        placement: { position: { x, y: 300 }, rotation: 0, mirror: "none" },
      });
    }
    const initial = commit(document, [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
      wire("ef", "e", "f", "independent"),
    ]);
    const cut = { kind: "cut_connection", routeId: "bc" } as const;
    const split = commit(initial, [cut]);
    const unrouted = commit(initial, [
      { kind: "remove_route_geometry", routeId: "bc" },
    ]);
    expect(split.routes.map(({ id }) => id)).toEqual(
      unrouted.routes.map(({ id }) => id),
    );
    expect(groups(split)).toEqual(["a,b", "c", "e,f"]);
    expect(groups(unrouted)).toEqual(["a,b,c", "e,f"]);
    expect(split.routes.find(({ id }) => id === "ef")).toEqual(
      initial.routes.find(({ id }) => id === "ef"),
    );
    expect(split.nets.find(({ id }) => id === "independent")).toEqual(
      initial.nets.find(({ id }) => id === "independent"),
    );
    const ring = commit(initial, [wire("cd", "c", "d"), wire("da", "d", "a")]);
    expect(groups(commit(ring, [cut]))).toEqual(["a,b,c,d", "e,f"]);
  });
  it("names a split-off network from the revision, not the transaction ID", () => {
    // Planners preview a step under one transaction ID and commit it under
    // another; later steps must still find the Net this one creates.
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
      wire("cd", "c", "d"),
    ]);
    const cutUnder = (transactionId: string) => {
      const result = executeTransaction(
        before,
        {
          transactionId,
          documentId: before.id,
          expectedRevision: before.revision,
          actor: { kind: "human", id: "test" },
          edits: [{ kind: "cut_connection", routeId: "bc" }],
        },
        { symbolResolver: resolver },
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.document.nets.map((net) => net.id).sort();
    };
    const preview = cutUnder("preview-cut");
    expect(preview).toHaveLength(2);
    expect(cutUnder("commit-cut")).toEqual(preview);
  });
  it("keeps the same Net identities when a batch cuts two bridges in either order", () => {
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("bc", "b", "c"),
      wire("cd", "c", "d"),
    ]);
    const ab = { kind: "cut_connection", routeId: "ab" } as const;
    const cd = { kind: "cut_connection", routeId: "cd" } as const;
    const leftFirst = commit(before, [ab, cd]);
    const rightFirst = commit(before, [cd, ab]);
    expect(groups(leftFirst)).toEqual(["a", "b,c", "d"]);
    expect(leftFirst.nets).toEqual(rightFirst.nets);
    expect(leftFirst.routes).toEqual(rightFirst.routes);
  });
  it("does not treat a stale netId hint as an invisible wire", () => {
    expect(
      groups(commit(fixture(), [wire("ab", "a", "b"), wire("cd", "c", "d")])),
    ).toEqual(["a,b", "c,d"]);
  });

  it.each([false, true])(
    "cutting an uncommitted path never cuts its unrelated hint (existing Route %s)",
    (existing) => {
      const document = fixture();
      const before = commit(document, [
        {
          kind: "connect_endpoints",
          from: pin("c"),
          to: pin("d"),
          newNetId: "occupied",
        },
        ...(existing ? [wire("ab", "a", "b", "actual")] : []),
      ]);
      const final = commit(before, [
        {
          kind: "route_orthogonal",
          routeId: "ab",
          netId: "occupied",
          from: pin("a"),
          to: pin("b"),
        },
        { kind: "cut_connection", routeId: "ab" },
      ]);
      expect(final.nets.find(({ id }) => id === "occupied")).toEqual(
        before.nets.find(({ id }) => id === "occupied"),
      );
      expect(groups(final)).toEqual(existing ? ["a", "b", "c,d"] : ["c,d"]);
    },
  );

  it.each([false, true])(
    "keeps a newly authored connection after removing its geometry in the batch (existing Net %s)",
    (existing) => {
      const document = fixture();
      const before = existing
        ? commit(document, [
            {
              kind: "connect_endpoints",
              from: pin("a"),
              to: pin("c"),
              newNetId: "hint",
            },
          ])
        : document;
      const add = wire("ab", "a", "b");
      const remove: SchematicEdit = {
        kind: "remove_route_geometry",
        routeId: "ab",
      };
      const final = commit(before, [add, remove]);
      expect(final.routes).toEqual([]);
      expect(groups(final)).toEqual(existing ? ["a,b,c"] : ["a,b"]);
      expect(final.nets).toEqual(commit(commit(before, [add]), [remove]).nets);
    },
  );

  it("checks the final Route ends after successive repoints in a batch", () => {
    const document = fixture();
    document.instances[1]!.placement!.position = { x: -100, y: -200 };
    document.instances[2]!.placement!.position = { x: 100, y: -200 };
    const repoint = (to: string, x: number, y: number): SchematicEdit => ({
      kind: "set_route_path",
      route: createRoutePath({
        id: "ab",
        netId: "hint",
        start: pin("a"),
        end: pin(to),
        bends: [
          { x: 0, y },
          { x, y },
        ],
        modes: ["manual", "manual", "manual"],
      }),
    });
    const before = commit(document, [repoint("b", -100, -250)]);
    const final = commit(before, [
      repoint("c", 100, -320),
      repoint("d", 200, -80),
    ]);
    expect(groups(final)).toEqual(["a,d", "b"]);
    expect(routeEndpoints(final.routes[0]!)).toEqual([pin("a"), pin("d")]);
  });

  it.each(["ab", "replacement"])(
    "uses the final cut or unroute intent after restoring the conductor as %s",
    (routeId) => {
      const path = wire("ab", "a", "b");
      const before = commit(fixture(), [path]);
      const restored = wire(routeId, "a", "b");
      const disconnected = commit(before, [
        { kind: "remove_route_geometry", routeId: "ab" },
        restored,
        { kind: "cut_connection", routeId },
      ]);
      const connected = commit(before, [
        { kind: "cut_connection", routeId: "ab" },
        restored,
        { kind: "remove_route_geometry", routeId },
      ]);
      expect(disconnected.routes).toEqual(connected.routes);
      expect(groups(disconnected)).toEqual(["a", "b"]);
      expect(groups(connected)).toEqual(["a,b"]);
    },
  );

  it("cleans up newly created orphan ends of a cut even before the draft Nets merge", () => {
    const endpoint = (id: string) => ({
      kind: "junction" as const,
      junctionId: id,
    });
    const document = createEmptyDocument("rebuild", "Connectivity rebuild");
    const final = commit(document, [
      ...["left", "right"].map((id, index) => ({
        kind: "add_junction" as const,
        junctionId: id,
        netId: `${id}-net`,
        role: "route-anchor" as const,
        position: { x: index * 100, y: 0 },
        createNet: true,
      })),
      {
        kind: "set_route_path",
        route: createRoutePath({
          id: "span",
          netId: "left-net",
          start: endpoint("left"),
          end: endpoint("right"),
          bends: [],
          modes: ["manual"],
        }),
      },
      { kind: "cut_connection", routeId: "span" },
    ]);
    expect(final.routes).toEqual([]);
    expect(final.junctions).toEqual([]);
    expect(final.nets).toEqual([]);
  });

  it.each(["remove_route_geometry", "cut_connection"] as const)(
    "%s captures a Route split earlier in the same batch",
    (kind) => {
      const before = commit(fixture(), [wire("ab", "a", "b")]);
      const original = before.routes.find(({ id }) => id === "ab")!;
      const split: SchematicEdit = {
        kind: "add_junction",
        junctionId: "middle",
        netId: original.netId,
        position: { x: 50, y: -20 },
        split: {
          routeId: original.id,
          legId: original.legs[0]!.id,
          firstRouteId: "left",
          secondRouteId: "right",
        },
      };
      const remove: SchematicEdit = { kind, routeId: "left" };
      const inBatch = commit(before, [split, remove]);
      const separate = commit(commit(before, [split]), [remove]);
      expect(groups(inBatch)).toEqual(
        kind === "remove_route_geometry" ? ["a,b"] : ["a", "b"],
      );
      expect(groups(inBatch)).toEqual(groups(separate));
    },
  );

  it.each(["independent conductor", "empty Net"])(
    "keeps names with the new route when its hint belongs to an %s",
    (hintOwner) => {
      const empty = hintOwner === "empty Net";
      const initial = structuredClone(
        commit(fixture(), [
          wire("ab", "a", "b", empty ? "independent" : "occupied"),
        ]),
      );
      if (empty) initial.nets.push({ id: "occupied", terminals: [] });
      const path = wire("cd", "c", "d", "occupied");
      if (path.kind !== "set_route_path") throw new Error("Expected a path");
      const final = commit(initial, [
        path,
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "label",
            kind: "net-label",
            netId: "occupied",
            binding: { kind: "net-name", netId: "occupied" },
            anchor: {
              kind: "route",
              routeId: "cd",
              legId: path.route.legs[0]!.id,
              t: 0.5,
              normalOffset: 4,
              direction: "forward",
              orientation: "horizontal",
              fallbackPosition: { x: 150, y: 80 },
            },
            alignment: "middle",
            rotation: 0,
            locked: false,
          },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "signal-claim",
            kind: "name-claim",
            netId: "occupied",
            name: "SIGNAL",
            scope: "local",
            owner: { kind: "net-label", annotationId: "label" },
          },
        },
      ]);
      const route = final.routes.find(({ id }) => id === "cd")!;
      expect(groups(final)).toEqual(["a,b", "c,d"]);
      expect(route.netId).not.toBe("occupied");
      expect(final.annotations[0]).toMatchObject({
        netId: route.netId,
        binding: { kind: "net-name", netId: route.netId },
      });
      expect(final.connectivityEvidence[0]).toMatchObject({
        netId: route.netId,
      });
    },
  );

  it.each(["same Net", "independent Net", "explicit new Route"])(
    "keeps a property-only supply and label on the largest side after joining a %s",
    (contact) => {
      const alreadyConnected = contact === "same Net";
      const document = createEmptyDocument("rebuild", "Connectivity rebuild");
      for (const [id, x, y, rotation] of [
        ["a", 0, 0, 0],
        ["b", 100, 0, 0],
        ["c", 200, 0, 0],
        ["d", 320, 100, 270],
        ["e", 380, 100, 90],
        ["f", 350, 200, 0],
        ["g", 350, 300, 0],
      ] as const) {
        document.instances.push({
          id,
          symbolId: "resistor",
          placement: { position: { x, y }, rotation, mirror: "none" },
        });
      }
      document.instances.push({
        id: "amp",
        symbolId: "opamp",
        placement: {
          position: { x: 800, y: 800 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.nets.push({
        id: "a-signal",
        terminals: [{ instanceId: "amp", pinName: "IN+" }],
      });
      const path = (
        from: string,
        to: string,
        bends: Array<{ x: number; y: number }> = [],
        netId = "hint",
      ): SchematicEdit => ({
        kind: "set_route_path",
        route: createRoutePath({
          id: from + to,
          netId,
          start: pin(from),
          end: pin(to),
          bends,
          modes: [...bends.map(() => "manual" as const), "manual"],
        }),
      });
      const chain = commit(document, [
        path("a", "b"),
        path("b", "c"),
        path("c", "d", [{ x: 300, y: -20 }]),
        path("d", "e"),
        ...(alreadyConnected ? [path("e", "f", [{ x: 400, y: 180 }])] : []),
        path("f", "g", [], alreadyConnected ? "hint" : "independent"),
      ]);
      const before = commit(chain, [
        {
          kind: "set_property_terminal_net",
          instanceId: "amp",
          pinName: "VDD",
          netId: "hint",
        },
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "supply-label",
            kind: "net-label",
            netId: "hint",
            binding: { kind: "net-name", netId: "hint" },
            anchor: {
              kind: "object",
              objectId: "amp",
              localOffset: { x: 0, y: 0 },
              fallbackPosition: { x: 800, y: 800 },
            },
            alignment: "start",
            rotation: 0,
            locked: false,
            visible: false,
          },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "supply-name",
            kind: "name-claim",
            netId: "hint",
            name: "AVDD",
            scope: "local",
            owner: { kind: "net-label", annotationId: "supply-label" },
          },
        },
      ]);
      const final = commit(before, [
        { kind: "cut_connection", routeId: "cd" },
        ...(alreadyConnected
          ? [{ kind: "cut_connection" as const, routeId: "ef" }]
          : []),
        contact === "explicit new Route"
          ? path("e", "f", [{ x: 400, y: 180 }])
          : path("d", "e", [
              { x: 300, y: 180 },
              { x: 400, y: 180 },
            ]),
      ]);
      expect(groups(final)).toEqual(["a,b,c", "amp", "amp,d,e,f,g"]);
      const supply = final.nets.find((net) =>
        net.terminals.some(
          ({ instanceId, pinName }) =>
            instanceId === "amp" && pinName === "VDD",
        ),
      );
      expect(final.annotations[0]).toMatchObject({
        netId: supply?.id,
        binding: { kind: "net-name", netId: supply?.id },
      });
      expect(final.connectivityEvidence[0]).toMatchObject({
        netId: supply?.id,
      });
    },
  );

  it("keeps an interior crossing disconnected", () => {
    const before = fixture();
    before.instances[1]!.placement!.position = { x: 100, y: 100 };
    before.instances[2]!.placement!.position = { x: 0, y: 100 };
    before.instances[3]!.placement!.position = { x: 100, y: 0 };
    const after = commit(before, [wire("ab", "a", "b"), wire("cd", "c", "d")]);
    expect(groups(after)).toEqual(["a,b", "c,d"]);
    expect(after.junctions).toEqual([]);
  });
  it("joins two existing networks through the new path alone", () => {
    const before = commit(fixture(), [
      wire("ab", "a", "b"),
      wire("cd", "c", "d"),
    ]);
    const after = commit(before, [wire("bc", "b", "c", "outdated-hint")]);
    expect(groups(after)).toEqual(["a,b,c,d"]);
    expect(new Set(after.routes.map((r) => r.netId)).size).toBe(1);
  });
  it("does not regenerate network identities on repeated path submission", () => {
    const before = commit(fixture(), [wire("ab", "a", "b")]);
    const after = commit(before, [
      { kind: "set_route_path", route: before.routes[0]! },
    ]);
    expect(after.nets).toEqual(before.nets);
    expect(after.connectivityEvidence).toEqual(before.connectivityEvidence);
  });
  it("preserves imported connections that have not yet been drawn", () => {
    const before = fixture();
    before.nets.push({
      id: "imported",
      terminals: ["a", "b", "c"].map((instanceId) => ({
        instanceId,
        pinName: "1",
      })),
    });
    const after = commit(before, [wire("ab", "a", "b")]);
    expect(groups(after)).toEqual(["a,b,c"]);
  });
  it("does not replay an earlier connection over a later explicit disconnect", () => {
    const after = commit(fixture(), [
      {
        kind: "connect_endpoints",
        from: pin("a"),
        to: pin("b"),
        newNetId: "intent",
      },
      { kind: "disconnect_endpoint", endpoint: pin("a") },
    ]);
    expect(groups(after)).toEqual(["b"]);
  });
  it("replaces an earlier connection when the same edit disconnects and reconnects that terminal", () => {
    const after = commit(fixture(), [
      {
        kind: "connect_endpoints",
        from: pin("a"),
        to: pin("b"),
        newNetId: "first",
      },
      { kind: "disconnect_endpoint", endpoint: pin("a") },
      {
        kind: "connect_endpoints",
        from: pin("a"),
        to: pin("c"),
        newNetId: "replacement",
      },
    ]);
    expect(groups(after)).toEqual(["a,c", "b"]);
  });
  it("reassigns two unrouted terminals in one transaction without joining their old Nets", () => {
    const before = commit(fixture(), [
      {
        kind: "connect_endpoints",
        from: pin("a"),
        to: pin("b"),
        newNetId: "first",
      },
      {
        kind: "connect_endpoints",
        from: pin("c"),
        to: pin("d"),
        newNetId: "second",
      },
    ]);
    const after = commit(before, [
      { kind: "disconnect_endpoint", endpoint: pin("a") },
      { kind: "disconnect_endpoint", endpoint: pin("c") },
      { kind: "connect_endpoints", from: pin("a"), to: pin("d") },
      { kind: "connect_endpoints", from: pin("c"), to: pin("b") },
    ]);
    expect(groups(after)).toEqual(["a,d", "b,c"]);
  });
});

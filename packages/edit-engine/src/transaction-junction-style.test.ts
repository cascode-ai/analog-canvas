import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { resolveEndpointConnection } from "@icm/derived";
import { describe, expect, it } from "vitest";
import { DocumentHistory } from "./history.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function branchDocument() {
  const document = createEmptyDocument("junction-style", "Junction style");
  document.nets.push({ id: "net", terminals: [] });
  for (const [id, x, y] of [
    ["J", 40, 0],
    ["L", 0, 0],
    ["R", 80, 0],
    ["B", 40, 40],
  ] as const)
    document.junctions.push({ id, netId: "net", position: { x, y } });
  for (const id of ["L", "R", "B"])
    document.routes.push(
      createRoutePath({
        id: `wire-${id}`,
        netId: "net",
        start: { kind: "junction", junctionId: "J" },
        end: { kind: "junction", junctionId: id },
        bends: [],
        modes: ["manual"],
        styleOverride: { color: "#008000" },
      }),
    );
  return document;
}

function request(document: SchematicDocument, edits: readonly unknown[]) {
  return {
    transactionId: `style-${document.revision}`,
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human", id: "test" },
    edits,
  };
}

describe("junction color", () => {
  it("rejects invalid colors, unknown targets, and a terminal without a branch dot", () => {
    const document = branchDocument();
    for (const edit of [
      {
        kind: "set_junction_style_override",
        target: { kind: "junction", junctionId: "J" },
        styleOverride: { color: "red" },
      },
      {
        kind: "set_junction_style_override",
        target: { kind: "junction", junctionId: "missing" },
        styleOverride: { color: "#CC2244" },
      },
      {
        kind: "set_junction_style_override",
        target: { kind: "terminal", instanceId: "missing", pinName: "1" },
        styleOverride: { color: "#CC2244" },
      },
    ]) {
      const result = executeTransaction(
        document,
        request(document, [edit]),
        context,
      );
      expect(result).toMatchObject({ ok: false, applied: false, document });
    }
  });

  it("changes only one junction's color and keeps it through conductor coalescing until it is cleared", () => {
    const document = branchDocument();
    const history = new DocumentHistory(document, context);
    expect(
      history.transact(
        request(history.document, [
          {
            kind: "set_junction_style_override",
            target: { kind: "junction", junctionId: "J" },
            styleOverride: { color: "#CC2244" },
          },
        ]),
      ),
    ).toMatchObject({ ok: true, applied: true });
    // Coloring a dot changes only the dot.
    expect(history.document.routes).toEqual(document.routes);
    expect(history.document.nets).toEqual(document.nets);
    expect(
      history.transact(
        request(history.document, [
          { kind: "cut_connection", routeId: "wire-B" },
        ]),
      ),
    ).toMatchObject({ ok: true });
    expect(history.document.junctions.find((j) => j.id === "J")).toMatchObject({
      styleOverride: { color: "#CC2244" },
    });
    expect(
      history.transact(
        request(history.document, [
          {
            kind: "set_junction_style_override",
            target: { kind: "junction", junctionId: "J" },
            styleOverride: null,
          },
        ]),
      ),
    ).toMatchObject({ ok: true });
    expect(
      history.document.junctions.find((j) => j.id === "J"),
    ).toBeUndefined();
    expect(
      history.transact(request(history.document, [{ kind: "undo" }])),
    ).toMatchObject({ ok: true });
    expect(history.document.junctions.find((j) => j.id === "J")).toMatchObject({
      styleOverride: { color: "#CC2244" },
    });
  });
  it.each([0, 45] as const)(
    "gives a generated %i-degree three-pin dot a persistent color without changing its Net",
    (rotation) => {
      const document = createEmptyDocument("generated-dot", "Generated dot");
      for (const id of ["R1", "R2", "R3"])
        document.instances.push({
          id,
          symbolId: "resistor",
          placement: { position: { x: 0, y: 20 }, rotation, mirror: "none" },
        });
      document.nets.push({
        id: "net",
        terminals: ["R1", "R2", "R3"].map((instanceId) => ({
          instanceId,
          pinName: "1",
        })),
      });
      const result = executeTransaction(
        document,
        request(document, [
          {
            kind: "set_junction_style_override",
            target: { kind: "terminal", instanceId: "R1", pinName: "1" },
            styleOverride: { color: "#CC2244" },
          },
        ]),
        context,
      );
      expect(result).toMatchObject({ ok: true, applied: true });
      if (!result.ok) return;
      expect(result.document.junctions).toEqual([
        expect.objectContaining({
          position: resolveEndpointConnection(document, resolver, {
            kind: "terminal",
            instanceId: "R1",
            pinName: "1",
          })!.gridLanding,
          styleOverride: { color: "#CC2244" },
        }),
      ]);
      expect(result.document.nets).toEqual(document.nets);
      expect(result.document.routes).toEqual([]);
      const moved = executeTransaction(
        result.document,
        request(
          result.document,
          result.document.instances.map((instance) => ({
            kind: "move_instance",
            instanceId: instance.id,
            position: { x: 40, y: 40 },
          })),
        ),
        context,
      );
      expect(moved).toMatchObject({ ok: true });
      if (!moved.ok) return;
      expect(moved.document.junctions[0]!.position).toEqual(
        resolveEndpointConnection(moved.document, resolver, {
          kind: "terminal",
          instanceId: "R1",
          pinName: "1",
        })!.gridLanding,
      );
      expect(moved.document.routes).toEqual([]);
      const disconnected = executeTransaction(
        moved.document,
        request(moved.document, [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
          },
        ]),
        context,
      );
      expect(disconnected).toMatchObject({ ok: true });
      if (!disconnected.ok) return;
      expect(
        disconnected.document.junctions[0]?.contactAnchor?.instanceId,
      ).toBe("R2");
      const rotated = executeTransaction(
        moved.document,
        request(
          moved.document,
          moved.document.instances.map((instance) => ({
            kind: "rotate_instance",
            instanceId: instance.id,
            rotation: 90,
          })),
        ),
        context,
      );
      expect(rotated).toMatchObject({ ok: true });
      if (!rotated.ok) return;
      expect(rotated.document.routes).toEqual([]);
      expect(
        resolveEndpointConnection(rotated.document, resolver, {
          kind: "junction",
          junctionId: rotated.document.junctions[0]!.id,
        })!.contactPoint,
      ).toEqual(
        resolveEndpointConnection(rotated.document, resolver, {
          kind: "terminal",
          instanceId: "R1",
          pinName: "1",
        })!.contactPoint,
      );
      const removed = executeTransaction(
        rotated.document,
        request(rotated.document, [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
          },
          { kind: "remove_instance", instanceId: "R1" },
        ]),
        context,
      );
      expect(removed).toMatchObject({ ok: true });
      if (!removed.ok) return;
      expect(removed.document.junctions[0]?.contactAnchor?.instanceId).toBe(
        "R2",
      );
      const automatic = executeTransaction(
        moved.document,
        request(moved.document, [
          {
            kind: "set_junction_style_override",
            target: { kind: "terminal", instanceId: "R1", pinName: "1" },
            styleOverride: null,
          },
        ]),
        context,
      );
      expect(automatic).toMatchObject({ ok: true });
      if (!automatic.ok) return;
      expect(automatic.document.junctions).toEqual([]);
    },
  );
});

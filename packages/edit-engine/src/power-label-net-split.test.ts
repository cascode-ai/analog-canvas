import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { executeTransaction, type SchematicEdit } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("power label ownership across a physical cut", () => {
  it.each([false, true])(
    "keeps the rail, label and formal terminal together (rail retains old Net: %s)",
    (reverse) => {
      let document = createEmptyDocument("main", "Main");
      const apply = (edits: SchematicEdit[]) => {
        const result = executeTransaction(
          document,
          {
            transactionId: `edit-${document.revision}`,
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "human", id: "test" },
            edits,
          },
          { symbolResolver: resolver },
        );
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        document = result.document;
      };
      apply([
        {
          kind: "add_power_rail",
          netId: "supply",
          routeId: "rail",
          startJunctionId: "rail-start",
          endJunctionId: "rail-end",
          labelId: "label",
          netName: "VDD",
          scope: "local",
          powerDomain: "vdd",
          start: { x: 0, y: 0 },
          end: { x: 100, y: 0 },
        },
      ]);
      const a = { kind: "junction" as const, junctionId: "signal-a" };
      const b = { kind: "junction" as const, junctionId: "rail-start" };
      apply([
        {
          kind: "add_junction",
          netId: "supply",
          junctionId: "signal-a",
          position: { x: 0, y: 100 },
        },
        {
          kind: "add_junction",
          netId: "supply",
          junctionId: "signal-b",
          position: { x: 100, y: 100 },
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "signal",
            netId: "supply",
            start: a,
            end: { kind: "junction", junctionId: "signal-b" },
            bends: [],
            modes: ["manual"],
          }),
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "short",
            netId: "supply",
            start: reverse ? b : a,
            end: reverse ? a : b,
            bends: [],
            modes: ["manual"],
          }),
        },
      ]);
      apply([{ kind: "cut_connection", routeId: "short" }]);
      const railNet = document.routes.find((r) => r.id === "rail")!.netId;
      const signalNet = document.routes.find((r) => r.id === "signal")!.netId;
      expect(railNet).not.toBe(signalNet);
      expect(railNet === "supply").toBe(reverse);
      expect(document.annotations.find((a) => a.id === "label")?.netId).toBe(
        railNet,
      );
      expect(document.netlist?.terminals[0]?.netId).toBe(railNet);
      expect(
        document.connectivityEvidence.find(
          (e) => e.kind === "name-claim" && e.name === "VDD",
        )?.netId,
      ).toBe(railNet);
      expect(
        document.annotations.find((a) => a.id === "label")?.binding?.kind,
      ).toBe("cell-terminal-name");
    },
  );
});

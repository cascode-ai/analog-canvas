import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("property-only terminal Net assignment", () => {
  it("moves a non-graphical B membership without creating canvas geometry", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: "sky-res-high-po",
        },
        parameters: { w: "1u", l: "5.5u", mult: "1" },
      },
    });
    document.nets.push(
      { id: "net-vss", terminals: [] },
      { id: "net-vb", terminals: [] },
    );

    const first = executeTransaction(
      document,
      {
        transactionId: "bind-body",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "set_property_terminal_net",
            instanceId: "R1",
            pinName: "B",
            netId: "net-vss",
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.document.nets[0]!.terminals).toEqual([
      { instanceId: "R1", pinName: "B" },
    ]);
    expect(first.document.routes).toEqual([]);
    expect(first.document.noConnects).toEqual([]);

    const moved = executeTransaction(
      first.document,
      {
        transactionId: "move-body",
        documentId: first.document.id,
        expectedRevision: first.document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "set_property_terminal_net",
            instanceId: "R1",
            pinName: "B",
            netId: "net-vb",
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.document.nets[0]!.terminals).toEqual([]);
    expect(moved.document.nets[1]!.terminals).toEqual([
      { instanceId: "R1", pinName: "B" },
    ]);
  });

  it("refuses to property-bind a visible resistor endpoint", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: { parameters: { value: "1k" } },
    });
    document.nets.push({ id: "net-a", terminals: [] });
    const result = executeTransaction(
      document,
      {
        transactionId: "invalid-property-pin",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "set_property_terminal_net",
            instanceId: "R1",
            pinName: "1",
            netId: "net-a",
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });
});

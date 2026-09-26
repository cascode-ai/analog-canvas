import { resolveEndpointPoint } from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
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

  it("keeps a property terminal on its Net when the same edit wires that Net", () => {
    // A paste binds a substrate and draws the Net's wires in one transaction.
    // No geometry holds the substrate, so the Net named for it must.
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      {
        id: "Q1",
        symbolId: "npn",
        reference: "Q1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    const at = (instanceId: string, pinName: string) =>
      resolveEndpointPoint(document, resolver, {
        kind: "terminal",
        instanceId,
        pinName,
      })!;
    const emitter = at("Q1", "E");
    const ground = at("GND1", "0");
    // Stand the marker straight below the emitter, clear of the transistor.
    document.instances[1]!.placement!.position = {
      x: emitter.x - ground.x,
      y: emitter.y + 40 - ground.y,
    };
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-substrate",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          { kind: "create_base_net", netId: "net-ground" },
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "Q1", pinName: "E" },
            to: { kind: "terminal", instanceId: "GND1", pinName: "0" },
            newNetId: "net-ground",
          },
          {
            kind: "set_property_terminal_net",
            instanceId: "Q1",
            pinName: "S",
            netId: "net-ground",
          },
          {
            kind: "set_route_path",
            route: createRoutePath({
              id: "wire",
              netId: "net-ground",
              start: { kind: "terminal", instanceId: "Q1", pinName: "E" },
              end: { kind: "terminal", instanceId: "GND1", pinName: "0" },
              bends: [],
              modes: ["manual"],
            }),
          },
        ],
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const netOf = (pinName: string) =>
      result.document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === "Q1" && terminal.pinName === pinName,
        ),
      )?.id;
    expect(netOf("E")).toBeDefined();
    expect(netOf("S")).toBe(netOf("E"));
    expect(result.document.nets).toHaveLength(1);
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

import { resolveEndpointPoint } from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import type { SchematicEdit } from "./edit-schema.js";
import { planSetNoConnect } from "./no-connect-planner.js";
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

  describe("an op-amp's supplies, pins its variant may show (#1833)", () => {
    const transact = (
      document: ReturnType<typeof createEmptyDocument>,
      edits: SchematicEdit[],
    ) =>
      executeTransaction(
        document,
        {
          transactionId: "supplies",
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits,
        },
        { symbolResolver: resolver },
      );
    const amplifier = (symbolVariantId?: string) => {
      const document = createEmptyDocument("document-main", "Main");
      document.instances.push({
        id: "U1",
        symbolId: "opamp",
        reference: "U1",
        ...(symbolVariantId ? { symbolVariantId } : {}),
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.nets.push({ id: "net-vdd", terminals: [] });
      return document;
    };
    const bindVdd = {
      kind: "set_property_terminal_net" as const,
      instanceId: "U1",
      pinName: "VDD",
      netId: "net-vdd",
    };

    it("binds VDD by its Net while its pin is hidden, and refuses once it is drawn", () => {
      const hidden = transact(amplifier(), [bindVdd]);
      if (!hidden.ok) throw new Error(JSON.stringify(hidden.error));
      expect(hidden.document.nets[0]!.terminals).toEqual([
        { instanceId: "U1", pinName: "VDD" },
      ]);
      expect(transact(amplifier("supply-pins"), [bindVdd])).toMatchObject({
        ok: false,
        error: {
          code: "EDIT_PRECONDITION",
          message: "Canvas terminal U1.VDD must be wired, not property-bound",
        },
      });
    });

    it("draws a VDD whose Net is set only once it is back on Auto", () => {
      const bound = transact(amplifier(), [bindVdd]);
      if (!bound.ok) throw new Error(JSON.stringify(bound.error));
      const show = {
        kind: "set_instance_symbol" as const,
        instanceId: "U1",
        symbolId: "opamp",
        symbolVariantId: "supply-pins",
      };
      // Drawn, VDD would show no wire to the Net it joins.
      expect(transact(bound.document, [show])).toMatchObject({
        ok: false,
        error: {
          code: "EDIT_PRECONDITION",
          message:
            "U1.VDD has its Net set in Properties; set it to Auto before its pin is drawn",
        },
      });
      // As one Apply in Properties: the row back to Auto, then the switch.
      const shown = transact(bound.document, [
        { ...bindVdd, netId: null },
        show,
      ]);
      if (!shown.ok) throw new Error(JSON.stringify(shown.error));
      expect(shown.document.instances[0]!.symbolVariantId).toBe("supply-pins");
      expect(shown.document.nets.flatMap((net) => net.terminals)).toEqual([]);
    });

    it("refuses to hide a supply pin a wire ends on", () => {
      const document = amplifier("supply-pins");
      document.instances.push({
        id: "VDD1",
        symbolId: "vdd-port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      });
      const at = (instanceId: string, pinName: string) =>
        resolveEndpointPoint(document, resolver, {
          kind: "terminal",
          instanceId,
          pinName,
        })!;
      // The marker stands straight above the op-amp's VDD pin.
      const vdd = at("U1", "VDD");
      const marker = at("VDD1", "P");
      document.instances[1]!.placement!.position = {
        x: vdd.x - marker.x,
        y: vdd.y - 40 - marker.y,
      };
      const wired = transact(document, [
        {
          kind: "connect_endpoints",
          from: { kind: "terminal", instanceId: "U1", pinName: "VDD" },
          to: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
          newNetId: "net-wire",
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "wire",
            netId: "net-wire",
            start: { kind: "terminal", instanceId: "U1", pinName: "VDD" },
            end: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
            bends: [],
            modes: ["manual"],
          }),
        },
      ]);
      if (!wired.ok) throw new Error(JSON.stringify(wired.error));
      expect(
        transact(wired.document, [
          {
            kind: "set_instance_symbol",
            instanceId: "U1",
            symbolId: "opamp",
            symbolVariantId: null,
          },
        ]),
      ).toMatchObject({
        ok: false,
        error: {
          code: "EDIT_PRECONDITION",
          message: "U1.VDD has a wire; disconnect it before its pin is hidden",
        },
      });
    });
  });

  // An op-amp's supplies (#1833), continued: a No Connect mark.
  it("marks an op-amp's VDD No Connect only while drawn, and keeps a marked one drawn", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "U1",
      symbolId: "opamp",
      reference: "U1",
      placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    });
    const vdd = { kind: "terminal" as const, instanceId: "U1", pinName: "VDD" };
    expect(() => planSetNoConnect(document, resolver, [vdd], true)).toThrow(
      "U1.VDD is not drawn; only a drawn pin takes a No Connect mark",
    );
    document.instances[0]!.symbolVariantId = "supply-pins";
    const marked = executeTransaction(
      document,
      {
        transactionId: "mark",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: planSetNoConnect(document, resolver, [vdd], true),
      },
      { symbolResolver: resolver },
    );
    if (!marked.ok) throw new Error(JSON.stringify(marked.error));
    expect(marked.document.noConnects).toHaveLength(1);
    expect(
      executeTransaction(
        marked.document,
        {
          transactionId: "hide",
          documentId: document.id,
          expectedRevision: marked.document.revision,
          actor: { kind: "human", id: "test" },
          edits: [
            {
              kind: "set_instance_symbol",
              instanceId: "U1",
              symbolId: "opamp",
              symbolVariantId: null,
            },
          ],
        },
        { symbolResolver: resolver },
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "EDIT_PRECONDITION",
        message:
          "U1.VDD has a No Connect mark; remove it before its pin is hidden",
      },
    });
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

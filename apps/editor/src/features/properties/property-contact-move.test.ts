import { describe, expect, it } from "vitest";
import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { planPropertyContactMove } from "./property-contact-move";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** A Pin at (400, 200) and an NMOS whose gate is 20 units to its right. */
function apart(): SchematicDocument {
  const document = createEmptyDocument("touch", "Touch");
  return {
    ...document,
    instances: [
      {
        id: "M1",
        reference: "M1",
        symbolId: "nmos",
        placement: {
          position: { x: 440, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 400, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    ] as SchematicDocument["instances"],
    nets: [{ id: "net-p1", terminals: [{ instanceId: "P1", pinName: "P" }] }],
    netlist: {
      ...document.netlist!,
      terminals: [
        {
          id: "terminal-p1",
          name: "Vinp",
          netId: "net-p1",
          direction: "passive",
          interfaceInstanceIds: ["P1"],
        },
      ],
    },
  };
}

describe("a part moved by its typed coordinate", () => {
  it("joins the pin its gate now lies on, as a drag there would", () => {
    const document = apart();
    const move = planPropertyContactMove(
      document,
      resolver,
      document.instances[0]!,
      [
        {
          kind: "move_instance",
          instanceId: "M1",
          position: { x: 420, y: 200 },
        },
      ],
    );
    expect(move).toMatchObject({ ok: true });
    if (!move?.ok) throw new Error("expected a move");
    // A connection, not a bare translation: the gate and the Pin merge.
    expect(move.intent).toBe("connect");
    expect(move.expectedElectricalEffect).toEqual({
      kind: "merge",
      endpointGroups: [["terminal:M1:G", "terminal:P1:P"]],
    });
    expect(move.edits.map((edit) => edit.kind)).toEqual([
      "move_instance",
      "connect_endpoints",
    ]);
  });

  it("leaves a turn or mirror in the same edit as a bare move", () => {
    const document = apart();
    expect(
      planPropertyContactMove(document, resolver, document.instances[0]!, [
        {
          kind: "move_instance",
          instanceId: "M1",
          position: { x: 420, y: 200 },
        },
        { kind: "rotate_instance", instanceId: "M1", rotation: 90 },
      ]),
    ).toBeNull();
    expect(
      planPropertyContactMove(document, resolver, document.instances[0]!, []),
    ).toBeNull();
  });
});

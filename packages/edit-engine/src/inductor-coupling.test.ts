import { createEmptyDocument, type InductorCoupling } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { DocumentHistory } from "./history.js";
import { planInstanceDeletion } from "./instance-lifecycle.js";
import type { SchematicEdit } from "./edit-schema.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture() {
  const document = createEmptyDocument("document-main", "Main");
  for (const [id, symbolId, x] of [
    ["L1", "inductor", 100],
    ["L2", "variable-inductor", 300],
    ["R1", "resistor", 500],
  ] as const)
    document.instances.push({
      id,
      symbolId,
      reference: id,
      placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
    });
  return new DocumentHistory(document, { symbolResolver: resolver });
}

let revisionCounter = 0;
function transact(history: DocumentHistory, edits: SchematicEdit[]) {
  return history.transact({
    transactionId: `transaction-${(revisionCounter += 1)}`,
    documentId: "document-main",
    expectedRevision: history.document.revision,
    actor: { kind: "human", id: "human-test" },
    edits,
  });
}

const coupling = (
  overrides: Partial<InductorCoupling> = {},
): InductorCoupling => ({
  id: "coupling-1",
  name: "TF1",
  members: [
    { instanceId: "L1", dotPin: "1" },
    { instanceId: "L2", dotPin: "P1" },
  ],
  k: "1",
  ...overrides,
});

const rejection = (result: ReturnType<typeof transact>) =>
  result.ok ? null : result.error.message;

describe("inductor coupling edits", () => {
  it("creates, updates and removes a coupling, undoably", () => {
    const history = fixture();
    expect(
      transact(history, [
        { kind: "set_inductor_coupling", coupling: coupling() },
      ]),
    ).toMatchObject({ ok: true, applied: true });
    expect(history.document.inductorCouplings).toEqual([coupling()]);

    const updated = coupling({ name: "Tx", k: "0.8", arrow: false });
    expect(
      transact(history, [{ kind: "set_inductor_coupling", coupling: updated }]),
    ).toMatchObject({ ok: true });
    expect(history.document.inductorCouplings).toEqual([updated]);

    transact(history, [
      { kind: "remove_inductor_coupling", couplingId: "coupling-1" },
    ]);
    // Empty again means absent, as before the first coupling.
    expect(Object.hasOwn(history.document, "inductorCouplings")).toBe(false);

    transact(history, [{ kind: "undo" }]);
    expect(history.document.inductorCouplings).toEqual([updated]);
    transact(history, [{ kind: "undo" }]);
    transact(history, [{ kind: "undo" }]);
    expect(history.document.inductorCouplings).toBeUndefined();
    transact(history, [{ kind: "redo" }]);
    expect(history.document.inductorCouplings).toEqual([coupling()]);
  });

  it("refuses non-inductors, unknown pins, a pair coupled twice and a taken name", () => {
    const history = fixture();
    expect(
      rejection(
        transact(history, [
          {
            kind: "set_inductor_coupling",
            coupling: coupling({
              members: [
                { instanceId: "L1", dotPin: "1" },
                { instanceId: "R1", dotPin: "1" },
              ],
            }),
          },
        ]),
      ),
    ).toMatch(/Only inductors can be coupled/u);
    expect(
      rejection(
        transact(history, [
          {
            kind: "set_inductor_coupling",
            coupling: coupling({
              members: [
                { instanceId: "L1", dotPin: "1" },
                { instanceId: "L2", dotPin: "1" },
              ],
            }),
          },
        ]),
      ),
    ).toMatch(/L2 has no pin 1/u);
    transact(history, [
      { kind: "set_inductor_coupling", coupling: coupling() },
    ]);
    expect(
      rejection(
        transact(history, [
          {
            kind: "set_inductor_coupling",
            coupling: coupling({
              id: "coupling-2",
              name: "TF2",
              members: [
                { instanceId: "L2", dotPin: "P2" },
                { instanceId: "L1", dotPin: "2" },
              ],
            }),
          },
        ]),
      ),
    ).toMatch(/already coupled by TF1/u);
  });

  it("removes a coupling with either of its inductors, and only through it", () => {
    const history = fixture();
    transact(history, [
      { kind: "set_inductor_coupling", coupling: coupling() },
    ]);
    expect(
      rejection(
        transact(history, [{ kind: "remove_instance", instanceId: "L1" }]),
      ),
    ).toMatch(/still connected or referenced/u);
    const edits = planInstanceDeletion(history.document, resolver, ["L2"], 1);
    expect(edits).toContainEqual({
      kind: "remove_inductor_coupling",
      couplingId: "coupling-1",
    });
    expect(transact(history, edits)).toMatchObject({ ok: true });
    expect(history.document.inductorCouplings).toBeUndefined();
    transact(history, [{ kind: "undo" }]);
    expect(history.document.inductorCouplings).toEqual([coupling()]);
  });

  it("keeps the dot through a swap to another inductor and refuses any other swap", () => {
    const history = fixture();
    transact(history, [
      {
        kind: "set_inductor_coupling",
        coupling: coupling({
          members: [
            { instanceId: "L1", dotPin: "2" },
            { instanceId: "L2", dotPin: "P1" },
          ],
        }),
      },
    ]);
    expect(
      rejection(
        transact(history, [
          {
            kind: "set_instance_symbol",
            instanceId: "L1",
            symbolId: "variable-inductor",
          },
        ]),
      ),
    ).toBeNull();
    expect(history.document.inductorCouplings![0]!.members[0]).toEqual({
      instanceId: "L1",
      dotPin: "P2",
    });
    expect(
      rejection(
        transact(history, [
          {
            kind: "set_instance_symbol",
            instanceId: "L2",
            symbolId: "resistor",
          },
        ]),
      ),
    ).toMatch(/remove its coupling before changing it/u);
  });

  it("drops couplings when the Cell body is reset", () => {
    const history = fixture();
    transact(history, [
      { kind: "set_inductor_coupling", coupling: coupling() },
    ]);
    expect(transact(history, [{ kind: "reset_cell_body" }])).toMatchObject({
      ok: true,
    });
    expect(history.document.inductorCouplings).toBeUndefined();
  });
});

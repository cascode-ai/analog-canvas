import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { DocumentHistory } from "./history.js";

function historyFixture() {
  const document = createEmptyDocument("document-main", "Main");
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: {
      reference: "R1",
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: {},
    },
  });
  return new DocumentHistory(document);
}

function transaction(revision: number, edits: unknown[], dryRun = false) {
  return {
    transactionId: `transaction-${revision}-${String((edits[0] as { kind?: string }).kind)}`,
    documentId: "document-main",
    expectedRevision: revision,
    actor: { kind: "human" as const, id: "human-test" },
    dryRun,
    edits,
  };
}

describe("DocumentHistory", () => {
  it("clears every authored collection atomically and restores it with undo", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.sourceBinding = {
      cellName: "main",
      sourceRef: {
        fileId: "main.spi",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 1, line: 1, column: 2 },
      },
    };
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
    });
    document.nets.push({
      id: "net-vss",
      name: "VSS",
      scope: "global",
      terminals: [],
    });
    document.mosBulkDefaults = { nmosNetId: "net-vss" };
    document.annotations.push({
      id: "label-R1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "R1" }] },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    document.drafting = {
      objects: [
        {
          id: "note-1",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 30 } },
          content: { runs: [{ kind: "text", value: "note" }] },
          alignment: "start",
          rotation: 0,
        },
      ],
    };
    const history = new DocumentHistory(document);

    const cleared = history.transact(
      transaction(0, [{ kind: "reset_cell_body" }]),
    );
    expect(cleared).toMatchObject({
      ok: true,
      revision: 1,
      diff: {
        editKinds: ["reset_cell_body"],
        changedObjectIds: [
          "R1",
          "document-main",
          "label-R1",
          "net-vss",
          "note-1",
        ],
      },
    });
    expect(history.document).toMatchObject({
      id: "document-main",
      name: "Main",
      instances: [],
      annotations: [],
      drafting: { objects: [] },
      sourceBinding: { cellName: "main" },
      sourceStatus: "connectivity-modified",
    });
    expect(history.document.mosBulkDefaults).toBeUndefined();

    const undone = history.transact(transaction(1, [{ kind: "undo" }]));
    expect(undone).toMatchObject({ ok: true, revision: 2 });
    expect(history.document.instances).toHaveLength(1);
    expect(history.document.annotations).toHaveLength(1);
    expect(history.document.drafting?.objects).toHaveLength(1);
    expect(history.document.mosBulkDefaults).toEqual({
      nmosNetId: "net-vss",
    });
  });

  it("undoes and redoes geometry with monotonically increasing revisions", () => {
    const history = historyFixture();
    const placed = history.transact(
      transaction(0, [
        {
          kind: "place_instance",
          instanceId: "R1",
          placement: {
            position: { x: 50, y: 40 },
            rotation: 0,
            mirror: "none",
          },
        },
      ]),
    );
    expect(placed).toMatchObject({ ok: true, revision: 1 });
    expect(history.canUndo).toBe(true);

    const undone = history.transact(transaction(1, [{ kind: "undo" }]));
    expect(undone).toMatchObject({ ok: true, revision: 2 });
    expect(history.document.instances[0]?.placement).toBeNull();
    expect(history.canRedo).toBe(true);

    const redone = history.transact(transaction(2, [{ kind: "redo" }]));
    expect(redone).toMatchObject({ ok: true, revision: 3 });
    expect(history.document.instances[0]?.placement?.position).toEqual({
      x: 50,
      y: 40,
    });
  });

  it("dry-runs history without consuming a state", () => {
    const history = historyFixture();
    history.transact(
      transaction(0, [
        {
          kind: "place_instance",
          instanceId: "R1",
          placement: {
            position: { x: 50, y: 40 },
            rotation: 0,
            mirror: "none",
          },
        },
      ]),
    );
    expect(
      history.transact(transaction(1, [{ kind: "undo" }], true)),
    ).toMatchObject({
      ok: true,
      applied: false,
      revision: 1,
      proposedRevision: 2,
    });
    expect(history.canUndo).toBe(true);
    expect(history.document.revision).toBe(1);
  });

  it("undoes and redoes a netlist parameter patch", () => {
    const history = historyFixture();
    const patched = history.transact(
      transaction(0, [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "R1",
          set: { value: "10k" },
        },
      ]),
    );
    expect(patched).toMatchObject({ ok: true, revision: 1 });
    expect(history.document.instances[0]!.netlist!.parameters).toEqual({
      value: "10k",
    });

    expect(history.transact(transaction(1, [{ kind: "undo" }]))).toMatchObject({
      ok: true,
      revision: 2,
    });
    expect(history.document.instances[0]!.netlist!.parameters).toEqual({});

    expect(history.transact(transaction(2, [{ kind: "redo" }]))).toMatchObject({
      ok: true,
      revision: 3,
    });
    expect(history.document.instances[0]!.netlist!.parameters).toEqual({
      value: "10k",
    });
  });

  it("rejects undo when no prior state exists", () => {
    const history = historyFixture();
    const result = history.transact(transaction(0, [{ kind: "undo" }]));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "HISTORY_EMPTY" },
    });
  });

  it("retains a bounded undo window", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        reference: "R1",
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: {},
      },
    });
    const history = new DocumentHistory(document, {}, 2);

    for (let revision = 0; revision < 3; revision += 1) {
      expect(
        history.transact(
          transaction(revision, [
            {
              kind: "patch_instance_netlist_parameters",
              instanceId: "R1",
              set: { value: `${revision}` },
            },
          ]),
        ),
      ).toMatchObject({ ok: true, revision: revision + 1 });
    }

    expect(history.transact(transaction(3, [{ kind: "undo" }]))).toMatchObject({
      ok: true,
      revision: 4,
    });
    expect(history.document.instances[0]!.netlist!.parameters.value).toBe("1");
    expect(history.transact(transaction(4, [{ kind: "undo" }]))).toMatchObject({
      ok: true,
      revision: 5,
    });
    expect(history.document.instances[0]!.netlist!.parameters.value).toBe("0");
    expect(history.transact(transaction(5, [{ kind: "undo" }]))).toMatchObject({
      ok: false,
      error: { code: "HISTORY_EMPTY" },
    });
  });

  it("rejects an invalid history limit", () => {
    expect(
      () =>
        new DocumentHistory(
          createEmptyDocument("document-main", "Main"),
          {},
          0,
        ),
    ).toThrow("Document history limit must be a positive integer");
  });
});

import { executeTransaction } from "@icm/edit-engine";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  planInitialMosBulkDefault,
  planMosBulkDefaultUpdate,
} from "./mos-bulk-defaults";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("initial MOS bulk defaults", () => {
  it("honors preceding batch defaults and explicit clearing without mutating the document", () => {
    const document = createEmptyDocument("main", "Main");
    document.mosBulkDefaults = { pmosNetId: "old" };
    expect(
      planInitialMosBulkDefault(document, "vdd", "next", [
        { kind: "set_mos_bulk_defaults", pmosNetId: "first" },
      ]),
    ).toEqual([]);
    expect(
      planInitialMosBulkDefault(document, "vdd", "next", [
        { kind: "set_mos_bulk_defaults", pmosNetId: null },
        { kind: "set_mos_bulk_defaults", nmosNetId: "zero" },
      ]),
    ).toEqual([
      { kind: "set_mos_bulk_defaults", pmosNetId: "next" },
      { kind: "reconcile_mos_bulk" },
    ]);
    expect(document.mosBulkDefaults).toEqual({ pmosNetId: "old" });
  });
  it("uses the explicit first ground Net as the NMOS default", () => {
    const document = createEmptyDocument("main", "Main");
    expect(planInitialMosBulkDefault(document, "ground", "net-zero")).toEqual([
      { kind: "set_mos_bulk_defaults", nmosNetId: "net-zero" },
      { kind: "reconcile_mos_bulk" },
    ]);
  });

  it("uses the explicit first vdd-domain Net even when it is named AVDD", () => {
    const document = createEmptyDocument("main", "Main");
    expect(planInitialMosBulkDefault(document, "vdd", "net-avdd")).toEqual([
      { kind: "set_mos_bulk_defaults", pmosNetId: "net-avdd" },
      { kind: "reconcile_mos_bulk" },
    ]);
  });

  it("does not overwrite an authored default when another rail is placed", () => {
    const document = createEmptyDocument("main", "Main");
    document.mosBulkDefaults = { pmosNetId: "net-avdd" };
    expect(planInitialMosBulkDefault(document, "vdd", "net-vdd")).toEqual([]);
  });

  it("reconfigures only MOS bodies created from the previous default", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "M1",
        symbolId: "pmos",
        mosBulkBinding: { origin: "cell-default", netId: "net-avdd" },
        placement: null,
      },
      {
        id: "M2",
        symbolId: "pmos",
        placement: null,
      },
      {
        id: "M3",
        symbolId: "nmos",
        mosBulkBinding: { origin: "cell-default", netId: "net-zero" },
        placement: null,
      },
      {
        id: "M4",
        symbolId: "pdmos",
        mosBulkBinding: { origin: "cell-default", netId: "net-avdd" },
        placement: null,
      },
    );
    expect(planMosBulkDefaultUpdate(document, "pmos", "net-dvdd")).toEqual([
      { kind: "clear_mos_bulk_default", instanceId: "M1" },
      { kind: "clear_mos_bulk_default", instanceId: "M4" },
      { kind: "set_mos_bulk_defaults", pmosNetId: "net-dvdd" },
      { kind: "reconcile_mos_bulk" },
    ]);
  });

  it("reclaims a body stranded alone on a Net that policy left behind", () => {
    // Copy/paste wrote Cell policy into its own Net, and the supply marker
    // that named it is gone: one body, no geometry, no name. Configuring the
    // default has to reach that body, or the netlist keeps exporting it as a
    // private Net nobody drew.
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      mosBulkBinding: { origin: "instance-override", netId: "net-residue" },
      placement: null,
    });
    document.nets.push(
      { id: "net-residue", terminals: [{ instanceId: "M1", pinName: "B" }] },
      { id: "net-zero", terminals: [] },
    );
    const result = executeTransaction(
      document,
      {
        transactionId: "set-nmos-default",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...planMosBulkDefaultUpdate(document, "nmos", "net-zero")],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]!.mosBulkBinding).toEqual({
      origin: "cell-default",
      netId: "net-zero",
    });
    expect(
      result.document.nets.find((net) => net.id === "net-zero")?.terminals,
    ).toEqual([{ instanceId: "M1", pinName: "B" }]);
    expect(result.document.nets.some((net) => net.id === "net-residue")).toBe(
      false,
    );
  });

  it.each([
    [
      "an authored body with no policy binding",
      (document: ReturnType<typeof createEmptyDocument>) => {
        delete document.instances[0]!.mosBulkBinding;
      },
    ],
    [
      "a Net that claims a name",
      (document: ReturnType<typeof createEmptyDocument>) => {
        document.annotations.push({
          id: "annotation-body",
          kind: "net-label",
          binding: { kind: "net-name", netId: "net-residue" },
          netId: "net-residue",
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          alignment: "start",
          rotation: 0,
          locked: false,
        });
        document.connectivityEvidence.push({
          id: "claim-body",
          kind: "name-claim",
          netId: "net-residue",
          name: "VSSB",
          owner: { kind: "net-label", annotationId: "annotation-body" },
          scope: "local",
        });
      },
    ],
    [
      "a Net shared with another body",
      (document: ReturnType<typeof createEmptyDocument>) => {
        document.instances.push({
          id: "M2",
          symbolId: "nmos",
          symbolVariantId: "textbook-3terminal",
          mosBulkBinding: {
            origin: "instance-override",
            netId: "net-residue",
          },
          placement: null,
        });
        document.nets[0]!.terminals.push({ instanceId: "M2", pinName: "B" });
      },
    ],
  ])("leaves %s where it is", (_case, prepare) => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      mosBulkBinding: { origin: "instance-override", netId: "net-residue" },
      placement: null,
    });
    document.nets.push(
      { id: "net-residue", terminals: [{ instanceId: "M1", pinName: "B" }] },
      { id: "net-zero", terminals: [] },
    );
    prepare(document);
    const result = executeTransaction(
      document,
      {
        transactionId: "set-nmos-default",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...planMosBulkDefaultUpdate(document, "nmos", "net-zero")],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.document.nets
        .find((net) => net.id === "net-residue")
        ?.terminals.some((terminal) => terminal.instanceId === "M1"),
    ).toBe(true);
  });

  it("moves a materialized default body without changing an explicit body", () => {
    const document = createEmptyDocument("main", "Main");
    document.mosBulkDefaults = { pmosNetId: "net-avdd" };
    document.instances.push(
      {
        id: "M1",
        symbolId: "pmos",
        mosBulkBinding: { origin: "cell-default", netId: "net-avdd" },
        placement: null,
      },
      { id: "M2", symbolId: "pmos", placement: null },
    );
    document.nets.push(
      {
        id: "net-avdd",

        terminals: [
          { instanceId: "M1", pinName: "B" },
          { instanceId: "M2", pinName: "B" },
        ],
      },
      {
        id: "net-dvdd",

        terminals: [],
      },
    );
    const result = executeTransaction(
      document,
      {
        transactionId: "change-pmos-default",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...planMosBulkDefaultUpdate(document, "pmos", "net-dvdd")],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.mosBulkDefaults).toEqual({ pmosNetId: "net-dvdd" });
    expect(result.document.nets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "net-avdd",
          terminals: [{ instanceId: "M2", pinName: "B" }],
        }),
        expect.objectContaining({
          id: "net-dvdd",
          terminals: [{ instanceId: "M1", pinName: "B" }],
        }),
      ]),
    );
  });
});

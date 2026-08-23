import { describe, expect, it } from "vitest";

import {
  executeTransaction,
  proposeVisualRouteDeletion,
} from "@icm/edit-engine";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  constrainedPowerRailEndpoint,
  constructVddRailEdits,
  planVddRailEdits,
} from "./vdd-rail";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("drawn VDD rail construction", () => {
  it("uses the dominant snapped delta for horizontal and vertical gestures", () => {
    expect(
      constrainedPowerRailEndpoint({ x: 100, y: 100 }, { x: 180, y: 130 }),
    ).toEqual({ x: 180, y: 100 });
    expect(
      constrainedPowerRailEndpoint({ x: 100, y: 100 }, { x: 120, y: 190 }),
    ).toEqual({ x: 100, y: 190 });
  });

  it("uses one explicit VDD Net and one horizontal editable power rail", () => {
    const edits = constructVddRailEdits({
      instanceId: "VDD3",
      start: { x: 80, y: 40 },
      end: { x: 260, y: 40 },
    });

    expect(edits).toEqual([
      {
        kind: "add_power_rail",
        netId: "net-power-vdd3",
        routeId: "route-vdd3-rail",
        startJunctionId: "junction-vdd3-start",
        endJunctionId: "junction-vdd3-end",
        labelId: "label-VDD3",
        netName: "VDD",
        scope: "global",
        powerDomain: "vdd",
        start: { x: 80, y: 40 },
        end: { x: 260, y: 40 },
      },
    ]);
  });

  it("keeps the VDD label at the visual right end for a right-to-left draw", () => {
    const rail = constructVddRailEdits({
      instanceId: "VDD4",
      start: { x: 260, y: 40 },
      end: { x: 80, y: 40 },
    }).at(-1);

    expect(rail).toMatchObject({
      kind: "add_power_rail",
      startJunctionId: "junction-vdd4-start",
      endJunctionId: "junction-vdd4-end",
    });
  });

  it("does not reuse AVDD when constructing a VDD rail", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-avdd",
      name: "AVDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });

    const plan = planVddRailEdits(document, {
      instanceId: "VDD1",
      start: { x: 40, y: 20 },
      end: { x: 180, y: 20 },
    });

    expect(plan).toMatchObject({
      ok: true,
      netId: "net-power-vdd1",
      edits: [
        {
          kind: "add_power_rail",
          netId: "net-power-vdd1",
        },
        { kind: "set_mos_bulk_defaults", pmosNetId: "net-power-vdd1" },
        { kind: "reconcile_mos_bulk" },
      ],
    });
  });

  it("records the first explicitly drawn AVDD rail as the PMOS bulk default", () => {
    const document = createEmptyDocument("main", "Main");
    const plan = planVddRailEdits(document, {
      instanceId: "VDD1",
      netName: "AVDD",
      start: { x: 40, y: 20 },
      end: { x: 180, y: 20 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-avdd-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...plan.edits],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.mosBulkDefaults).toEqual({
      pmosNetId: plan.netId,
    });
  });

  it("commits the explicit VDD Net and visual rail in one transaction", () => {
    const document = createEmptyDocument("main", "Main");
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-vdd-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD1",
          start: { x: 40, y: 20 },
          end: { x: 180, y: 20 },
        }),
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances).toEqual([]);
    expect(result.document.nets).toMatchObject([
      {
        id: "net-power-vdd1",
        scope: "local",
        powerDomain: "none",
      },
    ]);
    expect(
      resolveDocumentLogicalNets(result.document).byBaseNetId.get(
        "net-power-vdd1",
      ),
    ).toMatchObject({ name: "VDD", powerDomain: "vdd", scope: "global" });
    expect(result.document.routes).toMatchObject([
      { presentation: "power-rail", netId: "net-power-vdd1" },
    ]);
    expect(result.document.junctions).toHaveLength(2);
    expect(result.document.annotations).toMatchObject([
      {
        kind: "power-label",
        binding: { kind: "net-name", netId: "net-power-vdd1" },
      },
    ]);
  });

  it("commits a vertical Power Rail with its label at the visual top end", () => {
    const document = createEmptyDocument("main", "Main");
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-vertical-power-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD1",
          start: { x: 80, y: 220 },
          end: { x: 80, y: 40 },
        }),
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toMatchObject([
      { presentation: "power-rail", netId: "net-power-vdd1" },
    ]);
    expect(result.document.annotations[0]).toMatchObject({
      anchor: {
        kind: "object",
        objectId: "junction-vdd1-end",
        fallbackPosition: { x: 90, y: 50 },
      },
      rotation: 0,
    });
  });

  it("adds rail geometry to an existing explicitly global VDD Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "pmos",
      mosBulkBinding: {
        origin: "supply-default",
        netId: "net-global-vdd",
      },
      placement: null,
    });
    document.nets.push({
      id: "net-global-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });

    const result = executeTransaction(
      document,
      {
        transactionId: "reuse-vdd-supply",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD2",
          netId: "net-global-vdd",
          scope: "global",
          start: { x: 40, y: 20 },
          end: { x: 180, y: 20 },
        }),
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nets).toHaveLength(1);
    expect(result.document.nets[0]).toMatchObject({
      id: "net-global-vdd",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    expect(result.document.routes).toContainEqual(
      expect.objectContaining({
        netId: "net-global-vdd",
        presentation: "power-rail",
      }),
    );
  });

  it("deletes a power rail with its label and rail-only junctions", () => {
    const document = createEmptyDocument("main", "Main");
    const created = executeTransaction(
      document,
      {
        transactionId: "create-vdd-rail-for-delete",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD1",
          start: { x: 40, y: 20 },
          end: { x: 180, y: 20 },
        }),
      },
      { symbolResolver: resolver },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const proposal = proposeVisualRouteDeletion(
      created.document,
      ["route-vdd1-rail"],
      [],
    );
    expect(proposal.edits[0]).toEqual({
      kind: "remove_schematic_annotation",
      annotationId: "label-VDD1",
    });
    const deleted = executeTransaction(
      created.document,
      {
        transactionId: "delete-vdd-rail",
        documentId: document.id,
        expectedRevision: created.document.revision,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );

    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.document.routes).toEqual([]);
    expect(deleted.document.junctions).toEqual([]);
    expect(deleted.document.annotations).toEqual([]);
    expect(deleted.document.nets).toEqual([]);
  });

  it("keeps a rail Base Net separate while joining the Port's AVDD Logical Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-port-avdd",
      name: "AVDD",
      scope: "local",
      powerDomain: "vdd",
      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-port-avdd",
      kind: "name-claim",
      netId: "net-port-avdd",
      name: "AVDD",
      owner: { kind: "explicit-net-property" },
      scope: "global",
      powerDomain: "vdd",
    });
    const first = planVddRailEdits(document, {
      instanceId: "VDD1",
      netName: "AVDD",
      start: { x: 40, y: 20 },
      end: { x: 180, y: 20 },
    });
    expect(first).toMatchObject({
      ok: true,
      netId: "net-power-vdd1",
      edits: [
        {
          kind: "add_power_rail",
          netId: "net-power-vdd1",
          netName: "AVDD",
          scope: "global",
        },
        { kind: "set_mos_bulk_defaults", pmosNetId: "net-power-vdd1" },
        { kind: "reconcile_mos_bulk" },
      ],
    });
  });
});

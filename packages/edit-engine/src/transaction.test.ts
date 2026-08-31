import { createRoutePath } from "@icm/model";
import {
  createEmptyDocument,
  flattenRichText,
  semanticTextDocument,
  transformPoint,
} from "@icm/model";
import type { RichTextDocument } from "@icm/model";
import {
  defaultInstanceLabelPlacement,
  displayableInstanceValue,
  resolveDocumentLogicalNets,
  resolveSchematicStyleProfile,
  visibleSymbolLocalBounds,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  EditTransactionSchema,
  executeTransaction,
  SchematicEditSchema,
} from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** Canonical machine-projected value content for a fixture instance. */
function canonicalValueContent(instance: {
  symbolId: string;
  netlist?: unknown;
}): RichTextDocument {
  const display = displayableInstanceValue(
    instance as Parameters<typeof displayableInstanceValue>[0],
  );
  if (display.kind !== "displayable") {
    throw new Error("Fixture instance must have a displayable value");
  }
  return structuredClone(display.content);
}

function documentWithInstance() {
  const document = createEmptyDocument("document-main", "Main");
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    schematicReference: "M1",
    placement: null,
    netlist: {
      reference: "M1",
      binding: { kind: "primitive", deviceClass: "mos" },
      parameters: {},
    },
  });
  return document;
}

function transaction(expectedRevision = 0, dryRun = false) {
  return {
    transactionId: "transaction-test",
    documentId: "document-main",
    expectedRevision,
    actor: { kind: "human" as const, id: "human-test" },
    dryRun,
    edits: [{ kind: "noop" as const, reason: "Phase 0 envelope proof" }],
  };
}

function defineCellPin(
  document: ReturnType<typeof createEmptyDocument>,
  instanceId: string,
  name: string,
  netId: string,
): void {
  document.netlist ??= {
    name: document.name,
    formalParameters: [],
    terminals: [],
  };
  document.netlist.terminals.push({
    id: `terminal-${instanceId.toLowerCase()}`,
    name,
    netId,
    direction: "passive",
    interfaceInstanceIds: [instanceId],
  });
}

describe("Edit Transaction envelope", () => {
  it("accepts 1024 edits and rejects the 1025th before execution", () => {
    const document = createEmptyDocument("document-main", "Main");
    const maximum = {
      ...transaction(),
      edits: Array.from({ length: 1024 }, (_, index) => ({
        kind: "noop" as const,
        reason: `Boundary edit ${index + 1}`,
      })),
    };

    expect(EditTransactionSchema.safeParse(maximum).success).toBe(true);
    const accepted = executeTransaction(document, maximum);
    expect(accepted).toMatchObject({
      ok: true,
      applied: true,
      revision: 1,
      diff: { changedObjectIds: [] },
    });

    const rejected = executeTransaction(document, {
      ...maximum,
      edits: [
        ...maximum.edits,
        { kind: "noop" as const, reason: "Over the boundary" },
      ],
    });
    expect(rejected).toMatchObject({
      ok: false,
      applied: false,
      revision: 0,
      document,
      error: { code: "INVALID_TRANSACTION" },
    });
  });

  it("does not allow an update edit to rebind a Cell Pin marker", () => {
    expect(() =>
      SchematicEditSchema.parse({
        kind: "update_cell_terminal",
        terminalId: "terminal-vin",
        interfaceInstanceIds: ["P1", "P2"],
      }),
    ).toThrow();
  });

  it("creates a manual Base Net without adding naming semantics", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      { id: "A", symbolId: "port", placement: null },
      { id: "B", symbolId: "port", placement: null },
    );
    defineCellPin(document, "A", "A", "net-authored");
    defineCellPin(document, "B", "B", "net-authored");

    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "A", pinName: "P" },
            to: { kind: "terminal", instanceId: "B", pinName: "P" },
            newNetId: "net-authored",
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nets).toEqual([
      expect.objectContaining({ id: "net-authored" }),
    ]);
    expect(Object.hasOwn(result.document.nets[0]!, "origin")).toBe(false);
    expect(resolveDocumentLogicalNets(result.document).groups).toEqual([
      expect.objectContaining({
        id: "net-authored",
        powerDomain: "none",
        sourceNetIds: [],
      }),
    ]);
  });

  it("materializes a prepared Base Net before assigning terminal membership", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      { id: "R1", symbolId: "resistor", placement: null },
      { id: "R2", symbolId: "resistor", placement: null },
    );

    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          { kind: "create_base_net", netId: "net-imported" },
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "R1", pinName: "1" },
            to: { kind: "terminal", instanceId: "R2", pinName: "1" },
            newNetId: "net-imported",
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nets).toEqual([
      {
        id: "net-imported",
        terminals: [
          { instanceId: "R1", pinName: "1" },
          { instanceId: "R2", pinName: "1" },
        ],
      },
    ]);
    expect(result.document.connectivityEvidence).toEqual([]);
  });

  it("rejects a schematic reference on a formal Cell Pin", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "port-object",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "net-vout",

      terminals: [{ instanceId: "port-object", pinName: "P" }],
    });
    document.netlist = {
      name: "Child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vout",
          name: "Vout",
          netId: "net-vout",
          direction: "output",
          interfaceInstanceIds: ["port-object"],
        },
      ],
    };

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "set_instance_schematic_reference",
          instanceId: "port-object",
          reference: "P1",
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });

  it("updates a formal Port same-text format override without changing its interface name", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "port-object",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "net-vout",

      terminals: [{ instanceId: "port-object", pinName: "P" }],
    });
    document.netlist = {
      name: "Child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vout",
          name: "Vout",
          netId: "net-vout",
          direction: "output",
          interfaceInstanceIds: ["port-object"],
        },
      ],
    };
    const formatOverride = {
      runs: [
        {
          kind: "span" as const,
          style: "overbar" as const,
          children: [{ kind: "text" as const, value: "Vout" }],
        },
      ],
    };

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "instance-label-port-object",
            kind: "instance-label",
            binding: {
              kind: "cell-terminal-name",
              terminalId: "terminal-vout",
            },
            formatOverride,
            anchor: {
              kind: "object",
              objectId: "port-object",
              localOffset: { x: 0, y: 0 },
              fallbackPosition: { x: 0, y: 0 },
            },
            alignment: "middle",
            rotation: 0,
            locked: false,
          },
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.document.netlist!.terminals[0]!.name).toBe("Vout");
    expect(result.document.annotations[0]!.formatOverride).toEqual(
      formatOverride,
    );

    const renamed = executeTransaction(result.document, {
      ...transaction(),
      expectedRevision: result.document.revision,
      edits: [
        {
          kind: "update_cell_terminal",
          terminalId: "terminal-vout",
          name: "OUT",
        },
      ],
    });
    expect(renamed).toMatchObject({ ok: true });
    if (!renamed.ok) return;
    expect(renamed.document.annotations[0]!.formatOverride).toBeUndefined();
  });

  it("clears a stale Net-label format override when the Net is renamed", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-vin",

      terminals: [],
    });
    document.annotations.push({
      id: "label-vin",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-vin" },
      formatOverride: {
        runs: [
          {
            kind: "span",
            style: "italic",
            children: [{ kind: "text", value: "VIN" }],
          },
        ],
      },
      netId: "net-vin",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "claim-vin",
            kind: "name-claim",
            netId: "net-vin",
            name: "VINP",
            scope: "local",
            owner: { kind: "net-label", annotationId: "label-vin" },
          },
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.document.annotations[0]!.formatOverride).toBeUndefined();
  });

  it("enforces the same layout lock before placing a retained Instance", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      schematicReference: "R1",
      placement: null,
    });
    document.layoutGroups.push({
      id: "locked-instance",
      kind: "custom",
      objectIds: ["R1"],
      locked: true,
    });
    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "place_instance",
          instanceId: "R1",
          placement: {
            position: { x: 100, y: 100 },
            rotation: 0,
            mirror: "none",
          },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });

  it("updates a RichText schematic name without changing the SPICE reference", () => {
    const document = documentWithInstance();
    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "set_instance_schematic_name",
          instanceId: "M1",
          content: {
            runs: [
              {
                kind: "span",
                style: "overbar",
                children: [{ kind: "text", value: "M1" }],
              },
            ],
          },
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.document.instances[0]!.netlist!.reference).toBe("M1");
    expect(result.document.instances[0]!.schematicName).toEqual({
      runs: [
        {
          kind: "span",
          style: "overbar",
          children: [{ kind: "text", value: "M1" }],
        },
      ],
    });
  });

  it("rejects the retired ambiguous annotation edit names", () => {
    expect(
      SchematicEditSchema.safeParse({
        kind: "upsert_annotation",
        annotation: {},
      }).success,
    ).toBe(false);
    expect(
      SchematicEditSchema.safeParse({
        kind: "remove_annotation",
        annotationId: "label",
      }).success,
    ).toBe(false);
    expect(
      SchematicEditSchema.safeParse({ kind: "normalize_power_nets" }).success,
    ).toBe(false);
  });

  it("bounds one bulk netlist patch before it reaches a transaction", () => {
    const assignments = Array.from({ length: 5_000 }, (_, index) => ({
      instanceId: `M${index + 1}`,
      set: { l: "120n" },
    }));
    expect(
      SchematicEditSchema.safeParse({
        kind: "bulk_patch_instance_netlist",
        assignments,
      }).success,
    ).toBe(true);
    expect(
      SchematicEditSchema.safeParse({
        kind: "bulk_patch_instance_netlist",
        assignments: [
          ...assignments,
          { instanceId: "M5001", set: { l: "120n" } },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid power rail atomically", () => {
    const document = createEmptyDocument("document-main", "Main");
    const before = JSON.stringify(document);
    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "add_power_rail",
            netId: "net-vdd",
            routeId: "rail-vdd",
            startJunctionId: "junction-start",
            endJunctionId: "junction-end",
            labelId: "label-vdd",
            netName: "VDD",
            scope: "local",
            powerDomain: "vdd",
            start: { x: 10, y: 10 },
            end: { x: 40, y: 40 },
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects a second rail Route that would bend the run", () => {
    const empty = createEmptyDocument("document-main", "Main");
    const railed = executeTransaction(
      empty,
      {
        ...transaction(),
        edits: [
          {
            kind: "add_power_rail",
            netId: "net-vdd",
            routeId: "rail-vdd",
            startJunctionId: "junction-start",
            endJunctionId: "junction-end",
            labelId: "label-vdd",
            netName: "VDD",
            scope: "local",
            powerDomain: "vdd",
            start: { x: 10, y: 10 },
            end: { x: 100, y: 10 },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(railed.ok).toBe(true);
    const straight = railed.document;

    const bendEdits = [
      {
        kind: "add_junction" as const,
        junctionId: "junction-bend",
        netId: "net-vdd",
        position: { x: 100, y: 90 },
        role: "route-anchor" as const,
      },
      {
        kind: "set_route_path" as const,
        route: createRoutePath({
          id: "rail-vdd-branch",
          netId: "net-vdd",
          start: { kind: "junction", junctionId: "junction-end" },
          end: { kind: "junction", junctionId: "junction-bend" },
          bends: [],
          modes: ["manual"],
          presentation: "power-rail",
        }),
      },
    ];

    // A rail is one straight conductor. Hanging a perpendicular rail Route off
    // its end would leave two individually straight halves with a bend.
    const bent = executeTransaction(
      straight,
      {
        ...transaction(),
        expectedRevision: straight.revision,
        edits: bendEdits,
      },
      { symbolResolver: resolver },
    );
    console.log(
      "BENT",
      JSON.stringify({ ok: bent.ok, rejection: (bent as any).rejection }).slice(
        0,
        300,
      ),
    );
    expect(bent).toMatchObject({ ok: false, applied: false });

    // The same branch drawn collinearly extends the rail instead.
    const extended = executeTransaction(
      straight,
      {
        ...transaction(),
        expectedRevision: straight.revision,
        edits: [
          { ...bendEdits[0]!, position: { x: 200, y: 10 } },
          bendEdits[1]!,
        ],
      },
      { symbolResolver: resolver },
    );
    console.log(
      "EXT",
      JSON.stringify(
        Object.fromEntries(
          Object.entries(extended).filter(([k]) => k !== "document"),
        ),
      ).slice(0, 600),
    );
    expect(extended.ok).toBe(true);
  });

  it("rejects a power rail whose generated IDs collide with an existing object", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "label-vdd",
      symbolId: "resistor",
      placement: null,
    });
    const before = JSON.stringify(document);
    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "add_power_rail",
            netId: "net-vdd",
            routeId: "rail-vdd",
            startJunctionId: "junction-start",
            endJunctionId: "junction-end",
            labelId: "label-vdd",
            netName: "VDD",
            scope: "local",
            powerDomain: "vdd",
            start: { x: 10, y: 10 },
            end: { x: 80, y: 10 },
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects reassignment between non-empty power roles atomically", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-vdd",

      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "explicit-net-property" },
    });
    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "upsert_connectivity_evidence",
            evidence: {
              id: "claim-ground-conflict",
              kind: "name-claim",
              netId: "net-vdd",
              name: "0",
              scope: "global",
              powerDomain: "ground",
              owner: { kind: "explicit-net-property" },
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_RESULT" },
      document,
    });
  });

  it("sets a Cell bulk default by stable Net id before reconciliation", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
    });
    document.nets.push({
      id: "net-substrate",

      terminals: [],
    });
    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          { kind: "set_mos_bulk_defaults", nmosNetId: "net-substrate" },
          { kind: "reconcile_mos_bulk", instanceIds: ["M1"] },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.mosBulkDefaults).toEqual({
      nmosNetId: "net-substrate",
    });
    expect(result.document.instances[0]?.mosBulkBinding).toEqual({
      origin: "cell-default",
      netId: "net-substrate",
    });
  });

  it("adopts an imported hidden bulk already connected to the configured default", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: null,
      sourceRef: {
        fileId: "main-spi",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 1, line: 1, column: 2 },
      },
    });
    document.nets.push({
      id: "net-vss",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.mosBulkDefaults = { nmosNetId: "net-vss" };

    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [{ kind: "reconcile_mos_bulk", instanceIds: ["M1"] }],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]?.mosBulkBinding).toEqual({
      origin: "cell-default",
      netId: "net-vss",
    });
    expect(result.document.nets[0]?.terminals).toEqual([
      { instanceId: "M1", pinName: "B" },
    ]);
  });

  it("releases stale default ownership when a visible bulk route owns B", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      mosBulkBinding: { origin: "cell-default", netId: "net-vss" },
    });
    document.nets.push({
      id: "net-vss",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.junctions.push({
      id: "J1",
      netId: "net-vss",
      position: { x: 180, y: 100 },
    });
    document.routes.push(
      createRoutePath({
        id: "bulk-route",
        netId: "net-vss",
        start: { kind: "terminal", instanceId: "M1", pinName: "B" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [{ x: 100, y: 100 }],
        modes: ["escape", "manual"],
        presentation: "bulk-dashed",
      }),
    );
    document.mosBulkDefaults = { nmosNetId: "net-vss" };

    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [{ kind: "reconcile_mos_bulk", instanceIds: ["M1"] }],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]?.mosBulkBinding).toBeUndefined();
    expect(result.document.nets[0]?.terminals).toContainEqual({
      instanceId: "M1",
      pinName: "B",
    });
    expect(result.document.routes).toEqual(document.routes);
  });

  it("repairs a legacy imported B-only split using shared source provenance", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: null,
      sourceRef: {
        fileId: "main-spi",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 1, line: 1, column: 2 },
      },
    });
    document.nets.push(
      { id: "net-vss", terminals: [] },
      {
        id: "net-split-bulk",
        terminals: [{ instanceId: "M1", pinName: "B" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "source-vss",
        kind: "spice-source",
        netId: "net-vss",
        sourceNetId: "source-vss",
      },
      {
        id: "source-vss-split",
        kind: "spice-source",
        netId: "net-split-bulk",
        sourceNetId: "source-vss",
      },
    );
    document.mosBulkDefaults = { nmosNetId: "net-vss" };

    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [{ kind: "reconcile_mos_bulk", instanceIds: ["M1"] }],
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]?.mosBulkBinding).toEqual({
      origin: "cell-default",
      netId: "net-vss",
    });
    expect(result.document.nets).toEqual([
      {
        id: "net-vss",
        terminals: [{ instanceId: "M1", pinName: "B" }],
      },
    ]);
    expect(result.document.connectivityEvidence).toEqual([
      {
        id: "source-vss",
        kind: "spice-source",
        netId: "net-vss",
        sourceNetId: "source-vss",
      },
    ]);
  });

  it("leaves unconfigured bulk unresolved and permits an explicit connection", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const reconciled = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [{ kind: "reconcile_mos_bulk", instanceIds: ["M1"] }],
      },
      { symbolResolver: resolver },
    );
    expect(reconciled.ok).toBe(true);
    if (!reconciled.ok) return;
    expect(reconciled.document.instances[0]?.mosBulkBinding).toBeUndefined();
    expect(reconciled.document.nets).toEqual([]);

    const overridden = executeTransaction(
      reconciled.document,
      {
        ...transaction(reconciled.document.revision),
        edits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "M1", pinName: "B" },
            to: { kind: "terminal", instanceId: "M1", pinName: "B" },
            newNetId: "net-explicit-body",
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(overridden.ok).toBe(true);
    if (!overridden.ok) return;
    expect(overridden.document.instances[0]?.mosBulkBinding).toBeUndefined();
    expect(
      overridden.document.nets.find((net) => net.id === "net-explicit-body")
        ?.terminals,
    ).toContainEqual({ instanceId: "M1", pinName: "B" });
  });

  it("accepts Net-id Label bindings and rejects overloaded object ids", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-signal",

      terminals: [],
    });
    const annotation = {
      id: "label-signal",
      kind: "net-label" as const,
      content: { runs: [{ kind: "text", value: "SIGNAL" }] },
      netId: "net-signal",
      anchor: { kind: "free", position: { x: 100, y: 100 } },
      alignment: "middle" as const,
      rotation: 0 as const,
      locked: false,
    };
    const accepted = executeTransaction(document, {
      ...transaction(),
      edits: [{ kind: "upsert_schematic_annotation", annotation }],
    });
    expect(accepted).toMatchObject({ ok: true });

    const rejected = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: { ...annotation, netId: "junction-signal" },
        },
      ],
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { message: "Net Label identity is not a Net: junction-signal" },
    });
  });

  it("keeps imported Net routing intent through placement, Wire, and Net Labels", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.sourceBinding = {
      cellName: "main",
      sourceRef: {
        fileId: "main.sp",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 1, line: 1, column: 2 },
      },
    };
    document.nets.push({
      id: "net-ab",

      terminals: [
        { instanceId: "A", pinName: "P" },
        { instanceId: "B", pinName: "P" },
      ],
    });
    document.connectivityEvidence.push({
      id: "source-net-ab",
      kind: "spice-source",
      netId: "net-ab",
      sourceNetId: "net-ab",
    });
    document.instances.push(
      {
        id: "A",
        symbolId: "port",
        placement: null,
      },
      {
        id: "B",
        symbolId: "port",
        placement: {
          position: { x: 200, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    defineCellPin(document, "A", "A", "net-ab");
    defineCellPin(document, "B", "B", "net-ab");

    const placed = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "place_instance",
            instanceId: "A",
            placement: {
              position: { x: 100, y: 100 },
              rotation: 0,
              mirror: "none",
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(placed).toMatchObject({
      ok: true,
      document: {
        connectivityEvidence: [
          expect.objectContaining({
            kind: "spice-source",
            netId: "net-ab",
            sourceNetId: "net-ab",
          }),
        ],
      },
    });
    if (!placed.ok) return;

    const moved = executeTransaction(placed.document, {
      ...transaction(placed.document.revision),
      transactionId: "transaction-move",
      edits: [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 110, y: 100 },
        },
      ],
    });
    expect(moved).toMatchObject({
      ok: true,
      document: {
        connectivityEvidence: [
          expect.objectContaining({
            kind: "spice-source",
            netId: "net-ab",
            sourceNetId: "net-ab",
          }),
        ],
      },
    });

    const wired = executeTransaction(
      placed.document,
      {
        ...transaction(placed.document.revision),
        transactionId: "transaction-wire",
        edits: [
          {
            kind: "set_route_path",
            route: createRoutePath({
              id: "route-ab",
              netId: "net-ab",
              start: { kind: "terminal", instanceId: "A", pinName: "P" },
              end: { kind: "terminal", instanceId: "B", pinName: "P" },
              bends: [],
              modes: ["manual"],
            }),
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(wired).toMatchObject({
      ok: true,
      document: {
        connectivityEvidence: [
          expect.objectContaining({
            kind: "spice-source",
            netId: "net-ab",
            sourceNetId: "net-ab",
          }),
        ],
      },
    });
    if (!wired.ok) return;

    const labelled = executeTransaction(wired.document, {
      ...transaction(wired.document.revision),
      transactionId: "transaction-label",
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "label-ab",
            kind: "net-label",
            content: { runs: [{ kind: "text", value: "AB" }] },
            netId: "net-ab",
            anchor: { kind: "free", position: { x: 150, y: 100 } },
            alignment: "middle",
            rotation: 0,
            locked: false,
          },
        },
      ],
    });
    expect(labelled).toMatchObject({
      ok: true,
      document: {
        connectivityEvidence: [
          expect.objectContaining({
            kind: "spice-source",
            netId: "net-ab",
            sourceNetId: "net-ab",
          }),
        ],
      },
    });
  });

  it("retains imported provenance when an authored Port Net merges into it", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-imported-bus",

        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-authored-port",

        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-imported-bus",
        kind: "name-claim",
        netId: "net-imported-bus",
        name: "BUS",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "source-imported-bus",
        kind: "spice-source",
        netId: "net-imported-bus",
        sourceNetId: "source-bus",
      },
    );
    defineCellPin(document, "P1", "P1", "net-imported-bus");
    defineCellPin(document, "P2", "P2", "net-authored-port");

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "merge_nets",
          targetNetId: "net-imported-bus",
          sourceNetId: "net-authored-port",
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      document: {
        nets: [
          {
            id: "net-imported-bus",
            terminals: [
              { instanceId: "P1", pinName: "P" },
              { instanceId: "P2", pinName: "P" },
            ],
          },
        ],
      },
    });
    if (!result.ok) return;
    expect(result.document.connectivityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "name-claim",
          netId: "net-imported-bus",
          name: "BUS",
        }),
        expect.objectContaining({
          kind: "spice-source",
          netId: "net-imported-bus",
          sourceNetId: "source-bus",
        }),
      ]),
    );
  });

  it("retargets name and source evidence when Nets merge", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push(
      { id: "net-target", terminals: [] },
      { id: "net-source", terminals: [] },
    );
    document.connectivityEvidence.push(
      {
        id: "source-target",
        kind: "spice-source",
        netId: "net-target",
        sourceNetId: "spice-source",
      },
      {
        id: "claim-source",
        kind: "name-claim",
        netId: "net-source",
        name: "SOURCE",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "source-origin",
        kind: "spice-source",
        netId: "net-source",
        sourceNetId: "spice-source",
      },
    );

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "merge_nets",
          targetNetId: "net-target",
          sourceNetId: "net-source",
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
    });
    if (!result.ok) return;
    expect(result.document.connectivityEvidence).toEqual(
      expect.arrayContaining([
        {
          id: "source-target",
          kind: "spice-source",
          netId: "net-target",
          sourceNetId: "spice-source",
        },
        expect.objectContaining({ id: "claim-source", netId: "net-target" }),
      ]),
    );
    expect(
      result.document.connectivityEvidence.filter(
        (evidence) =>
          evidence.kind === "spice-source" &&
          evidence.netId === "net-target" &&
          evidence.sourceNetId === "spice-source",
      ),
    ).toHaveLength(1);
  });

  it("upserts and removes explicit Connectivity Evidence with final-Net GC", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-evidence",

      terminals: [],
    });

    const added = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "claim-evidence",
            kind: "name-claim",
            netId: "net-evidence",
            name: "BIAS",
            owner: { kind: "explicit-net-property" },
            scope: "local",
          },
        },
      ],
    });
    expect(added).toMatchObject({
      ok: true,
      document: {
        connectivityEvidence: [{ id: "claim-evidence", netId: "net-evidence" }],
      },
      diff: { changedObjectIds: ["claim-evidence"] },
    });
    if (!added.ok) return;

    const removed = executeTransaction(added.document, {
      ...transaction(1),
      edits: [
        {
          kind: "remove_connectivity_evidence",
          evidenceId: "claim-evidence",
        },
      ],
    });
    expect(removed).toMatchObject({
      ok: true,
      document: { nets: [], connectivityEvidence: [] },
      diff: { changedObjectIds: ["claim-evidence", "net-evidence"] },
    });
  });

  it("rejects evidence ID collisions and missing owners atomically", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({ id: "net-a", terminals: [] });
    const collision = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "net-a",
            kind: "spice-source",
            netId: "net-a",
            sourceNetId: "source-a",
          },
        },
      ],
    });
    expect(collision).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "EDIT_PRECONDITION" },
    });
    expect(document.connectivityEvidence).toEqual([]);

    const missingOwner = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "claim-a",
            kind: "name-claim",
            netId: "net-a",
            name: "A",
            owner: { kind: "net-label", annotationId: "missing" },
            scope: "local",
          },
        },
      ],
    });
    expect(missingOwner).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "INVALID_RESULT" },
    });
    expect(document.connectivityEvidence).toEqual([]);

    const missingEvidence = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "remove_connectivity_evidence",
          evidenceId: "missing-evidence",
        },
      ],
    });
    expect(missingEvidence).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "OBJECT_NOT_FOUND" },
    });
  });

  it("reclaims a deleted standalone Ground Net held only by the bulk default", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "GND1",
      symbolId: "ground",
      placement: null,
    });
    document.nets.push({
      id: "net-power-gnd1",

      terminals: [{ instanceId: "GND1", pinName: "0" }],
    });
    document.connectivityEvidence.push({
      id: "claim-ground-1",
      kind: "name-claim",
      netId: "net-power-gnd1",
      name: "0",
      owner: { kind: "power-marker", objectId: "GND1" },
      scope: "global",
      powerDomain: "ground",
    });
    document.mosBulkDefaults = { nmosNetId: "net-power-gnd1" };

    const removed = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "GND1", pinName: "0" },
          },
          { kind: "remove_instance", instanceId: "GND1" },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(removed).toMatchObject({
      ok: true,
      document: {
        instances: [],
        nets: [],
        connectivityEvidence: [],
      },
    });
    if (!removed.ok) return;
    expect(removed.document.mosBulkDefaults).toBeUndefined();

    const replaced = executeTransaction(
      removed.document,
      {
        ...transaction(removed.document.revision),
        edits: [
          {
            kind: "add_instance",
            instance: { id: "GND1", symbolId: "ground", placement: null },
          },
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "GND1", pinName: "0" },
            to: { kind: "terminal", instanceId: "GND1", pinName: "0" },
            newNetId: "net-power-gnd1",
          },
          {
            kind: "upsert_connectivity_evidence",
            evidence: {
              id: "claim-ground-1",
              kind: "name-claim",
              netId: "net-power-gnd1",
              name: "0",
              owner: { kind: "power-marker", objectId: "GND1" },
              scope: "global",
              powerDomain: "ground",
            },
          },
          { kind: "set_mos_bulk_defaults", nmosNetId: "net-power-gnd1" },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(replaced).toMatchObject({
      ok: true,
      document: {
        instances: [{ id: "GND1" }],
        nets: [{ id: "net-power-gnd1" }],
        mosBulkDefaults: { nmosNetId: "net-power-gnd1" },
      },
    });
  });

  it("revokes a materialized PMOS default when the last VDD claim is deleted", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      { id: "M1", symbolId: "pmos", placement: null },
      { id: "VDD1", symbolId: "vdd-port", placement: null },
    );
    document.nets.push({
      id: "net-power-vdd1",

      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "VDD1", pinName: "P" },
      ],
    });
    document.connectivityEvidence.push(
      {
        id: "claim-vdd-legacy-projection",
        kind: "name-claim",
        netId: "net-power-vdd1",
        name: "VDD",
        owner: { kind: "explicit-net-property" },
        scope: "global",
        powerDomain: "vdd",
      },
      {
        id: "claim-vdd-1",
        kind: "name-claim",
        netId: "net-power-vdd1",
        name: "VDD",
        owner: { kind: "power-marker", objectId: "VDD1" },
        scope: "global",
        powerDomain: "vdd",
      },
    );
    document.mosBulkDefaults = { pmosNetId: "net-power-vdd1" };
    document.instances[0]!.mosBulkBinding = {
      origin: "cell-default",
      netId: "net-power-vdd1",
    };

    const removed = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
          },
          { kind: "remove_instance", instanceId: "VDD1" },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.document.mosBulkDefaults).toBeUndefined();
    expect(removed.document.instances[0]?.mosBulkBinding).toBeUndefined();
    expect(removed.document.nets).toEqual([]);
    expect(removed.document.connectivityEvidence).toEqual([]);

    const replaced = executeTransaction(
      removed.document,
      {
        ...transaction(removed.document.revision),
        edits: [
          {
            kind: "add_instance",
            instance: { id: "VDD1", symbolId: "vdd-port", placement: null },
          },
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
            to: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
            newNetId: "net-power-vdd1",
          },
          {
            kind: "upsert_connectivity_evidence",
            evidence: {
              id: "claim-vdd-1",
              kind: "name-claim",
              netId: "net-power-vdd1",
              name: "VDD",
              owner: { kind: "power-marker", objectId: "VDD1" },
              scope: "global",
              powerDomain: "vdd",
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(replaced).toMatchObject({
      ok: true,
      document: {
        instances: [{ id: "M1" }, { id: "VDD1" }],
        nets: [{ id: "net-power-vdd1" }],
      },
    });
  });

  it("keeps an explicit custom PMOS body default without a power marker", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "pmos",
      placement: null,
      mosBulkBinding: { origin: "cell-default", netId: "net-body" },
    });
    document.nets.push({
      id: "net-body",

      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.mosBulkDefaults = { pmosNetId: "net-body" };

    const edited = executeTransaction(
      document,
      { ...transaction(), edits: [{ kind: "noop", reason: "unrelated edit" }] },
      { symbolResolver: resolver },
    );

    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.document.mosBulkDefaults).toEqual({ pmosNetId: "net-body" });
    expect(edited.document.instances[0]?.mosBulkBinding).toEqual({
      origin: "cell-default",
      netId: "net-body",
    });
  });

  it("migrates a PMOS default to another marker of the same supply", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      {
        id: "M1",
        symbolId: "pmos",
        placement: null,
        mosBulkBinding: { origin: "cell-default", netId: "net-vdd-1" },
      },
      { id: "VDD1", symbolId: "vdd-port", placement: null },
      { id: "VDD2", symbolId: "vdd-port", placement: null },
    );
    document.nets.push(
      {
        id: "net-vdd-1",

        terminals: [
          { instanceId: "M1", pinName: "B" },
          { instanceId: "VDD1", pinName: "P" },
        ],
      },
      {
        id: "net-vdd-2",

        terminals: [{ instanceId: "VDD2", pinName: "P" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-vdd-1",
        kind: "name-claim",
        netId: "net-vdd-1",
        name: "VDD",
        owner: { kind: "power-marker", objectId: "VDD1" },
        scope: "global",
        powerDomain: "vdd",
      },
      {
        id: "claim-vdd-2",
        kind: "name-claim",
        netId: "net-vdd-2",
        name: "VDD",
        owner: { kind: "power-marker", objectId: "VDD2" },
        scope: "global",
        powerDomain: "vdd",
      },
    );
    document.mosBulkDefaults = { pmosNetId: "net-vdd-1" };

    const removed = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
          },
          { kind: "remove_instance", instanceId: "VDD1" },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.document.mosBulkDefaults).toEqual({
      pmosNetId: "net-vdd-2",
    });
    expect(
      removed.document.instances.find((instance) => instance.id === "M1")
        ?.mosBulkBinding,
    ).toEqual({
      origin: "cell-default",
      netId: "net-vdd-2",
    });
    expect(
      removed.document.nets.find((net) => net.id === "net-vdd-2")?.terminals,
    ).toContainEqual({
      instanceId: "M1",
      pinName: "B",
    });
  });

  it("reclaims ownerless naming evidence with the label's orphaned Net", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({ id: "net-a", terminals: [] });
    document.annotations.push({
      id: "label-a",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-a" },
      netId: "net-a",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push(
      {
        id: "claim-label",
        kind: "name-claim",
        netId: "net-a",
        name: "A",
        owner: { kind: "net-label", annotationId: "label-a" },
        scope: "local",
      },
      {
        id: "claim-property",
        kind: "name-claim",
        netId: "net-a",
        name: "A",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
    );

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [{ kind: "remove_schematic_annotation", annotationId: "label-a" }],
    });
    expect(result).toMatchObject({
      ok: true,
      document: {
        nets: [],
        connectivityEvidence: [],
      },
    });
  });

  it("keeps a source-backed node name when its visible label is deleted", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({ id: "net-a", terminals: [] });
    document.junctions.push({
      id: "junction-a",
      netId: "net-a",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    });
    document.annotations.push({
      id: "label-a",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-a" },
      netId: "net-a",
      anchor: {
        kind: "object",
        objectId: "junction-a",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push(
      {
        id: "claim-label",
        kind: "name-claim",
        netId: "net-a",
        name: "A",
        owner: { kind: "net-label", annotationId: "label-a" },
        scope: "local",
      },
      {
        id: "claim-source-name",
        kind: "name-claim",
        netId: "net-a",
        name: "A",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "source-a",
        kind: "spice-source",
        netId: "net-a",
        sourceNetId: "source-a",
      },
    );

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [{ kind: "remove_schematic_annotation", annotationId: "label-a" }],
    });

    expect(result).toMatchObject({
      ok: true,
      document: {
        nets: [{ id: "net-a" }],
        connectivityEvidence: [{ id: "claim-source-name" }, { id: "source-a" }],
      },
    });
  });

  it("rejects a stale revision without changing the Document", () => {
    const document = createEmptyDocument("document-main", "Main");
    const before = JSON.stringify(document);
    const result = executeTransaction(document, transaction(8));
    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_REVISION");
    }
    expect(result.document).toBe(document);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("applies an accepted no-op atomically and advances revision", () => {
    const document = createEmptyDocument("document-main", "Main");
    const result = executeTransaction(document, transaction());
    expect(result).toMatchObject({
      ok: true,
      applied: true,
      revision: 1,
      proposedRevision: 1,
    });
    expect(result.document).not.toBe(document);
    expect(document.revision).toBe(0);
  });

  it("does not silently normalize an explicitly tagged supply Net", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M2",
      symbolId: "pmos",
      placement: null,
    });
    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "add_junction",
            junctionId: "vdd-rail-start",
            netId: "net-ui-2",
            position: { x: 100, y: 100 },
            createNet: true,
          },
          {
            kind: "upsert_connectivity_evidence",
            evidence: {
              id: "claim-net-ui-2-vdd",
              kind: "name-claim",
              netId: "net-ui-2",
              name: "VDD",
              scope: "local",
              powerDomain: "vdd",
              owner: { kind: "explicit-net-property" },
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        nets: [
          {
            id: "net-ui-2",
            terminals: [],
          },
        ],
      },
    });
    if (!result.ok) return;
    expect(
      resolveDocumentLogicalNets(result.document).byBaseNetId.get("net-ui-2"),
    ).toMatchObject({ name: "VDD", powerDomain: "vdd" });
  });

  it("dry-runs without mutating or advancing the current revision", () => {
    const document = createEmptyDocument("document-main", "Main");
    const result = executeTransaction(document, transaction(0, true));
    expect(result).toMatchObject({
      ok: true,
      applied: false,
      revision: 0,
      proposedRevision: 1,
    });
    // dryRun returns the validated candidate geometry (so callers can inspect
    // proposed Routes), NOT the original Document reference. The original
    // Document must be untouched and the revision un-advanced.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).not.toBe(document);
    expect(document.revision).toBe(0);
    expect(result.document.revision).toBe(1);
  });

  it("rejects the complete transaction when an edit is unknown", () => {
    const document = createEmptyDocument("document-main", "Main");
    const result = executeTransaction(document, {
      ...transaction(),
      edits: [{ kind: "move_instance", instanceId: "M1" }],
    });
    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    expect(result.document).toBe(document);
  });

  it("places and transforms an instance through typed edits", () => {
    const document = documentWithInstance();
    const placed = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "place_instance",
          instanceId: "M1",
          placement: {
            position: { x: 100, y: 80 },
            rotation: 0,
            mirror: "none",
          },
        },
      ],
    });
    expect(placed).toMatchObject({
      ok: true,
      applied: true,
      revision: 1,
      diff: { changedObjectIds: ["M1"] },
    });
    if (!placed.ok) {
      throw new Error("Placement unexpectedly failed");
    }

    const transformed = executeTransaction(placed.document, {
      ...transaction(1),
      transactionId: "transaction-transform",
      edits: [
        {
          kind: "move_instance",
          instanceId: "M1",
          position: { x: 120, y: 90 },
        },
        { kind: "rotate_instance", instanceId: "M1", rotation: 90 },
        { kind: "mirror_instance", instanceId: "M1", mirror: "x" },
      ],
    });
    expect(transformed).toMatchObject({
      ok: true,
      revision: 2,
      document: {
        instances: [
          {
            id: "M1",
            placement: {
              position: { x: 120, y: 90 },
              rotation: 90,
              mirror: "x",
            },
          },
        ],
      },
    });
  });

  it("patches instance netlist parameters atomically and records a non-source edit", () => {
    const document = documentWithInstance();
    document.instances[0]!.netlist!.parameters = {
      value: "8k",
    };
    document.sourceStatus = "in-sync";

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M1",
          set: { value: "12k", enabled: "true" },
          unset: ["unused"],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      diff: { changedObjectIds: ["M1"] },
      document: {
        sourceStatus: "geometry-only-changed",
        instances: [
          {
            netlist: { parameters: { value: "12k", enabled: "true" } },
          },
        ],
      },
    });
    expect(document.instances[0]!.netlist!.parameters).toEqual({
      value: "8k",
    });
  });

  it("updates signal flow parameters without touching netlist parameters", () => {
    const document = documentWithInstance();
    document.instances[0]!.netlist!.parameters = { value: "8k" };
    document.sourceStatus = "in-sync";

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "set_instance_signal_flow_parameters",
          instanceId: "M1",
          parameters: { formula: "z^-1", coefficient: "a1" },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      diff: { changedObjectIds: ["M1"] },
      document: {
        instances: [
          {
            signalFlowParameters: { formula: "z^-1", coefficient: "a1" },
            netlist: { parameters: { value: "8k" } },
          },
        ],
      },
    });
    if (!result.ok) return;
    expect(result.document.sourceStatus).not.toBe("connectivity-modified");
    expect(document.instances[0]!.netlist!.parameters).toEqual({
      value: "8k",
    });
    expect(document.instances[0]!.signalFlowParameters).toBeUndefined();
  });

  it("rejects a parameter patch on an Instance without netlist authority", () => {
    const document = documentWithInstance();
    delete document.instances[0]!.netlist;
    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M1",
          set: { value: "10k" },
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EDIT_PRECONDITION",
        }),
      ]),
    );
    expect(document.instances[0]!.netlist).toBeUndefined();
  });

  it("allows a case-only parameter rename as one atomic patch", () => {
    const document = documentWithInstance();
    document.instances[0]!.netlist!.parameters = { gain: "10" };

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M1",
          set: { Gain: "10" },
          unset: ["gain"],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [{ netlist: { parameters: { Gain: "10" } } }],
      },
    });
  });

  it("rejects a case-folded duplicate parameter patch without changing the instance", () => {
    const document = documentWithInstance();
    document.instances[0]!.netlist!.parameters = { value: "10k" };

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M1",
          set: { VALUE: "12k" },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "EDIT_PRECONDITION" },
    });
    expect(document.instances[0]!.netlist!.parameters).toEqual({
      value: "10k",
    });
  });

  it("edits reference and binding as independent typed netlist fields", () => {
    const document = documentWithInstance();
    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "set_instance_reference",
          instanceId: "M1",
          reference: "MN0",
        },
        {
          kind: "set_instance_binding",
          instanceId: "M1",
          binding: { kind: "model", deviceClass: "mos", name: "nch" },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [
          {
            netlist: {
              reference: "MN0",
              binding: { kind: "model", deviceClass: "mos", name: "nch" },
            },
          },
        ],
      },
    });
  });

  it("keeps the schematic reference independent from the netlist reference", () => {
    const document = documentWithInstance();
    document.instances.push({
      id: "M2",
      symbolId: "nmos",
      placement: null,
      netlist: { reference: "M2", parameters: {} },
    });
    document.annotations.push({
      id: "instance-label-M1",
      kind: "instance-label",
      content: semanticTextDocument("M1", "instance-label"),
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 0, y: -20 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const duplicate = executeTransaction(document, {
      ...transaction(),
      edits: [
        { kind: "set_instance_reference", instanceId: "M1", reference: "m2" },
      ],
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
    const wrongPrefix = executeTransaction(document, {
      ...transaction(),
      edits: [
        { kind: "set_instance_reference", instanceId: "M1", reference: "R1" },
      ],
    });
    expect(wrongPrefix).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });

    const renamed = executeTransaction(document, {
      ...transaction(),
      edits: [
        { kind: "set_instance_reference", instanceId: "M1", reference: "M3" },
      ],
    });
    expect(renamed).toMatchObject({ ok: true });
    if (!renamed.ok) return;
    expect(renamed.document.instances[0]?.netlist?.reference).toBe("M3");
    expect(flattenRichText(renamed.document.annotations[0]!.content!)).toBe(
      "M1",
    );
  });

  it("applies a bounded bulk netlist patch atomically", () => {
    const document = documentWithInstance();
    document.instances.push({
      id: "M2",
      symbolId: "nmos",
      placement: null,
      netlist: {
        reference: "M2",
        binding: { kind: "primitive", deviceClass: "mos" },
        parameters: { l: "60n" },
      },
    });

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "bulk_patch_instance_netlist",
          assignments: [
            { instanceId: "M1", set: { l: "120n" } },
            { instanceId: "M2", set: { l: "120n" } },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [
          { id: "M1", netlist: { parameters: { l: "120n" } } },
          { id: "M2", netlist: { parameters: { l: "120n" } } },
        ],
      },
    });
    const rejected = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "bulk_patch_instance_netlist",
          assignments: [
            { instanceId: "M1", reference: "M3" },
            { instanceId: "M2", reference: "m3" },
          ],
        },
      ],
    });
    expect(rejected).toMatchObject({ ok: false, applied: false });
    expect(
      document.instances.map((instance) => instance.netlist?.reference),
    ).toEqual(["M1", "M2"]);
  });

  it("rejects an invalid parameter patch without partially changing the instance", () => {
    const document = documentWithInstance();
    document.instances[0]!.netlist!.parameters = { value: "10k" };

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M1",
          set: { value: "12k" },
          unset: ["value"],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "EDIT_PRECONDITION" },
    });
    expect(document.instances[0]!.netlist!.parameters).toEqual({
      value: "10k",
    });
  });

  it("reuses upright label placement when a BJT rotates", () => {
    const document = createEmptyDocument("document-main", "BJT label");
    const instance = {
      id: "Q1",
      symbolId: "npn",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    const resolved = resolver.resolve("npn");
    if (!resolved) throw new Error("missing npn");
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );
    const initial = defaultInstanceLabelPlacement(
      instance,
      resolved,
      profile,
      10,
    );
    if (!initial) throw new Error("missing default label placement");
    document.annotations.push({
      id: "instance-label-Q1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "Q1" }] },
      anchor: {
        kind: "object",
        objectId: "Q1",
        localOffset: {
          x: initial.position.x - instance.placement.position.x,
          y: initial.position.y - instance.placement.position.y,
        },
        fallbackPosition: initial.position,
      },
      alignment: initial.alignment,
      rotation: 0,
      locked: false,
    });

    const rotated = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [{ kind: "rotate_instance", instanceId: "Q1", rotation: 90 }],
      },
      { symbolResolver: resolver },
    );
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    const rotatedInstance = rotated.document.instances[0]!;
    const localBounds = visibleSymbolLocalBounds(resolved);
    const worldCorners = [
      { x: localBounds.x, y: localBounds.y },
      { x: localBounds.x + localBounds.width, y: localBounds.y },
      {
        x: localBounds.x + localBounds.width,
        y: localBounds.y + localBounds.height,
      },
      { x: localBounds.x, y: localBounds.y + localBounds.height },
    ].map((point) =>
      transformPoint(
        point,
        rotatedInstance.placement!.position,
        rotatedInstance.placement!,
      ),
    );
    const bottom = Math.max(...worldCorners.map((point) => point.y));
    const label = rotated.document.annotations[0]!;
    expect(label).toMatchObject({ alignment: "middle", rotation: 0 });
    // The persisted semantic anchor is grid-snapped.  Assert the visible glyph
    // edge, not the raw baseline: the label must retain at least one whole
    // Document-grid interval outside the rotated symbol.
    if (label.anchor.kind === "free") {
      throw new Error("Rotated instance label must retain an object anchor");
    }
    const fallback = label.anchor.fallbackPosition;
    const glyphTop = fallback.y - profile.typography.instanceFontSize * 1.05;
    expect(glyphTop).toBeGreaterThanOrEqual(
      bottom + document.presentation.grid,
    );
  });

  it("reuses the canonical upright placement when a Cell Pin rotates", () => {
    const document = createEmptyDocument("document-main", "Port label");
    const instance = {
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    document.nets.push({
      id: "net-vin",

      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    defineCellPin(document, "P1", "VIN", "net-vin");
    const resolved = resolver.resolve("port");
    if (!resolved) throw new Error("missing port");
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );
    const initial = defaultInstanceLabelPlacement(
      instance,
      resolved,
      profile,
      document.presentation.grid,
      "reference",
    );
    if (!initial) throw new Error("missing default Port label placement");
    document.annotations.push({
      id: "cell-pin-label-p1",
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-p1" },
      anchor: {
        kind: "object",
        objectId: "P1",
        localOffset: {
          x: initial.position.x - instance.placement.position.x,
          y: initial.position.y - instance.placement.position.y,
        },
        fallbackPosition: initial.position,
      },
      alignment: initial.alignment,
      rotation: 0,
      locked: false,
    });

    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [{ kind: "rotate_instance", instanceId: "P1", rotation: 90 }],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = defaultInstanceLabelPlacement(
      result.document.instances[0]!,
      resolved,
      profile,
      result.document.presentation.grid,
      "reference",
    );
    const label = result.document.annotations[0]!;
    expect(expected).not.toBeNull();
    expect(label).toMatchObject({
      alignment: expected!.alignment,
      rotation: 0,
      anchor: {
        kind: "object",
        localOffset: {
          x: expected!.position.x - 100,
          y: expected!.position.y - 100,
        },
        fallbackPosition: expected!.position,
      },
    });
  });

  it("returns a canonical instance label to its initial position after four quarter turns", () => {
    let document = createEmptyDocument("document-main", "Stable label");
    const instance = {
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    const resolved = resolver.resolve("nmos", "textbook-3terminal");
    if (!resolved) throw new Error("missing nmos");
    const initial = defaultInstanceLabelPlacement(
      instance,
      resolved,
      resolveSchematicStyleProfile(document.presentation.styleProfileId),
      document.presentation.grid,
    );
    if (!initial) throw new Error("missing default label placement");
    document.annotations.push({
      id: "instance-label-M1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "M1" }] },
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: {
          x: initial.position.x - instance.placement.position.x,
          y: initial.position.y - instance.placement.position.y,
        },
        fallbackPosition: initial.position,
      },
      alignment: initial.alignment,
      rotation: 0,
      locked: false,
    });

    for (const rotation of [90, 180, 270, 0] as const) {
      const result = executeTransaction(
        document,
        {
          ...transaction(document.revision),
          edits: [{ kind: "rotate_instance", instanceId: "M1", rotation }],
        },
        { symbolResolver: resolver },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      document = result.document;
    }

    const label = document.annotations[0]!;
    if (label.anchor.kind !== "object") {
      throw new Error("Canonical instance label must keep an object anchor");
    }
    expect(label.anchor.localOffset).toEqual({
      x: initial.position.x - instance.placement.position.x,
      y: initial.position.y - instance.placement.position.y,
    });
    expect(label.anchor.fallbackPosition).toEqual(initial.position);
    expect(label.alignment).toBe(initial.alignment);
  });

  it("returns a canonical instance value to its slot after four quarter turns", () => {
    let document = createEmptyDocument("document-main", "Stable value");
    const instance = {
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    const resolved = resolver.resolve("nmos", "textbook-3terminal");
    if (!resolved) throw new Error("missing nmos");
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );
    const reference = defaultInstanceLabelPlacement(
      instance,
      resolved,
      profile,
      document.presentation.grid,
      "reference",
    );
    const value = defaultInstanceLabelPlacement(
      instance,
      resolved,
      profile,
      document.presentation.grid,
      "value",
    );
    if (!reference || !value) throw new Error("missing default placements");
    document.annotations.push(
      {
        id: "instance-label-M1",
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: "M1" }] },
        anchor: {
          kind: "object",
          objectId: "M1",
          localOffset: {
            x: reference.position.x - instance.placement.position.x,
            y: reference.position.y - instance.placement.position.y,
          },
          fallbackPosition: reference.position,
        },
        alignment: reference.alignment,
        rotation: 0,
        locked: false,
      },
      {
        id: "instance-value-M1",
        kind: "instance-value",
        content: { runs: [{ kind: "text", value: "10u/0.5u" }] },
        anchor: {
          kind: "object",
          objectId: "M1",
          localOffset: {
            x: value.position.x - instance.placement.position.x,
            y: value.position.y - instance.placement.position.y,
          },
          fallbackPosition: value.position,
        },
        alignment: value.alignment,
        rotation: 0,
        locked: false,
      },
    );

    for (const rotation of [90, 180, 270, 0] as const) {
      const result = executeTransaction(
        document,
        {
          ...transaction(document.revision),
          edits: [{ kind: "rotate_instance", instanceId: "M1", rotation }],
        },
        { symbolResolver: resolver },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      document = result.document;
    }

    const [label, valueAnnotation] = document.annotations;
    if (!label || !valueAnnotation) throw new Error("missing annotations");
    if (
      label.anchor.kind !== "object" ||
      valueAnnotation.anchor.kind !== "object"
    ) {
      throw new Error("Canonical slot annotations must keep object anchors");
    }
    expect(label.anchor.fallbackPosition).toEqual(reference.position);
    expect(valueAnnotation.anchor.fallbackPosition).toEqual(value.position);
    // The two rows stay a fixed grid-quantized distance apart at every
    // orientation, so they can never overlap.
    expect(valueAnnotation.anchor.fallbackPosition.y).toBe(
      label.anchor.fallbackPosition.y + 30,
    );
    expect(valueAnnotation.alignment).toBe(label.alignment);
  });

  it("refreshes a canonical instance value after a netlist parameter edit", () => {
    const document = createEmptyDocument("document-main", "Value refresh");
    const instance = {
      id: "M1",
      symbolId: "nmos",
      placement: null,
      netlist: {
        reference: "M1",
        binding: { kind: "primitive" as const, deviceClass: "mos" as const },
        parameters: { w: "10u", l: "0.5u" },
      },
    };
    document.instances.push(instance);
    document.annotations.push({
      id: "instance-value-M1",
      kind: "instance-value",
      content: canonicalValueContent(instance),
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 30, y: 10 },
        fallbackPosition: { x: 130, y: 110 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const edited = {
      ...instance,
      netlist: {
        ...instance.netlist,
        parameters: { w: "20u", l: "0.5u" },
      },
    };
    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "set_instance_netlist",
            instanceId: "M1",
            netlist: edited.netlist,
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.annotations[0]!.content).toEqual(
      canonicalValueContent(edited),
    );
    // The anchor is placement-only and survives the content refresh.
    expect(result.document.annotations[0]!.anchor).toMatchObject({
      localOffset: { x: 30, y: 10 },
    });
  });

  it("preserves a hand-edited instance value and hides an emptied projection", () => {
    const baseNetlist = (parameters: Record<string, string>) => ({
      reference: "M1",
      binding: { kind: "primitive" as const, deviceClass: "mos" as const },
      parameters,
    });
    const handEdited = createEmptyDocument("document-main", "Hand edited");
    handEdited.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      netlist: baseNetlist({ w: "10u", l: "0.5u" }),
    });
    handEdited.annotations.push({
      id: "instance-value-M1",
      kind: "instance-value",
      content: { runs: [{ kind: "text", value: "MY_BIAS_DEVICE" }] },
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 30, y: 10 },
        fallbackPosition: { x: 130, y: 110 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const handEditedResult = executeTransaction(
      handEdited,
      {
        ...transaction(),
        edits: [
          {
            kind: "set_instance_netlist",
            instanceId: "M1",
            netlist: baseNetlist({ w: "40u", l: "1u" }),
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(handEditedResult.ok).toBe(true);
    if (handEditedResult.ok) {
      expect(handEditedResult.document.annotations[0]!.content).toEqual({
        runs: [{ kind: "text", value: "MY_BIAS_DEVICE" }],
      });
    }

    const emptied = createEmptyDocument("document-main", "Emptied");
    const emptiedInstance = {
      id: "M1",
      symbolId: "nmos",
      placement: null,
      netlist: baseNetlist({ w: "10u", l: "0.5u" }),
    };
    emptied.instances.push(emptiedInstance);
    emptied.annotations.push({
      id: "instance-value-M1",
      kind: "instance-value",
      content: canonicalValueContent(emptiedInstance),
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 30, y: 10 },
        fallbackPosition: { x: 130, y: 110 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const emptiedResult = executeTransaction(
      emptied,
      {
        ...transaction(),
        edits: [
          {
            kind: "set_instance_netlist",
            instanceId: "M1",
            netlist: baseNetlist({ w: "10u" }),
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(emptiedResult.ok).toBe(true);
    if (emptiedResult.ok) {
      expect(emptiedResult.document.annotations[0]!.visible).toBe(false);
    }
  });

  it("refreshes an instance value from netlist parameters", () => {
    const document = createEmptyDocument("document-main", "Properties value");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        reference: "R1",
        binding: {
          kind: "primitive" as const,
          deviceClass: "resistor" as const,
        },
        parameters: { value: "10k" },
      },
    };
    document.instances.push(instance);
    document.annotations.push({
      id: "instance-value-R1",
      kind: "instance-value",
      content: canonicalValueContent(instance),
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 30, y: 0 },
        fallbackPosition: { x: 130, y: 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const result = executeTransaction(
      document,
      {
        ...transaction(),
        edits: [
          {
            kind: "patch_instance_netlist_parameters",
            instanceId: "R1",
            set: { value: "22k" },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.annotations[0]!.content).toEqual(
      canonicalValueContent({
        ...instance,
        netlist: {
          reference: "R1",
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "22k" },
        },
      }),
    );
  });

  it("rejects a multi-edit transaction atomically after a later precondition failure", () => {
    const document = documentWithInstance();
    const before = JSON.stringify(document);
    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "place_instance",
          instanceId: "M1",
          placement: {
            position: { x: 100, y: 80 },
            rotation: 0,
            mirror: "none",
          },
        },
        {
          kind: "move_instance",
          instanceId: "missing",
          position: { x: 0, y: 0 },
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    expect(result.document).toBe(document);
    expect(JSON.stringify(document)).toBe(before);
  });
});

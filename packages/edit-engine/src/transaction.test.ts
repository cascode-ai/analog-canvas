import { createEmptyDocument, transformPoint } from "@icm/model";
import {
  defaultInstanceLabelPlacement,
  resolveSchematicStyleProfile,
  visibleSymbolLocalBounds,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction, SchematicEditSchema } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentWithInstance() {
  const document = createEmptyDocument("document-main", "Main");
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    placement: null,
    properties: {},
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

describe("Edit Transaction envelope", () => {
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
            domain: "vdd",
            start: { x: 10, y: 10 },
            end: { x: 10, y: 40 },
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects a power rail whose generated IDs collide with an existing object", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "label-vdd",
      symbolId: "resistor",
      placement: null,
      properties: {},
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
            domain: "vdd",
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

  it("sets a Cell bulk default by stable Net id before reconciliation", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      properties: {},
    });
    document.nets.push({
      id: "net-substrate",
      name: "SUBSTRATE",
      scope: "local",
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

  it("creates a canonical supply default and permits an explicit bulk override", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      properties: {},
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
    expect(reconciled.document.instances[0]?.mosBulkBinding).toEqual({
      origin: "supply-default",
      netId: "net-global-0",
    });
    expect(reconciled.document.nets).toContainEqual({
      id: "net-global-0",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });

    const overridden = executeTransaction(
      reconciled.document,
      {
        ...transaction(reconciled.document.revision),
        edits: [
          { kind: "clear_mos_bulk_default", instanceId: "M1" },
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
      overridden.document.nets.find((net) => net.id === "net-global-0")
        ?.terminals,
    ).not.toContainEqual({ instanceId: "M1", pinName: "B" });
    expect(
      overridden.document.nets.find((net) => net.id === "net-explicit-body")
        ?.terminals,
    ).toContainEqual({ instanceId: "M1", pinName: "B" });
  });

  it("accepts Net-id Label bindings and rejects overloaded object ids", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-signal",
      scope: "local",
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

  it("keeps imported flightline guidance through placement and Wire, then dismisses it for a Net Label", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.sourceBinding = {
      cellName: "main",
      sourceRef: {
        fileId: "main.sp",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 1, line: 1, column: 2 },
      },
    };
    document.flightlineGuidance = "active";
    document.instances.push(
      {
        id: "A",
        symbolId: "port",
        placement: null,
        properties: {},
      },
      {
        id: "B",
        symbolId: "port",
        placement: {
          position: { x: 200, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        properties: {},
      },
    );

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
      document: { flightlineGuidance: "active" },
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
      document: { flightlineGuidance: "dismissed" },
    });

    const wired = executeTransaction(
      placed.document,
      {
        ...transaction(placed.document.revision),
        transactionId: "transaction-wire",
        edits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "A", pinName: "P" },
            to: { kind: "terminal", instanceId: "B", pinName: "P" },
            newNetId: "net-ab",
          },
          {
            kind: "set_route_points",
            routeId: "route-ab",
            netId: "net-ab",
            from: { kind: "terminal", instanceId: "A", pinName: "P" },
            to: { kind: "terminal", instanceId: "B", pinName: "P" },
            waypoints: [],
            segmentModes: ["manual"],
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(wired).toMatchObject({
      ok: true,
      document: { flightlineGuidance: "active" },
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
      document: { flightlineGuidance: "dismissed" },
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

  it("normalizes an explicitly tagged supply Net without a supply symbol", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M2",
      symbolId: "pmos",
      placement: null,
      properties: {},
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
            kind: "set_net_power_domain",
            netId: "net-ui-2",
            powerDomain: "vdd",
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
            name: "VDD",
            scope: "global",
            powerDomain: "vdd",
            terminals: [],
          },
        ],
      },
    });
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

  it("patches instance properties atomically and records a non-source edit", () => {
    const document = documentWithInstance();
    document.instances[0]!.properties = {
      value: "8k",
    };
    document.sourceStatus = "in-sync";

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_properties",
          instanceId: "M1",
          set: { value: "12k", enabled: true },
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
            properties: { value: "12k", enabled: true },
          },
        ],
      },
    });
    expect(document.instances[0]!.properties).toEqual({
      value: "8k",
    });
  });

  it("rejects legacy SPICE property patches before any candidate mutation", () => {
    const document = documentWithInstance();
    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_properties",
          instanceId: "M1",
          set: { "spice.param.value": "10k" },
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, applied: false, revision: 0 });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_TRANSACTION",
          path: ["edits", 0, "set", "spice.param.value"],
        }),
      ]),
    );
    expect(document.instances[0]!.properties).toEqual({});
  });

  it("rejects an invalid property patch without partially changing the instance", () => {
    const document = documentWithInstance();
    document.instances[0]!.properties = { value: "10k" };

    const result = executeTransaction(document, {
      ...transaction(),
      edits: [
        {
          kind: "patch_instance_properties",
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
    expect(document.instances[0]!.properties).toEqual({ value: "10k" });
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
      properties: {},
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

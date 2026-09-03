/**
 * A pin dropped exactly onto a foreign pin bonds the two endpoints through
 * the direct-contact planner (merge + connect), the same explicit gesture
 * as placing a component against one. Owner feedback: two elements that
 * abut via terminals are connected; moving one later grows the wire back
 * (that half lives in the engine's direct-contact lifecycle).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  createRoutingOperationPlan,
  executeTransaction,
  gateRoutingOperationPlan,
  type RoutingOperationIntent,
  type SchematicEdit,
} from "@icm/edit-engine";
import { describe, expect, it } from "vitest";

import { createSelectionMoveController } from "./selection-move-controller";
import { planSelectionMove } from "./selection-move-plan";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixtureDocument(): SchematicDocument {
  const document = parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
      "utf8",
    ),
  ).documents[0]!;
  // This case exercises two visible names, not the legacy source-name hints
  // carried by the routing fixture. Only visible owners are allowed to block
  // an otherwise physical merge.
  document.annotations.push(
    {
      id: "label-horizontal",
      kind: "net-label",
      netId: "net-h",
      binding: { kind: "net-name", netId: "net-h" },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
    {
      id: "label-vertical",
      kind: "net-label",
      netId: "net-v",
      binding: { kind: "net-name", netId: "net-v" },
      anchor: { kind: "free", position: { x: 0, y: 10 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  );
  document.connectivityEvidence.push(
    {
      id: "claim-horizontal",
      kind: "name-claim",
      netId: "net-h",
      name: "HORIZONTAL",
      owner: { kind: "net-label", annotationId: "label-horizontal" },
      scope: "local",
    },
    {
      id: "claim-vertical",
      kind: "name-claim",
      netId: "net-v",
      name: "VERTICAL",
      owner: { kind: "net-label", annotationId: "label-vertical" },
      scope: "local",
    },
  );
  // C: pin contact at (0,200) — the bond target on net-v.
  document.instances.find((i) => i.id === "C")!.placement = {
    position: { x: -10, y: 200 },
    rotation: 0,
    mirror: "none",
  };
  // E: rotation 270 puts its pin contact at (pos.x, pos.y-10).
  document.instances.find((i) => i.id === "E")!.placement = {
    position: { x: 30, y: 400 },
    rotation: 270,
    mirror: "none",
  };
  // RX: an unowned two-pin device; pin "1" contact at (pos.x, pos.y-20).
  document.instances.push({
    id: "RX",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 420 }, rotation: 0, mirror: "none" },
    reference: "RX",
    netlist: { parameters: {} },
  });
  return document;
}

function runMove(options: {
  instanceId: string;
  origin: { x: number; y: number };
  pinStart: { x: number; y: number };
  target: { x: number; y: number };
}) {
  const document = fixtureDocument();
  const statuses: string[] = [];
  const transactions: {
    intent: RoutingOperationIntent;
    edits: readonly SchematicEdit[];
    result?: ReturnType<typeof executeTransaction>;
  }[] = [];
  const transactConnectivity = (
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
  ) => {
    const record: (typeof transactions)[number] = { intent, edits };
    transactions.push(record);
    const proposal = createRoutingOperationPlan(document, {
      intent,
      edits,
      diagnostics: [],
    });
    const gate = gateRoutingOperationPlan(document, proposal, {
      symbolResolver: resolver,
    });
    if (!gate.ok) {
      statuses.push(gate.message);
      return null;
    }
    const result = executeTransaction(
      document,
      {
        transactionId: "bond-commit",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...gate.edits],
      },
      { symbolResolver: resolver },
    );
    record.result = result;
    if (!result.ok)
      statuses.push(`${result.error.code}: ${result.error.message}`);
    return { ok: result.ok };
  };
  const controller = createSelectionMoveController({
    document,
    resolver,
    visibleEndpoints: [],
    routeGeometryRecords: [],
    contactComponents: [],
    transactConnectivity,
    setStatus: (status) => statuses.push(status),
    nextRoutingSuffix: () => 1,
  });
  const movePlan = planSelectionMove(document, {
    instanceIds: [options.instanceId],
    routeIds: [],
    junctionIds: [],
    annotationIds: [],
    draftingIds: [],
  });
  const preview = {
    instanceIds: movePlan.instanceIds,
    primaryInstanceId: options.instanceId,
    originalPositions: { [options.instanceId]: options.origin },
    pointerStart: { x: 500, y: 500 },
    movePlan,
  };
  // Land the moving pin exactly on the target contact.
  const position = {
    x: 500 + (options.target.x - options.pinStart.x),
    y: 500 + (options.target.y - options.pinStart.y),
  };
  const resolved = controller.resolveInstanceMove(
    preview,
    position,
    7,
    false,
    undefined,
    document,
  );
  controller.completeInstanceMove(preview, position, 7, false, resolved.snap, {
    document,
    prefixEdits: [],
    resolvedMove: resolved,
  });
  return { resolved, statuses, transactions };
}

const netOf = (
  document: SchematicDocument,
  endpoint: Extract<RouteEndpoint, { kind: "terminal" }>,
): string | null =>
  document.nets.find((net) =>
    net.terminals.some(
      (candidate) =>
        candidate.instanceId === endpoint.instanceId &&
        candidate.pinName === endpoint.pinName,
    ),
  )?.id ?? null;

describe("pin-onto-pin move bond", () => {
  it("bonds an unowned pin dropped on a foreign pin into its net", () => {
    const { resolved, statuses, transactions } = runMove({
      instanceId: "RX",
      origin: { x: 100, y: 420 },
      pinStart: { x: 100, y: 400 },
      target: { x: 0, y: 200 },
    });
    expect(resolved.snap.electricalMatch?.target.electrical?.kind).toBe(
      "endpoint",
    );
    const edits = transactions.flatMap((t) => t.edits);
    expect(edits.some((edit) => edit.kind === "connect_endpoints")).toBe(true);
    const committed = transactions.find((t) => t.result?.ok);
    expect(committed).toBeDefined();
    const after = committed!.result!;
    if (!after.ok) throw new Error("expected ok");
    expect(
      netOf(after.document, {
        kind: "terminal",
        instanceId: "RX",
        pinName: "1",
      }),
    ).toBe(
      netOf(after.document, {
        kind: "terminal",
        instanceId: "C",
        pinName: "P",
      }),
    );
    expect(statuses.some((s) => s.includes("Snapped pin endpoints"))).toBe(
      true,
    );
  });

  it("joins two differently named nets and retires both names", () => {
    // E rides net-h (HORIZONTAL); C rides net-v (VERTICAL). Bringing the pin
    // to rest on the other Net joins them like any other contact. Neither
    // name survives the join — the author named two nodes to say they were
    // different, and that statement is what the gesture revokes — so the
    // labels go with the names rather than one being chosen for them.
    const { statuses, transactions } = runMove({
      instanceId: "E",
      origin: { x: 30, y: 400 },
      pinStart: { x: 30, y: 390 },
      target: { x: 0, y: 200 },
    });
    const edits = transactions.flatMap((t) => t.edits);
    expect(edits.some((edit) => edit.kind === "connect_endpoints")).toBe(true);
    expect(
      edits.filter((edit) => edit.kind === "remove_schematic_annotation"),
    ).toHaveLength(2);
    expect(transactions.some((t) => t.result?.ok)).toBe(true);
    expect(statuses.some((s) => s.includes("Moved without connecting"))).toBe(
      false,
    );
  });
});

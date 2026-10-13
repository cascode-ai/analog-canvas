import {
  createEmptyDocument,
  createRoutePath,
  freezeSnapshot,
} from "@icm/model";
import {
  resolveRouteGeometry,
  resolveEndpointConnection,
  resolveDocumentRoutingGeometry,
  resolveVisualAnchor,
} from "@icm/derived";
import {
  executeTransaction,
  gateRoutingOperationPlan,
  prepareInstanceContactTransform,
} from "@icm/edit-engine";
import * as transactionRuntime from "../../../../../packages/edit-engine/src/transaction";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";
import { createSelectionMoveController } from "./selection-move-controller";
import { planSelectionMove } from "./selection-move-plan";
import { EMPTY_VISUAL_SELECTION } from "./visual-selection";

describe("prepared instance movement", () => {
  it("preserves separately named Nets and their shared contacts during joint translation", () => {
    const document = createEmptyDocument("unlicensed", "Unlicensed");
    document.instances = ["A", "B"].map((id) => ({
      id,
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    }));
    document.nets = ["A", "B"].map((instanceId) => ({
      id: `net-${instanceId}`,
      terminals: [{ instanceId, pinName: "1" }],
    }));
    document.nets.push({
      id: "shared",
      terminals: ["A", "B"].map((instanceId) => ({ instanceId, pinName: "2" })),
    });
    freezeSnapshot(document);
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      nextRoutingSuffix: () => 1,
      setStatus: () => {},
      transactConnectivity: () => {
        throw new Error("Preview must not commit");
      },
    });
    const preview = {
      instanceIds: ["A", "B"],
      primaryInstanceId: "A",
      originalPositions: { A: { x: 0, y: 0 }, B: { x: 0, y: 0 } },
      pointerStart: { x: 0, y: 0 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["A", "B"],
      }),
    };
    const plan = prepareInstanceContactTransform(document, resolver, {
      instanceIds: ["A", "B"],
      routeIds: [],
      junctionIds: [],
    })({ x: 30, y: 10 }, false);
    const strict = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    const moved = controller.resolveSelectionMove(
      preview,
      { x: 30, y: 10 },
      4,
      true,
    );
    if (!strict.ok) throw new Error(strict.message);
    expect(moved.preparationError).toBeUndefined();
    expect(moved.prepared!.previewDocument.nets).toEqual(
      strict.evaluated.finalDocument.nets,
    );
    expect(moved.prepared!.previewDocument.instances).toEqual(
      strict.evaluated.finalDocument.instances,
    );
    expect(moved.prepared!.previewDocument.nets).toHaveLength(3);
  });
  it.each([
    { name: "mutable source", frozen: false, background: 1000, delta: 30 },
    {
      name: "overlapping stationary conductors",
      frozen: true,
      background: 1000,
      delta: 1000,
    },
    {
      name: "extreme translated coordinates",
      frozen: true,
      background: 1000,
      delta: 2 ** 25,
    },
  ])(
    "retains the exact evaluated preview for $name",
    ({ frozen, background, delta }) => {
      const document = createEmptyDocument("guard", "Guard");
      document.instances = ["A", "B", "C"].map((id) => ({
        id,
        symbolId: "resistor",
        placement: {
          position: { x: id === "C" ? background : 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      }));
      document.nets = ["1", "2"].map((pinName) => ({
        id: `n${pinName}`,
        terminals: ["A", "B"].map((instanceId) => ({ instanceId, pinName })),
      }));
      if (frozen) freezeSnapshot(document);
      const resolver = new InMemorySymbolResolver(builtInSymbols);
      const controller = createSelectionMoveController({
        document,
        resolver,
        visibleEndpoints: [],
        routeGeometryRecords: [],
        contactComponents: [],
        nextRoutingSuffix: () => 1,
        setStatus: () => {},
        transactConnectivity: () => {
          throw new Error("Preview must not commit");
        },
      });
      const preview = {
        instanceIds: ["A", "B"],
        primaryInstanceId: "A",
        originalPositions: { A: { x: 0, y: 0 }, B: { x: 0, y: 0 } },
        pointerStart: { x: 0, y: 0 },
        movePlan: planSelectionMove(document, {
          ...EMPTY_VISUAL_SELECTION,
          instanceIds: ["A", "B"],
        }),
      };
      const moved = controller.resolveSelectionMove(
        preview,
        { x: delta, y: 0 },
        4,
        true,
      );
      expect(moved.preparationError).toBeUndefined();
      const prepared = moved.prepared!;
      const strict = gateRoutingOperationPlan(document, prepared.plan, {
        symbolResolver: resolver,
      });
      if (!strict.ok) throw new Error(strict.message);
      expect(prepared.previewDocument).toEqual(strict.evaluated.finalDocument);
      expect(prepared.previewDocument.revision).toBe(document.revision + 1);
      controller.dispose();
    },
  );
  it.each([false, true])(
    "projects a closed contact, retaining strict label repair when required=%s",
    (repairLabel) => {
      const document = createEmptyDocument("joint-contact", "Joint contact");
      document.instances = ["A", "B", "background"].map((id) => ({
        id,
        symbolId: "resistor",
        placement: {
          position: { x: id === "background" ? 1000 : 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      }));
      document.nets = ["1", "2"].map((pinName) => ({
        id: `n${pinName}`,
        terminals: ["A", "B"].map((instanceId) => ({ instanceId, pinName })),
      }));
      document.junctions.push({
        id: "end",
        netId: "n2",
        position: { x: 0, y: 100 },
      });
      document.routes.push(
        createRoutePath({
          id: "internal",
          netId: "n2",
          start: { kind: "terminal", instanceId: "A", pinName: "2" },
          end: { kind: "junction", junctionId: "end" },
          bends: [],
          modes: ["manual"],
        }),
      );
      document.annotations.push({
        id: "net-label",
        kind: "net-label",
        netId: "n2",
        binding: { kind: "net-name", netId: "n2" },
        anchor: {
          kind: "route",
          routeId: "internal",
          legId: repairLabel ? "removed-leg" : document.routes[0]!.legs[0]!.id,
          t: 1,
          normalOffset: 0,
          direction: "forward",
          orientation: "horizontal",
          fallbackPosition: { x: 0, y: 300 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      freezeSnapshot(document);
      const resolver = new InMemorySymbolResolver(builtInSymbols);
      const controller = createSelectionMoveController({
        document,
        resolver,
        visibleEndpoints: [],
        routeGeometryRecords: [],
        contactComponents: [],
        nextRoutingSuffix: () => 1,
        setStatus: () => {},
        transactConnectivity: () => {
          throw new Error("Preview must not commit");
        },
      });
      const preview = {
        instanceIds: ["A", "B"],
        primaryInstanceId: "A",
        originalPositions: { A: { x: 0, y: 0 }, B: { x: 0, y: 0 } },
        pointerStart: { x: 0, y: 0 },
        movePlan: planSelectionMove(document, {
          ...EMPTY_VISUAL_SELECTION,
          instanceIds: ["A", "B"],
        }),
      };
      const transactionReads = vi.spyOn(
        transactionRuntime,
        "executeTransaction",
      );
      for (const [index, x] of [30, 50, -20].entries()) {
        const moved = controller.resolveSelectionMove(
          preview,
          { x, y: 10 },
          4,
          true,
        );
        // Observe the unchanged real writer. Only the first pointer frame may
        // qualify the source; subsequent eligible frames must do no full write.
        if (!repairLabel)
          expect(transactionReads).toHaveBeenCalledTimes(index === 0 ? 1 : 0);
        expect(moved.preparationError).toBeUndefined();
        expect(moved.prepared!.previewDocument.revision).toBe(
          document.revision + (repairLabel ? 1 : 0),
        );
        expect(
          moved
            .prepared!.previewDocument.instances.slice(0, 2)
            .map((i) => i.placement!.position),
        ).toEqual([
          { x, y: 10 },
          { x, y: 10 },
        ]);
        expect(moved.prepared!.previewDocument.nets).toEqual(document.nets);
        expect(moved.prepared!.visualRoutePoints).toBeDefined();
        const strict = gateRoutingOperationPlan(
          document,
          moved.prepared!.plan,
          {
            symbolResolver: resolver,
          },
        );
        transactionReads.mockClear();
        if (!strict.ok) throw new Error(strict.message);
        expect(
          resolveDocumentRoutingGeometry(
            moved.prepared!.previewDocument,
            resolver,
          ).routes,
        ).toEqual(
          resolveDocumentRoutingGeometry(
            strict.evaluated.finalDocument,
            resolver,
          ).routes,
        );
        expect(moved.prepared!.previewDocument.junctions).toEqual(
          strict.evaluated.finalDocument.junctions,
        );
        expect(
          resolveVisualAnchor(
            moved.prepared!.previewDocument,
            resolver,
            moved.prepared!.previewDocument.annotations[0]!.anchor,
          ),
        ).toEqual(
          resolveVisualAnchor(
            strict.evaluated.finalDocument,
            resolver,
            strict.evaluated.finalDocument.annotations[0]!.anchor,
          ),
        );
      }
      transactionReads.mockRestore();
      expect(document.instances[0]!.placement!.position).toEqual({
        x: 0,
        y: 0,
      });
    },
  );
  it("repaints DraftText on a stretched boundary wire from the committed geometry proposal", () => {
    const document = createEmptyDocument("boundary-text", "Boundary text");
    document.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const terminal = {
      kind: "terminal" as const,
      instanceId: "R",
      pinName: "1",
    };
    const pin = resolveEndpointConnection(
      document,
      resolver,
      terminal,
    )!.contactPoint;
    document.instances.push({
      id: "stationary",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 100 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "n",
      terminals: [
        { instanceId: "R", pinName: "1" },
        { instanceId: "stationary", pinName: "1" },
      ],
    });
    const route = createRoutePath({
      id: "wire",
      netId: "n",
      start: terminal,
      end: { kind: "terminal", instanceId: "stationary", pinName: "1" },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(route);
    const geometry = resolveRouteGeometry(document, resolver, route)!;
    document.drafting = {
      objects: [
        {
          id: "note",
          kind: "text",
          content: { runs: [{ kind: "text", value: "follows leg" }] },
          anchor: {
            kind: "route",
            routeId: "wire",
            legId: geometry.segments[0]!.address.legId,
            t: 0.5,
            normalOffset: 12,
            direction: "forward",
            orientation: "horizontal",
            fallbackPosition: { x: 200, y: pin.y + 12 },
          },
          alignment: "start",
          rotation: 0,
          locked: false,
          zIndex: 0,
        },
      ],
    };
    let committed = document;
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [{ route, geometry }],
      contactComponents: [],
      nextRoutingSuffix: () => 1,
      setStatus: () => {},
      transactConnectivity: (_intent, edits) => {
        const result = executeTransaction(
          document,
          {
            transactionId: "release",
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "human", id: "test" },
            edits: [...edits],
          },
          { symbolResolver: resolver },
        );
        if (result.ok) committed = result.document;
        return result;
      },
    });
    const preview = {
      instanceIds: ["R"],
      primaryInstanceId: "R",
      originalPositions: { R: { x: 100, y: 100 } },
      pointerStart: { x: 100, y: 100 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R"],
      }),
    };
    const moved = controller.resolveSelectionMove(
      preview,
      { x: 140, y: 100 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    const projected = moved.prepared!.previewDocument;
    const before = resolveVisualAnchor(
      document,
      resolver,
      document.drafting.objects[0]!.anchor,
    ).position;
    const during = resolveVisualAnchor(
      projected,
      resolver,
      projected.drafting!.objects[0]!.anchor,
    ).position;
    expect(during).not.toEqual(before);
    expect(moved.prepared!.visualRoutePoints).toBeUndefined();
    controller.completeSelectionMove(
      preview,
      { x: 140, y: 100 },
      4,
      true,
      undefined,
      { document, prefixEdits: [], resolvedMove: moved },
    );
    expect(
      resolveVisualAnchor(
        committed,
        resolver,
        committed.drafting!.objects[0]!.anchor,
      ).position,
    ).toEqual(during);
  });

  it("repaints an unselected arrow's moving attached endpoint without translating its fixed endpoint", () => {
    const document = createEmptyDocument("attached-arrow", "Attached arrow");
    document.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    document.drafting = {
      objects: [
        {
          id: "arrow",
          kind: "arrow",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 200, y: 100 } },
          from: {
            kind: "object",
            objectId: "R",
            localOffset: { x: 60, y: 0 },
            fallbackPosition: { x: 160, y: 100 },
          },
          to: { kind: "free", position: { x: 300, y: 100 } },
        },
      ],
    };
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      nextRoutingSuffix: () => 1,
      setStatus: () => {},
      transactConnectivity: () => {
        throw new Error("Preview must not commit");
      },
    });
    const moved = controller.resolveSelectionMove(
      {
        instanceIds: ["R"],
        primaryInstanceId: "R",
        originalPositions: { R: { x: 100, y: 100 } },
        pointerStart: { x: 100, y: 100 },
        movePlan: planSelectionMove(document, {
          ...EMPTY_VISUAL_SELECTION,
          instanceIds: ["R"],
        }),
      },
      { x: 140, y: 100 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    expect(moved.prepared!.visualRoutePoints).toBeUndefined();
    const arrow = moved.prepared!.previewDocument.drafting!.objects[0]!;
    if (arrow.kind !== "arrow") throw new Error("Expected arrow");
    expect(
      resolveVisualAnchor(moved.prepared!.previewDocument, resolver, arrow.from)
        .position,
    ).toEqual({ x: 200, y: 100 });
    expect(
      resolveVisualAnchor(moved.prepared!.previewDocument, resolver, arrow.to)
        .position,
    ).toEqual({ x: 300, y: 100 });
  });

  it("keeps a stationary-wire marker's constrained preview equal to its proposal", () => {
    const document = createEmptyDocument("marker", "Marker");
    document.nets.push({ id: "n", terminals: [] });
    document.junctions.push(
      { id: "a", netId: "n", position: { x: 100, y: 100 } },
      { id: "b", netId: "n", position: { x: 300, y: 100 } },
    );
    const route = createRoutePath({
      id: "wire",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(route);
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const geometry = resolveRouteGeometry(document, resolver, route)!;
    document.annotations.push({
      id: "current",
      kind: "route-marker",
      markerKind: "current",
      netId: "n",
      anchor: {
        kind: "route",
        routeId: "wire",
        legId: geometry.segments[0]!.address.legId,
        t: 0.5,
        normalOffset: 20,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 200, y: 120 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [{ route, geometry }],
      contactComponents: [],
      setStatus: () => {},
      nextRoutingSuffix: () => 1,
      transactConnectivity: () => {
        throw new Error("Preview must not commit");
      },
    });
    const preview = {
      instanceIds: [],
      primaryInstanceId: null,
      originalPositions: {},
      pointerStart: { x: 200, y: 120 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        annotationIds: ["current"],
      }),
    };
    const moved = controller.resolveSelectionMove(
      preview,
      { x: 220, y: 180 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    expect(moved.prepared!.previewDocument.routes).toEqual(document.routes);
    expect(
      moved.prepared!.previewDocument.annotations[0]!.anchor,
    ).toMatchObject({ kind: "route", t: 0.6, normalOffset: 40 });
    // Shaft stays on its wire while the label reaches the 40-unit band:
    // translating their entire SVG group cannot paint this proposal.
    expect(moved.prepared!.visualRoutePoints).toBeUndefined();
  });

  it("prepares visual-only text movement through the same proposal and commit path", () => {
    const document = createEmptyDocument("visual-move", "Visual move");
    document.drafting = {
      objects: [
        {
          id: "note",
          kind: "text",
          content: { runs: [{ kind: "text", value: "note" }] },
          anchor: { kind: "free", position: { x: 13, y: 7 } },
          alignment: "start",
          rotation: 0,
          locked: false,
          zIndex: 0,
        },
      ],
    };
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    let committed = document;
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      setStatus: () => {},
      nextRoutingSuffix: () => 1,
      transactConnectivity: (_intent, edits) => {
        const result = executeTransaction(
          document,
          {
            transactionId: "release",
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "human", id: "test" },
            edits: [...edits],
          },
          { symbolResolver: resolver },
        );
        if (result.ok) committed = result.document;
        return result;
      },
    });
    const preview = {
      instanceIds: [],
      primaryInstanceId: null,
      originalPositions: {},
      pointerStart: { x: 13, y: 7 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        draftingIds: ["note"],
      }),
    };
    const moved = controller.resolveSelectionMove(
      preview,
      { x: 33, y: 17 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    expect(moved.prepared!.previewDocument.revision).toBe(document.revision);
    expect(
      moved.prepared!.previewDocument.drafting!.objects[0]!.anchor,
    ).toEqual({ kind: "free", position: { x: 33, y: 17 } });
    controller.completeSelectionMove(
      preview,
      { x: 33, y: 17 },
      4,
      true,
      undefined,
      { document, prefixEdits: [], resolvedMove: moved },
    );
    expect(committed.drafting!.objects[0]!.anchor).toEqual({
      kind: "free",
      position: { x: 33, y: 17 },
    });
    expect(committed.revision).toBe(document.revision + 1);
  });

  it.each(["locked", "route-anchored"] as const)(
    "does not preview an independent move for %s DraftText",
    (kind) => {
      const document = createEmptyDocument("fixed-text", "Fixed text");
      document.instances.push({
        id: "R",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.nets.push({ id: "wire-net", terminals: [] });
      document.junctions.push(
        { id: "a", netId: "wire-net", position: { x: 300, y: 100 } },
        { id: "b", netId: "wire-net", position: { x: 500, y: 100 } },
      );
      document.routes.push(
        createRoutePath({
          id: "wire",
          netId: "wire-net",
          start: { kind: "junction", junctionId: "a" },
          end: { kind: "junction", junctionId: "b" },
          bends: [],
          modes: ["manual"],
        }),
      );
      const resolver = new InMemorySymbolResolver(builtInSymbols);
      const geometry = resolveRouteGeometry(
        document,
        resolver,
        document.routes[0]!,
      )!;
      document.drafting = {
        objects: [
          {
            id: "note",
            kind: "text",
            content: { runs: [{ kind: "text", value: "fixed" }] },
            anchor:
              kind === "locked"
                ? { kind: "free", position: { x: 400, y: 112 } }
                : {
                    kind: "route",
                    routeId: "wire",
                    legId: geometry.segments[0]!.address.legId,
                    t: 0.5,
                    normalOffset: 12,
                    direction: "forward",
                    orientation: "horizontal",
                    fallbackPosition: { x: 400, y: 112 },
                  },
            alignment: "start",
            rotation: 0,
            locked: kind === "locked",
            zIndex: 0,
          },
        ],
      };
      const controller = createSelectionMoveController({
        document,
        resolver,
        visibleEndpoints: [],
        routeGeometryRecords: [{ route: document.routes[0]!, geometry }],
        contactComponents: [],
        transactConnectivity: () => {
          throw new Error("Preview must not commit");
        },
        setStatus: () => {},
        nextRoutingSuffix: () => 1,
      });
      const movePlan = planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R"],
        draftingIds: ["note"],
      });
      expect(movePlan.previewObjectIds).not.toContain("note");
      expect(movePlan.fixedObjectIds).toContain("note");
      const moved = controller.resolveSelectionMove(
        {
          instanceIds: ["R"],
          primaryInstanceId: "R",
          originalPositions: { R: { x: 100, y: 100 } },
          pointerStart: { x: 100, y: 100 },
          movePlan,
        },
        { x: 120, y: 110 },
        4,
        true,
      );
      expect(moved.preparationError).toBeUndefined();
      expect(
        moved.prepared!.previewDocument.drafting!.objects[0]!.anchor,
      ).toEqual(document.drafting!.objects[0]!.anchor);
    },
  );

  it("carries a route-anchored Net Label once when its loose wire moves with the group", () => {
    const document = createEmptyDocument("wire-label-move", "Wire label move");
    document.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 200 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({ id: "loose", terminals: [] });
    document.junctions.push(
      { id: "a", netId: "loose", position: { x: 100, y: 100 } },
      { id: "b", netId: "loose", position: { x: 200, y: 100 } },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "loose",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const geometry = resolveRouteGeometry(
      document,
      resolver,
      document.routes[0]!,
    )!;
    document.annotations.push({
      id: "label",
      kind: "net-label",
      netId: "loose",
      binding: { kind: "net-name", netId: "loose" },
      anchor: {
        kind: "route",
        routeId: "wire",
        legId: geometry.segments[0]!.address.legId,
        t: 0.5,
        normalOffset: 12,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 150, y: 112 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [{ route: document.routes[0]!, geometry }],
      contactComponents: [],
      transactConnectivity: () => {
        throw new Error("Preview must not commit");
      },
      setStatus: () => {},
      nextRoutingSuffix: () => 1,
    });
    const moved = controller.resolveSelectionMove(
      {
        instanceIds: ["R"],
        primaryInstanceId: "R",
        originalPositions: { R: { x: 100, y: 200 } },
        pointerStart: { x: 100, y: 200 },
        movePlan: planSelectionMove(document, {
          ...EMPTY_VISUAL_SELECTION,
          instanceIds: ["R"],
          routeIds: ["wire"],
          annotationIds: ["label"],
        }),
      },
      { x: 120, y: 210 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    const projected = moved.prepared!.previewDocument;
    expect(
      resolveVisualAnchor(projected, resolver, projected.annotations[0]!.anchor)
        .position,
    ).toEqual({ x: 170, y: 122 });
    expect(projected.annotations[0]!.anchor).toEqual(
      document.annotations[0]!.anchor,
    );
    expect(projected.annotations[0]!.binding).toEqual(
      document.annotations[0]!.binding,
    );
  });

  it.each([false, true])(
    "carries anchored DraftText exactly once with its host (explicit selection: %s)",
    (explicitlySelected) => {
      const document = createEmptyDocument("following-text", "Following text");
      document.instances.push({
        id: "R",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.drafting = {
        objects: [
          {
            id: "note",
            kind: "text",
            content: { runs: [{ kind: "text", value: "note" }] },
            anchor: {
              kind: "object",
              objectId: "R",
              localOffset: { x: 13, y: 7 },
              fallbackPosition: { x: 113, y: 107 },
            },
            alignment: "start",
            rotation: 0,
            locked: false,
            zIndex: 0,
          },
        ],
      };
      const resolver = new InMemorySymbolResolver(builtInSymbols);
      const controller = createSelectionMoveController({
        document,
        resolver,
        visibleEndpoints: [],
        routeGeometryRecords: [],
        contactComponents: [],
        transactConnectivity: () => {
          throw new Error("Preview must not commit");
        },
        setStatus: () => {},
        nextRoutingSuffix: () => 1,
      });
      const movePlan = planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R"],
        draftingIds: explicitlySelected ? ["note"] : [],
      });
      expect(movePlan.previewObjectIds).toContain("note");
      const moved = controller.resolveSelectionMove(
        {
          instanceIds: ["R"],
          primaryInstanceId: "R",
          originalPositions: { R: { x: 100, y: 100 } },
          pointerStart: { x: 100, y: 100 },
          movePlan,
        },
        { x: 120, y: 110 },
        4,
        true,
      );
      expect(moved.preparationError).toBeUndefined();
      const projected = moved.prepared!.previewDocument;
      expect(
        resolveVisualAnchor(
          projected,
          resolver,
          projected.drafting!.objects[0]!.anchor,
        ).position,
      ).toEqual({ x: 133, y: 117 });
      expect(projected.drafting!.objects[0]!.anchor).toEqual(
        document.drafting!.objects[0]!.anchor,
      );
    },
  );

  it("moves selected object-anchored text with the group, preserving its fine offset from a stationary host", () => {
    const document = createEmptyDocument("text-move", "Text move");
    for (const [id, x] of [
      ["R", 100],
      ["stationary", 200],
    ] as const)
      document.instances.push({
        id,
        symbolId: "resistor",
        placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
      });
    document.drafting = {
      objects: [
        {
          id: "note",
          kind: "text",
          content: { runs: [{ kind: "text", value: "note" }] },
          anchor: {
            kind: "object",
            objectId: "stationary",
            localOffset: { x: 13, y: 7 },
            fallbackPosition: { x: 213, y: 107 },
          },
          alignment: "start",
          rotation: 0,
          locked: false,
          zIndex: 0,
        },
      ],
    };
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    let committed = document;
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity: (_intent, edits) => {
        const result = executeTransaction(
          document,
          {
            transactionId: "release",
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "human", id: "test" },
            edits: [...edits],
          },
          { symbolResolver: resolver },
        );
        if (result.ok) committed = result.document;
        return result;
      },
      setStatus: () => {},
      nextRoutingSuffix: () => 1,
    });
    const preview = {
      instanceIds: ["R"],
      primaryInstanceId: "R",
      originalPositions: { R: { x: 100, y: 100 } },
      pointerStart: { x: 100, y: 100 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R"],
        draftingIds: ["note"],
      }),
    };
    const moved = controller.resolveSelectionMove(
      preview,
      { x: 120, y: 110 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    const projected = moved.prepared!.previewDocument;
    // A coordinate preview is not a transaction or a new Document revision.
    expect(projected.revision).toBe(document.revision);
    expect(
      resolveVisualAnchor(
        projected,
        resolver,
        projected.drafting!.objects[0]!.anchor,
      ).position,
    ).toEqual({ x: 233, y: 117 });
    controller.completeSelectionMove(preview, { x: 120, y: 110 }, 4, true);
    expect(
      resolveVisualAnchor(
        committed,
        resolver,
        committed.drafting!.objects[0]!.anchor,
      ).position,
    ).toEqual({ x: 233, y: 117 });
    expect(
      committed.instances.find((instance) => instance.id === "stationary")!
        .placement!.position,
    ).toEqual({ x: 200, y: 100 });
    expect(committed.nets).toEqual(document.nets);
  });

  it("joins an external pin without joining a coincident carried Junction", () => {
    const document = createEmptyDocument(
      "external-contact",
      "External contact",
    );
    document.instances.push(
      {
        id: "R",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "target",
        symbolId: "resistor",
        placement: { position: { x: 120, y: 60 }, rotation: 0, mirror: "none" },
      },
    );
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const carriedContact = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId: "R",
      pinName: "1",
    })!.contactPoint;
    document.nets.push({ id: "loose", terminals: [] });
    document.junctions.push(
      { id: "a", netId: "loose", position: carriedContact },
      {
        id: "b",
        netId: "loose",
        position: { x: carriedContact.x + 100, y: carriedContact.y },
      },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "loose",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const target = {
      kind: "terminal" as const,
      instanceId: "target",
      pinName: "2",
    };
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [
        target,
        { kind: "terminal" as const, instanceId: "R", pinName: "1" },
      ].map((endpoint) => ({
        endpoint,
        connection: resolveEndpointConnection(document, resolver, endpoint)!,
        netId: null,
        preludeEdits: [],
      })),
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity: () => {
        throw new Error("Preview must not commit");
      },
      setStatus: () => {},
      nextRoutingSuffix: () => 1,
    });
    const moved = controller.resolveSelectionMove(
      {
        instanceIds: ["R"],
        primaryInstanceId: "R",
        originalPositions: { R: { x: 100, y: 100 } },
        pointerStart: { x: 100, y: 100 },
        movePlan: planSelectionMove(document, {
          ...EMPTY_VISUAL_SELECTION,
          instanceIds: ["R"],
          routeIds: ["wire"],
          junctionIds: ["a", "b"],
        }),
      },
      { x: 120, y: 100 },
      4,
      false,
    );
    expect(moved.preparationError).toBeUndefined();
    expect(moved.snap.electricalMatch?.target.id).toContain("target");
    const finalDocument = moved.prepared!.previewDocument;
    expect(
      finalDocument.nets.find((net) => net.id === "loose")!.terminals,
    ).toEqual([]);
    expect(
      finalDocument.nets.some(
        (net) =>
          net.terminals.some((pin) => pin.instanceId === "R") &&
          net.terminals.some((pin) => pin.instanceId === "target"),
      ),
    ).toBe(true);
  });

  it("never contacts its own carried loose wire or Junction while moving a mixed selection", () => {
    const document = createEmptyDocument("mixed", "Mixed");
    document.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const contact = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId: "R",
      pinName: "1",
    })!.contactPoint;
    document.nets.push({ id: "loose", terminals: [] });
    document.junctions.push(
      {
        id: "a",
        netId: "loose",
        position: { x: contact.x + 10, y: contact.y },
      },
      {
        id: "b",
        netId: "loose",
        position: { x: contact.x + 110, y: contact.y },
      },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "loose",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.annotations.push({
      id: "label",
      kind: "net-label",
      netId: "loose",
      binding: { kind: "net-name", netId: "loose" },
      anchor: { kind: "free", position: { x: 153, y: 57 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.drafting = {
      objects: [
        {
          id: "note",
          kind: "text",
          content: { runs: [{ kind: "text", value: "note" }] },
          anchor: { kind: "free", position: { x: 153, y: 140 } },
          alignment: "start",
          rotation: 0,
          locked: false,
          zIndex: 0,
        },
      ],
    };
    const endpoints = [
      { kind: "terminal" as const, instanceId: "R", pinName: "1" },
      { kind: "junction" as const, junctionId: "a" },
      { kind: "junction" as const, junctionId: "b" },
    ].map((endpoint) => ({
      endpoint,
      connection: resolveEndpointConnection(document, resolver, endpoint)!,
      netId: endpoint.kind === "junction" ? "loose" : null,
      preludeEdits: [],
    }));
    const geometry = resolveDocumentRoutingGeometry(document, resolver);
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: endpoints,
      routeGeometryRecords: document.routes.map((route) => ({
        route,
        geometry: geometry.routes.get(route.id)!,
      })),
      contactComponents: [],
      transactConnectivity: () => {
        throw new Error("Preview must not commit");
      },
      setStatus: () => {},
      nextRoutingSuffix: () => 1,
    });
    const preview = {
      instanceIds: ["R"],
      primaryInstanceId: "R",
      originalPositions: { R: { x: 100, y: 100 } },
      pointerStart: { x: 100, y: 100 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R"],
        routeIds: ["wire"],
        junctionIds: ["a", "b"],
        annotationIds: ["label"],
        draftingIds: ["note"],
      }),
    };
    const first = controller.resolveSelectionMove(
      preview,
      { x: 110, y: 100 },
      14,
      false,
    );
    expect(first.preparationError).toBeUndefined();
    expect(first.snap.electricalMatch).toBeUndefined();
    const next = controller.resolveSelectionMove(
      preview,
      { x: 120, y: 100 },
      14,
      false,
      first.snap,
    );
    expect(next.preparationError).toBeUndefined();
    expect(next.snap.delta).toEqual({ x: 20, y: 0 });
    expect(next.snap.electricalMatch).toBeUndefined();
    expect(
      next.prepared!.previewDocument.instances[0]!.placement!.position,
    ).toEqual({ x: 120, y: 100 });
  });

  it("shows the new branch while dragging a VDD pin off the middle of a wire", () => {
    const document = createEmptyDocument("tap", "Tap");
    document.instances.push({
      id: "VDD",
      symbolId: "vdd-port",
      placement: { position: { x: 100, y: 80 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "supply",
      terminals: [{ instanceId: "VDD", pinName: "P" }],
    });
    document.junctions.push(
      { id: "a", netId: "supply", position: { x: 0, y: 100 } },
      { id: "b", netId: "supply", position: { x: 200, y: 100 } },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "supply",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const setStatus = vi.fn();
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity: vi.fn(),
      setStatus,
      nextRoutingSuffix: () => 1,
    });
    const preview = {
      instanceIds: ["VDD"],
      primaryInstanceId: "VDD",
      originalPositions: { VDD: { x: 100, y: 80 } },
      pointerStart: { x: 100, y: 80 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["VDD"],
      }),
    };
    const moved = controller.resolveSelectionMove(
      preview,
      { x: 100, y: 20 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    const prepared = moved.prepared!;
    expect(prepared.visualRoutePoints).toBeUndefined(); // Topology changed, so render the complete projected document.
    const paths = prepared.previewDocument.routes.map(
      (r) =>
        resolveRouteGeometry(prepared.previewDocument, resolver, r)!.centerline,
    );
    expect(paths).toContainEqual([
      { x: 100, y: 40 },
      { x: 100, y: 100 },
    ]);
    const committed = executeTransaction(
      document,
      {
        transactionId: "release",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: prepared.plan.edits,
      },
      { symbolResolver: resolver },
    );
    if (!committed.ok) throw new Error(committed.error.message);
    expect(
      committed.document.routes.map(
        (r) =>
          resolveRouteGeometry(committed.document, resolver, r)!.centerline,
      ),
    ).toEqual(paths);
    expect(setStatus).not.toHaveBeenCalled();
  });
  it("accepts a return to the gesture origin as a no-op, without an error or commit", () => {
    const document = createEmptyDocument("move", "Move");
    document.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const transactConnectivity = vi.fn();
    const setStatus = vi.fn();
    const controller = createSelectionMoveController({
      document,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity,
      setStatus,
      nextRoutingSuffix: () => 1,
    });
    const preview = {
      instanceIds: ["R"],
      primaryInstanceId: "R",
      originalPositions: { R: { x: 100, y: 100 } },
      pointerStart: { x: 100, y: 100 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R"],
      }),
    };
    const away = controller.resolveSelectionMove(
      preview,
      { x: 140, y: 100 },
      4,
      true,
    );
    expect(away.preparationError).toBeUndefined();
    expect(
      away.prepared?.previewDocument.instances[0]!.placement!.position.x,
    ).toBe(140);
    // Ordinary pointer frames project the typed plan without executing a
    // whole-Document transaction. Release owns validation and the revision.
    expect(away.prepared?.previewDocument.revision).toBe(document.revision);
    expect(away.prepared?.visualRoutePoints).toBeDefined();
    const restored = controller.resolveSelectionMove(
      preview,
      { x: 100, y: 100 },
      4,
      true,
    );
    expect(restored.preparationError).toBeUndefined();
    expect(restored.prepared?.previewDocument).toEqual(document);
    controller.completeSelectionMove(preview, { x: 100, y: 100 }, 4, true);
    expect(transactConnectivity).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });
});

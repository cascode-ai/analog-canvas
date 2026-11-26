import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
} from "@icm/model";
import { executeTransaction, proposeRouteEndpointMove } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { resolveDocumentStyleProfile } from "@icm/derived";
import { defaultInstanceDisplayAnnotations } from "../features/instance-display/default-instance-display";

import {
  endpointTestId,
  instanceLabelAnnotationFor,
  maxRoutingCounter,
  nextDocumentObjectId,
  nextDocumentUniqueSuffix,
  nextProjectUniqueSuffix,
  occupiedDocumentObjectIds,
} from "./editor-document-helpers";

describe("editor document helpers", () => {
  it("uses stable endpoint identifiers and finds an instance label", () => {
    expect(
      endpointTestId({
        kind: "terminal",
        instanceId: "R1",
        pinName: "1",
      }),
    ).toBe("terminal-R1-1");
    expect(endpointTestId({ kind: "junction", junctionId: "J1" })).toBe(
      "junction-J1",
    );

    const document = createEmptyDocument("doc", "Doc");
    document.annotations.push({
      id: "label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      rotation: 0,
      alignment: "start",
      locked: false,
      visible: true,
      sizeScale: 1,
    });
    expect(instanceLabelAnnotationFor(document, "R1")?.id).toBe("label-R1");
    expect(instanceLabelAnnotationFor(document, "R2")).toBeUndefined();
  });

  it("does not confuse a literal master label with a live Reference label", () => {
    const document = createEmptyDocument("doc", "Doc");
    // Exercise the production master factory, not a synthetic instance-label:
    // a custom visual annotation now deliberately belongs to that latter kind.
    const instance = {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        instance,
        new InMemorySymbolResolver(builtInSymbols),
        resolveDocumentStyleProfile(document.presentation),
        { showDesignator: false, masterName: "master" },
      ),
    );
    expect(document.annotations).toHaveLength(1);
    expect(document.annotations[0]).toMatchObject({ kind: "instance-value" });
    expect(instanceLabelAnnotationFor(document, "R1")).toBeUndefined();
  });

  it("finds the highest generated routing counter across document objects", () => {
    const document = createEmptyDocument("doc", "Doc");
    document.nets.push({
      id: "net-ui-7",

      terminals: [],
    });
    document.routes.push(
      createRoutePath({
        id: "route-ui-12",
        netId: "net-ui-7",
        start: { kind: "junction", junctionId: "junction-ui-3" },
        end: { kind: "junction", junctionId: "junction-ui-3" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.junctions.push({
      id: "junction-ui-3",
      netId: "net-ui-7",
      position: { x: 0, y: 0 },
    });
    expect(maxRoutingCounter(document)).toBe(12);
  });

  it("sees the ids a re-pointed wire end authors", () => {
    // Re-pointing names its new Junction by the drag's suffix alone, so a
    // counter blind to that id would hand the same number out again after a
    // reload and the next re-point would be refused with "Junction already
    // exists". The two have to agree on the id family, and only a test that
    // runs the planner can say whether they still do.
    const document = createEmptyDocument("doc", "Doc");
    document.presentation.grid = 10;
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: { position: { x: 100, y: 60 }, rotation: 0, mirror: "none" },
    } as (typeof document)["instances"][number]);
    document.nets.push({
      id: "net-1",
      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });
    document.junctions.push({
      id: "junction-ui-3",
      netId: "net-1",
      position: { x: 100, y: 140 },
      role: "route-anchor",
    });
    document.routes.push(
      createRoutePath({
        id: "route-ui-3",
        netId: "net-1",
        start: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
        end: { kind: "junction", junctionId: "junction-ui-3" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const suffix = `ui-${maxRoutingCounter(document) + 1}`;
    const plan = proposeRouteEndpointMove(
      document,
      resolver,
      "route-ui-3",
      "start",
      { x: 200, y: 140 },
      suffix,
    );
    const result = executeTransaction(
      document,
      {
        transactionId: "repoint",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(maxRoutingCounter(result.document)).toBeGreaterThanOrEqual(4);
  });

  it("allocates non-colliding IDs for new boxes, labels, and arrows in an already-populated document (#2485)", () => {
    const document = createEmptyDocument("doc", "FIR diagram");
    document.drafting = {
      objects: [
        {
          id: "rectangle-1",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 100 } },
          center: { x: 100, y: 100 },
          width: 80,
          height: 40,
          rotation: 0,
          lineStyle: "solid",
        },
        {
          id: "note-2",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: {
            kind: "object",
            objectId: "rectangle-1",
            localOffset: { x: 0, y: 0 },
            fallbackPosition: { x: 100, y: 100 },
          },
          content: { runs: [{ kind: "text", value: "FIR" }] },
          alignment: "middle",
          rotation: 0,
        },
        {
          id: "arrow-3",
          kind: "arrow",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 140, y: 100 } },
          from: { kind: "free", position: { x: 140, y: 100 } },
          to: { kind: "free", position: { x: 200, y: 100 } },
        },
      ],
    };

    // Simulate a fresh session/reopened project where the local counter starts at 0.
    const counter = { current: 0 };
    const newRectId = nextDocumentObjectId(document, "rectangle", counter);
    expect(newRectId).not.toBe("rectangle-1");
    expect(newRectId).toBe("rectangle-2");

    // Reset counter to 1 so the next tick hits 2 (which is occupied by note-2 "FIR").
    counter.current = 1;
    const newLabelId = nextDocumentObjectId(document, "note", counter);
    expect(newLabelId).not.toBe("note-2");
    expect(newLabelId).toBe("note-3");

    // Reset counter to 2 so the next tick hits 3 (which is occupied by arrow-3).
    counter.current = 2;
    const newArrowId = nextDocumentObjectId(document, "arrow", counter);
    expect(newArrowId).not.toBe("arrow-3");
    expect(newArrowId).toBe("arrow-4");

    // Committing new objects using these IDs must leave FIR and arrow-3 intact.
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const result = executeTransaction(
      document,
      {
        transactionId: "add-second-box",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "upsert_drafting_object",
            object: {
              id: newRectId,
              kind: "rectangle",
              locked: false,
              zIndex: 0,
              anchor: { kind: "free", position: { x: 260, y: 100 } },
              center: { x: 260, y: 100 },
              width: 80,
              height: 40,
              rotation: 0,
              lineStyle: "solid",
            },
          },
          {
            kind: "upsert_drafting_object",
            object: {
              id: newLabelId,
              kind: "text",
              locked: false,
              zIndex: 0,
              anchor: {
                kind: "object",
                objectId: newRectId,
                localOffset: { x: 0, y: 0 },
                fallbackPosition: { x: 260, y: 100 },
              },
              content: { runs: [{ kind: "text", value: "ADC" }] },
              alignment: "middle",
              rotation: 0,
            },
          },
          {
            kind: "upsert_drafting_object",
            object: {
              id: newArrowId,
              kind: "arrow",
              locked: false,
              zIndex: 0,
              anchor: { kind: "free", position: { x: 300, y: 100 } },
              from: { kind: "free", position: { x: 300, y: 100 } },
              to: { kind: "free", position: { x: 360, y: 100 } },
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.document.drafting?.objects.map((object) => object.id);
    expect(ids).toEqual([
      "rectangle-1",
      "note-2",
      "arrow-3",
      "rectangle-2",
      "note-3",
      "arrow-4",
    ]);
  });

  it("advances document/project unique suffixes and routing counters past existing land- and trailing IDs", () => {
    const project = createEmptyProject("proj-1", "Project");
    const doc = project.documents[0]!;
    doc.junctions.push({
      id: "junction-land-9",
      netId: "net-ui-4",
      position: { x: 0, y: 0 },
    });
    doc.nets.push({ id: "net-ui-4", terminals: [] });
    doc.annotations.push({
      id: "net-label-15",
      kind: "net-label",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      content: { runs: [{ kind: "text", value: "OUT" }] },
      rotation: 0,
      alignment: "start",
      locked: false,
      visible: true,
      sizeScale: 1,
    });
    // A 13-digit timestamp suffix or substring match ("island-5") must not pollute the counter.
    doc.instanceGroups = [
      {
        id: "island-500",
        memberIds: [],
        collapsed: false,
      },
    ];
    const route = createRoutePath({
      id: "route-custom-a-ui-11",
      netId: "net-ui-4",
      start: { kind: "junction", junctionId: "junction-land-9" },
      end: { kind: "junction", junctionId: "junction-land-9" },
      bends: [{ x: 20, y: 0 }],
      modes: ["manual", "manual"],
    });
    doc.routes.push(route);
    const firstLeg = route.legs[0]!;
    const firstBendId =
      firstLeg.to.kind === "bend" ? firstLeg.to.bendId : undefined;
    expect(firstBendId).toBeDefined();
    doc.drafting = {
      objects: [
        {
          id: "note-1795662390390",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 10, y: 10 } },
          content: { runs: [{ kind: "text", value: "ts" }] },
          alignment: "start",
          rotation: 0,
        },
        {
          id: "land-1795662390390",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 20, y: 10 } },
          content: { runs: [{ kind: "text", value: "ts-land" }] },
          alignment: "start",
          rotation: 0,
        },
      ],
    };

    expect(maxRoutingCounter(doc)).toBe(11);
    const occupied = occupiedDocumentObjectIds(doc);
    expect(occupied.has(firstBendId!)).toBe(true);
    expect(occupied.has(firstLeg.id)).toBe(true);
    expect(occupied.has("island-500")).toBe(true);
    const counter = { current: 0 };
    expect(nextDocumentObjectId(doc, "island", { current: 499 })).toBe(
      "island-501",
    );
    expect(nextDocumentUniqueSuffix(doc, counter)).toBe(501);
    expect(nextProjectUniqueSuffix(project, counter)).toBe(502);
  });
});

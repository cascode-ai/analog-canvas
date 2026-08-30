import { createRoutePath } from "@icm/model";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyDocument, createEmptyProject } from "@icm/model";
import {
  executeProjectTransaction,
  executeTransaction,
  planRemoveCellTerminals,
  proposeVisualRouteDeletion,
} from "@icm/edit-engine";
import { parseProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  InMemorySymbolResolver,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  collectVisualRouteDeletion,
  explicitAnnotationRemovals,
  proposeConnectedInstanceDeletion,
  proposeSelectionRouteDeletion,
  proposeVisualSelectionDeletion,
} from "./delete-selection";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("connected instance deletion", () => {
  it("deletes the complete differential-op-amp Gallery scene atomically", () => {
    const project = parseProject(
      readFileSync(
        resolve(
          process.cwd(),
          "apps/editor/src/examples/fully-differential-two-stage-op-amp.icproj.json",
        ),
        "utf8",
      ),
    );
    const document = project.documents[0]!;
    const galleryResolver = createProjectSymbolResolver(
      project,
      builtInSymbols,
    );
    const deletionEdits = proposeVisualSelectionDeletion(
      document,
      galleryResolver,
      {
        instanceIds: document.instances.map((instance) => instance.id),
        routeIds: document.routes.map((route) => route.id),
        junctionIds: document.junctions.map((junction) => junction.id),
        annotationIds: document.annotations.map((annotation) => annotation.id),
        draftingIds: (document.drafting?.objects ?? []).map(
          (object) => object.id,
        ),
      },
      1,
    );
    const result = executeProjectTransaction(project, {
      transactionId: "delete-gallery-scene",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planRemoveCellTerminals(
        project,
        document.id,
        document.netlist!.terminals.map((terminal) => terminal.id),
        deletionEdits,
      ),
    });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.project.documents[0]).toMatchObject({
      instances: [],
      nets: [],
      connectivityEvidence: [],
      routes: [],
      junctions: [],
      annotations: [],
      netlist: { terminals: [] },
    });
    expect(result.project.documents[0]!.mosBulkDefaults).toBeUndefined();
  });

  it("does not remove an attached label twice in a mixed marquee deletion", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.annotations.push({
      id: "label-M1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "M1" }] },
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 0, y: 50 },
        fallbackPosition: { x: 100, y: 150 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    document.annotations.push({
      id: "free-net-label",
      kind: "net-label",
      content: { runs: [{ kind: "text", value: "VIN" }] },
      netId: "net-1",
      anchor: { kind: "free", position: { x: 220, y: 100 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    expect(
      explicitAnnotationRemovals(
        document,
        ["M1"],
        ["label-M1", "free-net-label"],
      ),
    ).toEqual(["free-net-label"]);
  });

  it("preserves routed wire geometry as a dangling Junction", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 240, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-1",

      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-1",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [{ x: 100, y: 80 }],
        modes: ["manual", "manual"],
      }),
    );

    const result = executeTransaction(
      document,
      {
        transactionId: "delete-connected",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposeConnectedInstanceDeletion(document, resolver, ["R1"], 1),
      },
      { symbolResolver: resolver },
    );
    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [{ id: "R2" }],
        nets: [{ terminals: [{ instanceId: "R2", pinName: "1" }] }],
        junctions: [
          {
            id: "junction-lifecycle-1-1",
            position: { x: 100, y: 120 },
          },
        ],
        routes: [
          {
            start: {
              kind: "junction",
              junctionId: "junction-lifecycle-1-1",
            },
            legs: [
              {},
              {
                to: {
                  kind: "endpoint",
                  endpoint: {
                    kind: "terminal",
                    instanceId: "R2",
                    pinName: "1",
                  },
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("deletes a MOS and its selected bulk route without scheduling bulk cleanup twice", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-body",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.junctions.push({
      id: "junction-body",
      netId: "net-body",
      position: { x: 180, y: 100 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-body",
        netId: "net-body",
        start: { kind: "terminal", instanceId: "M1", pinName: "B" },
        end: { kind: "junction", junctionId: "junction-body" },
        bends: [{ x: 100, y: 100 }],
        modes: ["escape", "manual"],
        presentation: "bulk-dashed",
      }),
    );

    const edits = proposeVisualSelectionDeletion(
      document,
      resolver,
      {
        instanceIds: ["M1"],
        routeIds: ["route-body"],
        junctionIds: ["junction-body"],
        annotationIds: [],
        draftingIds: [],
      },
      1,
    );
    expect(edits).not.toContainEqual({
      kind: "reconcile_mos_bulk",
      instanceIds: ["M1"],
    });

    const result = executeTransaction(
      document,
      {
        transactionId: "delete-mos-and-bulk-route",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits,
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.document).toMatchObject({
      instances: [],
      nets: [],
      routes: [],
      junctions: [],
    });
  });
});

function documentWithJunctionRoute() {
  const document = createEmptyProject("delete-routes", "Delete routes")
    .documents[0]!;
  document.nets.push({
    id: "net-1",

    terminals: [],
  });
  document.junctions.push(
    { id: "junction-left", netId: "net-1", position: { x: 100, y: 100 } },
    { id: "junction-right", netId: "net-1", position: { x: 200, y: 100 } },
  );
  document.routes.push(
    createRoutePath({
      id: "route-1",
      netId: "net-1",
      start: { kind: "junction", junctionId: "junction-left" },
      end: { kind: "junction", junctionId: "junction-right" },
      bends: [],
      modes: ["auto"],
    }),
  );
  return document;
}

function documentWithBranchedJunction() {
  const document = createEmptyProject("delete-branch", "Delete branch")
    .documents[0]!;
  document.nets.push({
    id: "net-1",

    terminals: [],
  });
  document.junctions.push(
    { id: "junction-center", netId: "net-1", position: { x: 100, y: 100 } },
    { id: "junction-left", netId: "net-1", position: { x: 0, y: 100 } },
    { id: "junction-right", netId: "net-1", position: { x: 200, y: 100 } },
    { id: "junction-bottom", netId: "net-1", position: { x: 100, y: 200 } },
  );
  document.routes.push(
    createRoutePath({
      id: "route-left",
      netId: "net-1",
      start: { kind: "junction", junctionId: "junction-left" },
      end: { kind: "junction", junctionId: "junction-center" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "route-right",
      netId: "net-1",
      start: { kind: "junction", junctionId: "junction-center" },
      end: { kind: "junction", junctionId: "junction-right" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "route-branch",
      netId: "net-1",
      start: { kind: "junction", junctionId: "junction-center" },
      end: { kind: "junction", junctionId: "junction-bottom" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

describe("collectVisualRouteDeletion", () => {
  it("cleans both orphan junction endpoints when a route is deleted", () => {
    expect(
      collectVisualRouteDeletion(documentWithJunctionRoute(), ["route-1"], []),
    ).toEqual({
      routeIds: ["route-1"],
      junctionIds: ["junction-left", "junction-right"],
    });
  });

  it("deletes every route attached to a selected junction before removing it", () => {
    expect(
      collectVisualRouteDeletion(
        documentWithJunctionRoute(),
        [],
        ["junction-left"],
      ),
    ).toEqual({
      routeIds: ["route-1"],
      junctionIds: ["junction-left", "junction-right"],
    });
  });

  it("deletes only the selected branch when its shared Junction is also inside the marquee", () => {
    const document = documentWithBranchedJunction();
    expect(
      collectVisualRouteDeletion(
        document,
        ["route-branch"],
        ["junction-center"],
      ),
    ).toEqual({
      routeIds: ["route-branch"],
      junctionIds: ["junction-bottom"],
    });
    const proposal = proposeSelectionRouteDeletion(
      document,
      ["route-branch"],
      ["junction-center"],
    );
    const result = executeTransaction(
      document,
      {
        transactionId: "delete-one-branch",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result).toMatchObject({
      ok: true,
      document: {
        routes: [{ id: "route-left" }],
        junctions: [{ id: "junction-left" }, { id: "junction-right" }],
      },
    });
  });

  it("submits the visual deletion closure without duplicate junction removals", () => {
    const document = documentWithJunctionRoute();
    const proposal = proposeVisualRouteDeletion(document, ["route-1"], []);
    expect(proposal.edits).toEqual([
      { kind: "cut_connection", routeId: "route-1" },
    ]);
    const result = executeTransaction(
      document,
      {
        transactionId: "delete-route",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result).toMatchObject({
      ok: true,
      document: { routes: [], junctions: [] },
    });
  });
});

import { freezeSnapshot } from "@icm/model";
import { proposePaste } from "./paste-proposal";
import { describe, expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import { deriveInternalGroupSelection } from "@icm/derived";
import { EditorDocumentController } from "../../document/document-controller";
import {
  captureProjectCopy,
  planProjectCopyPlacement,
  applyProjectCopyPlacement,
} from "./project-copy";
import {
  DENSE_COPY_COUNTS,
  createDenseCopyPerformanceProject,
} from "./test-support/dense-copy-fixture";

describe("dense copy workload", () => {
  it("captures a tile without resolving the geometry of a remote Junction", () => {
    const project = createDenseCopyPerformanceProject();
    const document = project.documents[0]!;
    const junction = document.junctions.at(-1)!;
    const position = junction.position;
    let reads = 0;
    Object.defineProperty(junction, "position", {
      get() {
        reads += 1;
        return position;
      },
    });

    const copied = captureProjectCopy(project, document, {
      instanceIds: [document.instances[0]!.id],
      routeIds: [document.routes[0]!.id],
      annotationIds: [],
      junctionIds: [],
      draftingIds: [],
    });

    expect(copied?.instances.map((item) => item.id)).toEqual(["R1"]);
    expect(copied?.routes.map((item) => item.id)).toContain(
      document.routes[0]!.id,
    );
    expect(reads).toBe(0);
  });

  it("copies different small selections and allocates their IDs without rereading distant routes on an owned Cell", () => {
    const project = createDenseCopyPerformanceProject();
    const document = project.documents[0]!;
    const far = document.routes.at(-1)!;
    const id = far.id;
    let reads = 0;
    Object.defineProperty(far, "id", {
      get() {
        reads++;
        return id;
      },
    });
    freezeSnapshot(project);
    function copy(tile: number) {
      const clipboard = captureProjectCopy(project, document, {
        instanceIds: [document.instances[tile * 4]!.id],
        routeIds: [document.routes[tile * 13]!.id],
        annotationIds: [],
        junctionIds: [],
        draftingIds: [],
      })!;
      return proposePaste(document, clipboard, { x: 18000, y: 0 }, 1, project);
    }
    expect(copy(0).edits.length).toBeGreaterThan(0);
    reads = 0;
    expect(copy(1).edits.length).toBeGreaterThan(0);
    expect(reads).toBe(0);
  });

  it("copies routed MOS/label tiles as one undoable operation and repeats after undo", () => {
    const project = parseProject(
      JSON.stringify(createDenseCopyPerformanceProject()),
    );
    const document = project.documents[0]!;
    for (const [kind, count] of Object.entries(DENSE_COPY_COUNTS))
      expect(document[kind as keyof typeof DENSE_COPY_COUNTS]).toHaveLength(
        count,
      );
    const instanceIds = document.instances
      .slice(0, 12)
      .map((instance) => instance.id);
    const internal = deriveInternalGroupSelection(document, instanceIds);
    const selection = {
      instanceIds,
      annotationIds: [],
      draftingIds: [],
      routeIds: internal.routeIds,
      junctionIds: internal.junctionIds,
    };
    const copied = captureProjectCopy(project, document, selection);
    if (!copied) throw new Error("Dense tile selection must be copyable");
    expect(copied.routes.length).toBeGreaterThan(0);
    expect(copied.annotations).toHaveLength(12);
    const plan = planProjectCopyPlacement(
      project,
      document,
      copied,
      { x: 18000, y: 0 },
      0,
    );
    const result = applyProjectCopyPlacement(plan);
    expect(result.documents[0]!.instances).toHaveLength(412);
    const controller = new EditorDocumentController(project);
    const original = structuredClone(controller.document);
    expect(
      controller.dispatchProjectTransaction({
        transactionId: "dense-copy",
        projectId: controller.project.id,
        expectedStructureRevision: controller.project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      }).ok,
    ).toBe(true);
    const committed = structuredClone(controller.document);
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect({ ...controller.document, revision: original.revision }).toEqual(
      original,
    );
    expect(controller.canUndo).toBe(false);
    expect(controller.transact([{ kind: "redo" }]).ok).toBe(true);
    expect({ ...controller.document, revision: committed.revision }).toEqual(
      committed,
    );
    const repeat = applyProjectCopyPlacement(
      planProjectCopyPlacement(
        project,
        document,
        copied,
        { x: 18000, y: 0 },
        0,
      ),
    );
    expect(repeat).toEqual(result);
  }, 30_000); // Dense full-transaction/history contract, not a timing budget.
});

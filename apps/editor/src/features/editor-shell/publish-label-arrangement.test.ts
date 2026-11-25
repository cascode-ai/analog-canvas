import {
  evaluateSubmissionGates,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { executeProjectTransaction } from "@icm/edit-engine";
import { createEmptyProject, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { createLabelClearanceContext } from "@icm/derived";
import { describe, expect, it } from "vitest";

import { defaultInstanceDisplayAnnotations } from "../instance-display/default-instance-display";
import {
  advisedLabelOwners,
  arrangeAdvisedLabelEdits,
} from "./publish-label-arrangement";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** RBIAS with its name moved by hand onto a wire, and R2 left clear. */
function fixture() {
  const project = createEmptyProject("p", "Labels", "doc");
  const document = project.documents[0]!;
  for (const [id, reference, x] of [
    ["r", "RBIAS", 100],
    ["r2", "R2", 400],
  ] as const) {
    const instance = {
      id,
      reference,
      symbolId: "resistor",
      placement: {
        position: { x, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: { parameters: { value: "1k" } },
    };
    document.instances.push(instance);
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        resolveDocumentStyleProfile(document.presentation),
        {},
      ),
    );
  }
  const name = document.annotations.find(
    (a) =>
      a.binding?.kind === "instance-reference" && a.binding.instanceId === "r",
  )!;
  const ink = createLabelClearanceContext(document, resolver).measure(
    name,
  ).inkBounds;
  const even = (value: number) => 2 * Math.round(value / 2);
  const y = even(ink.y + ink.height / 2);
  document.nets.push({ id: "n", terminals: [] });
  document.junctions.push(
    { id: "a", netId: "n", position: { x: even(ink.x) - 40, y } },
    { id: "b", netId: "n", position: { x: even(ink.x + ink.width) + 40, y } },
  );
  document.routes.push(
    createRoutePath({
      id: "w",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return { project, document, name };
}

function labelAdvice(project: ReturnType<typeof fixture>["project"]) {
  return evaluateSubmissionGates(project, resolver).failures.find(
    (failure) => failure.code === "label-clearance",
  );
}

describe("Publish's Arrange labels (#2619)", () => {
  it("arranges the advised part's labels in one undoable transaction", () => {
    const { project, document, name } = fixture();
    const report = evaluateSubmissionGates(project, resolver);
    expect(labelAdvice(project)?.findings).toEqual([
      expect.objectContaining({
        code: "VISUAL_LABEL_CLEARANCE",
        subject: "RBIAS",
        objectIds: [name.id, "w"],
      }),
    ]);
    // The part the struck label names, not the parts beside it.
    expect([...advisedLabelOwners(project, report)]).toEqual([
      [document.id, ["r"]],
    ]);
    const edits = arrangeAdvisedLabelEdits(project, resolver, report);
    expect(edits).toEqual([
      expect.objectContaining({
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
      }),
    ]);
    const result = executeProjectTransaction(project, {
      transactionId: "arrange",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelAdvice(result.project)).toBeUndefined();
    // R2's labels stay where they were.
    const r2Labels = (target: typeof project) =>
      target.documents[0]!.annotations.filter(
        (a) =>
          (a.binding?.kind === "instance-reference" ||
            a.binding?.kind === "instance-value") &&
          a.binding.instanceId === "r2",
      );
    expect(r2Labels(result.project)).toEqual(r2Labels(project));
  });

  it("asks nothing of a drawing with clear labels", () => {
    const { project } = fixture();
    project.documents[0]!.routes = [];
    const report = evaluateSubmissionGates(project, resolver);
    expect(labelAdvice(project)).toBeUndefined();
    expect(arrangeAdvisedLabelEdits(project, resolver, report)).toEqual([]);
    expect(arrangeAdvisedLabelEdits(project, resolver, null)).toEqual([]);
  });
});

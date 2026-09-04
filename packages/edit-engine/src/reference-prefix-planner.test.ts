import { createEmptyProject } from "@icm/model";
import type { Annotation, CircuitProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { executeProjectTransaction } from "./project-transaction.js";
import {
  annotationWithReferencePrefixHidden,
  planReferencePrefixDisplay,
} from "./reference-prefix-planner.js";

function projectWithLabelledResistor(reference = "RG1"): CircuitProject {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference,
      netlist: { parameters: { value: "1k" } },
    },
    // A signal-flow block carries no reference prefix policy at all.
    { id: "B1", symbolId: "gain", placement: null },
  );
  document.annotations.push({
    id: "label-R1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "R1" },
    anchor: { kind: "free", position: { x: 10, y: 10 } },
    alignment: "middle",
    rotation: 0,
    locked: false,
  } satisfies Annotation);
  return project;
}

describe("annotationWithReferencePrefixHidden", () => {
  it("removes the flag instead of persisting a default false", () => {
    const annotation: Annotation = {
      id: "label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: { kind: "free", position: { x: 10, y: 10 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
      referencePrefixHidden: true,
    };
    expect(
      "referencePrefixHidden" in
        annotationWithReferencePrefixHidden(annotation, false),
    ).toBe(false);
    expect(
      annotationWithReferencePrefixHidden(annotation, true)
        .referencePrefixHidden,
    ).toBe(true);
  });
});

describe("planReferencePrefixDisplay", () => {
  it("writes only the label presentation flag", () => {
    const project = projectWithLabelledResistor();
    const plan = planReferencePrefixDisplay(
      project,
      [{ documentId: project.topDocumentId, instanceId: "R1" }],
      true,
    );

    expect(plan.applicable).toHaveLength(1);
    expect(plan.edits).toEqual([
      {
        kind: "transact_document",
        documentId: project.topDocumentId,
        expectedRevision: 0,
        edits: [
          {
            kind: "upsert_schematic_annotation",
            annotation: {
              ...project.documents[0]!.annotations[0]!,
              referencePrefixHidden: true,
            },
          },
        ],
      },
    ]);

    const result = executeProjectTransaction(project, {
      transactionId: "hide-reference-prefix",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: plan.edits,
    });

    expect(result.ok).toBe(true);
    const committed = result.ok ? result.project.documents[0]! : undefined;
    expect(committed?.annotations[0]!.referencePrefixHidden).toBe(true);
    // The electrical name is the point: it must survive a display switch.
    expect(committed?.instances[0]!.reference).toBe("RG1");
  });

  it("reports what cannot or need not change", () => {
    const project = projectWithLabelledResistor();
    project.documents[0]!.annotations[0]!.referencePrefixHidden = true;
    const plan = planReferencePrefixDisplay(
      project,
      [
        { documentId: project.topDocumentId, instanceId: "R1" },
        { documentId: project.topDocumentId, instanceId: "B1" },
        { documentId: project.topDocumentId, instanceId: "missing" },
      ],
      true,
    );

    expect(plan.edits).toEqual([]);
    expect(plan.unchanged).toEqual([
      { documentId: project.topDocumentId, instanceId: "R1" },
    ]);
    expect(plan.incompatible).toMatchObject([
      { instanceId: "B1", reason: "Symbol carries no reference prefix" },
    ]);
    expect(plan.blocked).toMatchObject([
      { instanceId: "missing", reason: "Instance no longer exists" },
    ]);
  });

  it("refuses a component that draws no reference at all", () => {
    const project = projectWithLabelledResistor();
    project.documents[0]!.annotations = [];
    const plan = planReferencePrefixDisplay(
      project,
      [{ documentId: project.topDocumentId, instanceId: "R1" }],
      true,
    );

    expect(plan.edits).toEqual([]);
    expect(plan.incompatible).toMatchObject([
      { instanceId: "R1", reason: "Component shows no reference" },
    ]);
  });
});

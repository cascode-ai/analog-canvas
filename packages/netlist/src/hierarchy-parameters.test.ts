import { describe, expect, it } from "vitest";
import {
  executeProjectTransaction,
  planRenameCellParameter,
  planSetCellParameterDefault,
  type ProjectStructureEdit,
} from "../../edit-engine/src/index.js";
import { hierarchyParameterFixture } from "../../../netlists/hierarchy-parameters/fixture";
import { analyzeDesignNetlist } from "./extract.js";
import { printSpiceNetlist } from "./printers.js";

function apply(
  project: ReturnType<typeof hierarchyParameterFixture>,
  edits: ProjectStructureEdit[],
) {
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "parameter-acceptance",
    actor: { kind: "human", id: "test" },
    edits,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.project;
}

function deck(project: ReturnType<typeof hierarchyParameterFixture>) {
  const result = analyzeDesignNetlist(project);
  expect(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  ).toEqual([]);
  if (!result.ir) throw new Error("No executable netlist");
  return { text: printSpiceNetlist(result.ir), ir: result.ir };
}

describe("hierarchical parameter export acceptance", () => {
  it("preserves default/override scope through rename, default changes and override reset", () => {
    const original = hierarchyParameterFixture();
    const before = deck(original);
    expect(before.text).toContain("Rbase=1k");
    expect(before.text).toContain("{2*Rbase}");
    expect(before.text).toMatch(/X1 .* Resistors Rbase=2k/u);
    expect(before.text).toMatch(/X2 .* Resistors\n/u);
    const renamed = apply(
      original,
      planRenameCellParameter(original, "resistors", "Rbase", "Resistance"),
    );
    const afterRename = deck(renamed);
    expect(afterRename.text).not.toContain("Rbase");
    expect(afterRename.text).toContain("{2*Resistance}");
    expect(afterRename.text).toMatch(/X1 .* Resistors Resistance=2k/u);
    const changed = apply(
      renamed,
      planSetCellParameterDefault(renamed, "resistors", "Resistance", "3k"),
    );
    expect(deck(changed).text).toContain("Resistance=3k");
    expect(deck(changed).text).toMatch(/X1 .* Resistors Resistance=2k/u);
    const top = changed.documents[0]!;
    const reset = apply(changed, [
      {
        kind: "transact_document",
        documentId: top.id,
        expectedRevision: top.revision,
        edits: [
          {
            kind: "patch_instance_netlist_parameters",
            instanceId: "X1",
            unset: ["Resistance"],
          },
        ],
      },
    ]);
    expect(deck(reset).text).toMatch(/X1 .* Resistors\n/u);
    expect(deck(reset).ir.cells.map((cell) => cell.ports)).toEqual(
      before.ir.cells.map((cell) => cell.ports),
    );
  });
});

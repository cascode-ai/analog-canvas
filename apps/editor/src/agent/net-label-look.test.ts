import { createEmptyProject, roleLabelFormat } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planBrowserAgentCommand } from "./browser-agent-command.js";

it("gives a plain Agent voltage-node label the GUI's standard look", () => {
  const project = createEmptyProject("agent-label", "Agent label");
  const document = project.documents[0]!;
  document.nets.push({ id: "net-vbp", terminals: [] });
  const plan = planBrowserAgentCommand(
    project,
    document.id,
    createProjectSymbolResolver(project, builtInSymbols),
    {
      kind: "set-net-label",
      annotationId: "label-vbp",
      netId: "net-vbp",
      text: { runs: [{ kind: "text", value: "VBP" }] },
      position: { x: 100, y: 100 },
    },
  );
  if (!("edits" in plan)) throw new Error("Expected a schematic edit plan");
  const label = plan.edits.find(
    (edit) => edit.kind === "upsert_schematic_annotation",
  );
  expect(label?.kind).toBe("upsert_schematic_annotation");
  if (label?.kind === "upsert_schematic_annotation") {
    expect(label.annotation.formatOverride).toEqual(
      roleLabelFormat("voltage-node", "VBP"),
    );
  }
  const explicit = {
    runs: [
      { kind: "text" as const, value: "V" },
      {
        kind: "span" as const,
        style: "overbar" as const,
        children: [{ kind: "text" as const, value: "BP" }],
      },
    ],
  };
  const styled = planBrowserAgentCommand(
    project,
    document.id,
    createProjectSymbolResolver(project, builtInSymbols),
    {
      kind: "set-net-label",
      annotationId: "label-authored",
      netId: "net-vbp",
      text: explicit,
      position: { x: 200, y: 100 },
    },
  );
  if (!("edits" in styled)) throw new Error("Expected a schematic edit plan");
  const authored = styled.edits.find(
    (edit) => edit.kind === "upsert_schematic_annotation",
  );
  if (authored?.kind !== "upsert_schematic_annotation")
    throw new Error("Expected a label edit");
  expect(authored.annotation.formatOverride).toEqual(explicit);
});

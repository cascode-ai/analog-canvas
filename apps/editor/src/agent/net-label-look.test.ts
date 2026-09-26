import {
  createEmptyProject,
  roleLabelFormat,
  createRoutePath,
} from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planBrowserAgentCommand } from "./browser-agent-command.js";
import { resolveRouteGeometry } from "@icm/derived";
import { netLabelPlacementTargetAtPoint } from "../features/wiring/route-interaction-geometry";

it.each([
  [0, 100],
  [100, 0],
  [0, -100],
  [-100, 0],
])("creates a label on the GUI side of a route (%s,%s)", (x, y) => {
  const project = createEmptyProject("p", "Label side");
  const doc = project.documents[0]!;
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "a", netId: "n", position: { x: 100, y: 100 } },
    { id: "b", netId: "n", position: { x: 100 + x, y: 100 + y } },
  );
  const route = createRoutePath({
    id: "w",
    netId: "n",
    start: { kind: "junction", junctionId: "a" },
    end: { kind: "junction", junctionId: "b" },
    bends: [],
    modes: ["manual"],
  });
  doc.routes.push(route);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const position = { x: 100 + x / 2, y: 100 + y / 2 };
  const gui = netLabelPlacementTargetAtPoint(
    [{ route, geometry: resolveRouteGeometry(doc, resolver, route)! }],
    position,
    1000,
  )!;
  const plan = planBrowserAgentCommand(project, doc.id, resolver, {
    kind: "set-net-label",
    annotationId: "label",
    netId: "n",
    text: { runs: [{ kind: "text", value: "OUT" }] },
    position,
  });
  if (!("edits" in plan)) throw new Error("Expected document edits");
  const label = plan.edits.find(
    (e) => e.kind === "upsert_schematic_annotation",
  );
  if (label?.kind !== "upsert_schematic_annotation")
    throw new Error("Expected label");
  expect(label.annotation.alignment).toBe(gui.alignment ?? "middle");
  expect(label.annotation.anchor).toMatchObject({
    ...gui.routeAttachment,
    fallbackPosition: gui.labelPosition,
  });
});

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

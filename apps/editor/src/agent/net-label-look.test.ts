import {
  createEmptyProject,
  roleLabelFormat,
  createRoutePath,
} from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planBrowserAgentCommand } from "./browser-agent-command.js";
import {
  createLabelClearanceContext,
  netLabelAttachmentForText,
  netLabelBaselineForName,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
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
  // The Net Label tool commits its preview re-seated for the text it
  // carries (#1300); the Agent's label lands where that commit does.
  const committed = netLabelAttachmentForText(
    gui.routeAttachment,
    gui.labelPosition,
    0,
    netLabelBaselineForName("OUT", undefined, doc.presentation),
    resolveRouteGeometry(doc, resolver, route)!,
  );
  expect(label.annotation.anchor).toMatchObject({
    ...committed.attachment,
    fallbackPosition: committed.position,
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

it("stands an Agent label clear of the part at its stub's open end", () => {
  const project = createEmptyProject("stub-label", "Stub label");
  const doc = project.documents[0]!;
  doc.instances.push({
    id: "r",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 90, mirror: "none" },
    netlist: { parameters: { value: "1k" } },
  });
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const [pin, contact] = ["1", "2"]
    .map((pinName) => {
      const endpoint = { kind: "terminal" as const, instanceId: "r", pinName };
      return [
        endpoint,
        resolveEndpointConnection(doc, resolver, endpoint)!.contactPoint,
      ] as const;
    })
    .sort(([, a], [, b]) => a.x - b.x)[0]!;
  // A stub two grid steps out of the resistor's left pin, open at its end.
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push({
    id: "end",
    netId: "n",
    position: { x: contact.x - 20, y: contact.y },
  });
  doc.routes.push(
    createRoutePath({
      id: "stub",
      netId: "n",
      start: pin,
      end: { kind: "junction", junctionId: "end" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const label = (text: string) => {
    const plan = planBrowserAgentCommand(project, doc.id, resolver, {
      kind: "set-net-label",
      annotationId: "label",
      netId: "n",
      text: { runs: [{ kind: "text", value: text }] },
      position: { x: contact.x - 10, y: contact.y },
    });
    if (!("edits" in plan)) throw new Error("Expected document edits");
    const edit = plan.edits.find(
      (e) => e.kind === "upsert_schematic_annotation",
    );
    if (edit?.kind !== "upsert_schematic_annotation")
      throw new Error("Expected label");
    return edit.annotation;
  };
  // Centred on the stub, v_bias reached back over the resistor's lead. At
  // the open end it reads away from the wire and is clear.
  const moved = label("vbias");
  expect(moved).toMatchObject({
    alignment: "end",
    anchor: { kind: "route", routeId: "stub", t: 1 },
  });
  const context = createLabelClearanceContext(doc, resolver);
  expect(
    context.conflictsAt(context.measure(moved).inkBounds, moved.id),
  ).toEqual([]);
  // A name narrow enough to sit over the stub stays centred on it.
  expect(label("a")).toMatchObject({
    alignment: "middle",
    anchor: { t: 0.5 },
  });
});

import { createEmptyProject } from "@icm/model";
import type { Annotation, CircuitProject, Instance } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";

import { executeProjectTransaction } from "./project-transaction.js";

function adc(id: string, x: number): Instance {
  return {
    id,
    symbolId: "adc",
    placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
  };
}

function edit(project: CircuitProject, ...edits: unknown[]) {
  const document = project.documents[0]!;
  return executeProjectTransaction(project, {
    transactionId: "drawing-edit",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "editor" },
    edits: [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits,
      },
    ],
  });
}

it("persists an ADC's opaque body and its reordered name in a transparent SVG", () => {
  const project = createEmptyProject("stack", "ADC stack");
  const document = project.documents[0]!;
  document.instances.push(adc("front", 100), adc("rear", 110));
  document.annotations.push({
    id: "front-name",
    kind: "instance-label",
    anchor: {
      kind: "object",
      objectId: "front",
      localOffset: { x: 0, y: -50 },
      fallbackPosition: { x: 100, y: 50 },
    },
    content: { runs: [{ kind: "text", value: "Channel" }] },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });

  const result = edit(
    project,
    {
      kind: "set_body_fill",
      objectIds: ["front"],
      fill: { kind: "color", color: "#d4ecff" },
    },
    {
      kind: "reorder_drawing_objects",
      objectIds: ["front"],
      position: { kind: "front" },
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const saved = serializeProject(result.project);
  const reopened = parseProject(saved);
  const drawing = reopened.documents[0]!;
  const resolver = createProjectSymbolResolver(reopened, builtInSymbols);
  const svg = renderDocumentSvg(drawing, resolver, {
    background: "transparent",
  });

  expect(serializeProject(reopened)).toBe(saved);
  expect(svg.match(/data-object-id="(?:rear|front|front-name)"/gu)).toEqual([
    'data-object-id="rear"',
    'data-object-id="front"',
    'data-object-id="front-name"',
  ]);
  const body = svg.match(
    /<polygon[^>]+data-role="instance-body-fill"[^>]+>/u,
  )?.[0];
  expect(body).toContain('points="30,-20 -20,-20 -40,0 -20,20 30,20"');
  expect(body).toContain('fill="#d4ecff"');
  expect(svg).toContain("Channel");
  expect(svg).not.toContain("<rect");
  expect(drawing.nets).toEqual(document.nets);
  expect(drawing.routes).toEqual(document.routes);
  expect(drawing.sourceStatus).toBe(document.sourceStatus);
});

it("leaves a free wire landing separate from a pin hidden by a filled ADC", () => {
  const project = createEmptyProject("contact", "Covered contact");
  const document = project.documents[0]!;
  document.instances.push(adc("behind", 100), adc("cover", 140));
  const filled = edit(project, {
    kind: "set_body_fill",
    objectIds: ["cover"],
    fill: { kind: "background" },
  });
  if (!filled.ok) throw new Error(JSON.stringify(filled.error));

  const landed = edit(filled.project, {
    kind: "add_junction",
    junctionId: "wire-landing",
    netId: "wire-net",
    position: { x: 140, y: 100 },
    role: "route-anchor",
    createNet: true,
  });
  if (!landed.ok) throw new Error(JSON.stringify(landed.error));

  expect(landed.project.documents[0]!.nets).toEqual([
    { id: "wire-net", terminals: [] },
  ]);
});

it("rejects a mixed batch atomically when an ADC belongs to a locked group", () => {
  const project = createEmptyProject("locked-stack", "Protected stack");
  const document = project.documents[0]!;
  document.instances.push(adc("editable", 100), adc("locked", 110));
  document.layoutGroups.push({
    id: "locked-group",
    kind: "custom",
    objectIds: ["locked"],
    locked: true,
  });
  const result = edit(
    project,
    {
      kind: "reorder_drawing_objects",
      objectIds: ["editable"],
      position: { kind: "front" },
    },
    {
      kind: "set_body_fill",
      objectIds: ["editable", "locked"],
      fill: { kind: "background" },
    },
  );
  expect(result).toMatchObject({
    ok: false,
    applied: false,
    project,
    diagnostics: [
      expect.objectContaining({ objectIds: ["locked", "locked-group"] }),
    ],
  });
});

it("keeps an already frontmost ADC at the same revision on one more forward step", () => {
  const project = createEmptyProject("topmost", "Topmost channel");
  project.documents[0]!.instances.push(adc("only", 100));
  const result = edit(project, {
    kind: "reorder_drawing_objects",
    objectIds: ["only"],
    position: { kind: "forward" },
  });
  expect(result).toMatchObject({ ok: true, applied: false, project });
});

it("moves past another ADC and its gathered label as one drawing step", () => {
  const project = createEmptyProject("labeled-stack", "Labeled stack");
  const document = project.documents[0]!;
  document.instances.push(adc("A", 100), adc("B", 120));
  document.annotations.push(
    ...document.instances.map((instance): Annotation => ({
      id: `${instance.id}-name`,
      kind: "instance-label",
      anchor: {
        kind: "object",
        objectId: instance.id,
        localOffset: { x: 0, y: -50 },
        fallbackPosition: { x: instance.placement!.position.x, y: 50 },
      },
      content: { runs: [{ kind: "text", value: instance.id }] },
      alignment: "middle",
      rotation: 0,
      locked: false,
    })),
  );
  const step = (
    source: CircuitProject,
    id: string,
    position:
      | { kind: "front" | "forward" | "backward" }
      | {
          kind: "after";
          target: { kind: "instance"; id: string };
        },
  ) => {
    const result = edit(source, {
      kind: "reorder_drawing_objects",
      objectIds: [id],
      position,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.project;
  };
  const drawingOrder = (source: CircuitProject) =>
    source.documents[0]!.drawingOrder?.map((entry) =>
      "id" in entry ? entry.id : entry.kind,
    );

  const firstMove = step(project, "A", { kind: "forward" });
  expect(drawingOrder(firstMove)).toEqual([
    "electrical",
    "B",
    "A",
    "A-name",
    "circuit-marks",
    "B-name",
  ]);

  const gathered = step(firstMove, "B", { kind: "front" });
  expect(drawingOrder(gathered)).toEqual([
    "electrical",
    "A",
    "A-name",
    "circuit-marks",
    "B",
    "B-name",
  ]);
  const forward = step(gathered, "A", { kind: "forward" });
  const expected = [
    "electrical",
    "circuit-marks",
    "B",
    "B-name",
    "A",
    "A-name",
  ];
  expect(drawingOrder(forward)).toEqual(expected);
  expect(
    drawingOrder(
      step(gathered, "A", {
        kind: "after",
        target: { kind: "instance", id: "B" },
      }),
    ),
  ).toEqual(expected);
  expect(drawingOrder(step(forward, "A", { kind: "backward" }))).toEqual([
    "electrical",
    "circuit-marks",
    "A",
    "A-name",
    "B",
    "B-name",
  ]);
});

it("keeps the legacy box and detached label when merely reopening an old drawing", () => {
  const project = createEmptyProject("legacy-stack", "Legacy channels");
  const document = project.documents[0]!;
  document.instances.push(
    { ...adc("first", 100), styleOverride: { background: "#d4ecff" } },
    adc("second", 120),
  );
  document.annotations.push({
    id: "old-name",
    kind: "instance-label",
    anchor: {
      kind: "object",
      objectId: "first",
      localOffset: { x: 0, y: -50 },
      fallbackPosition: { x: 100, y: 50 },
    },
    content: { runs: [{ kind: "text", value: "Original" }] },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  const legacy = JSON.parse(serializeProject(project));
  legacy.schemaVersion = 80;
  for (const definition of legacy.componentDefinitions)
    for (const primitive of definition.symbol.primitives)
      delete primitive.fillableBody;
  const opened = parseProject(JSON.stringify(legacy));
  const drawing = opened.documents[0]!;
  const resolver = createProjectSymbolResolver(opened, builtInSymbols);
  const svg = renderDocumentSvg(drawing, resolver, {
    background: "transparent",
  });
  expect(svg).toContain(
    '<rect data-role="instance-background" x="-54" y="-24" width="98" height="48" fill="#d4ecff"/>',
  );
  expect(svg.match(/data-object-id="(?:first|second|old-name)"/gu)).toEqual([
    'data-object-id="first"',
    'data-object-id="second"',
    'data-object-id="old-name"',
  ]);

  const filled = edit(opened, {
    kind: "set_body_fill",
    objectIds: ["first"],
    fill: { kind: "background" },
  });
  if (!filled.ok) throw new Error(JSON.stringify(filled.error));
  expect(filled.project.documents[0]!.instances[0]).toMatchObject({
    bodyFill: { kind: "background" },
  });
  expect(
    filled.project.documents[0]!.instances[0]!.styleOverride,
  ).toBeUndefined();
});

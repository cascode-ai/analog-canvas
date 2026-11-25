import { createEmptyProject } from "@icm/model";
import type { Annotation, CircuitProject, Instance } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { buildSvgScene, renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { legacyProjectFile } from "../../project-protocol/src/legacy-project.test-support.js";

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
  expect(body).toContain('fill="#d4ecff"');
  expect(svg).toContain("Channel");
  expect(svg).not.toContain("<rect");
});

it("includes remote filled regions in a rotated and mirrored formal SVG", () => {
  const project = createEmptyProject("remote-bodies", "Remote bodies");
  project.componentDefinitions = [
    {
      symbol: {
        schemaVersion: 1,
        id: "remote-body",
        name: "Remote body",
        viewBox: { x: -10, y: -10, width: 20, height: 20 },
        pins: [
          {
            name: "IN",
            role: "input",
            at: { x: -10, y: 0 },
            direction: "west",
            presentation: { visibility: "visible" },
          },
        ],
        primitives: [
          {
            kind: "rectangle",
            bounds: { x: 100, y: 20, width: 20, height: 20 },
            fillableBody: true,
          },
          {
            kind: "path",
            data: "M-60-50 H-40 V-30 H-60 Z",
            fillableBody: true,
          },
        ],
        variants: [],
      },
    },
  ];
  project.documents[0]!.instances.push({
    id: "device",
    symbolId: "remote-body",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 90,
      mirror: "horizontal",
    },
  });
  const result = edit(project, {
    kind: "set_body_fill",
    objectIds: ["device"],
    fill: { kind: "color", color: "#ecd4ff" },
  });
  if (!result.ok) throw new Error(result.error.message);
  const render = (candidate: CircuitProject) => {
    const reopened = parseProject(serializeProject(candidate));
    return renderDocumentSvg(
      reopened.documents[0]!,
      createProjectSymbolResolver(reopened, builtInSymbols),
      { background: "transparent", margin: 0 },
    );
  };
  const svg = render(result.project);
  expect(svg).toContain('viewBox="50 40 90 180"');
  expect(svg).toMatch(/<rect data-role="instance-body-fill"[^>]+/u);
  expect(svg).toMatch(/<path data-role="instance-body-fill"[^>]+/u);
  const clear = edit(result.project, {
    kind: "set_body_fill",
    objectIds: ["device"],
    fill: null,
  });
  if (!clear.ok) throw new Error(clear.error.message);
  const transparent = render(clear.project);
  expect(transparent).toContain('viewBox="50 40 90 180"');
  expect(transparent).not.toContain('data-role="instance-body-fill"');
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

it.each([
  "dac",
  "dac-differential",
  "opamp",
  "opamp-differential-wide-crossed-lettered-inputs-swapped",
  "voltage-source",
  "pulse-voltage-source",
  "sine-voltage-source",
  "current-source",
  "vcvs",
  "vccs",
  "ccvs",
  "cccs",
])("fills exactly the reviewed %s body on a reopened Project", (symbolId) => {
  const project = createEmptyProject("filled-symbol", "Filled Symbol");
  const document = project.documents[0]!;
  document.instances.push({ ...adc("device", 100), symbolId });
  const result = edit(project, {
    kind: "set_body_fill",
    objectIds: ["device"],
    fill: { kind: "background" },
  });
  if (!result.ok) throw new Error(result.error.message);
  const reopened = parseProject(serializeProject(result.project));
  const resolver = createProjectSymbolResolver(reopened, builtInSymbols);
  const svg = renderDocumentSvg(reopened.documents[0]!, resolver);
  expect(svg.match(/data-role="instance-body-fill"/gu)).toHaveLength(1);
  const transparent = renderDocumentSvg(
    document,
    createProjectSymbolResolver(project, builtInSymbols),
  );
  // Delete only the added body paint. The original ink, including internal
  // notation and pin leads, stays exactly the same.
  expect(
    svg.replace(
      /<(?:path|polygon|circle)[^>]*data-role="instance-body-fill"[^>]*\/>/u,
      "",
    ),
  ).toBe(transparent);
});

it.each(["integrator", "transconductance"])(
  "keeps the %s fill on the new frame when its formula grows",
  (symbolId) => {
    const project = createEmptyProject("grown-body", "Grown body");
    project.documents[0]!.instances.push({ ...adc("block", 200), symbolId });
    const fill = edit(project, {
      kind: "set_body_fill",
      objectIds: ["block"],
      fill: { kind: "color", color: "#d4ecff" },
    });
    if (!fill.ok) throw new Error(fill.error.message);
    const sharedScene = (source: CircuitProject) => {
      const reopened = parseProject(serializeProject(source));
      return buildSvgScene(
        reopened.documents[0]!,
        createProjectSymbolResolver(reopened, builtInSymbols),
      );
    };
    const point = { x: 240, y: 100 };
    expect(
      sharedScene(fill.project).drawingScene.isVisibleAt(
        { kind: "electrical" },
        point,
      ),
    ).toBe(true);
    const resize = edit(fill.project, {
      kind: "set_instance_signal_flow_parameters",
      instanceId: "block",
      parameters: {
        formula: "A very long transfer function",
        bodyWidth: 160,
        bodyHeight: 80,
      },
    });
    if (!resize.ok) throw new Error(resize.error.message);
    const scene = sharedScene(resize.project);
    expect(scene.drawingScene.isVisibleAt({ kind: "electrical" }, point)).toBe(
      false,
    );
    const fillTag = scene.formalBody.match(
      /<(rect|polygon) data-role="instance-body-fill"[^>]*\/>/u,
    )?.[0];
    const outline = scene.formalBody.match(
      /<(rect|polygon) data-role="signal-flow-frame"[^>]*\/>/u,
    )?.[0];
    expect(fillTag?.match(/(?: x=| points=).*/u)?.[0]).toBe(
      outline?.match(/(?: x=| points=).*/u)?.[0],
    );
    expect(fillTag).toContain('fill="#d4ecff"');
  },
);

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
  const legacy = legacyProjectFile(serializeProject(project), 80);
  for (const definition of legacy.componentDefinitions)
    for (const primitive of definition.symbol.primitives)
      delete primitive.fillableBody;
  const opened = parseProject(JSON.stringify(legacy));
  const drawing = opened.documents[0]!;
  const resolver = createProjectSymbolResolver(opened, builtInSymbols);
  const svg = renderDocumentSvg(drawing, resolver, {
    background: "transparent",
  });
  expect(svg).toMatch(
    /<rect data-role="instance-background"[^>]*fill="#d4ecff"/u,
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

it("keeps a rectangle's anchored label immediately above it across layer reorders and inserts", () => {
  const project = createEmptyProject("rect-label-order", "Rect label order");
  const document = project.documents[0]!;
  document.drafting = {
    objects: [
      {
        id: "box-rear",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 100, y: 100 } },
        center: { x: 100, y: 100 },
        width: 80,
        height: 40,
        rotation: 0,
        lineStyle: "solid",
        styleOverride: { fillColor: "#d4ecff" },
      },
      {
        id: "box-front",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 110, y: 100 } },
        center: { x: 110, y: 100 },
        width: 80,
        height: 40,
        rotation: 0,
        lineStyle: "solid",
        styleOverride: { fillColor: "#f3e5f5" },
      },
      {
        id: "fir-label",
        kind: "text",
        locked: false,
        zIndex: 0,
        anchor: {
          kind: "object",
          objectId: "box-rear",
          localOffset: { x: 0, y: 0 },
          fallbackPosition: { x: 100, y: 100 },
        },
        content: { runs: [{ kind: "text", value: "FIR" }] },
        alignment: "middle",
        rotation: 0,
        typographyToken: "label",
      },
    ],
  };

  // Bringing box-rear to front must gather its anchored FIR label right above it.
  const broughtFront = edit(project, {
    kind: "reorder_drawing_objects",
    objectIds: ["box-rear"],
    position: { kind: "front" },
  });
  if (!broughtFront.ok) throw new Error(broughtFront.error.message);
  const frontIds = broughtFront.project.documents[0]!.drawingOrder?.map(
    (entry) => ("id" in entry ? entry.id : entry.kind),
  );
  expect(frontIds?.slice(-3)).toEqual(["box-front", "box-rear", "fir-label"]);

  const resolver = createProjectSymbolResolver(
    broughtFront.project,
    builtInSymbols,
  );
  const svg = renderDocumentSvg(broughtFront.project.documents[0]!, resolver, {
    background: "transparent",
  });
  expect(
    svg.match(/data-object-id="(?:box-front|box-rear|fir-label)"/gu),
  ).toEqual([
    'data-object-id="box-front"',
    'data-object-id="box-rear"',
    'data-object-id="fir-label"',
  ]);

  // Adding a label to box-front when drawingOrder already exists places it right above box-front.
  const labeledFront = edit(broughtFront.project, {
    kind: "upsert_drafting_object",
    object: {
      id: "iir-label",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: {
        kind: "object",
        objectId: "box-front",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 110, y: 100 },
      },
      content: { runs: [{ kind: "text", value: "IIR" }] },
      alignment: "middle",
      rotation: 0,
      typographyToken: "label",
    },
  });
  if (!labeledFront.ok) throw new Error(labeledFront.error.message);
  const insertedIds = labeledFront.project.documents[0]!.drawingOrder?.map(
    (entry) => ("id" in entry ? entry.id : entry.kind),
  );
  expect(insertedIds?.slice(-4)).toEqual([
    "box-front",
    "iir-label",
    "box-rear",
    "fir-label",
  ]);

  // One forward step moves box-front + iir-label past box-rear + fir-label together.
  const stepped = edit(labeledFront.project, {
    kind: "reorder_drawing_objects",
    objectIds: ["box-front"],
    position: { kind: "forward" },
  });
  if (!stepped.ok) throw new Error(stepped.error.message);
  const steppedIds = stepped.project.documents[0]!.drawingOrder?.map((entry) =>
    "id" in entry ? entry.id : entry.kind,
  );
  expect(steppedIds?.slice(-4)).toEqual([
    "box-rear",
    "fir-label",
    "box-front",
    "iir-label",
  ]);
});

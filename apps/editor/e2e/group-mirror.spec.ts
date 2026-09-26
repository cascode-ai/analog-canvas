import { expect, test, type Page } from "@playwright/test";
import {
  createEmptyProject,
  createRoutePath,
  routeBends,
  type CircuitProject,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  awaitEditorReady,
  copyNetlistText,
  downloadBytes,
  parseSavedProject,
} from "./editor-fixtures";

async function open(page: Page, project: CircuitProject): Promise<void> {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "group-mirror.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened group-mirror.icproj.json",
  );
}

async function savedDocument(page: Page) {
  const project = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  return project.documents[0];
}

/** The on-screen midpoint of one wire leg; a thin polyline's CSS box misses. */
async function wireLegPoint(page: Page, routeId: string, leg: number) {
  const route = page.getByTestId(`route-hit-${routeId}`);
  await expect(route).toBeAttached();
  return route.evaluate((element, index) => {
    const line = element as SVGPolylineElement;
    const first = line.points.getItem(index);
    const second = line.points.getItem(index + 1);
    const screen = new DOMPoint(
      (first.x + second.x) / 2,
      (first.y + second.y) / 2,
    ).matrixTransform(line.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, leg);
}

test("a wire alone mirrors from its context menu", async ({ page }) => {
  const project = createEmptyProject("wire-mirror", "Wire mirror");
  const document = project.documents[0]!;
  document.nets.push({ id: "net-w", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-w", position: { x: 200, y: 200 } },
    { id: "J2", netId: "net-w", position: { x: 320, y: 280 } },
  );
  // An L: right along the top, then down.
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "net-w",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [{ x: 320, y: 200 }],
      modes: ["manual", "manual"],
    }),
  );
  await open(page, project);
  const initial = await savedDocument(page);

  const point = await wireLegPoint(page, "wire", 0);
  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await menu
    .getByRole("menuitem", { name: "Mirror left/right (Shift+R)" })
    .click();
  await expect(page.getByTestId("status")).toContainText(
    "Flipped the selection left to right",
  );

  const mirrored = await savedDocument(page);
  const position = (id: string) =>
    mirrored.junctions.find((junction: { id: string }) => junction.id === id)
      .position;
  // About the wire's own centre line, x = 260: left along the top, then down.
  expect(position("J1")).toEqual({ x: 320, y: 200 });
  expect(position("J2")).toEqual({ x: 200, y: 280 });
  const wire = mirrored.routes.find(
    (route: { id: string }) => route.id === "wire",
  );
  expect(routeBends(wire)).toEqual([{ x: 200, y: 200 }]);
  expect(wire.start).toEqual({ kind: "junction", junctionId: "J1" });
  expect(mirrored.nets).toEqual(initial.nets);

  // Mirroring again puts it back exactly.
  await page.keyboard.press("Shift+R");
  const restored = await savedDocument(page);
  expect(restored.junctions).toEqual(initial.junctions);
  expect(
    routeBends(
      restored.routes.find((route: { id: string }) => route.id === "wire"),
    ),
  ).toEqual([{ x: 320, y: 200 }]);
});

test("parts, wires, a wire label and a note mirror as one drawing", async ({
  page,
}) => {
  const project = createEmptyProject("group-mirror", "Group mirror");
  const document = project.documents[0]!;
  // Two resistors side by side, joined across the top by a labelled wire and
  // across the bottom through two Junctions.
  for (const [id, x] of [
    ["R1", 200],
    ["R2", 300],
  ] as const) {
    document.instances.push({
      id,
      symbolId: "resistor",
      reference: id,
      netlist: { parameters: { value: id === "R1" ? "1k" : "2k" } },
      placement: { position: { x, y: 200 }, rotation: 0, mirror: "none" },
    });
  }
  document.nets.push(
    {
      id: "net-top",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
    {
      id: "net-bottom",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "2" },
      ],
    },
  );
  document.junctions.push(
    { id: "J1", netId: "net-bottom", position: { x: 200, y: 260 } },
    { id: "J2", netId: "net-bottom", position: { x: 300, y: 260 } },
  );
  const top = createRoutePath({
    id: "wire-top",
    netId: "net-top",
    start: { kind: "terminal", instanceId: "R1", pinName: "1" },
    end: { kind: "terminal", instanceId: "R2", pinName: "1" },
    bends: [
      { x: 200, y: 160 },
      { x: 300, y: 160 },
    ],
    modes: ["manual", "manual", "manual"],
  });
  document.routes.push(
    top,
    createRoutePath({
      id: "wire-r1",
      netId: "net-bottom",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "junction", junctionId: "J1" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "wire-r2",
      netId: "net-bottom",
      start: { kind: "terminal", instanceId: "R2", pinName: "2" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "wire-bottom",
      netId: "net-bottom",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  document.annotations.push({
    id: "label-out",
    kind: "net-label",
    binding: { kind: "net-name", netId: "net-top" },
    netId: "net-top",
    anchor: {
      kind: "route",
      routeId: "wire-top",
      legId: top.legs[1]!.id,
      t: 0.25,
      normalOffset: -8,
      direction: "forward",
      orientation: "follow",
      fallbackPosition: { x: 225, y: 152 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "claim-out",
    kind: "name-claim",
    netId: "net-top",
    name: "OUT",
    scope: "local",
    owner: { kind: "net-label", annotationId: "label-out" },
  });
  document.drafting = {
    objects: [
      {
        id: "note",
        kind: "text",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 160, y: 120 } },
        content: { runs: [{ kind: "text", value: "divider" }] },
        alignment: "start",
        rotation: 0,
      },
    ],
  };
  await open(page, project);
  const initial = await savedDocument(page);
  const netlist = await copyNetlistText(page);

  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Shift+R");
  await expect(page.getByTestId("status")).toContainText(
    "Flipped 2 parts as one group, left to right",
  );

  const mirrored = await savedDocument(page);
  const placement = (id: string) =>
    mirrored.instances.find((instance: { id: string }) => instance.id === id)
      .placement;
  // About x = 250: the two parts exchange places, each mirrored.
  expect(placement("R1")).toMatchObject({
    position: { x: 300, y: 200 },
    mirror: "horizontal",
  });
  expect(placement("R2")).toMatchObject({
    position: { x: 200, y: 200 },
    mirror: "horizontal",
  });
  // Every Junction and every bend lands on its mirror image. (Opening the
  // file may already have tidied the wiring; the drawing as opened is what
  // has to mirror.)
  const reflect = (point: { x: number; y: number }) => ({
    x: 500 - point.x,
    y: point.y,
  });
  expect(initial.junctions.length + initial.routes.length).toBeGreaterThan(0);
  for (const original of initial.junctions) {
    expect(
      mirrored.junctions.find(
        (candidate: { id: string }) => candidate.id === original.id,
      ).position,
    ).toEqual(reflect(original.position));
  }
  for (const original of initial.routes) {
    const route = mirrored.routes.find(
      (candidate: { id: string }) => candidate.id === original.id,
    );
    expect(route.start).toEqual(original.start);
    expect(routeBends(route)).toEqual(routeBends(original).map(reflect));
  }
  expect(
    routeBends(
      mirrored.routes.find((route: { id: string }) => route.id === "wire-top"),
    ),
  ).toEqual([
    { x: 300, y: 160 },
    { x: 200, y: 160 },
  ]);
  // The label stays a quarter of the way along its wire and above it.
  const label = mirrored.annotations.find(
    (annotation: { id: string }) => annotation.id === "label-out",
  );
  expect(label.anchor).toMatchObject({
    kind: "route",
    routeId: "wire-top",
    t: 0.25,
    normalOffset: 8,
  });
  // The note reads the same way, now growing leftward from the mirrored side.
  const note = mirrored.drafting.objects.find(
    (object: { id: string }) => object.id === "note",
  );
  expect(note.alignment).toBe("end");
  expect(note.anchor.position.y).toBe(120);
  expect(note.anchor.position.x).toBe(340);

  // Every connection is exactly as it was.
  expect(mirrored.nets).toEqual(initial.nets);
  expect(await copyNetlistText(page)).toBe(netlist);

  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Shift+R");
  const restored = await savedDocument(page);
  expect(restored.instances).toEqual(initial.instances);
  expect(restored.junctions).toEqual(initial.junctions);
  expect(restored.routes).toEqual(initial.routes);
  expect(restored.annotations).toEqual(initial.annotations);
  expect(restored.drafting.objects).toEqual(initial.drafting.objects);
});

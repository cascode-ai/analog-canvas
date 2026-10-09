// Moving parts, Wires and groups: command move, drags and their live previews,
// and the connection points that move with them.

import { parseSavedProject } from "./editor-fixtures";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  revealPropertiesShelf,
  clickDrawTool,
  downloadBytes,
  readComponentPropertyCode,
  setComponentCodeField,
  expectComponentCodeField,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import {
  clickRoute,
  routeInk,
  readRoutePoints,
  copySelectionAt,
  closeSelectionShelf,
} from "./canvas-fixtures.js";

async function dragRouteSegment(
  page: Page,
  routeId: string,
  delta: { x: number; y: number },
  position = 0.5,
  segmentIndex?: number,
  duringDrag?: () => Promise<void>,
): Promise<void> {
  const route = page.getByTestId(`route-hit-${routeId}`);
  const point = await route.evaluate(
    (element, options) => {
      const polyline = element as SVGPolylineElement;
      let index = options.segmentIndex;
      if (index === undefined) {
        index = 0;
        let longest = -1;
        for (
          let candidate = 0;
          candidate < polyline.points.numberOfItems - 1;
          candidate += 1
        ) {
          const from = polyline.points.getItem(candidate);
          const to = polyline.points.getItem(candidate + 1);
          const length = Math.hypot(to.x - from.x, to.y - from.y);
          if (length > longest) {
            longest = length;
            index = candidate;
          }
        }
      }
      const from = polyline.points.getItem(index);
      const to = polyline.points.getItem(index + 1);
      const matrix = polyline.getScreenCTM();
      if (!from || !to || !matrix) return null;
      return new DOMPoint(
        from.x + (to.x - from.x) * options.position,
        from.y + (to.y - from.y) * options.position,
      ).matrixTransform(matrix);
    },
    { position, segmentIndex },
  );
  if (!point) throw new Error(`Route ${routeId} is not measurable`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + delta.x, point.y + delta.y, { steps: 4 });
  await duringDrag?.();
  await page.mouse.up();
}

test("property code keeps a drawn wired instance visible and moves it with grid snapping", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page
    .getByTestId("schematic-canvas")
    .dblclick({ position: { x: 500, y: 350 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  const before = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const revision = await page.getByTestId("revision").textContent();
  const code = JSON.parse(await readComponentPropertyCode(page));
  code.coordinate = null;
  await page
    .getByLabel("Editable Canvas property code")
    .fill(JSON.stringify(code));
  const discard = page.getByRole("button", {
    name: "Discard draft",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances).toEqual(before.documents[0].instances);
  expect(saved.documents[0].nets).toEqual(before.documents[0].nets);
  expect(saved.documents[0].routes).toEqual(before.documents[0].routes);
  await discard.click();
  await setComponentCodeField(page, "coordinate", [421, 281]);
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expectComponentCodeField(page, "coordinate", [420, 280]);
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expectComponentCodeField(page, "coordinate", [
    before.documents[0].instances[0].placement.position.x,
    before.documents[0].instances[0].placement.position.y,
  ]);
});

test("a directly connected device can move away and return with its wire, undo and redo", async ({
  page,
}) => {
  const project = createEmptyProject(
    "contact-round-trip",
    "Contact round trip",
  );
  const document = project.documents[0]!;
  document.instances = [250, 290].map((y, index) => ({
    id: "R" + (index + 1),
    reference: "R" + (index + 1),
    symbolId: "resistor",
    netlist: { parameters: {} },
    placement: {
      position: { x: 300, y },
      rotation: 0 as const,
      mirror: "none" as const,
    },
  }));
  document.nets = [
    {
      id: "bond",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
  ];
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "contact.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const hit = page.getByTestId("hit-R1");
  await expect(hit).toBeVisible();
  const before = (await hit.boundingBox())!;
  const origin = {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 120, origin.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  const away = (await hit.boundingBox())!;
  expect(away.x).toBeGreaterThan(before.x + 40);
  await page.mouse.move(away.x + away.width / 2, away.y + away.height / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x, origin.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);
  expect((await hit.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);
  expect((await hit.boundingBox())!.x).toBeCloseTo(before.x, 0);
});

test("command move follows the pointer and commits on one click", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  const resistor = page.getByTestId("hit-R1");
  await resistor.click();
  const before = await resistor.boundingBox();
  if (!before) throw new Error("Placed resistor is not measurable");
  const symbolNode = await page
    .locator('[data-layer="symbols"] [data-object-id="R1"]')
    .elementHandle();
  if (!symbolNode) throw new Error("Placed symbol is not measurable");

  await page.keyboard.press("m");
  await expect(page.getByTestId("status")).toContainText("Move:");
  await page.mouse.move(before.x + 40, before.y + 20);
  expect(
    await page
      .locator('[data-layer="symbols"] [data-object-id="R1"]')
      .evaluate((current, original) => current === original, symbolNode),
  ).toBe(true);
  await page.mouse.click(before.x + 40, before.y + 20);

  const after = await resistor.boundingBox();
  if (!after) throw new Error("Moved resistor is not measurable");
  expect(after.x).toBeGreaterThan(before.x + 20);
});

test("command move commits a materially different click instead of a stale preview", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  const canvas = page.getByTestId("schematic-canvas");
  const resistor = page.getByTestId("hit-R1");
  await resistor.click();
  const before = await resistor.boundingBox();
  if (!before) throw new Error("Placed resistor is not measurable");

  await page.keyboard.press("m");
  await page.mouse.move(before.x + 40, before.y + 20);

  // Dispatch click without a preceding pointermove. This is the browser path
  // that exposed the old "last painted frame wins" bug.
  await canvas.dispatchEvent("click", {
    bubbles: true,
    clientX: before.x + 140,
    clientY: before.y + 20,
    detail: 1,
  });

  await expect(page.getByTestId("revision")).toHaveText("2");
  const after = await resistor.boundingBox();
  if (!after) throw new Error("Moved resistor is not measurable");
  expect(after.x).toBeGreaterThan(before.x + 100);
});

test("command move owns rotate and commits pose plus translation atomically", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  const resistor = page.getByTestId("hit-R1");
  await resistor.click();
  const before = await resistor.boundingBox();
  if (!before) throw new Error("Placed resistor is not measurable");

  await page.keyboard.press("m");
  await page.mouse.move(before.x + 100, before.y + 80);
  await page.keyboard.press("r");

  await expect(page.getByTestId("status")).toContainText(
    "Move preview rotated",
  );
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.locator('[data-kind="draft-rectangle"]')).toHaveCount(0);
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R1"] > g'),
  ).toHaveAttribute("transform", /rotate\(90\)/u);
  const reference = page.locator(
    '[data-layer="annotations"] [data-object-id="instance-label-R1"]',
  );
  await expect(reference).toHaveAttribute("transform", /^rotate\(0 /u);
  await expect(reference).not.toHaveAttribute("transform", /matrix|scale/u);

  await page.mouse.click(before.x + 100, before.y + 80);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.getByTestId("status")).toContainText(
    "Moved and transformed selection",
  );
  await expect(
    page.locator('[data-object-id="R1"] > g').first(),
  ).toHaveAttribute("transform", /rotate\(90\)/u);
});

test("command move restores its exact preview when cancelled after a turn", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  const resistor = page.getByTestId("hit-R1");
  await resistor.click();
  const before = await resistor.boundingBox();
  if (!before) throw new Error("Placed resistor is not measurable");

  await page.keyboard.press("m");
  await page.mouse.move(before.x + 120, before.y + 90);
  await page.keyboard.press("r");
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R1"] > g'),
  ).toHaveAttribute("transform", /rotate\(90\)/u);
  await page.keyboard.press("Escape");

  await expect(resistor).not.toHaveAttribute("transform", /^matrix\(/u);
  await expect(page.getByTestId("revision")).toHaveText("1");
  const after = await resistor.boundingBox();
  expect(after).toEqual(before);
});

test("dragging a part draws its wire stretching with it before the drop", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  const revision = await page.getByTestId("revision").textContent();
  const before = await readRoutePoints(page, "route-ui-1");
  const wire = page.locator(
    '[data-layer="routes"] [data-object-id="route-ui-1"]',
  );
  const inkRuns = () =>
    page
      .locator('[data-layer="routes"] [data-role="conductor-ink"]')
      .evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
  const oldRun = `M ${before.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
  expect((await inkRuns()).some((d) => d?.includes(oldRun))).toBe(true);

  const hit = await page.getByTestId("hit-R1").boundingBox();
  if (!hit) throw new Error("Connected resistor is not measurable");
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    hit.x + hit.width / 2 + 40,
    hit.y + hit.height / 2 + 60,
    { steps: 6 },
  );
  // Mid-drag: the wire is drawn where it now runs, in its own paint, and its
  // old run has left the shared conductor ink rather than staying behind.
  await expect
    .poll(() => readRoutePoints(page, "route-ui-1"))
    .not.toEqual(before);
  await expect(wire).not.toHaveAttribute("stroke", "none");
  expect((await inkRuns()).some((d) => d?.includes(oldRun))).toBe(false);

  await page.mouse.up();
  await expect(page.getByTestId("revision")).not.toHaveText(revision!);
  await expect(wire).toHaveAttribute("stroke", "none");
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke"))
    .not.toBeNull();
});

test("command move turns a component while locally stretching its boundary wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  const resistor = page.getByTestId("hit-R1");
  const hit = await resistor.boundingBox();
  if (!hit) throw new Error("Connected resistor is not measurable");
  const before = await readRoutePoints(page, "route-ui-1");
  // The pin bridges are subpaths of the conductor ink now, so the shape's own
  // path data is what changes when the pin they join moves.
  const conductorInk = page
    .locator('[data-layer="routes"] [data-role="conductor-ink"]')
    .first();
  await expect(conductorInk).toBeAttached();
  const bridgeBefore = await conductorInk.getAttribute("d");
  await resistor.click();
  await page.keyboard.press("m");
  await page.mouse.move(hit.x + 100, hit.y + 100);
  await page.keyboard.press("r");

  await expect
    .poll(() => readRoutePoints(page, "route-ui-1"))
    .not.toEqual(before);
  const preview = await readRoutePoints(page, "route-ui-1");
  const bridgePreview = await conductorInk.getAttribute("d");
  expect(preview[0]).not.toEqual(before[0]);
  expect(preview.at(-1)).toEqual(before.at(-1));
  expect(bridgePreview).not.toBe(bridgeBefore);
  await expect(page.getByTestId("revision")).toHaveText("3");

  await page.mouse.click(hit.x + 100, hit.y + 100);
  await expect(page.getByTestId("revision")).toHaveText("4");
  expect(await readRoutePoints(page, "route-ui-1")).toEqual(preview);
  expect(await conductorInk.getAttribute("d")).toBe(bridgePreview);
});

test("moves an isolated free wire as one route", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 420, y: 220 } });
  await canvas.dblclick({ position: { x: 620, y: 300 } });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-layer="junctions"] circle')).toHaveCount(0);

  const route = page.locator('[data-testid^="route-hit-"]');
  await expect(route).toHaveCount(1);
  const routeId = (await route.getAttribute("data-testid"))!.replace(
    "route-hit-",
    "",
  );
  const before = await readRoutePoints(page, routeId);
  await dragRouteSegment(page, routeId, { x: 120, y: 80 });
  const after = await readRoutePoints(page, routeId);
  const delta = {
    x: after[0]!.x - before[0]!.x,
    y: after[0]!.y - before[0]!.y,
  };
  expect(delta).not.toEqual({ x: 0, y: 0 });
  expect(
    after.map((point, index) => ({
      x: point.x - before[index]!.x,
      y: point.y - before[index]!.y,
    })),
  ).toEqual(after.map(() => delta));
});

test("moves a selected wire segment and deletes a connected component safely", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  // Drag the exposed middle segment directly through the unified canvas
  // session; terminal escape segments remain covered by component hit targets.
  const before = await readRoutePoints(page, "route-ui-1");
  await dragRouteSegment(page, "route-ui-1", { x: 0, y: 80 });
  const after = await readRoutePoints(page, "route-ui-1");
  expect(after[0]).toEqual(before[0]);
  expect(after.at(-1)).toEqual(before.at(-1));
  expect(after).not.toEqual(before);

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("instance-count")).toHaveText("1");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await expect(
    page.locator('[data-testid^="junction-junction-delete-"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "connected wires remain dangling",
  );
});

test("previews a connected Wire while its Instance moves", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  const before = await readRoutePoints(page, "route-ui-1");
  const hit = page.getByTestId("hit-R1");
  const box = await hit.boundingBox();
  if (!box) throw new Error("Connected Instance is not measurable");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 50, { steps: 4 });

  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect
    .poll(() => readRoutePoints(page, "route-ui-1"))
    .not.toEqual(before);
  const during = await readRoutePoints(page, "route-ui-1");
  expect(during[0]).not.toEqual(before[0]);
  expect(during.at(-1)).toEqual(before.at(-1));

  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("4");
  const after = await readRoutePoints(page, "route-ui-1");
  expect(after[0]).toEqual(during[0]);
  expect(after.at(-1)).toEqual(before.at(-1));
});

test("moves internal wiring with a selected group and copies the routed subgraph", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("selected-internal-route-count")).toHaveText(
    "1",
  );
  const before = await readRoutePoints(page, "route-ui-1");
  const routeNode = await page
    .locator('[data-layer="routes"] [data-object-id="route-ui-1"]')
    .elementHandle();
  if (!routeNode) throw new Error("Internal route is not measurable");
  const firstBefore = await page.getByTestId("hit-R1").boundingBox();
  await dragRouteSegment(
    page,
    "route-ui-1",
    { x: 90, y: 70 },
    0.35,
    undefined,
    async () => {
      await expect
        .poll(() => readRoutePoints(page, "route-ui-1"))
        .not.toEqual(before);
      await expect(page.getByTestId("schematic-canvas")).toHaveClass(
        /semantic-move-preview/u,
      );
      await expect(page.getByTestId("revision")).toHaveText("3");
      expect(
        await page
          .locator('[data-layer="routes"] [data-object-id="route-ui-1"]')
          .evaluate((current, original) => current === original, routeNode),
      ).toBe(true);
    },
  );
  const after = await readRoutePoints(page, "route-ui-1");
  const firstAfter = await page.getByTestId("hit-R1").boundingBox();
  const delta = {
    x: after[0]!.x - before[0]!.x,
    y: after[0]!.y - before[0]!.y,
  };
  expect(delta).not.toEqual({ x: 0, y: 0 });
  expect(
    after.map((point, index) => ({
      x: point.x - before[index]!.x,
      y: point.y - before[index]!.y,
    })),
  ).toEqual(after.map(() => delta));
  expect(firstAfter?.x).not.toBe(firstBefore?.x);
  expect(firstAfter?.y).not.toBe(firstBefore?.y);

  await copySelectionAt(page, { x: 640, y: 380 });
  await expect(page.getByTestId("instance-count")).toHaveText("4");
  await expect(page.getByTestId("net-count")).toHaveText("2");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(2);
  await expect(page.getByTestId("selected-internal-route-count")).toHaveText(
    "1",
  );
});

test("keeps an internal junction with the live group preview", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  // R3 sits under the tap so the branch leaves it as a clean tee; a jogged
  // branch would leave two arms on one side and draw no Junction dot.
  await placeComponent(page, "resistor", { x: 425, y: 420 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await clickDrawTool(page, "wire");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.getByTestId("terminal-R3-1").click();
  await page.keyboard.press("Escape");

  const junctionHit = page.locator('[data-testid^="junction-"]').first();
  await expect(junctionHit).toBeVisible();
  const junctionId = await junctionHit.getAttribute("data-drag-object-id");
  if (!junctionId) throw new Error("Internal junction has no drag identity");
  const junctionBefore = await junctionHit.boundingBox();
  await page.keyboard.press("Control+a");
  const routeHit = page.locator('[data-testid^="route-hit-"]').first();
  const routeTestId = await routeHit.getAttribute("data-testid");
  if (!routeTestId) throw new Error("Internal route has no test id");
  const routeId = routeTestId.replace(/^route-hit-/u, "");
  await dragRouteSegment(
    page,
    routeId,
    { x: 76, y: 62 },
    0.35,
    undefined,
    async () => {
      await expect(page.getByTestId("schematic-canvas")).toHaveClass(
        /semantic-move-preview/u,
      );
      await expect(page.getByTestId("revision")).toHaveText("5");
    },
  );
  const junctionAfter = await junctionHit.boundingBox();
  expect(junctionAfter?.x).not.toBe(junctionBefore?.x);
  expect(junctionAfter?.y).not.toBe(junctionBefore?.y);
});

test("moves an unselected component in one thresholded drag", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  const canvas = page.getByTestId("schematic-canvas");
  const hit = page.getByTestId("hit-R1");
  const symbol = page.locator('[data-layer="symbols"] [data-object-id="R1"]');

  // Placement selects the new part; clear that convenience selection so this
  // is the same gesture a user makes in a dense, established schematic.
  await canvas.click({ position: { x: 760, y: 420 } });
  const before = await hit.boundingBox();
  const symbolBefore = await symbol.boundingBox();
  if (!before) throw new Error("Component hit target is not measurable");
  if (!symbolBefore) throw new Error("Component symbol is not measurable");
  const start = {
    x: before.x + before.width * 0.7,
    y: before.y + before.height * 0.6,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 74, start.y + 53, { steps: 4 });
  await expect(canvas).toHaveClass(/semantic-move-preview/u);
  await expect(page.getByTestId("revision")).toHaveText("1");
  const during = await symbol.boundingBox();
  expect(during?.x).not.toBe(symbolBefore.x);
  expect(during?.y).not.toBe(symbolBefore.y);
  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("2");
});

test("selects and moves multiple instances while viewport gestures stay transient", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 330, y: 180 });
  await placeComponent(page, "nmos", { x: 560, y: 180 });
  await expect(page.getByTestId("revision")).toHaveText("2");

  const first = await page.getByTestId("hit-M1").boundingBox();
  const second = await page.getByTestId("hit-M2").boundingBox();
  if (!first || !second) throw new Error("Instances are not measurable");
  await page.mouse.move(first.x - 15, first.y - 15);
  await page.mouse.down();
  await page.mouse.move(
    second.x + second.width + 15,
    second.y + second.height + 15,
    {
      steps: 5,
    },
  );
  await page.mouse.up();
  await openSelectionShelf(page);
  await revealPropertiesShelf(page);
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "2 components",
  );

  await page
    .getByTestId("hit-M1")
    .dragTo(page.getByTestId("schematic-canvas"), {
      targetPosition: { x: 450, y: 330 },
    });
  await expect(page.getByTestId("revision")).toHaveText("3");

  const canvas = page.getByTestId("schematic-canvas");
  const beforeViewBox = await canvas.getAttribute("viewBox");
  await page.evaluate(() => {
    const formal = document.querySelector('[data-layer="formal"]');
    const host = formal?.parentElement;
    if (!host) throw new Error("Formal scene host is unavailable");
    const state = { mutations: 0, observer: null as MutationObserver | null };
    state.observer = new MutationObserver((records) => {
      state.mutations += records.length;
    });
    state.observer.observe(host, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    (
      window as unknown as {
        __formalSceneMutationState?: typeof state;
      }
    ).__formalSceneMutationState = state;
  });
  await closeSelectionShelf(page);
  await canvas.hover({ position: { x: 320, y: 350 } });
  await page.mouse.wheel(0, -120);
  await expect(canvas).not.toHaveAttribute("viewBox", beforeViewBox!);
  await expect(page.getByTestId("revision")).toHaveText("3");

  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Canvas is not measurable");
  await page.mouse.move(canvasBox.x + 320, canvasBox.y + 350);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(canvasBox.x + 750, canvasBox.y + 390, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (
          window as unknown as {
            __formalSceneMutationState?: {
              mutations: number;
              observer: MutationObserver;
            };
          }
        ).__formalSceneMutationState;
        state?.observer.disconnect();
        return state?.mutations ?? -1;
      }),
    )
    .toBe(0);

  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("carries the connection point when a column and its wire move", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  // Two columns sharing one bus, as a differential pair is drawn.
  for (const [x, y] of [
    [240, 200],
    [560, 200],
    [240, 440],
    [560, 440],
  ] as const) {
    await placeComponent(page, "nmos", { x, y });
  }
  const ids = await page
    .locator('[data-layer="symbols"] [data-object-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-object-id")),
    );
  for (const [top, bottom] of [
    [ids[0], ids[2]],
    [ids[1], ids[3]],
  ] as const) {
    await clickDrawTool(page, "wire");
    await page.getByTestId(`terminal-${top}-D`).click();
    await canvas.click({
      position: {
        x: top === ids[0] ? 250 : 570,
        y: 300,
      },
    });
    await page.getByTestId(`terminal-${bottom}-D`).click();
    await page.keyboard.press("Escape");
  }
  const columnMids = await page
    .locator('[data-layer="routes"] polyline')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .map((rect) => ({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        })),
    );
  await clickDrawTool(page, "wire");
  await page.mouse.click(columnMids[0]!.x, columnMids[0]!.y);
  await page.mouse.dblclick(columnMids[1]!.x, columnMids[1]!.y);
  await page.keyboard.press("Escape");

  const scene = () =>
    page.evaluate(() => ({
      dots: [
        ...document.querySelectorAll('[data-layer="junctions"] circle'),
      ].map((circle) => Math.round(Number(circle.getAttribute("cx")))),
      bends: [
        ...document.querySelectorAll('[data-layer="routes"] polyline'),
      ].map((line) => (line as unknown as SVGPolylineElement).points.length),
    }));

  const before = await scene();
  expect(before.dots).toHaveLength(2);
  // Every wire is a straight run to start with.
  expect(before.bends.every((count) => count === 2)).toBe(true);
  const rightJunction = Math.max(...before.dots);

  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 480, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 520, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText("Selected");

  await page.mouse.move(box.x + 560, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 680, box.y + 200, { steps: 12 });
  await page.mouse.up();

  const after = await scene();
  // The connection point travels with the column it belongs to. Pinning it
  // left the selected wires bending back to a point that stayed behind.
  expect(Math.max(...after.dots)).toBeGreaterThan(rightJunction);
  expect(Math.min(...after.dots)).toBe(Math.min(...before.dots));
  // The bus stretches; nothing in the selection deforms into a dogleg.
  expect(after.bends.filter((count) => count > 2)).toHaveLength(0);
});

test("leaves the connection point alone when only a part moves", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await placeComponent(page, "nmos", { x: 300, y: 200 });
  await placeComponent(page, "nmos", { x: 300, y: 440 });
  const ids = await page
    .locator('[data-layer="symbols"] [data-object-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-object-id")),
    );
  await clickDrawTool(page, "wire");
  await page.getByTestId(`terminal-${ids[0]}-D`).click();
  await canvas.click({ position: { x: 310, y: 300 } });
  await page.getByTestId(`terminal-${ids[1]}-D`).click();
  await page.keyboard.press("Escape");
  const wire = (await page
    .locator('[data-layer="routes"] polyline')
    .first()
    .boundingBox())!;
  await clickDrawTool(page, "wire");
  await page.mouse.click(wire.x + wire.width / 2, wire.y + wire.height / 2);
  await page.mouse.dblclick(
    wire.x + wire.width / 2 - 200,
    wire.y + wire.height / 2,
  );
  await page.keyboard.press("Escape");

  const dotX = () =>
    page
      .locator('[data-layer="junctions"] circle')
      .first()
      .evaluate((circle) => Math.round(Number(circle.getAttribute("cx"))));
  const before = await dotX();

  // One part, no wire: its own lead stretches rather than dragging the
  // connection point — and with it the rest of the net — along.
  await canvas.click({ position: { x: 300, y: 200 } });
  await page.mouse.move(0, 0);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 200, { steps: 10 });
  await page.mouse.up();

  expect(await dotX()).toBe(before);
});

test("drags a marquee selection that holds no instance", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await clickDrawTool(page, "wire");
  await canvas.click({ position: { x: 200, y: 200 } });
  await canvas.dblclick({ position: { x: 340, y: 200 } });
  await canvas.click({ position: { x: 200, y: 260 } });
  await canvas.dblclick({ position: { x: 340, y: 260 } });
  await page.keyboard.press("Escape");

  const readAll = () =>
    page
      .locator('[data-testid^="route-hit-"]')
      .evaluateAll((elements) =>
        elements.map((element) =>
          Array.from((element as unknown as SVGPolylineElement).points).map(
            (point) => ({ x: point.x, y: point.y }),
          ),
        ),
      );
  const before = await readAll();
  expect(before).toHaveLength(2);

  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 150, bounds.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 500, bounds.y + 330, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText("Selected");

  // A marquee can hold only Routes and Junctions. Grabbing one of them used
  // to drag it out of its own selection and leave the rest behind.
  const grab = (await page
    .locator('[data-testid^="route-hit-"]')
    .first()
    .boundingBox())!;
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 60, { steps: 10 });
  await page.mouse.up();

  const after = await readAll();
  const shifts = after.map(
    (points, index) => points[0]!.y - before[index]![0]!.y,
  );
  expect(shifts[0]).toBeGreaterThan(0);
  expect(shifts[1]).toBe(shifts[0]);
});

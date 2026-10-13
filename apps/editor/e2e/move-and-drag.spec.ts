// Moving parts, Wires and groups: command move, drags and their live previews,
// and the wiring a selected group carries.

import {
  clickDrawTool,
  expectStatus,
  openProject,
  exportedProject,
  closeProjectTools,
} from "./editor-fixtures";
import { createGroupDragPerformanceProject } from "../src/features/selection/test-support/group-drag-fixture";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { placeComponent } from "./manual-editor-fixtures.js";
import {
  clickRoute,
  routeInk,
  readRoutePoints,
  closeSelectionShelf,
  routeIdOf,
  segmentPoint,
  polylinePoints,
  drawWire,
} from "./canvas-fixtures.js";

test("a closed 85-part group in a large background cancels, commits once and restores all geometry with Undo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { project } = createGroupDragPerformanceProject();
  await openProject(page, project);
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  await expect(page.getByTestId("instance-count")).toHaveText("485");
  const before = (await exportedProject(page)).documents[0];
  const revision = Number(await page.getByTestId("revision").textContent());
  const corners = await canvas.evaluate((svg) => {
    const matrix = (svg as SVGSVGElement).getScreenCTM()!;
    return [
      { x: 9940, y: 9940 },
      { x: 12800, y: 11140 },
    ].map((p) => new DOMPoint(p.x, p.y).matrixTransform(matrix).toJSON());
  });
  await page.mouse.move(corners[0]!.x, corners[0]!.y);
  await page.mouse.down();
  await page.mouse.move(corners[1]!.x, corners[1]!.y, { steps: 3 });
  await page.mouse.up();
  await expect(
    page.locator('[data-canvas-hit-kind="instance"].selected'),
  ).toHaveCount(85);
  await canvas.focus();
  const formal = page.locator('[data-layer="formal"]');
  const original = await formal.elementHandle();
  const target = { x: corners[0]!.x + 70, y: corners[0]!.y + 60 };
  await page.keyboard.press("m");
  await page.keyboard.down("Alt");
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await expect(canvas).toHaveClass(/semantic-move-preview/);
  expect(await formal.evaluate((node, saved) => node === saved, original)).toBe(
    true,
  );
  await expect(page.getByTestId("revision")).toHaveText(String(revision));
  await page.keyboard.press("Escape");
  await page.keyboard.up("Alt");
  const cancelled = (await exportedProject(page)).documents[0];
  expect(cancelled).toEqual(before);
  // Select again: Escape intentionally clears the current selection.
  await page.mouse.move(corners[0]!.x, corners[0]!.y);
  await page.mouse.down();
  await page.mouse.move(corners[1]!.x, corners[1]!.y, { steps: 3 });
  await page.mouse.up();
  await expect(
    page.locator('[data-canvas-hit-kind="instance"].selected'),
  ).toHaveCount(85);
  await canvas.focus();
  await page.keyboard.press("m");
  await page.keyboard.down("Alt");
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await page.mouse.click(target.x, target.y);
  await page.keyboard.up("Alt");
  await expect(page.getByTestId("revision")).toHaveText(String(revision + 1));
  const after = (await exportedProject(page)).documents[0];
  const positions = (doc: typeof before) =>
    doc.instances
      .filter((i: { id: string }) => i.id.startsWith("RM"))
      .map(
        (i: { placement: { position: { x: number; y: number } } }) =>
          i.placement.position,
      );
  expect(positions(after)).not.toEqual(positions(before));
  expect(
    after.instances.filter((i: { id: string }) => !i.id.startsWith("RM")),
  ).toEqual(
    before.instances.filter((i: { id: string }) => !i.id.startsWith("RM")),
  );
  await canvas.focus();
  await page.keyboard.press("Control+z");
  const restored = (await exportedProject(page)).documents[0];
  expect({ ...restored, revision: before.revision }).toEqual(before);
});

/** R1 and R2 side by side, joined by a Wire from R1's pin 2 to R2's pin 1. */
async function wiredResistors(page: Page): Promise<void> {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await drawWire(page, "R1-2", "R2-1");
}

async function dragRouteSegment(
  page: Page,
  routeId: string,
  delta: { x: number; y: number },
  position: number,
  duringDrag: () => Promise<void>,
): Promise<void> {
  const route = page.getByTestId(`route-hit-${routeId}`);
  // Grab the longest leg, clear of the pins at either end.
  const points = await polylinePoints(route);
  let index = 0;
  let longest = -1;
  for (let at = 0; at < points.length - 1; at += 1) {
    const [from, to] = [points[at]!, points[at + 1]!];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > longest) [longest, index] = [length, at];
  }
  const point = await segmentPoint(route, position, index);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + delta.x, point.y + delta.y, { steps: 4 });
  await duringDrag();
  await page.mouse.up();
}

test("command move follows the pointer and commits a materially different click instead of a stale preview", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  const canvas = page.getByTestId("schematic-canvas");
  const resistor = page.getByTestId("hit-R1");
  await resistor.click();
  const before = await resistor.boundingBox();
  if (!before) throw new Error("Placed resistor is not measurable");
  const symbol = page.locator('[data-layer="symbols"] [data-object-id="R1"]');
  const symbolNode = await symbol.elementHandle();
  if (!symbolNode) throw new Error("Placed symbol is not measurable");

  await page.keyboard.press("m");
  await expectStatus(page, "Move:");
  await page.mouse.move(before.x + 40, before.y + 20);
  // The preview moves the drawn symbol rather than rebuilding it.
  expect(
    await symbol.evaluate(
      (current, original) => current === original,
      symbolNode,
    ),
  ).toBe(true);

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

test("command move turns a part while stretching its boundary wire, restores the exact preview on Escape and commits pose and translation together", async ({
  page,
}) => {
  await wiredResistors(page);

  const resistor = page.getByTestId("hit-R1");
  const body = page.locator('[data-layer="symbols"] [data-object-id="R1"] > g');
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

  // A turn inside the move is undone exactly by cancelling it.
  await page.keyboard.press("m");
  await page.mouse.move(hit.x + 120, hit.y + 90);
  await page.keyboard.press("r");
  await expect(body).toHaveAttribute("transform", /rotate\(90\)/u);
  await page.keyboard.press("Escape");
  await expect(resistor).not.toHaveAttribute("transform", /^matrix\(/u);
  await expect(page.getByTestId("revision")).toHaveText("3");
  expect(await resistor.boundingBox()).toEqual(hit);
  expect(await readRoutePoints(page, "route-ui-1")).toEqual(before);

  await resistor.click();
  await page.keyboard.press("m");
  await page.mouse.move(hit.x + 100, hit.y + 100);
  await page.keyboard.press("r");
  await expectStatus(page, "Move preview rotated");
  await expect(body).toHaveAttribute("transform", /rotate\(90\)/u);
  // The name stays upright while its part turns.
  const reference = page.locator(
    '[data-layer="annotations"] [data-object-id="instance-label-R1"]',
  );
  await expect(reference).toHaveAttribute("transform", /^rotate\(0 /u);
  await expect(reference).not.toHaveAttribute("transform", /matrix|scale/u);
  // Only the moving end of the boundary wire stretches in the preview.
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
  await expectStatus(page, "Moved and transformed selection");
  await expect(body).toHaveAttribute("transform", /rotate\(90\)/u);
  expect(await readRoutePoints(page, "route-ui-1")).toEqual(preview);
  expect(await conductorInk.getAttribute("d")).toBe(bridgePreview);
});

test("dragging an unselected part past the threshold draws its wire stretching before the drop", async ({
  page,
}) => {
  await wiredResistors(page);
  // Clear the convenience selection so this is the same gesture a user makes
  // in a dense, established schematic.
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 760, y: 420 } });
  const revision = Number(await page.getByTestId("revision").textContent());
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
  const start = {
    x: hit.x + hit.width * 0.7,
    y: hit.y + hit.height * 0.6,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 74, start.y + 53, { steps: 4 });
  await expect(canvas).toHaveClass(/semantic-move-preview/u);
  await expect(page.getByTestId("revision")).toHaveText(String(revision));
  // Mid-drag: the wire is drawn where it now runs, in its own paint, and its
  // old run has left the shared conductor ink rather than staying behind.
  await expect
    .poll(() => readRoutePoints(page, "route-ui-1"))
    .not.toEqual(before);
  const during = await readRoutePoints(page, "route-ui-1");
  expect(during[0]).not.toEqual(before[0]);
  expect(during.at(-1)).toEqual(before.at(-1));
  await expect(wire).not.toHaveAttribute("stroke", "none");
  expect((await inkRuns()).some((d) => d?.includes(oldRun))).toBe(false);

  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText(String(revision + 1));
  const after = await readRoutePoints(page, "route-ui-1");
  expect(after[0]).toEqual(during[0]);
  expect(after.at(-1)).toEqual(before.at(-1));
  await expect(wire).toHaveAttribute("stroke", "none");
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke"))
    .not.toBeNull();
});

test("a selected group carries its internal wiring and Junction through the live preview", async ({
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
  const junctionBefore = await junctionHit.boundingBox();
  const firstBefore = await page.getByTestId("hit-R1").boundingBox();
  await page.keyboard.press("Control+a");
  const routeHit = page.locator('[data-testid^="route-hit-"]').first();
  const routeId = await routeIdOf(routeHit);
  const before = await readRoutePoints(page, routeId);
  const routeNode = await page
    .locator(`[data-layer="routes"] [data-object-id="${routeId}"]`)
    .elementHandle();
  if (!routeNode) throw new Error("Internal route is not measurable");
  await dragRouteSegment(page, routeId, { x: 76, y: 62 }, 0.35, async () => {
    await expect.poll(() => readRoutePoints(page, routeId)).not.toEqual(before);
    await expect(page.getByTestId("schematic-canvas")).toHaveClass(
      /semantic-move-preview/u,
    );
    await expect(page.getByTestId("revision")).toHaveText("5");
    // The preview moves the drawn wire rather than rebuilding it.
    expect(
      await page
        .locator(`[data-layer="routes"] [data-object-id="${routeId}"]`)
        .evaluate((current, original) => current === original, routeNode),
    ).toBe(true);
  });
  // The internal wire translated rigidly, with its parts and Junction.
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
  const firstAfter = await page.getByTestId("hit-R1").boundingBox();
  expect(firstAfter?.x).not.toBe(firstBefore?.x);
  expect(firstAfter?.y).not.toBe(firstBefore?.y);
  const junctionAfter = await junctionHit.boundingBox();
  expect(junctionAfter?.x).not.toBe(junctionBefore?.x);
  expect(junctionAfter?.y).not.toBe(junctionBefore?.y);
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
  await expect(page.getByTestId("hit-M1")).toHaveClass(/selected/);
  await expect(page.getByTestId("hit-M2")).toHaveClass(/selected/);

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

import { createEmptyProject } from "@icm/model";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { chooseComponent, clickDrawTool } from "./editor-fixtures";

async function placeComponent(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
}

async function instanceIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-canvas-hit-kind="instance"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-canvas-hit-id")!),
    );
}

/**
 * Where document points are on screen, through the canvas's own screen CTM.
 *
 * That matrix is the transform the editor inverts to read every pointer, so
 * aiming a gesture through it is aiming at exactly the document coordinate
 * named. A rendered bounding box is not a substitute: Chromium's box model
 * counts an SVG stroke as part of the shape, and the hit polylines carry a
 * 14px non-scaling one.
 */
async function onScreen(
  canvas: Locator,
  points: readonly { x: number; y: number }[],
): Promise<{ x: number; y: number }[]> {
  const screen = await canvas.evaluate((element, logical) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) return null;
    return logical.map((point) => {
      const mapped = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: mapped.x, y: mapped.y };
    });
  }, points);
  if (!screen) throw new Error("Canvas geometry is not measurable");
  return screen;
}

/**
 * Hold until the canvas has stopped moving under the pointer.
 *
 * Panel toggles animate the workspace grid, and the canvas keeps growing into
 * the freed column for the whole transition: the drawing slides sideways and
 * the document-to-pixel scale climbs as it goes. The aria attribute a toggle
 * flips is set on the click, not at the end of that animation, so a pixel-
 * exact gesture measured straight afterwards aims at where the drawing WAS.
 */
async function awaitCanvasSettled(canvas: Locator): Promise<void> {
  await canvas.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const svg = element as SVGSVGElement;
        const read = () => {
          const matrix = svg.getScreenCTM();
          return matrix
            ? `${matrix.a} ${matrix.d} ${matrix.e} ${matrix.f}`
            : "";
        };
        let previous = read();
        let stillFrames = 0;
        const step = () => {
          const current = read();
          stillFrames = current === previous ? stillFrames + 1 : 0;
          previous = current;
          if (stillFrames >= 3) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
}

test("wire can start from any interior point of an existing net", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 260, y: 420 });
  await placeComponent(page, "resistor", { x: 460, y: 310 });
  const ids = await instanceIds(page);

  // Vertical wire between the first two resistors.
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);

  // Start the next wire from the MIDDLE of that wire, not from a pin, and
  // land it on the third resistor's pin.
  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const box = (await route.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId(`terminal-${ids[2]}-1`).click();
  await page.keyboard.press("Escape");

  // The tap split the original wire and added the branch: three routes, one
  // junction dot at the tee.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(3);
  await expect(page.locator('g[data-layer="junctions"] circle')).toHaveCount(1);
});

test("clicking a junction dot selects it and Delete disconnects the tap", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 260, y: 420 });
  await placeComponent(page, "resistor", { x: 460, y: 310 });
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const box = (await route.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId(`terminal-${ids[2]}-1`).click();
  await page.keyboard.press("Escape");
  const dot = page.locator('g[data-layer="junctions"] circle');
  await expect(dot).toHaveCount(1);

  // Click exactly on the visible dot: the junction's hit circle sits on the
  // same contact point, so the dot is clickable.
  const dotBox = (await dot.boundingBox())!;
  await page.mouse.click(
    dotBox.x + dotBox.width / 2,
    dotBox.y + dotBox.height / 2,
  );
  await page.keyboard.press("Delete");

  // The tap is gone: the branch to the third resistor is disconnected and
  // the dot disappears.
  await expect(page.locator('g[data-layer="junctions"] circle')).toHaveCount(0);
  await expect(page.locator('[data-canvas-hit-kind="route"]')).not.toHaveCount(
    3,
  );
});

test("middle click cycles the wire corner and never commits the wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 460, y: 420 });
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();

  // Drafting toward the second pin: middle over bare canvas cycles the
  // corner shape instead of placing a point.
  await page.mouse.move(360, 320);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("status")).toContainText("Wire corner:");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);

  // Middle directly over the destination endpoint's snap circle is the
  // reported hazard: it must cycle again, not commit the wire.
  const destination = page.getByTestId(`terminal-${ids[1]}-1`);
  const box = (await destination.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("status")).toContainText("Wire corner:");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);

  // The primary button still commits.
  await destination.click();
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
});

test("dragging a wire's end onto another wire joins them into one net", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  // A horizontal wire, then a separate vertical one clear above it. A wire
  // drawn on free grid points finishes on Enter, not on the second click.
  await canvas.click({ position: { x: 600, y: 500 } });
  await page.keyboard.press("w");
  await canvas.click({ position: { x: 240, y: 320 } });
  await canvas.click({ position: { x: 480, y: 320 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("w");
  await canvas.click({ position: { x: 360, y: 160 } });
  await canvas.click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(2);
  await expect(page.getByTestId("statusbar-issues")).toHaveText("Not checked");
  await page.getByTestId("check-and-save").click();
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "No issues found",
  );
  // Return to the drawing surface before measuring this pixel-exact drag.
  await page.getByTestId("selection-shelf").click();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await awaitCanvasSettled(canvas);

  // Drag the vertical wire down so its lower end comes to rest on the
  // horizontal one. This is the gesture that used to leave two nets touching
  // at a point, with an ambiguous-junction error the author could not clear.
  // The travel is read from what is actually rendered rather than assumed from
  // the click coordinates, and aimed through the canvas transform, so the end
  // is released ON the wire instead of a rounding step past it.
  const routes = page.locator('[data-canvas-hit-kind="route"]');
  const drawn = await routes.evaluateAll((elements) =>
    elements.map((element) => {
      const points = (element.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/u)
        .map((pair) => pair.split(",").map(Number));
      const xs = points.map((point) => point[0]!);
      const ys = points.map((point) => point[1]!);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    }),
  );
  const horizontal = drawn.find((route) => route.maxX - route.minX > 0)!;
  const vertical = drawn.find((route) => route.maxY - route.minY > 0)!;
  const grabbedAt = (vertical.minY + vertical.maxY) / 2;
  const travel = horizontal.minY - vertical.maxY;
  const [grab, halfway, release] = await onScreen(canvas, [
    { x: vertical.minX, y: grabbedAt },
    { x: vertical.minX, y: grabbedAt + travel / 2 },
    { x: vertical.minX, y: grabbedAt + travel },
  ]);
  await page.mouse.move(grab!.x, grab!.y);
  await page.mouse.down();
  await page.mouse.move(halfway!.x, halfway!.y, { steps: 6 });
  await page.mouse.move(release!.x, release!.y, { steps: 6 });
  await page.mouse.up();

  // The landing tapped the horizontal wire: it splits, and a junction dot
  // marks the connection — exactly what drawing the same wire would produce.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(3);
  await expect(page.locator('g[data-layer="junctions"] circle')).toHaveCount(1);
  // Drawing and model agree, so there is nothing ambiguous left to report.
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "Check out of date",
  );
  await page.getByTestId("check-and-save").click();
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "No issues found",
  );
});

test("a power rail drawn across the tops of wires connects to them", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 600, y: 500 } });

  // Two wires standing side by side with their upper ends level.
  for (const x of [300, 460]) {
    await page.keyboard.press("w");
    await canvas.click({ position: { x, y: 400 } });
    await canvas.click({ position: { x, y: 280 } });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
  }
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(2);

  // A VDD rail laid across both tops. This used to refuse outright with
  // "That edit would have changed which Nets these objects belong to" — the
  // mirror of the rail-end-on-wire case, and just as deliberate a gesture.
  await chooseComponent(page, "vdd");
  await canvas.click({ position: { x: 240, y: 280 } });
  await canvas.click({ position: { x: 520, y: 280 } });

  await expect(page.getByTestId("status")).toContainText("Added VDD rail");
  // The rail tapped both wires on the way across, so it arrives split into
  // three pieces — two wires plus three rail segments — rather than lying
  // over them as one unconnected conductor.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(5);
  await page.keyboard.press("Escape");
  await page.getByTestId("check-and-save").click();
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "No issues found",
  );
});

test("a component dragged onto a wire lands and connects", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 600, y: 500 } });

  await page.keyboard.press("w");
  await canvas.click({ position: { x: 240, y: 320 } });
  await canvas.click({ position: { x: 480, y: 320 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  // Place the port clear of the wire, so no placement contact runs and the
  // only thing under test is the move.
  await chooseComponent(page, "vdd-port");
  await canvas.click({ position: { x: 360, y: 200 } });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);

  // Drag it down until its pin comes to rest on the wire. This used to be
  // refused outright — "That edit would have changed which Nets these objects
  // belong to" — leaving the part where it started: the author could neither
  // connect it nor put it there.
  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const body = (await instance.boundingBox())!;
  const wire = (await page
    .locator('[data-canvas-hit-kind="route"]')
    .first()
    .boundingBox())!;
  const cx = body.x + body.width / 2;
  const cy = body.y + body.height / 2;
  const travel = wire.y + wire.height / 2 - (body.y + body.height);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + travel / 2, { steps: 6 });
  await page.mouse.move(cx, cy + travel, { steps: 6 });
  await page.mouse.up();

  await expect(page.getByTestId("status")).toContainText("connected them");
  // The pin became a real endpoint on the conductor, so the wire is now two
  // pieces meeting at it.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(2);
  await page.getByTestId("check-and-save").click();
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    "No issues found",
  );
});

test("the preview draws the wire the release commits, contacts and all", async ({
  page,
}) => {
  // The defect this pins: the draft used to be computed one way and the
  // committed wire another, so the line the author watched was not the line
  // they got. One straight run across three pins is where the two answers
  // used to differ most — the commit splits at every crossed pin and the
  // preview drew none of them.
  const project = createEmptyProject("wire-preview-truth", "Wire preview");
  const document = project.documents[0]!;
  document.instances.push(
    {
      id: "C1",
      symbolId: "capacitor",
      placement: { position: { x: 80, y: 120 }, rotation: 0, mirror: "none" },
    },
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 120, y: 120 }, rotation: 0, mirror: "none" },
    },
  );

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "wire-preview-truth.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const canvas = page.getByTestId("schematic-canvas");
  const [start, end] = await onScreen(canvas, [
    { x: 40, y: 100 },
    { x: 200, y: 100 },
  ]);

  await clickDrawTool(page, "wire");
  await page.mouse.click(start!.x, start!.y);
  // Hover, do not release: this is the moment the author is looking at.
  await page.mouse.move(end!.x, end!.y);

  const previewPoints = await page
    .getByTestId("wire-preview")
    .evaluate((element) =>
      Array.from((element as SVGPolylineElement).points).map((point) => ({
        x: point.x,
        y: point.y,
      })),
    );
  // Both crossed pins are drawn as contacts, so the run reads as joining them
  // rather than passing over them.
  await expect(page.getByTestId("wire-preview-contact")).toHaveCount(2);

  await page.mouse.dblclick(end!.x, end!.y);
  await expect(page.getByTestId("status")).toContainText("Committed route");

  // Every leg of this gesture lies on one horizontal line, so ordering the
  // committed vertices by x reassembles the single conductor the author drew.
  const committedPoints = await page
    .locator('[data-testid^="route-hit-"]')
    .evaluateAll((elements) => {
      const seen = new Map<string, { x: number; y: number }>();
      for (const element of elements) {
        for (const point of Array.from(
          (element as SVGPolylineElement).points,
        )) {
          seen.set(`${point.x}:${point.y}`, { x: point.x, y: point.y });
        }
      }
      return [...seen.values()].sort((left, right) => left.x - right.x);
    });

  expect(previewPoints.length).toBeGreaterThan(2);
  expect(previewPoints).toEqual(committedPoints);
});

import { expect, test, type Page } from "@playwright/test";
import {
  addStraightWire,
  findCanvasInstance,
  largeCameraProject,
  routeAnchor,
  onScreen,
} from "./canvas-fixtures.js";

import {
  awaitEditorReady,
  editDocumentStyleCode,
  readDocumentStyleCode,
  openEditor,
  openProject,
  closeProjectTools,
  exportedProject,
} from "./editor-fixtures";

test("a local camera keeps a crossing wire pickable and can find distant parts without mounting every device", async ({
  page,
}) => {
  const project = largeCameraProject();
  const cell = project.documents[0]!;
  addStraightWire(
    cell,
    "long-wire",
    routeAnchor("start", "long-net", -200, 20),
    routeAnchor("end", "long-net", 6500, 20),
  );
  addStraightWire(
    cell,
    "far-wire",
    routeAnchor("far-start", "far-net", 4100, 3440),
    routeAnchor("far-end", "far-net", 4220, 3440),
  );
  cell.annotations.push({
    id: "wide",
    kind: "instance-label",
    locked: false,
    content: { runs: [{ kind: "text", value: "W".repeat(110) }] },
    anchor: { kind: "free", position: { x: 500, y: 40 } },
    alignment: "start",
    rotation: 0,
  });
  await openProject(page, project);
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  const formal = canvas.locator('[data-layer="formal"]');
  const painted = (id: string) => formal.locator(`[data-object-id="${id}"]`);
  await findCanvasInstance(page, "R8");
  await expect(painted("R8")).toBeInViewport();
  await expect(painted("R640")).toHaveCount(0);
  await expect(painted("wide")).toBeInViewport();
  // The crossing Wire shares its painted path and can start off screen.
  const conductor = formal.locator('[data-role="conductor-ink"]');
  expect(
    await conductor.evaluateAll((paths) =>
      paths.some((path) =>
        (path as SVGGeometryElement).isPointInStroke(new DOMPoint(1430, 20)),
      ),
    ),
  ).toBe(true);
  await expect
    .poll(() => canvas.locator('[data-canvas-hit-kind="instance"]').count())
    .toBeLessThan(100);
  await expect
    .poll(() =>
      canvas.locator('[data-layer="formal"] [data-symbol-id]').count(),
    )
    .toBeLessThan(100);
  const wire = canvas.locator('[data-canvas-hit-id="long-wire"]');
  await expect(page.getByTestId("route-hit-far-wire")).toHaveCount(0);
  const [p] = await onScreen(canvas, [{ x: 1430, y: 20 }]);
  await page.mouse.click(p.x, p.y);
  await expect(wire).toHaveClass(/selected/);
  const [ink] = await onScreen(canvas, [{ x: 1410, y: 35 }]);
  await page.mouse.click(ink.x, ink.y);
  await expect(page.getByTestId("annotation-hit-wide")).toHaveClass(/selected/);
  await findCanvasInstance(page, "R640");
  await expect(painted("R640")).toBeInViewport();
  await expect(painted("R8")).toHaveCount(0);
  const [part] = await onScreen(canvas, [{ x: 6200, y: 4180 }]);
  await page.mouse.move(part.x, part.y);
  await page.mouse.down();
  await page.mouse.move(part.x + 24, part.y + 18);
  const beforePan = await canvas.getAttribute("viewBox");
  await page.mouse.wheel(2300, 0);
  await expect(canvas).not.toHaveAttribute("viewBox", beforePan!);
  await page.mouse.move(part.x + 48, part.y + 26);
  await page.mouse.up();
  const moved = (await exportedProject(page)) as typeof project;
  expect(
    moved.documents[0]!.instances.find((i) => i.id === "R640")!.placement!
      .position.x,
  ).toBeGreaterThan(6300);
  await canvas.focus();
  await page.keyboard.press("Control+z");
  const restored = (await exportedProject(page)) as typeof project;
  expect(
    restored.documents[0]!.instances.find((i) => i.id === "R640")!.placement!
      .position,
  ).toEqual({ x: 6200, y: 4180 });
  await canvas.focus();
  await page.keyboard.press("f");
  await expect(painted("R1")).toBeInViewport();
  await expect(painted("R640")).toBeInViewport();
  await expect(page.getByTestId("hit-R1")).toBeAttached();
  await expect(page.getByTestId("hit-R640")).toBeAttached();
  await expect(page.getByTestId("route-hit-far-wire")).toBeAttached();
});

test("a prepared tall formula stays painted and pickable when only its top enters the local camera", async ({
  page,
}) => {
  const project = largeCameraProject();
  project.documents[0]!.annotations.push({
    id: "tall-rule",
    kind: "instance-label",
    locked: false,
    content: {
      runs: [{ kind: "math", latex: "\\rule{1em}{40em}", display: "inline" }],
    },
    anchor: { kind: "free", position: { x: 2800, y: 440 } },
    alignment: "start",
    rotation: 0,
  });
  await openProject(page, project);
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  const painted = canvas.locator(
    '[data-layer="formal"] [data-object-id="tall-rule"]',
  );
  await expect
    .poll(() =>
      painted.evaluate(
        (element) => (element as SVGGraphicsElement).getBBox().height,
      ),
    )
    .toBeGreaterThan(450);
  await findCanvasInstance(page, "R15");
  await expect(painted).toBeInViewport();
  const [ink] = await onScreen(canvas, [{ x: 2806, y: 48 }]);
  await page.mouse.click(ink.x, ink.y);
  await expect(page.getByTestId("annotation-hit-tall-rule")).toHaveClass(
    /selected/,
  );
});

test("fallback glyphs stay painted when their trailing ink reaches the local camera", async ({
  page,
}) => {
  const project = largeCameraProject();
  project.documents[0]!.annotations.push({
    id: "wide-fallback",
    kind: "instance-label",
    locked: false,
    content: { runs: [{ kind: "text", value: "Ａ".repeat(200) }] },
    anchor: { kind: "free", position: { x: 0, y: 40 } },
    alignment: "start",
    rotation: 0,
  });
  await openProject(page, project);
  await closeProjectTools(page);
  await page.evaluate(() => document.fonts.ready);
  const painted = page.locator(
    '[data-layer="formal"] [data-object-id="wide-fallback"]',
  );
  const right = await painted.evaluate((element) => {
    const box = (element as SVGGraphicsElement).getBBox();
    return box.x + box.width;
  });
  // Browsers choose an installed face for fullwidth A. Find a part inside
  // the actual trailing ink regardless of which system face supplied it.
  const column = Math.min(31, Math.floor((right - 80) / 200));
  expect(column).toBeGreaterThan(2);
  await findCanvasInstance(page, `R${column + 1}`);
  await expect(painted).toBeInViewport();
});

/** Dispatch one wheel event with a chosen device signature. */
async function wheel(
  page: Page,
  signature: { deltaY: number; deltaX?: number; wheelDeltaY?: number },
): Promise<void> {
  await page.getByTestId("schematic-canvas").evaluate((element, init) => {
    const bounds = element.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      clientX: bounds.left + bounds.width * 0.3,
      clientY: bounds.top + bounds.height * 0.3,
      deltaX: init.deltaX ?? 0,
      deltaY: init.deltaY,
      bubbles: true,
      cancelable: true,
    });
    if (init.wheelDeltaY !== undefined) {
      Object.defineProperty(event, "wheelDeltaY", { value: init.wheelDeltaY });
    }
    element.dispatchEvent(event);
  }, signature);
}

const width = async (page: Page): Promise<number> =>
  Number(
    (await page.getByTestId("schematic-canvas").getAttribute("viewBox"))!.split(
      " ",
    )[2],
  );

test("arrow keys pan by one screen-space step, a wheel zooms and a trackpad pans, the setting overrides both, and a framed narrow view keeps full-speed pan and zoom range", async ({
  page,
}) => {
  await openEditor(page);
  const canvas = page.getByTestId("schematic-canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await canvas.click({
    position: { x: bounds!.width - 12, y: bounds!.height - 12 },
  });
  await expect(canvas).toHaveCSS("outline-style", "none");

  const readViewBox = async () =>
    (await canvas.getAttribute("viewBox"))!.split(" ").map(Number) as [
      number,
      number,
      number,
      number,
    ];
  // Screen pixels per document unit for a camera.
  const visualScale = (view: number[]) =>
    Math.min(bounds!.width / view[2]!, bounds!.height / view[3]!);
  const scrollBehavior = async () =>
    JSON.parse(await readDocumentStyleCode(page)).canvas.scrollBehavior;
  const setScrollBehavior = (behavior: "zoom" | "pan") =>
    editDocumentStyleCode(page, (code) => {
      code.canvas.scrollBehavior = behavior;
    });
  const initial = await readViewBox();
  await page.keyboard.press("ArrowRight");
  await expect.poll(readViewBox).not.toEqual(initial);
  const right = await readViewBox();
  expect(right[2]).toBe(initial[2]);
  expect(right[3]).toBe(initial[3]);
  const initialScale = visualScale(initial);
  expect((right[0] - initial[0]) * initialScale).toBeCloseTo(48, 1);

  await page.keyboard.press("ArrowLeft");
  await expect.poll(readViewBox).toEqual(initial);
  await page.keyboard.press("ArrowDown");
  await expect.poll(readViewBox).not.toEqual(initial);
  const down = await readViewBox();
  expect((down[1] - initial[1]) * initialScale).toBeCloseTo(48, 1);
  await page.keyboard.press("ArrowUp");
  await expect.poll(readViewBox).toEqual(initial);

  expect(await scrollBehavior()).toBe("auto");

  // A detent-quantized signature zooms even though its deltaY is tiny —
  // the case that made a slowly turned mouse wheel pan. Scrolling up
  // zooms in, so the camera narrows.
  const beforeWheel = await width(page);
  await wheel(page, { deltaY: -4, wheelDeltaY: 120 });
  await expect.poll(() => width(page)).toBeLessThan(beforeWheel);

  // A Mac mouse wheel with acceleration (3:1 ratio, one axis) zooms too.
  const afterDetent = await width(page);
  await wheel(page, { deltaY: -40, wheelDeltaY: 120 });
  await expect.poll(() => width(page)).toBeLessThan(afterDetent);

  // A two-axis trackpad swipe pans instead, leaving the zoom untouched.
  const afterWheel = await width(page);
  await wheel(page, { deltaX: 3, deltaY: 40, wheelDeltaY: -120 });
  await expect.poll(() => width(page)).toBe(afterWheel);

  // An explicit choice wins over any evidence: the same trackpad
  // signature now zooms.
  await setScrollBehavior("zoom");
  await wheel(page, { deltaX: -3, deltaY: -40, wheelDeltaY: 120 });
  await expect.poll(() => width(page)).toBeLessThan(afterWheel);

  // And a mouse detent pans once the person says the device is a surface.
  await setScrollBehavior("pan");
  const beforePan = await width(page);
  await wheel(page, { deltaY: -4, wheelDeltaY: 120 });
  await expect.poll(() => width(page)).toBe(beforePan);

  // The choice survives a reload.
  await page.reload();
  await awaitEditorReady(page);
  expect(await scrollBehavior()).toBe("pan");

  // A framed narrow view keeps full-speed pan and the visual zoom range.
  const beforeFrame = await readViewBox();
  const centerX = bounds!.x + bounds!.width / 2;
  const centerY = bounds!.y + bounds!.height / 2;
  await page.mouse.move(centerX - 30, centerY - 160);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(centerX + 30, centerY + 160, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await expect.poll(readViewBox).not.toEqual(beforeFrame);
  const framed = await readViewBox();
  expect(framed[2] / framed[3]).toBeLessThan(0.5);

  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(centerX + 120, centerY, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(readViewBox).not.toEqual(framed);
  const panned = await readViewBox();
  const framedScale = visualScale(framed);
  expect(Math.abs(panned[0] - framed[0]) * framedScale).toBeCloseTo(120, 0);

  await setScrollBehavior("zoom");
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < 80; index += 1) {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          deltaY: -120,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  const maximumVisualScale = Math.min(bounds!.width / 120, bounds!.height / 80);
  await expect
    .poll(async () => visualScale(await readViewBox()))
    .toBeCloseTo(maximumVisualScale, 1);
});

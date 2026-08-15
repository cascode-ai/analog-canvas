import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  chooseComponent,
  clickCommand,
  downloadBytes,
  emulateDownloadOnlyBrowser,
} from "./editor-fixtures.js";

test.beforeEach(async ({ page }) => {
  await emulateDownloadOnlyBrowser(page);
});

// Two-phase drafting creation: click to set the start, move to preview, click to
// commit. Arrow commits on the second click; construction line commits on the
// second click too (a 2-point line). Uses real mouse clicks (not pointer
// dispatch) so the editor's onClick handler — which gates on event.detail === 1
// — fires, and a pointermove drives the hover preview between the two clicks.
async function clickCreate(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Schematic canvas is not measurable");
  const start = { x: box.x + from.x, y: box.y + from.y };
  const end = { x: box.x + to.x, y: box.y + to.y };
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(end.x, end.y);
  await page.mouse.click(end.x, end.y);
  // Arrows commit on the second click. Construction lines retain that click as
  // a vertex so users can add bends; Enter accepts the current preview end.
  await page.keyboard.press("Enter");
}

async function dragLocator(
  locator: Locator,
  delta: { x: number; y: number },
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Drafting hit target is not measurable");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await locator.page().mouse.move(start.x, start.y);
  await locator.page().mouse.down();
  await locator.page().mouse.move(start.x + delta.x, start.y + delta.y, {
    steps: 12,
  });
  await locator.page().mouse.up();
}

async function clickSvgPolyline(locator: Locator): Promise<void> {
  const point = await locator.evaluate((element) => {
    const polyline = element as SVGPolylineElement;
    const matrix = polyline.getScreenCTM();
    if (!matrix || polyline.points.numberOfItems === 0) return null;
    const first = polyline.points.getItem(0);
    const last = polyline.points.getItem(polyline.points.numberOfItems - 1);
    const center = new DOMPoint(
      (first.x + last.x) / 2,
      (first.y + last.y) / 2,
    ).matrixTransform(matrix);
    return { x: center.x, y: center.y };
  });
  if (!point) throw new Error("Drafting polyline is not measurable");
  await locator.page().mouse.click(point.x, point.y);
}

async function expectForeignObjectContentsContained(
  foreignObject: Locator,
): Promise<void> {
  await expect(foreignObject).toBeVisible();
  const containment = await foreignObject.evaluate((element) => {
    const host = element.getBoundingClientRect();
    const content = element.firstElementChild as HTMLElement | null;
    if (!content) return null;
    const contentRect = content.getBoundingClientRect();
    const children = [...content.children].map((child) =>
      child.getBoundingClientRect(),
    );
    return {
      contentFits:
        content.scrollWidth <= content.clientWidth + 1 &&
        content.scrollHeight <= content.clientHeight + 1,
      contained:
        contentRect.left >= host.left - 1 &&
        contentRect.top >= host.top - 1 &&
        contentRect.right <= host.right + 1 &&
        contentRect.bottom <= host.bottom + 1 &&
        children.every(
          (child) =>
            child.left >= host.left - 1 &&
            child.top >= host.top - 1 &&
            child.right <= host.right + 1 &&
            child.bottom <= host.bottom + 1,
        ),
    };
  });
  expect(containment).toEqual({ contentFits: true, contained: true });
}

// The canvas-local toolbar creates RichText AST without exposing raw markup.
test("adds formatted drafting text and undo/redo restores it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("revision")).toHaveText("0");

  await clickCommand(page, "Draw", "Text");
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await expect(draftInput).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insert fraction" }),
  ).toHaveCount(0);
  await expect(draftInput).toHaveCSS("font-family", /DejaVu Sans.*Arial/u);
  await expectForeignObjectContentsContained(
    page.getByTestId("canvas-text-editor"),
  );
  const toolbarCenters = await page
    .getByRole("toolbar", { name: "Text formatting" })
    .locator(":scope > *")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      }),
    );
  expect(
    Math.max(...toolbarCenters) - Math.min(...toolbarCenters),
  ).toBeLessThan(1);
  const initialFontSize = await draftInput.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  await page.getByRole("button", { name: "Increase text size" }).click();
  const previewFontSize = await draftInput.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(previewFontSize).toBeGreaterThan(initialFontSize);
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expectForeignObjectContentsContained(
    page.getByTestId("canvas-text-editor"),
  );
  await draftInput.fill("Vin");
  await draftInput.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Subscript" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await expect(page.locator('[data-layer="drafting"]')).toContainText("Vin");
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCSS(
    "font-family",
    /DejaVu Sans.*Arial/u,
  );
  await expect(page.getByTestId("revision")).toHaveText("2");

  const projectBytes = await downloadBytes(page, "File", "Save Project");
  const project = JSON.parse(projectBytes.toString("utf8"));
  const doc = project.documents[0];
  const textObject = doc.drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  expect(textObject).toBeTruthy();
  expect(textObject.typographyToken).toBe("label");
  expect(textObject.styleOverride?.sizeScale).toBe(1.1);
  const runs = textObject.content.runs.map((run: { kind: string }) => run.kind);
  expect(runs).toContain("span");
  const selectedTextHit = page.getByTestId(/^drafting-hit-note-/);
  await expect(selectedTextHit).toHaveClass(/hit-target/u);
  await expect(selectedTextHit).toHaveClass(/selected/u);
  await expect(selectedTextHit).toHaveCSS("stroke-dasharray", /6px.*4px/u);

  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-layer="drafting"] text')).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-layer="drafting"] text')).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(page.locator('[data-layer="drafting"] text')).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("revision")).toHaveText("6");
});

test("snaps quick Text creation after a non-grid viewport zoom", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 317, y: 243 } });
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);

  const zoomedViewBox = (await canvas.getAttribute("viewBox"))!
    .split(" ")
    .map(Number);
  const [x, y, width, height] = zoomedViewBox;
  const unsnappedTextPosition = {
    x: Math.round(x! + width! / 2),
    y: Math.round(y! + height! - 20),
  };
  expect(
    Object.values(unsnappedTextPosition).some((value) => value % 10 !== 0),
  ).toBe(true);

  await clickCommand(page, "Draw", "Text");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toContainText("Added drafting text");

  const projectBytes = await downloadBytes(page, "File", "Save Project");
  const project = JSON.parse(projectBytes.toString("utf8"));
  const textObject = project.documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  expect(textObject.anchor.position.x % 10).toBe(0);
  expect(textObject.anchor.position.y % 10).toBe(0);
});

test("fits drafting text with F using an integer grid camera", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Text");
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await draftInput.fill("Vout");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("f");
  await expect(page.getByTestId("status")).toHaveText("Fit Document");
  const camera = (await canvas.getAttribute("viewBox"))!.split(" ").map(Number);
  expect(camera).toHaveLength(4);
  expect(camera.every((value) => Number.isInteger(value))).toBe(true);
  expect(camera.every((value) => value % 10 === 0)).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Circuit Maker" }),
  ).toBeVisible();
});

test("text floating editor closes on Escape or an outside pointer", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Text");
  await expect(page.getByTestId("canvas-text-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);

  await clickCommand(page, "Draw", "Text");
  await expect(page.getByTestId("canvas-text-editor")).toBeVisible();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 300, y: 100 } });
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);
});

test("exports a newly created construction line through the File menu", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Construction line (K)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 260 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-kind="construction-line"');
});

test("switching creation tools discards the incompatible draft session", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Arrow (A)");
  await page.getByTestId("schematic-canvas").click({
    position: { x: 220, y: 220 },
  });
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();

  await clickCommand(page, "Draw", "Wire (W)");
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await expect(page.getByTestId("drafting-create-preview")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("repeating A or K preserves the current drafting session", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("schematic-canvas");

  await page.keyboard.press("a");
  await canvas.click({ position: { x: 220, y: 220 } });
  await canvas.hover({ position: { x: 420, y: 260 } });
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("k");
  await canvas.click({ position: { x: 220, y: 300 } });
  await canvas.hover({ position: { x: 420, y: 340 } });
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();
  await page.keyboard.press("k");
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("revision")).toHaveText("0");
});

// Moving an existing drafting object commits exactly one transaction, so one
// Ctrl+Z restores its original persisted anchor.
test("existing text drag commits once and undoes atomically", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Text");
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");

  const before = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ).documents[0].drafting.objects[0].anchor.position;
  await dragLocator(page.getByTestId(/^drafting-hit-note-/), {
    x: 70,
    y: -45,
  });
  await expect(page.getByTestId("revision")).toHaveText("2");
  const moved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ).documents[0].drafting.objects[0].anchor.position;
  expect(moved).not.toEqual(before);

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("revision")).toHaveText("3");
  const undone = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ).documents[0].drafting.objects[0].anchor.position;
  expect(undone).toEqual(before);
});

test("Escape cancels an existing text drag without a revision", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Text");
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .press("Escape");
  const hit = page.getByTestId(/^drafting-hit-note-/);
  const box = await hit.boundingBox();
  if (!box) throw new Error("Drafting hit target is not measurable");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y - 30, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toHaveText("Cancelled canvas drag");
});

test("Escape removes Smart Snap guides from a cancelled component drag", async ({
  page,
}) => {
  await page.goto("/");
  await chooseComponent(page, "resistor");
  await page.getByTestId("schematic-canvas").click({
    position: { x: 300, y: 240 },
  });
  await chooseComponent(page, "resistor");
  await page.getByTestId("schematic-canvas").click({
    position: { x: 560, y: 360 },
  });
  await page.keyboard.press("Escape");

  const moving = page.getByTestId("hit-R1");
  const target = page.getByTestId("hit-R2");
  const movingBox = await moving.boundingBox();
  const targetBox = await target.boundingBox();
  if (!movingBox || !targetBox) {
    throw new Error("Component hit targets are not measurable");
  }
  const start = {
    x: movingBox.x + movingBox.width / 2,
    y: movingBox.y + movingBox.height / 2,
  };
  const end = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });

  const snapGuides = page.locator(
    '[data-layer="snap-guides"] .smart-snap-guide',
  );
  await expect.poll(async () => snapGuides.count()).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(snapGuides).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText("2");
});

// Creating a construction line commits one object.
test("two-phase click-creates a construction line", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Construction line (K)");
  await expect(page.getByTestId("active-tool")).toHaveText("construction-line");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 260 });
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(
    page.locator(
      '[data-layer="drafting"] polyline[data-kind="construction-line"]',
    ),
  ).toHaveCount(1);
});

// Two-phase click-creating an arrow commits one object.
test("two-phase click-creates an arrow", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Arrow (A)");
  await expect(page.getByTestId("active-tool")).toHaveText("arrow");
  await clickCreate(page, { x: 200, y: 320 }, { x: 420, y: 380 });
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(
    page.locator('[data-layer="drafting"] g[data-kind="draft-arrow"]'),
  ).toHaveCount(1);
});

// Shape-based hit — a construction line selects via its stroke and does not
// block a click below its bounds rect.
test("construction line uses stroke-based hit, not a blocking rect", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Construction line (K)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const hit = page.getByTestId(/^drafting-hit-construction-/);
  await expect(hit).toHaveCount(1);
  const tag = await hit.evaluate((element) => element.tagName);
  expect(tag).toBe("polyline");

  const line = page.locator(
    '[data-layer="drafting"] polyline[data-kind="construction-line"]',
  );
  const box = await line.boundingBox();
  if (!box) throw new Error("Construction line is not measurable");
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
  await expect(
    page.locator('[data-testid^="drafting-hit-construction-"].selected'),
  ).toHaveCount(1);
});

// An unedited Apply must not add a revision.
test("unedited Apply does not add a revision", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Text");
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await draftInput.fill("Vin");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("revision")).toHaveText("2");

  const handle = page.getByTestId(/^drafting-hit-note-/);
  await handle.dblclick();
  await expect(draftInput).toBeVisible();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.waitForTimeout(200);
  await expect(page.getByTestId("revision")).toHaveText("2");
});

// A saved project is reopened through the file input and preserves both its
// canonical rich-text AST and anchor.
test("drafting content and anchor survive save and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Text");
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await draftInput.fill("Vref");
  await draftInput.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Italic" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("revision")).toHaveText("2");

  const projectBytes = await downloadBytes(page, "File", "Save Project");
  const project = JSON.parse(projectBytes.toString("utf8"));
  const textObject = project.documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  expect(textObject).toBeTruthy();
  expect(
    textObject.content.runs.map((run: { kind: string }) => run.kind),
  ).toContain("span");
  expect(textObject.anchor).toMatchObject({ kind: "free" });
  expect(typeof textObject.anchor.position.x).toBe("number");
  await clickCommand(page, "Draw", "Text");
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(2);

  await page.getByTestId("project-file").setInputFiles({
    name: "saved-drafting.icproj.json",
    mimeType: "application/json",
    buffer: projectBytes,
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened saved-drafting.icproj.json",
  );
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(1);
  const reopenedBytes = await downloadBytes(page, "File", "Save Project");
  const reopened = JSON.parse(reopenedBytes.toString("utf8"));
  const reopenedText = reopened.documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  expect(reopenedText.anchor).toEqual(textObject.anchor);
  expect(reopenedText.content).toEqual(textObject.content);
});

// A two-phase-created arrow shows selection handles and rotates +90° via R,
// committing one revision and keeping the head at the rotated tip.
test("selected arrow rotates via R and shows selection handles", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Arrow (A)");
  await clickCreate(page, { x: 200, y: 300 }, { x: 320, y: 300 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const hit = page.getByTestId(/^drafting-hit-arrow-/);
  await clickSvgPolyline(hit);
  await expect(
    page.locator('[data-testid^="drafting-handles-arrow-"]'),
  ).toHaveCount(1);

  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("2");
  // One rotated arrow remains (head stays attached to the rotated tip).
  await expect(
    page.locator('[data-layer="drafting"] g[data-kind="draft-arrow"]'),
  ).toHaveCount(1);
});

test("R creates a selectable, styleable rectangle with four resize handles", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("r");
  await clickCreate(page, { x: 220, y: 220 }, { x: 380, y: 320 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const rectangle = page.locator('[data-kind="draft-rectangle"]');
  await expect(rectangle).toHaveCount(1);
  await expect(rectangle).toHaveAttribute("fill", "none");

  const hit = page.getByTestId(/^drafting-hit-rectangle-/);
  await expect(hit).toHaveCSS("pointer-events", "stroke");
  await expect(hit).toHaveCSS("fill", "none");
  const center = await hit.evaluate((element) => {
    const polygon = element as SVGPolygonElement;
    const matrix = polygon.getScreenCTM();
    if (!matrix || polygon.points.numberOfItems !== 4) return null;
    const logicalCenter = Array.from({ length: 4 }, (_, index) =>
      polygon.points.getItem(index),
    ).reduce(
      (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
      { x: 0, y: 0 },
    );
    const screenCenter = new DOMPoint(
      logicalCenter.x,
      logicalCenter.y,
    ).matrixTransform(matrix);
    return { x: screenCenter.x, y: screenCenter.y };
  });
  if (!center) throw new Error("rectangle center is not measurable");

  // A marquee wholly inside the empty rectangle must not select its outline.
  await page.mouse.move(center.x - 12, center.y - 12);
  await page.mouse.down();
  await page.mouse.move(center.x + 12, center.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect(
    page.locator('[data-testid^="draft-handle-corner-"]'),
  ).toHaveCount(0);

  // The empty interior must also pass a placement click through to the canvas.
  await chooseComponent(page, "nmos");
  await page.mouse.click(center.x, center.y);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-M1")).toHaveCount(1);
  await expect(page.getByTestId("revision")).toHaveText("2");

  const edge = await hit.evaluate((element) => {
    const polygon = element as SVGPolygonElement;
    const matrix = polygon.getScreenCTM();
    if (!matrix || polygon.points.numberOfItems < 2) return null;
    const first = polygon.points.getItem(0);
    const second = polygon.points.getItem(1);
    const midpoint = new DOMPoint(
      (first.x + second.x) / 2,
      (first.y + second.y) / 2,
    ).matrixTransform(matrix);
    return { x: midpoint.x, y: midpoint.y };
  });
  if (!edge) throw new Error("rectangle hit target is not measurable");
  await page.mouse.click(edge.x, edge.y);
  await expect(
    page.locator('[data-testid^="draft-handle-corner-"]'),
  ).toHaveCount(4);
  await page.keyboard.press("q");

  await page
    .getByRole("combobox", { name: "Line style" })
    .selectOption("dotted");
  await expect(rectangle).toHaveAttribute("stroke-dasharray", "2 3");
  await expect(page.getByTestId("revision")).toHaveText("3");

  const pointsBeforeResize = await rectangle.getAttribute("points");
  await dragLocator(page.getByTestId(/^draft-handle-corner-0-/), {
    x: -20,
    y: -10,
  });
  await expect(page.getByTestId("revision")).toHaveText("4");
  expect(await rectangle.getAttribute("points")).not.toBe(pointsBeforeResize);
});

// Dragging an arrow endpoint handle moves just that endpoint in one
// transaction; undo restores it.
test("arrow endpoint handle drag moves the tip", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Arrow (A)");
  await clickCreate(page, { x: 200, y: 300 }, { x: 320, y: 300 });
  await clickSvgPolyline(page.getByTestId(/^drafting-hit-arrow-/));
  const tipHandle = page.getByTestId(/^draft-handle-to-arrow-/);
  await dragLocator(tipHandle, { x: 0, y: 40 });
  await expect(page.getByTestId("revision")).toHaveText("2");

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("revision")).toHaveText("3");
});

// Double-clicking a construction line inserts a vertex; double-clicking a
// vertex below the two-vertex floor is refused.
test("construction line vertex insert via double-click", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Construction line (K)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  // Insert a vertex by double-clicking the line near its midpoint.
  const hit = page.getByTestId(/^drafting-hit-construction-/);
  const box = await hit.boundingBox();
  if (!box) throw new Error("construction line hit not measurable");
  // Avoid the midpoint curve handle, which is rendered above the line and
  // intentionally owns its pointer events.
  await page.mouse.dblclick(box.x + box.width * 0.35, box.y + box.height / 2);
  await expect(page.getByTestId("revision")).toHaveText("2");
  // Three vertex handles now.
  await expect(page.locator('[data-testid^="draft-handle-vx-"]')).toHaveCount(
    3,
  );
});

// The [ and ] shortcuts step the selected object's stroke width and commit one
// revision each.
test("bracket shortcuts step stroke width", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Construction line (K)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await page.getByTestId(/^drafting-hit-construction-/).click({ force: true });
  await page.keyboard.press("]");
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("[");
  await expect(page.getByTestId("revision")).toHaveText("3");
});

// Drawing style lives in Properties; it is not a second floating canvas UI.
test("Properties changes drawing line style", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Construction line (K)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await page.getByTestId(/^drafting-hit-construction-/).click({ force: true });
  await page.keyboard.press("q");
  await page
    .getByRole("combobox", { name: "Line style" })
    .selectOption("solid");
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.locator('[aria-label="Drawing style"]')).toHaveCount(1);
  await expect(page.getByTestId("drafting-inline-inspector")).toHaveCount(0);
});

test("Properties renders an arrow line-style override", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Arrow (A)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await page.getByTestId(/^drafting-hit-arrow-/).click({ force: true });
  await page.keyboard.press("q");
  const commandBar = page.getByRole("navigation", { name: "Editor commands" });
  const commandBarBefore = await commandBar.boundingBox();
  await page
    .getByRole("combobox", { name: "Line style" })
    .selectOption("dotted");
  await expect(
    page.locator('[data-kind="draft-arrow"] > polyline'),
  ).toHaveAttribute("stroke-dasharray", "2 3");
  expect(await commandBar.boundingBox()).toEqual(commandBarBefore);
});

test("arrow Properties omits the Segment selector", async ({ page }) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Arrow (A)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await page.getByTestId(/^drafting-hit-arrow-/).click({ force: true });
  await page.keyboard.press("q");
  const shaft = page.locator('[data-kind="draft-arrow"] > polyline');
  const head = page.locator('[data-kind="draft-arrow"] > polygon');
  const originalPoints = await head.getAttribute("points");

  const properties = page.getByTestId("drafting-properties");
  await expect(
    properties.getByRole("combobox", { name: "Curve segment" }),
  ).toHaveCount(0);

  await properties
    .getByRole("combobox", { name: "Stroke width" })
    .selectOption("2");
  await expect(shaft).toHaveAttribute("stroke-width", "3.2");

  await properties
    .getByRole("combobox", { name: "Arrow head size" })
    .selectOption("1.5");
  expect(await head.getAttribute("points")).not.toBe(originalPoints);
});

test("drawing Properties follows selection and closes with the dock", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Arrow (A)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  const hit = page.getByTestId(/^drafting-hit-arrow-/);
  await hit.click({ force: true });
  await page.keyboard.press("q");
  await expect(page.getByTestId("drafting-properties")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drafting-properties")).toHaveCount(0);

  await hit.click({ force: true });
  await page.keyboard.press("q");
  await expect(page.getByTestId("drafting-properties")).toBeVisible();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 300, y: 520 } });
  await expect(page.getByTestId("drafting-properties")).toHaveCount(0);
});

// Lock protects in-place edits but Delete has priority and remains available.
test("drawing Properties unlocks a protected drawing and Delete overrides its lock", async ({
  page,
}) => {
  await page.goto("/");
  await clickCommand(page, "Draw", "Construction line (K)");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  const drawing = page.getByTestId(/^drafting-hit-construction-/);
  await drawing.click({ force: true });
  await page.keyboard.press("q");

  await page
    .getByRole("combobox", { name: "Line style" })
    .selectOption("dotted");
  const styledProject = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  );
  expect(
    styledProject.documents[0].drafting.objects[0].styleOverride.lineStyle,
  ).toBe("dotted");

  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unlock", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[aria-label="Drawing style"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lock", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await clickCommand(page, "Edit", "Delete");
  await expect(drawing).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  awaitEditorReady,
  chooseComponent,
  clickCommand,
  clickDrawTool,
  downloadBytes,
} from "./editor-fixtures.js";

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
  await page.goto("/editor");
  await expect(page.getByTestId("revision")).toHaveText("0");

  await clickDrawTool(page, "text");
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await expect(draftInput).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insert fraction" }),
  ).toHaveCount(0);
  await expect(draftInput).toHaveCSS(
    "font-family",
    /ICM Round Period.*DejaVu Sans.*Arial/u,
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const faces = await document.fonts.load('15px "ICM Round Period"', ".");
        return faces.some((face) => face.status === "loaded");
      }),
    )
    .toBe(true);
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
    /ICM Round Period.*DejaVu Sans.*Arial/u,
  );
  await expect(page.getByTestId("revision")).toHaveText("2");

  const projectBytes = await downloadBytes(
    page,
    "File",
    "Export Project File…",
  );
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
  // Selection is a solid tinted wash, not a dashed marquee box.
  await expect(selectedTextHit).toHaveCSS("stroke-dasharray", "none");

  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-layer="drafting"] text')).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-layer="drafting"] text')).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(page.locator('[data-layer="drafting"] text')).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("revision")).toHaveText("6");
});

test("authors one validated formula through the canonical text editor", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await clickDrawTool(page, "text");

  await page.getByRole("button", { name: "Insert formula" }).click();
  await expect(page.getByRole("dialog", { name: "Formula" })).toBeVisible();
  await expect(
    page.locator('math-field[aria-label="Formula editor"]'),
  ).toBeVisible();

  const editorLayout = await page
    .getByTestId("canvas-text-editor")
    .evaluate((element) => {
      const shell = element.querySelector<HTMLElement>(
        ".rich-text-editor-shell",
      );
      const formulaScroll = element.querySelector<HTMLElement>(
        '[data-testid="formula-scroll-region"]',
      );
      const mathfield = element.querySelector<HTMLElement>("math-field");
      const keyboardToggle = mathfield?.shadowRoot?.querySelector<HTMLElement>(
        '[part="virtual-keyboard-toggle"]',
      );
      return {
        frameHeight: Number(element.getAttribute("height")),
        shellHeight: shell?.offsetHeight ?? 0,
        shellScrollHeight: shell?.scrollHeight ?? 0,
        shellOverflowY: shell ? getComputedStyle(shell).overflowY : "",
        formulaOverflowY: formulaScroll
          ? getComputedStyle(formulaScroll).overflowY
          : "",
        keyboardToggleDisplay: keyboardToggle
          ? getComputedStyle(keyboardToggle).display
          : "none",
        virtualKeyboardVisible: window.mathVirtualKeyboard?.visible === true,
      };
    });
  expect(editorLayout.frameHeight).toBeGreaterThanOrEqual(
    editorLayout.shellScrollHeight,
  );
  expect(editorLayout.shellHeight).toBeGreaterThanOrEqual(
    editorLayout.shellScrollHeight,
  );
  expect(editorLayout.shellOverflowY).not.toBe("auto");
  expect(editorLayout.shellOverflowY).not.toBe("scroll");
  expect(editorLayout.formulaOverflowY).toBe("auto");
  expect(editorLayout.keyboardToggleDisplay).toBe("none");
  expect(editorLayout.virtualKeyboardVisible).toBe(false);

  const formulaKeyboard = page.getByRole("toolbar", {
    name: "Formula keyboard",
  });
  await expect(formulaKeyboard.getByRole("button")).toHaveCount(20);
  const keyRowCount = await formulaKeyboard
    .getByRole("button")
    .evaluateAll(
      (buttons) =>
        new Set(
          buttons.map((button) =>
            Math.round(button.getBoundingClientRect().top),
          ),
        ).size,
    );
  expect(keyRowCount).toBe(2);
  await expect(
    formulaKeyboard.getByRole("button", { name: "Insert Product" }),
  ).toBeVisible();
  await expect(
    formulaKeyboard.getByRole("button", { name: "Insert Derivative" }),
  ).toBeVisible();
  await expect(
    formulaKeyboard.getByRole("button", { name: "Insert Plus" }),
  ).toHaveCount(0);
  await expect(
    formulaKeyboard.getByRole("button", { name: "Insert Equals" }),
  ).toHaveCount(0);

  const source = page.getByRole("textbox", { name: "Formula LaTeX source" });
  await page.locator('math-field[aria-label="Formula editor"]').click();
  await page.keyboard.type("a+b-c=(d)");
  await expect(source).toHaveValue(/a\+b-c=/u);
  await expect(source).toHaveValue(/\\left\(d\\right\)/u);
  await formulaKeyboard.getByRole("button", { name: "Insert Product" }).click();
  await formulaKeyboard
    .getByRole("button", { name: "Insert Derivative" })
    .click();
  await expect(source).toHaveValue(/\\prod/u);
  await expect(source).toHaveValue(/\\mathrm\{d\}/u);

  const moreSymbols = page.getByText("More symbols", { exact: true });
  await expect(page.getByRole("toolbar", { name: "Greek" })).not.toBeVisible();
  await moreSymbols.click();
  const formulaScroll = page.getByTestId("formula-scroll-region");
  const canvasViewBoxBeforeFormulaScroll = await page
    .getByTestId("schematic-canvas")
    .getAttribute("viewBox");
  const scrollExtent = await formulaScroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollExtent.scrollHeight).toBeGreaterThan(scrollExtent.clientHeight);
  await formulaScroll.hover();
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => formulaScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.getByTestId("schematic-canvas")).toHaveAttribute(
    "viewBox",
    canvasViewBoxBeforeFormulaScroll!,
  );
  await page.getByRole("button", { name: "Insert Omega", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Formula LaTeX source" }),
  ).toHaveValue(/\\Omega/u);
  await moreSymbols.click();

  await page.getByRole("button", { name: "Insert Square root" }).click();
  await expect(source).toHaveValue(/\\sqrt/u);

  const normalizedDifferential = String.raw`\int_0^1\frac{1}{\sqrt{1+\cos^2x}}\differentialD x`;
  await source.fill(normalizedDifferential);
  await page.getByRole("button", { name: "Display" }).click();
  await page
    .getByRole("dialog", { name: "Formula" })
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect(
    page.getByTestId("canvas-text-editor").locator("[data-rich-text-math]"),
  ).toHaveAttribute("data-latex", normalizedDifferential);
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const formula = page.locator(
    '[data-kind="draft-text"] [data-role="formula"]',
  );
  await expect(formula).toBeVisible();
  await expect(formula.locator("path").first()).toBeVisible();
  await expect(page.locator("foreignObject", { has: formula })).toHaveCount(0);

  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const text = project.documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  expect(text.content).toEqual({
    runs: [
      {
        kind: "math",
        latex: normalizedDifferential,
        display: "block",
      },
    ],
  });

  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-role="formula"');
  expect(svg).toContain("<path");
  expect(svg).not.toContain("<foreignObject");

  const pdf = await downloadBytes(page, "File", "Export PDF");
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(pdf.toString("latin1")).not.toContain("/Subtype /Image");
});

test("keeps unsafe formula source out of the Project", async ({ page }) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await clickDrawTool(page, "text");
  await page.getByRole("button", { name: "Insert formula" }).click();
  await page
    .getByRole("textbox", { name: "Formula LaTeX source" })
    .fill(String.raw`\href{https://example.com}{V}`);
  await page
    .getByRole("dialog", { name: "Formula" })
    .getByRole("button", { name: "Insert", exact: true })
    .click();

  await expect(page.getByRole("alert")).toContainText(
    "command is not available",
  );
  await expect(page.getByRole("dialog", { name: "Formula" })).toBeVisible();
  await expect(page.locator('[data-role="formula"]')).toHaveCount(0);
});

test("snaps quick Text creation after a non-grid viewport zoom", async ({
  page,
}) => {
  await page.goto("/editor");
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

  await clickDrawTool(page, "text");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toContainText("Added drafting text");

  const projectBytes = await downloadBytes(
    page,
    "File",
    "Export Project File…",
  );
  const project = JSON.parse(projectBytes.toString("utf8"));
  const textObject = project.documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  // Quick text rounds to the annotation pitch (default 5), never raw
  // fractional viewport coordinates.
  expect(textObject.anchor.position.x % 5).toBe(0);
  expect(textObject.anchor.position.y % 5).toBe(0);
});

test("copies a selected text with C", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await clickDrawTool(page, "text");
  const draftInput = page.getByRole("textbox", { name: "Canvas text editor" });
  await draftInput.fill("Design note");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.keyboard.press("Escape");

  const texts = page.locator('[data-kind="draft-text"]');
  await expect(texts).toHaveCount(1);
  const origin = (await texts.first().boundingBox())!;

  // Select the text and copy it. A drawing-only selection used to be refused
  // outright — "Select at least one component to copy".
  await page.mouse.click(
    origin.x + origin.width / 2,
    origin.y + origin.height / 2,
  );
  await page.keyboard.press("c");
  await expect(page.getByTestId("status")).toContainText("Place copy");

  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 420, box.y + 380);
  await canvas.click({ position: { x: 420, y: 380 } });
  await page.keyboard.press("Escape");

  await expect(texts).toHaveCount(2);
  const both = await texts.evaluateAll((elements) =>
    elements.map((element) => element.textContent),
  );
  expect(both.filter((value) => value?.includes("Design note"))).toHaveLength(
    2,
  );
});

test("fits drafting text with F using an integer grid camera", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "text");
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
    page.getByRole("heading", { name: "Analog Canvas" }),
  ).toBeVisible();
});

test("text floating editor closes on Escape or an outside pointer", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "text");
  await expect(page.getByTestId("canvas-text-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);

  await clickDrawTool(page, "text");
  await expect(page.getByTestId("canvas-text-editor")).toBeVisible();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 300, y: 100 } });
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);
});

test("exports a newly created construction line through the File menu", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "line");
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
  await page.goto("/editor");
  await clickDrawTool(page, "arrow");
  await page.getByTestId("schematic-canvas").click({
    position: { x: 220, y: 220 },
  });
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();

  await clickDrawTool(page, "wire");
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  await expect(page.getByTestId("drafting-create-preview")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("repeating A or K preserves the current drafting session", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
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
  await page.goto("/editor");
  await clickDrawTool(page, "text");
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");

  const before = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ).documents[0].drafting.objects[0].anchor.position;
  await dragLocator(page.getByTestId(/^drafting-hit-note-/), {
    x: 70,
    y: -45,
  });
  await expect(page.getByTestId("revision")).toHaveText("2");
  const moved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ).documents[0].drafting.objects[0].anchor.position;
  expect(moved).not.toEqual(before);

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("revision")).toHaveText("3");
  const undone = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ).documents[0].drafting.objects[0].anchor.position;
  expect(undone).toEqual(before);
});

test("Escape cancels an existing text drag without a revision", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "text");
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
  await page.goto("/editor");
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
  await page.goto("/editor");
  await clickDrawTool(page, "line");
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
  await page.goto("/editor");
  await clickDrawTool(page, "arrow");
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
  await page.goto("/editor");
  await clickDrawTool(page, "line");
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
  await page.goto("/editor");
  await clickDrawTool(page, "text");
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
  await page.goto("/editor");
  await clickDrawTool(page, "text");
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await draftInput.fill("Vref");
  await draftInput.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Italic" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("revision")).toHaveText("2");

  const projectBytes = await downloadBytes(
    page,
    "File",
    "Export Project File…",
  );
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
  await clickDrawTool(page, "text");
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(2);

  await page.getByTestId("project-file").setInputFiles({
    name: "saved-drafting.icproj.json",
    mimeType: "application/json",
    buffer: projectBytes,
  });
  // One drafting object sits under the guard's meaningful-content
  // threshold, so the replacement proceeds without a prompt.
  await expect(page.getByTestId("status")).toContainText(
    "Opened saved-drafting.icproj.json",
  );
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(1);
  const reopenedBytes = await downloadBytes(
    page,
    "File",
    "Export Project File…",
  );
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
  await page.goto("/editor");
  await clickDrawTool(page, "arrow");
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
  await page.goto("/editor");
  await awaitEditorReady(page);
  await clickDrawTool(page, "rectangle");
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

test("O creates a selectable, styleable circle with one radial handle and no rotation", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("o");
  await clickCreate(page, { x: 260, y: 260 }, { x: 340, y: 260 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const circle = page.locator('[data-kind="draft-circle"]');
  await expect(circle).toHaveCount(1);
  await expect(circle).toHaveAttribute("fill", "none");
  // The default 5-unit annotation pitch resolves this gesture half a grid
  // finer than the old device-grid rounding did.
  await expect(circle).toHaveAttribute("r", "85");

  const hit = page.getByTestId(/^drafting-hit-circle-/);
  await expect(hit).toHaveCSS("pointer-events", "stroke");
  const hitPoint = await hit.evaluate((element) => {
    const circle = element as SVGCircleElement;
    const matrix = circle.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(
      circle.cx.baseVal.value + circle.r.baseVal.value,
      circle.cy.baseVal.value,
    ).matrixTransform(matrix);
  });
  if (!hitPoint) throw new Error("circle hit target is not measurable");
  await page.mouse.click(hitPoint.x, hitPoint.y);
  await expect(
    page.locator('[data-testid^="draft-handle-radius-circle-"]'),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("drafting-properties").getByLabel("Drawing bearing"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("drafting-properties").getByLabel("Line style"),
  ).toHaveCount(1);

  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.locator('[data-kind="draft-rectangle"]')).toHaveCount(0);
});

test("E leaves a selected drafting rectangle as drawing geometry", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 220, y: 220 }, { x: 380, y: 320 });

  await page.getByTestId(/^drafting-hit-rectangle-/).click({ force: true });
  await page.keyboard.press("e");

  await expect(page.getByTestId("document-count")).toHaveText("1");
  await expect(page.locator('[data-kind="draft-rectangle"]')).toHaveCount(1);
  await expect(page.getByTestId("status")).toHaveText(
    "Select a hierarchical block before entering a Cell",
  );
});

// Dragging an arrow endpoint handle moves just that endpoint in one
// transaction; undo restores it.
test("arrow endpoint handle drag moves the tip", async ({ page }) => {
  await page.goto("/editor");
  await clickDrawTool(page, "arrow");
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
  await page.goto("/editor");
  await clickDrawTool(page, "line");
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
  await page.goto("/editor");
  await clickDrawTool(page, "line");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await page.getByTestId(/^drafting-hit-construction-/).click({ force: true });
  await page.keyboard.press("]");
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("[");
  await expect(page.getByTestId("revision")).toHaveText("3");
});

// Drawing style lives in Properties; it is not a second floating canvas UI.
test("Properties changes drawing line style", async ({ page }) => {
  await page.goto("/editor");
  await clickDrawTool(page, "line");
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
  await page.goto("/editor");
  await clickDrawTool(page, "arrow");
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
  await page.goto("/editor");
  await clickDrawTool(page, "arrow");
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

  await properties.getByLabel("Stroke width").fill("2");
  await expect(shaft).toHaveAttribute("stroke-width", "3.2");

  await properties
    .getByRole("combobox", { name: "Arrow head size" })
    .selectOption("1.5");
  expect(await head.getAttribute("points")).not.toBe(originalPoints);
});

test("drawing Properties follows selection and closes with the dock", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "arrow");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  const hit = page.getByTestId(/^drafting-hit-arrow-/);
  await hit.click({ force: true });
  await page.keyboard.press("q");
  await expect(page.getByTestId("drafting-properties")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drafting-properties")).toHaveCount(0);

  // Escape leaves the dock open, so reselecting restores Properties without
  // Q, and the next Q collapses the dock instead of reopening it.
  await hit.click({ force: true });
  await expect(page.getByTestId("drafting-properties")).toBeVisible();
  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByTestId("drafting-properties")).toBeHidden();
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
  await page.goto("/editor");
  await clickDrawTool(page, "line");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  const drawing = page.getByTestId(/^drafting-hit-construction-/);
  await drawing.click({ force: true });
  await page.keyboard.press("q");

  await page
    .getByRole("combobox", { name: "Line style" })
    .selectOption("dotted");
  const styledProject = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
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

test("a label too long for its box wraps inside it", async ({ page }) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 220, y: 220 }, { x: 380, y: 320 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const hit = page.getByTestId(/^drafting-hit-rectangle-/);
  const box = await hit.first().boundingBox();
  if (!box) throw new Error("rectangle is not measurable");
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toBeVisible();
  await page.keyboard.type("A very long bias network label indeed");
  await page.keyboard.press("Escape");

  const label = page.locator('[data-kind="draft-text"]');
  await expect(label).toHaveCount(1);
  // Several drawn lines, not one line running out past both edges.
  expect(
    await label.locator('[data-text-run="line-break"]').count(),
  ).toBeGreaterThan(0);

  // And it stays inside the box it belongs to.
  const fits = await page.evaluate(() => {
    const polygon = document.querySelector(
      '[data-kind="draft-rectangle"]',
    ) as SVGPolygonElement | null;
    const text = document.querySelector(
      '[data-kind="draft-text"]',
    ) as SVGTextElement | null;
    if (!polygon || !text) return null;
    const rect = polygon.getBBox();
    const drawn = text.getBBox();
    return { rectWidth: rect.width, textWidth: drawn.width };
  });
  if (!fits) throw new Error("label geometry is not measurable");
  expect(fits.textWidth).toBeLessThanOrEqual(fits.rectWidth);
});

test("double-click inside a rectangle writes a centered, anchored label", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 220, y: 220 }, { x: 380, y: 320 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const hit = page.getByTestId(/^drafting-hit-rectangle-/);
  const screenCenter = async (): Promise<{ x: number; y: number }> => {
    const center = await hit.first().evaluate((element) => {
      const polygon = element as SVGPolygonElement;
      const matrix = polygon.getScreenCTM();
      if (!matrix || polygon.points.numberOfItems !== 4) return null;
      const logicalCenter = Array.from({ length: 4 }, (_, index) =>
        polygon.points.getItem(index),
      ).reduce(
        (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
        { x: 0, y: 0 },
      );
      const screen = new DOMPoint(
        logicalCenter.x,
        logicalCenter.y,
      ).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
    if (!center) throw new Error("rectangle center is not measurable");
    return center;
  };

  const center = await screenCenter();
  await page.mouse.dblclick(center.x, center.y);
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeVisible();
  await page.keyboard.type("PFD");
  await page.keyboard.press("Escape");

  const label = page.locator('[data-kind="draft-text"]');
  await expect(label).toHaveCount(1);
  await expect(label).toHaveAttribute("text-anchor", "middle");
  await expect(label).toContainText("PFD");

  // The painted label centers on the rectangle's logical center: x on the
  // center exactly, baseline 0.35 em below for optical cap centering.
  const readGeometry = async () =>
    page.evaluate(() => {
      const polygon = document.querySelector(
        '[data-kind="draft-rectangle"]',
      ) as SVGPolygonElement | null;
      const text = document.querySelector(
        '[data-kind="draft-text"]',
      ) as SVGTextElement | null;
      if (!polygon || !text || polygon.points.numberOfItems !== 4) return null;
      const logicalCenter = Array.from({ length: 4 }, (_, index) =>
        polygon.points.getItem(index),
      ).reduce(
        (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
        { x: 0, y: 0 },
      );
      return {
        center: logicalCenter,
        x: Number(text.getAttribute("x")),
        y: Number(text.getAttribute("y")),
      };
    });
  const geometry = await readGeometry();
  if (!geometry) throw new Error("label geometry is not measurable");
  expect(geometry.x).toBeCloseTo(geometry.center.x, 5);
  expect(geometry.y).toBeCloseTo(geometry.center.y + 0.35 * 15.116, 1);

  // Re-entering editing reuses the same label instead of stacking a second.
  await page.mouse.dblclick(center.x, center.y);
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(label).toHaveCount(1);

  // Resizing the rectangle re-centers the label automatically.
  const edge = await hit.first().evaluate((element) => {
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
  await dragLocator(page.getByTestId(/^draft-handle-corner-0-/), {
    x: -40,
    y: -20,
  });
  const resized = await readGeometry();
  if (!resized) throw new Error("resized geometry is not measurable");
  expect(resized.x).toBeCloseTo(resized.center.x, 5);
  expect(resized.y).toBeCloseTo(resized.center.y + 0.35 * 15.116, 1);

  // An untouched empty label vanishes on commit instead of persisting.
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 430, y: 220 }, { x: 560, y: 300 });
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Schematic canvas is not measurable");
  await page.mouse.dblclick(box.x + 495, box.y + 260);
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(1);
});

test("Properties sets precise size, stroke width, and color per shape", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);

  // Rectangle: precise width/height plus an explicit color.
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 220, y: 220 }, { x: 380, y: 320 });
  const rectangle = page.locator('[data-kind="draft-rectangle"]');
  await expect(rectangle).toHaveCount(1);
  await expect(page.getByTestId("revision")).toHaveText("1");
  const rectangleHit = page.getByTestId(/^drafting-hit-rectangle-/);
  const rectangleEdge = await rectangleHit.evaluate((element) => {
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
  if (!rectangleEdge) throw new Error("rectangle edge is not measurable");
  await page.mouse.click(rectangleEdge.x, rectangleEdge.y);
  await page.keyboard.press("q");
  const properties = page.getByTestId("drafting-properties");
  await expect(properties).toBeVisible();

  await properties.getByLabel("Rectangle width").fill("120");
  await properties.getByLabel("Rectangle height").fill("48");
  const size = await rectangle.evaluate((element) => {
    const polygon = element as SVGPolygonElement;
    const points = Array.from({ length: 4 }, (_, index) =>
      polygon.points.getItem(index),
    );
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  });
  expect(size).toEqual({ width: 120, height: 48 });

  await properties.getByLabel("Stroke width").fill("2.5");
  await properties.getByLabel("Stroke color").evaluate((input, value) => {
    const element = input as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, "#cc2200");
  await expect(rectangle).toHaveAttribute("stroke", "#cc2200");
  const rectangleStroke = Number(await rectangle.getAttribute("stroke-width"));

  // Circle: precise radius; its stroke stays at the profile default and is
  // therefore narrower than the widened rectangle stroke.
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "circle");
  await clickCreate(page, { x: 560, y: 240 }, { x: 610, y: 240 });
  const circle = page.locator('[data-kind="draft-circle"]');
  await expect(circle).toHaveCount(1);
  await circle.click({ position: { x: 0, y: 0 }, force: true });
  const circleEdge = await circle.evaluate((element) => {
    const shape = element as SVGCircleElement;
    const matrix = shape.getScreenCTM();
    if (!matrix) return null;
    const edge = new DOMPoint(
      shape.cx.baseVal.value + shape.r.baseVal.value,
      shape.cy.baseVal.value,
    ).matrixTransform(matrix);
    return { x: edge.x, y: edge.y };
  });
  if (!circleEdge) throw new Error("circle edge is not measurable");
  // The dock stays open from the rectangle phase (Q toggles it); selecting
  // the circle swaps the panel content in place.
  await page.mouse.click(circleEdge.x, circleEdge.y);
  await properties.getByLabel("Circle radius").fill("75");
  await expect(circle).toHaveAttribute("r", "75");
  const circleStroke = Number(await circle.getAttribute("stroke-width"));
  expect(circleStroke).toBeLessThan(rectangleStroke);

  // Auto returns the rectangle to the document ink. The rectangle was
  // resized above, so its edge is re-measured before re-selecting it.
  const resizedEdge = await rectangleHit.evaluate((element) => {
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
  if (!resizedEdge) throw new Error("resized rectangle is not measurable");
  await page.mouse.click(resizedEdge.x, resizedEdge.y);
  await properties.getByRole("button", { name: "Auto" }).click();
  const stroke = await rectangle.getAttribute("stroke");
  expect(stroke).not.toBe("#cc2200");
});

test("annotation grid pitch frees drawings from the device grid", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);

  // Half-grid is the shipped default; the electrical grid is not offered.
  const pitch = page.getByTestId("annotation-grid-select");
  await expect(pitch).toHaveValue("5");
  await pitch.selectOption("1");

  // A drawn rectangle commits at 1-unit precision and survives validation.
  await clickDrawTool(page, "rectangle");
  const canvas = page.getByTestId("schematic-canvas");
  const corners = [
    { x: 301, y: 203 },
    { x: 352, y: 247 },
  ];
  await canvas.click({ position: corners[0]! });
  await canvas.click({ position: corners[1]! });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");
  // Reproduce the click-to-document mapping so the center assertion is exact.
  const expectedCenter = await canvas.evaluate((element, points) => {
    const svg = element as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const matrix = svg.getScreenCTM()!.inverse();
    const toDocument = (point: { x: number; y: number }) => {
      const client = new DOMPoint(bounds.left + point.x, bounds.top + point.y);
      const local = client.matrixTransform(matrix);
      return { x: Math.round(local.x), y: Math.round(local.y) };
    };
    const start = toDocument(points[0]!);
    const end = toDocument(points[1]!);
    return {
      x: Math.round((start.x + end.x) / 2),
      y: Math.round((start.y + end.y) / 2),
    };
  }, corners);

  // A device stays on the Document grid no matter the annotation pitch.
  await chooseComponent(page, "resistor");
  await canvas.click({ position: { x: 363, y: 327 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    schemaVersion: number;
    documents: Array<{
      instances: Array<{ placement?: { position: { x: number; y: number } } }>;
      drafting?: {
        objects: Array<{
          kind: string;
          anchor: { kind: string; position?: { x: number; y: number } };
        }>;
      };
    }>;
  };
  expect(saved.schemaVersion).toBe(30);
  const document = saved.documents[0]!;
  const rectangle = document.drafting?.objects.find(
    (object) => object.kind === "rectangle",
  ) as { center?: { x: number; y: number } } | undefined;
  // 1-unit pitch: the drawn center lands exactly where the clicks map, not
  // on a device-grid multiple.
  expect(rectangle?.center).toEqual(expectedCenter);
  const placement = document.instances[0]!.placement!.position;
  expect(placement.x % 10).toBe(0);
  expect(placement.y % 10).toBe(0);

  // The pitch choice is an editor preference that survives a reload.
  await page.reload();
  await expect(page.getByTestId("annotation-grid-select")).toHaveValue("1");
});

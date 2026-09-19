import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  createEmptyProject,
  flattenRichText,
} from "@icm/model";
import { fractionGeometry } from "@icm/derived";

import {
  revealPropertiesShelf,
  awaitEditorReady,
  editComponentPropertyCode,
  editDocumentStyleCode,
  readComponentPropertyCode,
  readDocumentStyleCode,
  chooseComponent,
  clickCommand,
  clickDrawTool,
  placeText,
  downloadBytes,
} from "./editor-fixtures.js";

test("a Library arrow stays fully editable without occupying the toolbar", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await expect(page.getByTestId("draw-tool-arrow")).toHaveCount(0);
  await clickDrawTool(page, "arrow");
  const canvas = page.getByTestId("schematic-canvas");
  await clickCreate(page, { x: 220, y: 180 }, { x: 300, y: 240 });
  await expect(page.locator('[data-kind="draft-arrow"]')).toHaveCount(1);

  const hit = page.getByTestId(/^drafting-hit-arrow-/);
  await clickSvgPolyline(hit);
  await page.keyboard.press("q");
  const properties = page.getByTestId("drafting-properties");
  await expect(properties).toBeVisible();
  expect(
    JSON.parse(await readComponentPropertyCode(page)).appearance.arrowShape,
  ).toBe("line");
  await editComponentPropertyCode(page, (code) => {
    code.appearance.arrowShape = "outline";
  });
  const outline = page.locator(
    '[data-kind="draft-arrow"] > [data-arrow-family="outline"]',
  );
  await expect(outline).toHaveCount(1);
  await expect(outline).toHaveAttribute("fill", "none");
  await expect(outline).toHaveCSS("stroke", "rgb(0, 0, 0)");
  expect(JSON.parse(await readComponentPropertyCode(page)).geometry.width).toBe(
    30,
  );
  expect(
    JSON.parse(await readComponentPropertyCode(page)).geometry,
  ).not.toHaveProperty("tangentAngles");
  const startStyle = page.getByRole("combobox", {
    name: "Start style options",
    exact: true,
  });
  await expect(startStyle.locator("option")).toHaveCount(6);
  const rotation = page.getByRole("combobox", {
    name: "Rotation options",
    exact: true,
  });
  expect(
    (await rotation.locator("option").allTextContents()).slice(0, 8),
  ).toEqual(["0°", "45°", "90°", "135°", "180°", "225°", "270°", "315°"]);
  await editComponentPropertyCode(page, (code) => {
    code.appearance.strokeScale = 2;
  });
  await expect(outline).toHaveAttribute("stroke-width", "3.2");
  const originalPoints = await outline.getAttribute("points");
  await editComponentPropertyCode(page, (code) => {
    code.geometry.width = 45;
  });
  await expect(outline).not.toHaveAttribute("points", originalPoints!);
  await expect(page.getByTestId(/^draft-handle-width-/)).toBeVisible();
  await expect(page.getByTestId(/^draft-handle-rotate-/)).toBeVisible();
  await expect(page.getByTestId(/^draft-handle-segment-/)).toHaveCount(0);
  await rotation.selectOption("45");

  const rotated = await outline.getAttribute("points");
  await startStyle.selectOption("medium-arrow");
  expect(await outline.getAttribute("points")).not.toBe(rotated);

  await canvas.focus();
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "arrow");
  await clickCreate(page, { x: 360, y: 180 }, { x: 440, y: 240 });
  await expect(page.locator('[data-kind="draft-arrow"]')).toHaveCount(2);
  // Editing one object does not change the default used by the Library tool.
  await clickSvgPolyline(page.getByTestId(/^drafting-hit-arrow-/).last());
  expect(
    JSON.parse(await readComponentPropertyCode(page)).appearance.arrowShape,
  ).toBe("line");
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-kind="draft-arrow"]')).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator('[data-kind="draft-arrow"]')).toHaveCount(2);
});

// Multi-phase drafting creation: click to set the start, move to preview, click
// a final vertex, then Enter. Line arrows and construction lines retain clicks
// as bends until Enter or double-click finishes. Uses real mouse clicks (not pointer
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
  // The click is a vertex; Enter accepts it as the current endpoint.
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

async function controlTop(locator: Locator): Promise<number> {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Toolbar control is not measurable");
  return bounds.y;
}

// The canvas-local toolbar creates RichText AST without exposing raw markup.
test("keeps every line of a multi-line note on its own line", async ({
  page,
}) => {
  await page.goto("/editor");
  await revealPropertiesShelf(page);
  await placeText(page, { x: 400, y: 220 });
  const editable = page.getByRole("textbox", { name: "Canvas text editor" });
  await editable.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Bias network");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("third line");

  // Typing after a break must continue on the new line. Placing the break by
  // hand used to leave the caret on an empty text node that Chromium gives no
  // visual position, so the next characters went back onto the line above and
  // the note collapsed into one flattened line.
  await expect
    .poll(() =>
      editable.evaluate((element) =>
        (element.textContent ?? "").replace(/\u00a0/gu, " "),
      ),
    )
    .toBe("Bias network\nsecond line\nthird line");

  await page.getByRole("button", { name: "Apply text changes" }).click();
  const note = page.locator('[data-kind="draft-text"]').first();
  await expect(note).toBeVisible();
  // Three lines: each break resets x and steps the baseline down by one line.
  await expect(note.locator('tspan[data-text-run="line-break"]')).toHaveCount(
    2,
  );
  const box = await note.boundingBox();
  expect(box?.height).toBeGreaterThan(40);

  // Reopening edits the same three lines rather than one run of joined text.
  await note.dblclick({ force: true });
  const reopened = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(reopened).toBeVisible();
  await expect(reopened.locator("br")).toHaveCount(2);
});

test("adds formatted drafting text and undo/redo restores it", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("revision")).toHaveText("0");

  await placeText(page);
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await expect(draftInput).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insert fraction" }),
  ).toBeEnabled();
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
  const [canvasBounds, editorBounds] = await Promise.all([
    page.getByTestId("schematic-canvas").boundingBox(),
    page.getByTestId("canvas-text-editor").boundingBox(),
  ]);
  if (!canvasBounds || !editorBounds) {
    throw new Error("Canvas text editor geometry is not measurable");
  }
  expect(editorBounds.x).toBeGreaterThanOrEqual(canvasBounds.x);
  expect(editorBounds.x + editorBounds.width).toBeLessThanOrEqual(
    canvasBounds.x + canvasBounds.width + 1,
  );
  expect(editorBounds.width).toBeCloseTo(332, 0);
  const [boldTop, increaseTop, applyTop, cancelTop, deleteTop] =
    await Promise.all([
      controlTop(page.getByRole("button", { name: "Bold" })),
      controlTop(page.getByRole("button", { name: "Increase text size" })),
      controlTop(page.getByRole("button", { name: "Apply text changes" })),
      controlTop(page.getByRole("button", { name: "Cancel text changes" })),
      controlTop(page.getByRole("button", { name: "Delete text" })),
    ]);
  expect(Math.abs(increaseTop - boldTop)).toBeLessThan(1);
  expect(Math.abs(cancelTop - applyTop)).toBeLessThan(1);
  expect(Math.abs(deleteTop - applyTop)).toBeLessThan(1);
  expect(applyTop).toBeGreaterThan(boldTop);

  const fullViewport = page.viewportSize();
  await page.setViewportSize({ width: 720, height: 720 });
  await expect
    .poll(async () =>
      page
        .getByTestId("canvas-text-editor")
        .boundingBox()
        .then((bounds) => bounds?.width),
    )
    .toBeCloseTo(332, 0);
  // Chromium may report one intermediate foreignObject layout immediately
  // after the viewport changes. Assert both toolbar rows after that layout
  // settles rather than sampling a transient frame.
  await expect
    .poll(async () => {
      const [boldTop, increaseTop] = await Promise.all([
        controlTop(page.getByRole("button", { name: "Bold" })),
        controlTop(page.getByRole("button", { name: "Increase text size" })),
      ]);
      return Math.abs(increaseTop - boldTop);
    })
    .toBeLessThan(1);
  const narrowBoldTop = await controlTop(
    page.getByRole("button", { name: "Bold" }),
  );
  await expect
    .poll(async () => {
      const [applyTop, cancelTop] = await Promise.all([
        controlTop(page.getByRole("button", { name: "Apply text changes" })),
        controlTop(page.getByRole("button", { name: "Cancel text changes" })),
      ]);
      return Math.abs(cancelTop - applyTop);
    })
    .toBeLessThan(8);
  const narrowApplyTop = await controlTop(
    page.getByRole("button", { name: "Apply text changes" }),
  );
  expect(narrowApplyTop).toBeGreaterThan(narrowBoldTop);
  await page.getByLabel("Insert circuit symbol").click();
  const [symbolMenuBounds, narrowEditorBounds] = await Promise.all([
    page.getByRole("menu", { name: "Circuit symbols" }).boundingBox(),
    page.getByTestId("canvas-text-editor").boundingBox(),
  ]);
  if (!symbolMenuBounds || !narrowEditorBounds) {
    throw new Error("Circuit symbol menu geometry is not measurable");
  }
  expect(symbolMenuBounds.x).toBeGreaterThanOrEqual(narrowEditorBounds.x);
  expect(symbolMenuBounds.x + symbolMenuBounds.width).toBeLessThanOrEqual(
    narrowEditorBounds.x + narrowEditorBounds.width + 1,
  );
  await page.getByLabel("Insert circuit symbol").click();
  if (fullViewport) await page.setViewportSize(fullViewport);

  await draftInput.fill(
    "A deliberately long annotation that wraps inside the compact canvas text editor instead of extending beyond it",
  );
  await expectForeignObjectContentsContained(
    page.getByTestId("canvas-text-editor"),
  );
  expect(
    await draftInput.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
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

test("drafting text owns an independent color override with Auto inheritance", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
  const draftInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await draftInput.fill("Colored note");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const hit = page.getByTestId(/^drafting-hit-note-/);
  const text = page.locator('[data-kind="draft-text"]');
  await hit.click({ force: true });
  await page.keyboard.press("q");
  const properties = page.getByTestId("drafting-properties");
  await expect(page.getByLabel("Editable Canvas property code")).toBeVisible();
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("auto");
  await properties.getByRole("button", { name: "Edit text color" }).click();
  await page
    .getByRole("button", { name: "Use Blue for text", exact: true })
    .click();
  await expect(text).toHaveAttribute("fill", "#2563eb");

  const coloredProject = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const coloredText = coloredProject.documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  expect(coloredText.styleOverride.color).toBe("#2563eb");

  await properties.getByRole("button", { name: "Edit text color" }).click();
  await page.getByRole("button", { name: "Reset text color" }).click();
  await expect(text).toHaveAttribute("fill", "#000");
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("auto");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(text).toHaveAttribute("fill", "#2563eb");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(text).toHaveAttribute("fill", "#000");
});

test("authors one validated formula through the canonical text editor", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await placeText(page);

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
  // MathLive publishes palette edits through its input event. Let that event
  // and the controlled-value render settle before the source textarea becomes
  // authoritative, otherwise an old palette edit can overwrite a fast fill.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await source.fill(normalizedDifferential);
  await expect(source).toHaveValue(normalizedDifferential);
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

for (const zoomedOut of [false, true]) {
  test(`keeps a reopened long formula within its text editor at ${zoomedOut ? "19%" : "normal"} zoom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.goto("/editor");
    await awaitEditorReady(page);
    if (zoomedOut) {
      while (
        Number.parseInt(
          (await page.getByLabel("Current zoom").textContent())!,
        ) > 20
      ) {
        await page
          .getByRole("button", { name: "Zoom out", exact: true })
          .click();
      }
    }
    const canvas = page.getByTestId("schematic-canvas");
    const viewBox = await canvas.getAttribute("viewBox");
    await placeText(page, { x: 560, y: 280 });
    const frame = page.getByTestId("canvas-text-editor");
    const dialog = page.getByRole("dialog", { name: "Formula", exact: true });
    const source = page.getByRole("textbox", { name: "Formula LaTeX source" });
    const latex = String.raw`NTF=\frac{\left(1-z^{-1}\right)\left(1-0.75z^{-1}\right)^2}{\left(1-p_1z^{-1}\right)\left(1-p_2z^{-1}\right)}`;
    const openFormula = async () => {
      await page
        .getByRole("button", { name: "Insert formula", exact: true })
        .click();
      await expect(dialog.locator("math-field")).toBeVisible();
    };
    const checkFrame = async () => {
      // All controls must fit the visible foreignObject, including the right
      // edge. Playwright's visibility check alone accepts clipped descendants.
      await expect
        .poll(() =>
          frame.evaluate((element) => {
            const outer = element.getBoundingClientRect();
            const controls = element.querySelectorAll(
              ".rich-text-floating-toolbar, .rich-text-formula-popover, .rich-text-editable, button",
            );
            return [...controls].every((control) => {
              const rect = control.getBoundingClientRect();
              if (!rect.width || !rect.height) return true;
              return (
                rect.left >= outer.left - 1 && rect.right <= outer.right + 1
              );
            });
          }),
        )
        .toBe(true);
      await expect(canvas).toHaveAttribute("viewBox", viewBox!);
      const bounds = (await frame.boundingBox())!;
      expect(bounds.width).toBeCloseTo(332, 0);
    };
    const apply = async (expectedLatex: string) => {
      await dialog.getByRole("button", { name: "Insert", exact: true }).click();
      await expect(frame.locator("[data-rich-text-math]")).toHaveAttribute(
        "data-latex",
        expectedLatex,
      );
      await checkFrame();
      await page.getByRole("button", { name: "Apply text changes" }).click();
      await expect(frame).toHaveCount(0);
      await expect(
        page.locator('[data-kind="draft-text"] [data-role="formula"]'),
      ).toBeVisible();
    };

    await openFormula();
    await source.fill(latex);
    const display = dialog.getByRole("button", {
      name: "Display",
      exact: true,
    });
    await display.click();
    await expect(display).toHaveAttribute("aria-pressed", "true");
    await checkFrame();
    await apply(latex);

    await page.getByTestId(/^drafting-hit-note-/).dblclick();
    await checkFrame();
    await openFormula();
    await expect(source).toHaveValue(latex);
    await expect(display).toHaveAttribute("aria-pressed", "true");
    await checkFrame();
    const revised = latex.replace("0.75", "0.65");
    await source.fill(revised);
    await apply(revised);

    await page.getByTestId(/^drafting-hit-note-/).dblclick();
    await openFormula();
    await expect(source).toHaveValue(revised);
    await checkFrame();
    // Both the dialog's close control and the outer cancel remain reachable.
    await dialog.getByRole("button", { name: "Close formula editor" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel text changes" }).click();
    await expect(frame).toHaveCount(0);
  });
}

test("edits an unrestricted device formula in the same visual annotation", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  await page.getByRole("button", { name: "Insert formula" }).click();
  const latex = String.raw`R_1=\frac{1}{g_m}`;
  await page.getByRole("textbox", { name: "Formula LaTeX source" }).fill(latex);
  await page
    .getByRole("dialog", { name: "Formula" })
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Formula" })).toHaveCount(0);
  await expect(page.getByTestId("formula-conversion-confirmation")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(
    page.locator('[data-object-id="instance-label-R1"] [data-role="formula"]'),
  ).toHaveCount(1);
  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(project.documents[0].instances[0].reference).toBe("R1");
  const labels = project.documents[0].annotations.filter(
    (annotation: { kind: string }) => annotation.kind === "instance-label",
  );
  expect(labels).toHaveLength(1);
  expect(labels[0]).toMatchObject({
    id: "instance-label-R1",
    content: { runs: [{ kind: "math", latex, display: "inline" }] },
    anchor: { kind: "object", objectId: "R1" },
  });
  expect(labels[0]).not.toHaveProperty("binding");
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.getByRole("button", { name: "Insert formula" }).click();
  await expect(
    page.getByRole("textbox", { name: "Formula LaTeX source" }),
  ).toHaveValue(latex);
});

test("keeps unsafe formula source out of the Project", async ({ page }) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await placeText(page);
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

test("T previews text at the pointer without creating it and Escape cancels", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("icm.annotation-grid.v1", "1"),
  );
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 317, y: 243 } });
  const box = (await canvas.boundingBox())!;
  const point = { x: box.x + 317, y: box.y + 243 };
  const expected = await snappedCanvasPoint(canvas, point, 1);
  expect(expected.x % 10 !== 0 || expected.y % 10 !== 0).toBe(true);

  await page.keyboard.press("t");
  await expect(page.getByTestId("canvas-empty-state")).toHaveCount(0);
  const preview = page.getByTestId("text-placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveText("Design note");
  await expect(preview).toHaveAttribute(
    "transform",
    `translate(${expected.x} ${expected.y})`,
  );
  await expect(preview).toHaveCSS("pointer-events", "none");
  expect(
    Number(
      await preview.evaluate((element) => getComputedStyle(element).opacity),
    ),
  ).toBeLessThan(1);
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  const moved = { x: point.x + 153, y: point.y + 77 };
  await page.mouse.move(moved.x, moved.y);
  const next = await snappedCanvasPoint(canvas, moved, 1);
  await expect(preview).toHaveAttribute(
    "transform",
    `translate(${next.x} ${next.y})`,
  );
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");
  await expect(page.getByTestId("draw-tool-undo")).toBeDisabled();
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();

  // The toolbar uses the same cancellable placement, then lets a new tool take over.
  await clickDrawTool(page, "text");
  await canvas.hover({ position: { x: 420, y: 310 } });
  await expect(preview).toBeVisible();
  await clickDrawTool(page, "rectangle");
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");
});

test("keeps a rectangle's edges on the grid a wire can land on", async ({
  page,
}) => {
  // Reported as wire endpoints protruding past a Rect outline: the annotation
  // pitch is finer than the electrical grid, so an edge could sit half a cell
  // away from every coordinate a wire endpoint is allowed to take.
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await clickDrawTool(page, "rectangle");
  await canvas.click({ position: { x: 305, y: 205 } });
  await canvas.click({ position: { x: 505, y: 355 } });
  await page.keyboard.press("Escape");

  const points =
    (await page
      .locator('[data-kind="draft-rectangle"]')
      .first()
      .getAttribute("points")) ?? "";
  const grid = await page.evaluate(
    () =>
      (
        globalThis as unknown as {
          __icmDocument?: { presentation: { grid: number } };
        }
      ).__icmDocument?.presentation.grid ?? 10,
  );
  const coordinates = points
    .split(/[ ,]/u)
    .filter((part) => part.length > 0)
    .map(Number);
  expect(coordinates.length).toBe(8);
  for (const coordinate of coordinates) expect(coordinate % grid).toBe(0);
});

async function snappedCanvasPoint(
  canvas: Locator,
  client: { x: number; y: number },
  pitch: number,
) {
  return canvas.evaluate(
    (element, { client, pitch }) => {
      const svg = element as SVGSVGElement;
      const point = new DOMPoint(client.x, client.y).matrixTransform(
        svg.getScreenCTM()!.inverse(),
      );
      return {
        x: Math.round(point.x / pitch) * pitch,
        y: Math.round(point.y / pitch) * pitch,
      };
    },
    { client, pitch },
  );
}

test("places Text at its preview after zoom and pan, then edits and undoes it", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 317, y: 243 } });
  const initialViewBox = await canvas.getAttribute("viewBox");
  await page.mouse.wheel(0, -120);
  await expect(canvas).not.toHaveAttribute("viewBox", initialViewBox!);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 220);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + 360, box.y + 260, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  const point = { x: box.x + 427, y: box.y + 287 };
  await page.mouse.move(point.x, point.y);
  const expected = await snappedCanvasPoint(canvas, point, 5);
  await page.keyboard.press("t");
  const preview = page.getByTestId("text-placement-preview");
  await expect(preview).toHaveAttribute(
    "transform",
    `translate(${expected.x} ${expected.y})`,
  );
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute(
    "transform",
    `translate(${expected.x} ${expected.y})`,
  );
  await expect(preview.locator("text")).toHaveAttribute("font-weight", "bold");
  const previewBounds = await preview.locator("text").boundingBox();
  await page.mouse.click(point.x, point.y);
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("1");
  const texts = page.locator('[data-kind="draft-text"]');
  await expect(texts).toHaveCount(1);
  await expect(texts).toHaveAttribute("x", String(expected.x));
  await expect(texts).toHaveAttribute("y", String(expected.y));
  const placedBounds = (await texts.boundingBox())!;
  expect(placedBounds.x).toBeCloseTo(previewBounds!.x, 1);
  expect(placedBounds.y).toBeCloseTo(previewBounds!.y, 1);
  expect(placedBounds.width).toBeCloseTo(previewBounds!.width, 1);
  expect(placedBounds.height).toBeCloseTo(previewBounds!.height, 1);
  const input = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(input).toBeVisible();
  await input.fill("Custom text");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(texts).toHaveText("Custom text");
  await expect(page.getByTestId("revision")).toHaveText("2");

  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const textObject = project.documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
  expect(textObject.anchor).toEqual({ kind: "free", position: expected });
  expect(textObject.rotation).toBe(90);
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain("Custom text");
  expect(svg).not.toContain(`rotate(90 ${expected.x} ${expected.y})`);
  expect(svg).not.toContain("text-placement-preview");
  await clickCommand(page, "Edit", "Undo");
  await expect(texts).toHaveText("Design note");
  await clickCommand(page, "Edit", "Undo");
  await expect(texts).toHaveCount(0);
  await clickCommand(page, "Edit", "Redo");
  await clickCommand(page, "Edit", "Redo");
  await expect(texts).toHaveText("Custom text");
});

test("previews copied text upright and commits its pose atomically", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await placeText(page);
  const draftInput = page.getByRole("textbox", { name: "Canvas text editor" });
  await draftInput.fill("Design note");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.keyboard.press("Escape");

  const texts = page.locator('[data-kind="draft-text"]');
  await expect(texts).toHaveCount(1);
  const origin = (await texts.first().boundingBox())!;
  const originalId = await texts.first().getAttribute("data-object-id");
  const original = page.locator(`[data-object-id="${originalId}"]`);
  const revision = Number(await page.getByTestId("revision").textContent());

  // Select the text and copy it. A drawing-only selection used to be refused
  // outright — "Select at least one component to copy".
  await page.mouse.click(
    origin.x + origin.width / 2,
    origin.y + origin.height / 2,
  );
  await page.keyboard.press("c");
  await expect(page.getByTestId("status")).toContainText("Place copy");

  const box = (await canvas.boundingBox())!;
  const ghost = page.getByTestId("copy-placement-preview");
  const previewText = ghost.locator('[data-kind="draft-text"]');
  await page.mouse.move(box.x + 320, box.y + 280);
  await expect(previewText).toBeInViewport();
  await expect(previewText).toContainText("Design note");
  const firstPreview = (await previewText.boundingBox())!;
  await page.mouse.move(box.x + 420, box.y + 380);
  const movedPreview = (await previewText.boundingBox())!;
  expect(movedPreview.x).toBeGreaterThan(firstPreview.x + 50);
  expect(movedPreview.y).toBeGreaterThan(firstPreview.y + 50);
  expect(await original.boundingBox()).toEqual(origin);
  await expect(page.getByTestId("revision")).toHaveText(String(revision));

  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
  await expect(texts).toHaveCount(1);
  await expect(page.getByTestId("revision")).toHaveText(String(revision));

  await page.mouse.click(
    origin.x + origin.width / 2,
    origin.y + origin.height / 2,
  );
  await page.keyboard.press("c");
  await page.mouse.move(box.x + 420, box.y + 380);
  await page.keyboard.press("r");
  await expect(previewText).toBeInViewport();
  const rotatedPreview = (await previewText.boundingBox())!;
  // Rotation metadata may change a multipart annotation's layout, but an
  // ordinary note keeps its glyphs upright and its source remains unchanged.
  expect(rotatedPreview.width).toBeGreaterThan(rotatedPreview.height);
  expect(rotatedPreview.width).toBeCloseTo(origin.width, 1);
  expect(rotatedPreview.height).toBeCloseTo(origin.height, 1);
  await canvas.click({ position: { x: 420, y: 380 } });
  await page.keyboard.press("Escape");

  await expect(texts).toHaveCount(2);
  const both = await texts.evaluateAll((elements) =>
    elements.map((element) => element.textContent),
  );
  expect(both.filter((value) => value?.includes("Design note"))).toHaveLength(
    2,
  );
  const placed = (await texts.last().boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(placed[key]).toBeCloseTo(rotatedPreview[key], 1);
  }
  await expect(page.getByTestId("revision")).toHaveText(String(revision + 1));
  await page.keyboard.press("Control+z");
  await expect(texts).toHaveCount(1);
  expect(await original.boundingBox()).toEqual(origin);
  await page.keyboard.press("Control+Shift+z");
  await expect(texts).toHaveCount(2);
});

test("fits drafting text with F using an integer grid camera", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
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
  await placeText(page);
  await expect(page.getByTestId("canvas-text-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);

  await placeText(page);
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

test("A and K are unbound and preserve the current drafting session", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const canvas = page.getByTestId("schematic-canvas");

  await page.keyboard.press("a");
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
  await clickDrawTool(page, "arrow");
  await canvas.click({ position: { x: 220, y: 220 } });
  await canvas.hover({ position: { x: 420, y: 260 } });
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();
  await page.keyboard.press("k");
  await expect(page.getByTestId("drafting-create-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("k");
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");

  await expect(page.getByTestId("revision")).toHaveText("0");
});

// Moving an existing drafting object commits exactly one transaction, so one
// Ctrl+Z restores its original persisted anchor.
test("existing text drag commits once and undoes atomically", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
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
  await placeText(page);
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

test("line arrow clicks add bends and snap through to an arbitrary rectangle edge", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 430, y: 220 }, { x: 650, y: 400 });
  const rectangle = page.locator('[data-kind="draft-rectangle"]');
  const target = await rectangle.evaluate((element) => {
    const polygon = element as SVGPolygonElement;
    const matrix = polygon.getScreenCTM();
    if (!matrix || polygon.points.numberOfItems < 2) return null;
    const from = polygon.points.getItem(0);
    const to = polygon.points.getItem(1);
    const logical = {
      x: from.x + (to.x - from.x) * 0.37,
      y: from.y + (to.y - from.y) * 0.37,
    };
    const screen = new DOMPoint(logical.x, logical.y).matrixTransform(matrix);
    const screenFrom = new DOMPoint(from.x, from.y).matrixTransform(matrix);
    const screenTo = new DOMPoint(to.x, to.y).matrixTransform(matrix);
    const dx = screenTo.x - screenFrom.x;
    const dy = screenTo.y - screenFrom.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      exact: { x: screen.x, y: screen.y },
      near: {
        x: screen.x + (-dy / length) * 2,
        y: screen.y + (dx / length) * 2,
      },
    };
  });
  if (!target) throw new Error("Rectangle edge is not measurable");

  await clickDrawTool(page, "arrow");
  await page.mouse.click(target.exact.x - 110, target.exact.y - 80);
  await page.mouse.click(target.exact.x - 55, target.exact.y - 25);
  await page.mouse.move(target.near.x, target.near.y);
  await expect(page.locator(".drafting-create-snap")).toHaveCount(1);
  await page.mouse.dblclick(target.near.x, target.near.y);

  const line = page.locator(
    '[data-layer="drafting"] g[data-kind="draft-arrow"] > polyline',
  );
  const head = page.locator(
    '[data-layer="drafting"] g[data-kind="draft-arrow"] > polygon',
  );
  await expect(line).toHaveCount(1);
  const geometry = await Promise.all([
    line.evaluate((element) => {
      const polyline = element as SVGPolylineElement;
      return Array.from(
        { length: polyline.points.numberOfItems },
        (_, index) => {
          const point = polyline.points.getItem(index);
          return { x: point.x, y: point.y };
        },
      );
    }),
    rectangle.evaluate((element) => {
      const polygon = element as SVGPolygonElement;
      return [polygon.points.getItem(0), polygon.points.getItem(1)].map(
        (point) => ({ x: point.x, y: point.y }),
      );
    }),
    head.evaluate((element) => {
      const polygon = element as SVGPolygonElement;
      return Array.from(
        { length: polygon.points.numberOfItems },
        (_, index) => {
          const point = polygon.points.getItem(index);
          return { x: point.x, y: point.y };
        },
      );
    }),
  ]);
  expect(geometry[0]).toHaveLength(3);
  const edge = geometry[1];
  const edgeLength = Math.hypot(
    edge[1]!.x - edge[0]!.x,
    edge[1]!.y - edge[0]!.y,
  );
  const distanceToEdge = (point: { x: number; y: number }): number =>
    Math.abs(
      (point.x - edge[0]!.x) * (edge[1]!.y - edge[0]!.y) -
        (point.y - edge[0]!.y) * (edge[1]!.x - edge[0]!.x),
    ) / edgeLength;
  // The shaft is shortened under the head; its triangle tip owns the exact
  // persisted endpoint and therefore the edge capture.
  expect(Math.min(...geometry[2].map(distanceToEdge))).toBeLessThanOrEqual(0.5);
  await expect(page.locator(".drafting-create-snap")).toHaveCount(0);
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
  await placeText(page);
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
  await placeText(page);
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
  await placeText(page);
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

  await editComponentPropertyCode(page, (code) => {
    code.appearance.lineStyle = "dotted";
  });
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

test("O toggles Display settings and never activates Circle", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);

  await page.keyboard.press("o");
  await expect(page.getByLabel("Document settings")).toBeVisible();
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
  await page.keyboard.press("o");
  await expect(page.getByLabel("Document settings")).toHaveCount(0);
});

test("the Library Circle creates a selectable shape with one radial handle and no rotation", async ({
  page,
}) => {
  await page.goto("/editor");
  await revealPropertiesShelf(page);
  await awaitEditorReady(page);
  await clickDrawTool(page, "circle");
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
  await page.keyboard.press("q");
  expect(
    JSON.parse(await readComponentPropertyCode(page)).appearance.lineStyle,
  ).toBe("solid");
  await page.getByTestId("schematic-canvas").focus();

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
  await editComponentPropertyCode(page, (code) => {
    code.appearance.lineStyle = "solid";
  });
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.getByTestId("drafting-properties")).toHaveCount(1);
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
  await editComponentPropertyCode(page, (code) => {
    code.appearance.lineStyle = "dotted";
  });
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

  await editComponentPropertyCode(page, (code) => {
    code.appearance.strokeScale = 2;
  });
  await expect(shaft).toHaveAttribute("stroke-width", "3.2");

  await expect(
    properties.getByRole("combobox", { name: "Arrow head size" }),
  ).toHaveCount(0);
  await editComponentPropertyCode(page, (code) => {
    code.appearance.endStyle = "open-arrow";
  });
  await expect(head).toHaveAttribute("fill", "none");
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
  await revealPropertiesShelf(page);
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

  await editComponentPropertyCode(page, (code) => {
    code.appearance.lineStyle = "dotted";
  });
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
  await expect(page.getByTestId("drafting-properties")).toHaveCount(1);
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
  await expect(editor).toHaveCSS("font-weight", "700");
  await page.keyboard.type("PFD");
  await page.keyboard.press("Escape");

  const label = page.locator('[data-kind="draft-text"]');
  await expect(label).toHaveCount(1);
  await expect(label).toHaveAttribute("text-anchor", "middle");
  await expect(label).toContainText("PFD");
  await expect(label.locator("tspan")).toHaveCSS("font-weight", "700");

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

  await editComponentPropertyCode(page, (code) => {
    code.geometry.width = 120;
  });
  await editComponentPropertyCode(page, (code) => {
    code.geometry.height = 48;
  });
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

  await editComponentPropertyCode(page, (code) => {
    code.appearance.strokeScale = 2.5;
  });
  await properties.getByRole("button", { name: "Edit border color" }).click();
  await page.getByRole("button", { name: "Use Red for border" }).click();
  await expect(rectangle).toHaveAttribute("stroke", "#dc2626");
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
  await editComponentPropertyCode(page, (code) => {
    code.geometry.radius = 75;
  });
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
  await properties.getByRole("button", { name: "Edit border color" }).click();
  await page.getByRole("button", { name: "Reset border color" }).click();
  const stroke = await rectangle.getAttribute("stroke");
  expect(stroke).not.toBe("#dc2626");
});

test("annotation grid pitch frees drawings from the device grid", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);

  // Half-grid is the shipped default; the electrical grid is not offered.
  expect(
    JSON.parse(await readDocumentStyleCode(page)).canvas.annotationGrid,
  ).toBe(5);
  await editDocumentStyleCode(page, (code) => {
    code.canvas.annotationGrid = 1;
  });

  // A drawn circle commits at 1-unit precision and survives validation. A
  // rectangle would not: it is the one drawn shape that places on the
  // electrical grid, because it is the one people wire to.
  await clickDrawTool(page, "circle");
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
    return toDocument(points[0]!);
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
  expect(saved.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  const document = saved.documents[0]!;
  const circle = document.drafting?.objects.find(
    (object) => object.kind === "circle",
  ) as { center?: { x: number; y: number } } | undefined;
  // 1-unit pitch: the drawn center lands exactly where the click maps, not
  // on a device-grid multiple.
  expect(circle?.center).toEqual(expectedCenter);
  const placement = document.instances[0]!.placement!.position;
  expect(placement.x % 10).toBe(0);
  expect(placement.y % 10).toBe(0);

  // The pitch choice is an editor preference that survives a reload.
  await page.reload();
  expect(
    JSON.parse(await readDocumentStyleCode(page)).canvas.annotationGrid,
  ).toBe(1);
});

test("authors inline fractions alongside styled text and preserves them through editing and export", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "text");
  await page.keyboard.press("r");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 450, y: 340 } });
  const editor = page.getByRole("textbox", {
    name: "Canvas text editor",
    exact: true,
  });
  await editor.fill("R = ");
  await editor.press("End");
  await page
    .getByRole("button", { name: "Insert fraction", exact: true })
    .click();
  const fraction = editor.locator("[data-rich-text-fraction]");
  await expect(fraction).toHaveCount(1);
  await page.keyboard.insertText("1");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("gmN");
  const denominator = fraction.locator('[data-fraction-part="denominator"]');
  await denominator.evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.firstChild!, 1);
    range.setEnd(element.firstChild!, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await expect(denominator.locator("sub")).toHaveText("mN");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText(" + R1");
  await expect(editor).toHaveText("R = 1gmN + R1");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await expect(editor.locator("sub")).toHaveCount(2);
  const alignment = await editor.evaluate((element) => {
    const prefix = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode()!;
    const range = document.createRange();
    range.selectNodeContents(prefix);
    const text = range.getBoundingClientRect();
    const numerator = element
      .querySelector('[data-fraction-part="numerator"]')!
      .getBoundingClientRect();
    return {
      gap: Math.abs(numerator.bottom - (text.top + text.height / 2)),
      fontSize: parseFloat(getComputedStyle(element).fontSize),
    };
  });
  expect(alignment.gap).toBeLessThan(alignment.fontSize * 0.35);
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const note = page.locator('[data-kind="draft-text"]');
  await expect(note.locator('[data-role="fraction-bar"]')).toHaveCount(1);
  await expect(note).toContainText("R = ");
  await expect(note).toContainText(" + R");
  await expect(note.locator('[data-text-run="subscript"]')).toHaveCount(2);
  const saved = await downloadBytes(page, "File", "Export Project File…");
  const project = JSON.parse(saved.toString("utf8"));
  const content = project.documents[0].drafting.objects[0].content;
  expect(content.runs.map((run: { kind: string }) => run.kind)).toContain(
    "fraction",
  );
  expect(
    content.runs.find((run: { kind: string }) => run.kind === "fraction")
      .denominator.runs[1].style,
  ).toBe("subscript");
  const revision = await page.getByTestId("revision").textContent();
  await page.getByTestId(/^drafting-hit-note-/).dblclick();
  await expect(
    editor.locator('[data-fraction-part="denominator"] sub'),
  ).toHaveText("mN");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("revision")).toHaveText(revision!);

  expect(await note.getAttribute("transform")).toBeNull();
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-role="fraction-bar"');
  expect(svg).toContain('data-text-run="subscript"');
  expect(svg).toContain(" + R");
  expect(svg).not.toContain("data-rich-text-fraction");
  await page.getByTestId("project-file").setInputFiles({
    name: "fractions.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await expect(note.locator('[data-role="fraction-bar"]')).toHaveCount(1);
  const reopened = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(reopened.documents[0].drafting.objects[0].content).toEqual(content);
});

test("converts a selected slash fraction and mixes multiple fractions in one note", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
  const editor = page.getByRole("textbox", {
    name: "Canvas text editor",
    exact: true,
  });
  await editor.fill("1u/150n");
  await editor.press("ControlOrMeta+A");
  await page
    .getByRole("button", { name: "Insert fraction", exact: true })
    .click();
  await expect(editor.locator('[data-fraction-part="numerator"]')).toHaveText(
    "1u",
  );
  await expect(editor.locator('[data-fraction-part="denominator"]')).toHaveText(
    "150n",
  );
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("[data-rich-text-fraction]")).toHaveCount(0);
  await expect(editor).toHaveText("1u/150n");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor.locator("[data-rich-text-fraction]")).toHaveCount(1);
  await editor.locator('[data-fraction-part="numerator"]').click();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText(" + ");
  await page
    .getByRole("button", { name: "Insert fraction", exact: true })
    .click();
  await page.keyboard.insertText("2");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("3");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText(" = x");
  await editor.focus();
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const note = page.locator('[data-kind="draft-text"]');
  await expect(note.locator('[data-role="fraction-bar"]')).toHaveCount(2);
  await expect(note).toContainText(" = x");
  await expect(
    note.locator('[data-role="fraction-numerator"] text').first(),
  ).toHaveCSS("font-weight", "400");
  await clickCommand(page, "Edit", "Undo");
  await expect(note).toHaveText("Design note");
  await clickCommand(page, "Edit", "Redo");
  await expect(note.locator('[data-role="fraction-bar"]')).toHaveCount(2);
});

test("places a mixed fraction in a device visual annotation without changing its reference", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 450, y: 340 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  const editor = page.getByRole("textbox", {
    name: "Canvas text editor",
    exact: true,
  });
  await editor.fill("1/gmN + R1");
  await editor.evaluate((element) => {
    const range = document.createRange();
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode()!;
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
  await page
    .getByRole("button", { name: "Insert fraction", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const label = page.locator('[data-object-id="instance-label-R1"]');
  await expect(label.locator('[data-role="fraction-bar"]')).toHaveCount(1);
  await expect(label).toContainText(" + R1");
  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const doc = project.documents[0];
  expect(doc.instances[0].reference).toBe("R1");
  const annotation = doc.annotations.find(
    (annotation: { id: string }) => annotation.id === "instance-label-R1",
  );
  expect(annotation.binding).toBeUndefined();
  expect(annotation.content.runs[0].kind).toBe("fraction");
  expect(flattenRichText(annotation.content)).toBe("1/gmN + R1");
  // Effective formatting survives; the normal-weight reader can put bold
  // spans below italic spans so explicit unbold descendants remain expressible.
  for (const part of ["numerator", "denominator"]) {
    const text = label
      .locator(`[data-role="fraction-${part}"] text tspan`)
      .last();
    await expect(text).toHaveCSS("font-weight", "700");
    await expect(text).toHaveCSS("font-style", "italic");
  }
});

test("centers fraction parts on a content-sized bar and defaults notes to bold", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
  const editor = page.getByRole("textbox", {
    name: "Canvas text editor",
    exact: true,
  });
  await expect(editor).toHaveCSS("font-weight", "700");
  await editor.fill("1 + ");
  await editor.press("End");
  await page
    .getByRole("button", { name: "Insert fraction", exact: true })
    .click();
  await page.keyboard.insertText("1");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("Gm");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await page.keyboard.insertText("R");
  const part = (name: string) =>
    editor.locator(`[data-fraction-part="${name}"]`);
  const apply = () =>
    page.getByRole("button", { name: "Apply text changes" }).click();
  const note = page.locator('[data-kind="draft-text"]');
  const reopen = () => page.getByTestId(/^drafting-hit-note-/).dblclick();
  const measure = async (target: Locator) =>
    target.evaluate((element) => {
      const bounds = (role: string) => {
        const part = element.querySelector<SVGGraphicsElement>(
          `[data-role="fraction-${role}"]`,
        )!;
        if (role === "bar") {
          const box = part.getBBox();
          return { x: box.x, width: box.width, center: box.x + box.width / 2 };
        }
        // Center the browser's actual typographic advances. getBBox includes
        // platform-specific glyph overhang, which is not the textLength that
        // positions the parts and sizes the bar (Linux GmR extends by 0.27).
        const positions = Array.from(part.querySelectorAll("text")).flatMap(
          (text) =>
            Array.from({ length: text.getNumberOfChars() }, (_, index) => [
              text.getStartPositionOfChar(index).x,
              text.getEndPositionOfChar(index).x,
            ]).flat(),
        );
        const x = Math.min(...positions);
        const width = Math.max(...positions) - x;
        return { x, width, center: x + width / 2 };
      };
      return {
        top: bounds("numerator"),
        bottom: bounds("denominator"),
        bar: bounds("bar"),
        partFontSize: parseFloat(
          getComputedStyle(
            element.querySelector<SVGTextElement>(
              '[data-role="fraction-numerator"] text',
            )!,
          ).fontSize,
        ),
      };
    });
  const check = async (target: Locator) => {
    const { top, bottom, bar, partFontSize } = await measure(target);
    for (const part of [top, bottom]) {
      expect(Math.abs(part.center - bar.center)).toBeLessThan(0.02);
      expect(part.x).toBeGreaterThan(bar.x);
      expect(part.x + part.width).toBeLessThan(bar.x + bar.width);
    }
    // Fixed small overhang; the line must not grow independently of the text.
    expect(bar.width - Math.max(top.width, bottom.width)).toBeCloseTo(
      partFontSize * fractionGeometry.barOverhangEm * 2,
      2,
    );
    return bar.width;
  };
  await apply();
  const initialWidth = await check(note);
  const weights = () =>
    note.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const weights: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim())
          weights.push(getComputedStyle(node.parentElement!).fontWeight);
      }
      return weights;
    });
  expect(await weights()).toEqual(["700", "700", "700", "700", "700"]);
  await reopen();
  const revision = await page.getByTestId("revision").textContent();
  await apply();
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  await reopen();
  await part("numerator").fill("WWW + MMM");
  await apply();
  const grownWidth = await check(note);
  expect(grownWidth).toBeGreaterThan(initialWidth * 2);
  await reopen();
  await part("numerator").fill("1");
  await part("denominator").fill("R");
  await apply();
  expect(await check(note)).toBeLessThan(initialWidth);

  const saved = await downloadBytes(page, "File", "Export Project File…");
  const svg = await downloadBytes(page, "File", "Export SVG");
  const exported = await page.context().newPage();
  await exported.setContent(svg.toString("utf8"));
  await check(exported.locator('[data-kind="draft-text"]'));
  await exported.close();
  await page.getByTestId("project-file").setInputFiles({
    name: "fraction-layout.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await check(note);
  await reopen();
  await editor.focus();
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await apply();
  expect((await weights()).every((weight) => weight === "400")).toBe(true);
  await reopen();
  await expect(editor).toHaveCSS("font-weight", "400");
  await editor.focus();
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await apply();
  expect((await weights()).every((weight) => weight === "700")).toBe(true);
  await check(note);
});

test("persists normal weight selected inside an otherwise bold text box", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
  const editor = page.getByRole("textbox", {
    name: "Canvas text editor",
    exact: true,
  });
  await editor.fill("Bold Plain");
  await editor.press("End");
  for (let index = 0; index < 5; index++)
    await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const note = page.locator('[data-kind="draft-text"]');
  const renderedWeights = () =>
    note.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const result = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim())
          result.push({
            text: node.textContent,
            weight: getComputedStyle(node.parentElement!).fontWeight,
          });
      }
      return result;
    });
  const expected = [
    { text: "Bold ", weight: "700" },
    { text: "Plain", weight: "400" },
  ];
  expect(await renderedWeights()).toEqual(expected);
  const saved = await downloadBytes(page, "File", "Export Project File…");
  await page.getByTestId("project-file").setInputFiles({
    name: "text-weight.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  expect(await renderedWeights()).toEqual(expected);
  await page.getByTestId(/^drafting-hit-note-/).dblclick();
  await expect(editor.locator("strong")).toHaveText("Bold ");
  const revision = await page.getByTestId("revision").textContent();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("revision")).toHaveText(revision!);
});

for (const kind of ["rectangle", "circle"] as const) {
  test(`${kind} annotation code commits paint and stacking atomically and survives export`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const project = createEmptyProject(`code-${kind}`, "Annotation code");
    const document = project.documents[0]!;
    const base = {
      id: "shape",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free" as const, position: { x: 100, y: 100 } },
      center: { x: 100, y: 100 },
      lineStyle: "solid" as const,
    };
    document.drafting = {
      objects: [
        kind === "rectangle"
          ? { ...base, kind, width: 160, height: 80, rotation: 0 }
          : { ...base, kind, radius: 60 },
      ],
    };
    await page.goto("/editor");
    await page.getByTestId("project-file").setInputFiles({
      name: "annotation.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    const hit = page.getByTestId("drafting-hit-shape");
    const edgePoint = () =>
      hit.evaluate((element) => {
        const node = element as SVGGraphicsElement;
        const bounds = node.getBBox();
        const point = new DOMPoint(
          bounds.x,
          bounds.y + bounds.height / 2,
        ).matrixTransform(node.getScreenCTM()!);
        return { x: point.x, y: point.y };
      });
    const edge = await edgePoint();
    await page.mouse.click(edge.x, edge.y, {
      button: kind === "circle" ? "right" : "left",
    });
    if (kind === "circle")
      await page
        .getByRole("menuitem", { name: "Properties (Q)", exact: true })
        .click();
    else await page.keyboard.press("q");
    const editor = page.getByLabel("Editable Canvas property code");
    await expect(editor).toBeVisible();
    const shape = page.locator(
      `[data-kind="draft-${kind}"][data-object-id="shape"]`,
    );
    const before = JSON.parse(await readComponentPropertyCode(page));
    expect(before.stacking).toEqual({ layer: "front" });
    expect(before).not.toHaveProperty("bearing");
    const lineStyle = page.getByRole("combobox", {
      name: "Line style options",
      exact: true,
    });
    expect(
      await lineStyle
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        ),
    ).toEqual(["solid", "dashed", "dotted"]);
    const layer = page.getByRole("combobox", {
      name: "Layer options",
      exact: true,
    });
    expect(
      await layer
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        ),
    ).toEqual(["front", "back"]);
    await lineStyle.selectOption("dotted");
    await expect(shape).toHaveAttribute("stroke-dasharray", /\d/);
    await layer.selectOption("back");
    await expect(
      page.locator(
        '[data-drafting-layer="background"] [data-object-id="shape"]',
      ),
    ).toHaveCount(1);
    await layer.selectOption("front");
    await lineStyle.selectOption("solid");
    await expect(shape).not.toHaveAttribute("stroke-dasharray");
    const revision = Number(await page.getByTestId("revision").textContent());
    await editComponentPropertyCode(page, (code) => {
      code.color = [12, 34, 56];
      code.appearance.fillColor = [225, 238, 255];
      code.stacking.layer = "back";
    });
    await expect(page.getByTestId("revision")).toHaveText(String(revision + 1));
    await expect(shape).toHaveAttribute("stroke", "#0c2238");
    await expect(shape).toHaveAttribute("fill", "#e1eeff");
    await expect(
      page.locator(
        '[data-drafting-layer="background"] [data-object-id="shape"]',
      ),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(JSON.parse(await readComponentPropertyCode(page))).toEqual(before);
    await expect(shape).toHaveAttribute("fill", "none");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    const valid = await readComponentPropertyCode(page);
    const bad = JSON.parse(valid);
    bad.appearance.fillColor = [999, 0, 0];
    bad.geometry[kind === "rectangle" ? "width" : "radius"] = 200;
    await editor.fill(JSON.stringify(bad));
    await expect(
      page.getByRole("button", { name: "Discard draft" }),
    ).toBeVisible();
    await expect(shape).toHaveAttribute("fill", "#e1eeff");
    const lastRevision = await page.getByTestId("revision").textContent();
    await page.getByRole("button", { name: "Discard draft" }).click();
    expect(JSON.parse(await readComponentPropertyCode(page))).toEqual(
      JSON.parse(valid),
    );
    await expect(page.getByTestId("revision")).toHaveText(lastRevision!);
    const saved = await downloadBytes(page, "File", "Export Project File…");
    const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
      "utf8",
    );
    expect(svg).toContain('fill="#e1eeff"');
    expect(svg).toContain('stroke="#0c2238"');
    await page.getByTestId("project-file").setInputFiles({
      name: "reopen.icproj.json",
      mimeType: "application/json",
      buffer: saved,
    });
    await expect(page.getByTestId("status")).toContainText(
      "Opened reopen.icproj.json",
    );
    const reopenedEdge = await edgePoint();
    await page.mouse.click(reopenedEdge.x, reopenedEdge.y, { button: "right" });
    await page
      .getByRole("menuitem", { name: "Properties (Q)", exact: true })
      .click();
    expect(JSON.parse(await readComponentPropertyCode(page))).toEqual(
      JSON.parse(valid),
    );
    if (kind === "rectangle")
      await page.screenshot({ path: "plan/annotation-code-properties.png" });
    await page.getByRole("button", { name: "Edit fill color" }).click();
    await page.getByRole("button", { name: "Reset fill color" }).click();
    await expect(shape).toHaveAttribute("fill", "none");
    await expect(shape).toHaveAttribute("stroke", "#0c2238");
  });
}

test("text and voltage/polarity annotations expose their own live code without leaking drafts", async ({
  page,
}) => {
  const project = createEmptyProject("all-notes", "Annotation types");
  project.documents[0]!.drafting = {
    objects: [undefined, "both", "positive", "negative"].map(
      (polarity, index) => ({
        id: `note-${index}`,
        kind: "text" as const,
        locked: false,
        zIndex: index,
        anchor: {
          kind: "free" as const,
          position: { x: 100 + index * 150, y: 100 },
        },
        content: {
          runs:
            polarity === "positive" || polarity === "negative"
              ? [{ kind: "line-break" as const }]
              : [{ kind: "text" as const, value: "VDD" }],
        },
        alignment: "middle" as const,
        rotation: 0 as const,
        ...(polarity
          ? { polarity: polarity as "both" | "positive" | "negative" }
          : {}),
      }),
    ),
  };
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "notes.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened notes.icproj.json",
  );
  for (let index = 0; index < 4; index++) {
    await page.getByTestId(`drafting-hit-note-${index}`).click({ force: true });
    const editor = page.getByLabel("Editable Canvas property code");
    if (index === 0) await page.keyboard.press("q");
    const code = JSON.parse(await readComponentPropertyCode(page));
    expect(code.color).toBe("auto");
    expect(Boolean(code.content)).toBe(index < 2);
    await editComponentPropertyCode(page, (value) => {
      value.color = [220, 38, 38];
      if (index < 2) value.content.runs[0].value = `V${index}`;
    });
    const note = page.locator(
      `[data-kind="draft-text"][data-object-id="note-${index}"]`,
    );
    if (index === 0) {
      await expect(note).toHaveAttribute("fill", "#dc2626");
      await expect(note).toHaveText("V0");
    } else
      await expect(note.locator("line").first()).toHaveAttribute(
        "stroke",
        "#dc2626",
      );
    await editor.fill('{ "placement":');
    await expect(
      page.getByRole("button", { name: "Discard draft" }),
    ).toBeVisible();
  }
});

test("annotation dropdowns use typed values and disable locked or incompatible choices", async ({
  page,
}) => {
  const project = createEmptyProject(
    "annotation-options",
    "Annotation options",
  );
  const anchor = { kind: "free" as const, position: { x: 100, y: 100 } };
  project.documents[0]!.drafting = {
    objects: [
      {
        id: "note",
        kind: "text",
        anchor,
        locked: false,
        zIndex: 12,
        content: { runs: [{ kind: "text", value: "Annotation" }] },
        alignment: "middle",
        rotation: 0,
      },
      {
        id: "curve",
        kind: "arrow",
        anchor,
        locked: false,
        zIndex: 3,
        from: { kind: "free", position: { x: 100, y: 200 } },
        to: { kind: "free", position: { x: 300, y: 200 } },
        curveControls: [{ x: 200, y: 280 }],
      },
    ],
  };
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "annotation-options.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened annotation-options.icproj.json",
  );
  await page.getByTestId("drafting-hit-note").click();
  await page.keyboard.press("q");
  const weight = page.getByRole("combobox", {
    name: "Text weight options",
    exact: true,
  });
  const lock = page.getByRole("combobox", {
    name: "Lock options",
    exact: true,
  });
  await weight.selectOption("normal");
  await page
    .getByRole("combobox", { name: "Text alignment options", exact: true })
    .selectOption("end");
  await page
    .getByRole("combobox", { name: "Italic options", exact: true })
    .selectOption("true");
  await page
    .getByRole("combobox", { name: "Rotation options", exact: true })
    .selectOption("45");
  expect(JSON.parse(await readComponentPropertyCode(page))).toMatchObject({
    rotation: 45,
    appearance: { alignment: "end", weight: "normal", italic: true },
  });
  await lock.selectOption("true");
  await expect(weight.locator('option[value="bold"]')).toBeDisabled();
  await expect(lock.locator('option[value="false"]')).toBeEnabled();
  await lock.selectOption("false");
  await expect(weight.locator('option[value="bold"]')).toBeEnabled();
  await weight.selectOption("bold");
  const revision = await page.getByTestId("revision").textContent();
  await page.getByLabel("Editable Canvas property code").fill('{"placement":');
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  await expect(weight).toHaveValue("bold");

  await page.getByTestId("drafting-hit-curve").click({ force: true });
  const startStyle = page.getByRole("combobox", {
    name: "Start style options",
    exact: true,
  });
  await expect(startStyle.locator("option")).toHaveCount(6);
  await expect(
    page
      .getByRole("combobox", { name: "Arrow shape options", exact: true })
      .locator('option[value="outline"]'),
  ).toBeDisabled();
  await startStyle.selectOption("medium-arrow");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].drafting.objects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "note",
        rotation: 45,
        locked: false,
        zIndex: 12,
        styleOverride: expect.objectContaining({
          weight: "bold",
          italic: true,
        }),
      }),
      expect.objectContaining({
        id: "curve",
        zIndex: 3,
        curveControls: [{ x: 200, y: 280 }],
        styleOverride: expect.objectContaining({ arrowStart: "medium-arrow" }),
      }),
    ]),
  );
});

for (const shape of ["line", "outline"] as const) {
  test(`${shape} arrow endpoints have independent styles through rotation, history and file export`, async ({
    page,
  }) => {
    const project = createEmptyProject("arrow-ends", "Independent arrow ends");
    const anchor = { kind: "free" as const, position: { x: 100, y: 100 } };
    project.documents[0]!.drafting = {
      objects: [
        {
          id: "arrow-ends",
          kind: "arrow",
          locked: false,
          zIndex: 0,
          anchor,
          from: anchor,
          to: { kind: "free", position: { x: 300, y: 100 } },
          ...(shape === "outline" ? { outline: { width: 30 } } : {}),
        },
      ],
    };
    await page.goto("/editor");
    await awaitEditorReady(page);
    await page.getByTestId("project-file").setInputFiles({
      name: "ends.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await expect(page.getByTestId("status")).toContainText(
      "Opened ends.icproj.json",
    );
    const hit = page.getByTestId("drafting-hit-arrow-ends");
    const edge = await hit.evaluate((element) => {
      const path = element as SVGPolygonElement;
      const first = path.points.getItem(0);
      const p = new DOMPoint(first.x, first.y).matrixTransform(
        path.getScreenCTM()!,
      );
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(edge.x, edge.y);
    await page.keyboard.press("q");
    const start = page.getByRole("combobox", {
      name: "Start style options",
      exact: true,
    });
    const end = page.getByRole("combobox", {
      name: "End style options",
      exact: true,
    });
    for (const select of [start, end])
      await expect(select.locator("option")).toHaveText([
        "Small arrow",
        "Medium arrow",
        "Large arrow",
        "Dot",
        "None",
        "Open arrow",
      ]);
    await expect(start).toHaveValue("none");
    await expect(end).toHaveValue("medium-arrow");
    for (const style of [
      "small-arrow",
      "medium-arrow",
      "large-arrow",
      "dot",
      "none",
    ]) {
      await start.selectOption(style);
      await expect(end).toHaveValue("medium-arrow");
    }
    await start.selectOption("dot");
    const art = page.locator(
      '[data-kind="draft-arrow"][data-object-id="arrow-ends"]',
    );
    for (const style of [
      "small-arrow",
      "medium-arrow",
      "large-arrow",
      "dot",
      "none",
      "open-arrow",
    ]) {
      await end.selectOption(style);
      await expect(start).toHaveValue("dot");
      await expect(art.locator("circle")).toHaveCount(style === "dot" ? 2 : 1);
      if (shape === "line")
        await expect(art.locator("polygon")).toHaveCount(
          style === "none" || style === "dot" ? 0 : 1,
        );
    }
    await end.selectOption("large-arrow");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(end).toHaveValue("open-arrow");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(end).toHaveValue("large-arrow");
    await page
      .getByRole("combobox", { name: "Rotation options", exact: true })
      .selectOption("45");
    await expect(start).toHaveValue("dot");
    await expect(end).toHaveValue("large-arrow");
    const polygon = (await art.locator("polygon").getAttribute("points"))!;
    const circle = await art.locator("circle").evaluate((el) => ({
      cx: el.getAttribute("cx"),
      cy: el.getAttribute("cy"),
      r: el.getAttribute("r"),
    }));
    const saved = await downloadBytes(page, "File", "Export Project File…");
    expect(
      JSON.parse(saved.toString("utf8")).documents[0].drafting.objects[0]
        .styleOverride,
    ).toMatchObject({ arrowStart: "dot", arrowEnd: "large-arrow" });
    const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
      "utf8",
    );
    expect(svg).toContain(`points="${polygon}"`);
    expect(svg).toContain(
      `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}"`,
    );
    await page.getByTestId("project-file").setInputFiles({
      name: "reopened-ends.icproj.json",
      mimeType: "application/json",
      buffer: saved,
    });
    await expect(page.getByTestId("status")).toContainText(
      "Opened reopened-ends.icproj.json",
    );
    await expect(art.locator("polygon")).toHaveAttribute("points", polygon);
    // Click the visible dot away from the shaft and endpoint handle. It must
    // select the arrow even outside the original path's geometry.
    const dotEdge = await art.locator("circle").evaluate((node) => {
      const dot = node as SVGCircleElement;
      const r = dot.r.baseVal.value;
      const p = new DOMPoint(
        dot.cx.baseVal.value - r * 0.7,
        dot.cy.baseVal.value - r * 0.4,
      ).matrixTransform(dot.getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(dotEdge.x, dotEdge.y);
    await expect(hit).toHaveClass(/selected/u);
    if (!(await page.getByTestId("drafting-properties").isVisible()))
      await page.keyboard.press("q");
    await expect(start).toHaveValue("dot");
    await expect(end).toHaveValue("large-arrow");
    await page.screenshot({
      path: `plan/arrow-${shape}-endpoint-properties.png`,
    });
  });
}

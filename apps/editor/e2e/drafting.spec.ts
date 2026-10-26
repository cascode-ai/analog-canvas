import { inflateSync } from "node:zlib";

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { createEmptyProject, type Point } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  revealPropertiesShelf,
  editComponentPropertyCode,
  editDocumentStyleCode,
  readComponentPropertyCode,
  readDocumentStyleCode,
  chooseComponent,
  clickDrawTool,
  placeText,
  downloadBytes,
  expectStatus,
  exportedProject,
  openProjectFile,
  parseSavedProject,
  openEditor,
  awaitTwoFrames,
  openProject,
} from "./editor-fixtures.js";
import {
  placedInstance,
  screenPoints,
  segmentPoint,
} from "./canvas-fixtures.js";
import { readComponentCode } from "./manual-editor-fixtures.js";

/** The exported Project's first text drafting object. */
async function exportedTextObject(page: Page): Promise<any> {
  return (await exportedProject(page)).documents[0].drafting.objects.find(
    (object: { kind: string }) => object.kind === "text",
  );
}

async function exportedSvg(page: Page): Promise<string> {
  return (await downloadBytes(page, "File", "Export SVG")).toString("utf8");
}

/** Type LaTeX into the open Formula dialog and press its Insert. */
async function submitFormula(page: Page, latex: string): Promise<void> {
  await page.getByRole("textbox", { name: "Formula LaTeX source" }).fill(latex);
  await page
    .getByRole("dialog", { name: "Formula" })
    .getByRole("button", { name: "Insert", exact: true })
    .click();
}

/** A free, start-aligned, unrotated text note at x 100. */
function freeText(id: string, zIndex: number, value: string, y: number) {
  return {
    id,
    kind: "text" as const,
    locked: false,
    zIndex,
    content: { runs: [{ kind: "text" as const, value }] },
    anchor: { kind: "free" as const, position: { x: 100, y } },
    alignment: "start" as const,
    rotation: 0 as const,
  };
}

function pdfUnicodeMaps(bytes: Buffer): string[] {
  const pdf = bytes.toString("latin1");
  return [...pdf.matchAll(/\bstream\r?\n/gu)].flatMap((match) => {
    const start = match.index + match[0].length;
    const end = pdf.indexOf("endstream", start);
    try {
      const stream = inflateSync(bytes.subarray(start, end)).toString("latin1");
      return stream.includes("begincmap") ? [stream] : [];
    } catch {
      return [];
    }
  });
}

test("schematic text uses the pinned textbook face with measured advances and PDF symbol fallback", async ({
  page,
}) => {
  const project = createEmptyProject("textbook-font", "Textbook font");
  project.documents[0]!.drafting = {
    objects: [
      freeText("value", 0, "1.33pF", 100),
      { ...freeText("initial", 1, "R", 150), styleOverride: { italic: true } },
      freeText("symbols", 2, "Ω∮β", 200),
    ],
  };
  await openProject(page, serializeProject(project), "font.icproj.json");
  const value = page.locator('text[data-object-id="value"]');
  await expect(value).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(value).toHaveCSS(
    "font-family",
    /ICM Round Period.*Metropolis.*DejaVu Sans/u,
  );
  // Upstream face advances, independent of our metric implementation.
  const widthInEm = (selector: string) =>
    page
      .locator(selector)
      .evaluate(
        (element) =>
          (element as SVGTextElement).getComputedTextLength() /
          parseFloat(getComputedStyle(element).fontSize),
      );
  expect(await widthInEm('text[data-object-id="value"]')).toBeCloseTo(3.335, 2);
  expect(await widthInEm('text[data-object-id="initial"]')).toBeCloseTo(0.7, 2);
  const pdfBytes = await downloadBytes(page, "File", "Export PDF");
  const pdf = pdfBytes.toString("latin1");
  for (const family of [
    "ICM#20Schematic",
    "ICM#20Symbols",
    "ICM#20Round#20Period",
  ])
    expect(pdf).toContain(`/FontName /${family}`);
  expect(pdf).toContain("/FontFile2");
  // The export removes its temporary font registrations.
  expect(
    await page.evaluate(() =>
      [...document.fonts].some((face) => face.family === "ICM Schematic"),
    ),
  ).toBe(false);
  const mappings = pdfUnicodeMaps(pdfBytes).join("\n").toLowerCase();
  for (const codepoint of ["002e", "0052", "03a9", "222e", "03b2"])
    expect(mappings).toContain(`<${codepoint}>`);
});

test("drawing tools keep a visible locator before the first point and clear queued hover on leave and Escape", async ({
  page,
}) => {
  await openEditor(page);
  const project = createEmptyProject("pointer-feedback", "Pointer feedback");
  project.documents[0]!.instances.push({
    ...placedInstance("R1", "resistor", 250, 200),
    reference: "R1",
  });
  await openProjectFile(
    page,
    serializeProject(project),
    "pointer-feedback.icproj.json",
  );
  const canvas = page.getByTestId("schematic-canvas");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  for (const name of ["line", "rectangle", "circle", "polyline", "arrow"]) {
    await page.getByTestId("annotation-menu").locator("summary").click();
    await page.getByTestId(`annotation-shortcut-annotation-${name}`).click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65);
    await expect(page.getByTestId("drawing-position-marker")).toHaveCount(1);
    await expect(page.getByTestId("hit-R1")).toHaveCSS("cursor", "crosshair");
    await expect(
      page.getByTestId("drawing-position-marker").locator("path").first(),
    ).toHaveAttribute("vector-effect", "non-scaling-stroke");
    await page.mouse.move(box.x + box.width * 0.66, box.y + box.height * 0.66);
    await page.mouse.move(1, 1);
    await expect(page.getByTestId("drawing-position-marker")).toHaveCount(0);
    await awaitTwoFrames(page);
    await expect(page.getByTestId("drawing-position-marker")).toHaveCount(0);
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drawing-position-marker")).toHaveCount(0);
  }
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

/** Every point of an SVG polyline or polygon. */
function svgPoints(locator: Locator) {
  return locator.evaluate((element) => {
    const { points } = element as SVGPolylineElement;
    return Array.from({ length: points.numberOfItems }, (_, index) => {
      const point = points.getItem(index);
      return { x: point.x, y: point.y };
    });
  });
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
  await expect(draftInput).toHaveCSS(
    "font-family",
    /ICM Round Period.*Metropolis.*DejaVu Sans.*Arial/u,
  );
  await expectForeignObjectContentsContained(
    page.getByTestId("canvas-text-editor"),
  );
  // Formatting sits on one row; alignment shares the commit row below it.
  const top = (name: string) => controlTop(page.getByRole("button", { name }));
  const [boldTop, increaseTop, applyTop, deleteTop, alignLeftTop] =
    await Promise.all([
      top("Bold"),
      top("Increase text size"),
      top("Apply text changes"),
      top("Delete text"),
      top("Align left"),
    ]);
  expect(Math.abs(increaseTop - boldTop)).toBeLessThan(1);
  expect(Math.abs(deleteTop - applyTop)).toBeLessThan(1);
  expect(Math.abs(alignLeftTop - applyTop)).toBeLessThan(1);
  expect(applyTop).toBeGreaterThan(increaseTop);

  // A long note wraps inside the compact editor instead of running past it.
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
  await draftInput.fill("Vin");
  await draftInput.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Subscript" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await expect(page.locator('[data-layer="drafting"]')).toContainText("Vin");
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCSS(
    "font-family",
    /ICM Round Period.*Metropolis.*DejaVu Sans.*Arial/u,
  );
  await expect(page.getByTestId("revision")).toHaveText("2");

  const textObject = await exportedTextObject(page);
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
  await openEditor(page);
  await placeText(page);

  const latexButton = page.getByRole("button", { name: "Insert formula" });
  await expect(latexButton).toHaveText("LaTeX");
  await latexButton.click();
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
  await expect(source).toHaveValue("Design note");
  await expect(source).toBeFocused();
  const directLatex = String.raw`a+b-c=\left(d\right)`;
  await source.fill(directLatex);
  await expect(source).toHaveValue(directLatex);
  await page.locator('math-field[aria-label="Formula editor"]').click();
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
  await awaitTwoFrames(page);
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
  // An integral, a root and MathLive's upright d are all set in label type.
  await expect(formula).toHaveAttribute("data-formula-typography", "label-v5");
  await expect(formula.locator("text", { hasText: "∫" })).toHaveCount(1);
  await expect(page.locator("foreignObject", { has: formula })).toHaveCount(0);

  const text = await exportedTextObject(page);
  expect(text.content).toEqual({
    runs: [
      {
        kind: "math",
        latex: normalizedDifferential,
        display: "block",
      },
    ],
  });

  const svg = await exportedSvg(page);
  expect(svg).toContain('data-role="formula"');
  expect(svg).toContain('data-formula-typography="label-v5"');
  expect(svg).not.toContain("<foreignObject");
});

test("edits an unrestricted device formula in the same visual annotation", async ({
  page,
}) => {
  await openEditor(page);
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  await page.getByRole("button", { name: "Insert formula" }).click();
  const latex = String.raw`R_1=\frac{-1}{g_m\omega}`;
  await submitFormula(page, latex);
  await expect(page.getByRole("dialog", { name: "Formula" })).toHaveCount(0);
  await expect(page.getByTestId("formula-conversion-confirmation")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const labelFormula = page.locator(
    '[data-object-id="instance-label-R1"] [data-role="formula"]',
  );
  await expect(labelFormula).toHaveCount(1);
  await expect(labelFormula).toHaveAttribute(
    "data-formula-typography",
    "label-v5",
  );
  const project = await exportedProject(page);
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
  await openEditor(page);
  await placeText(page);
  await page.getByRole("button", { name: "Insert formula" }).click();
  await submitFormula(page, String.raw`\href{https://example.com}{V}`);

  await expect(page.getByRole("alert")).toContainText(
    "command is not available",
  );
  await expect(page.getByRole("dialog", { name: "Formula" })).toBeVisible();
  await expect(page.locator('[data-role="formula"]')).toHaveCount(0);

  // LaTeX that label type cannot set is refused by name, not drawn some
  // other way.
  await submitFormula(page, String.raw`\boxed{V}`);
  await expect(page.getByRole("alert")).toContainText(
    String.raw`\boxed is not supported in formulas`,
  );
  await expect(page.locator('[data-role="formula"]')).toHaveCount(0);
});

// Half a laptop screen at its lowest zoom (22%): the collapsed Properties rail floats over
// the canvas's right edge, which the editor must measure as covered, and the
// editor frame is at its tightest for a long display formula.
test("keeps the text editor clear of a docked panel and a long formula inside its frame at the lowest zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await openEditor(page);
  const netlist = page.getByRole("button", {
    name: "Netlist",
    exact: true,
    pressed: true,
  });
  if (await netlist.isVisible()) await netlist.click();
  while (
    Number.parseInt((await page.getByLabel("Current zoom").textContent())!) > 25
  ) {
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  }
  const canvas = page.getByTestId("schematic-canvas");
  const rail = page.getByRole("complementary", { name: "Properties" });
  await expect(rail).toBeVisible();
  const [canvasBounds, railBounds] = await Promise.all([
    canvas.boundingBox(),
    rail.boundingBox(),
  ]);
  if (!canvasBounds || !railBounds) throw new Error("Layout is not measurable");
  expect(railBounds.x).toBeGreaterThan(canvasBounds.x + 400);
  const viewBox = await canvas.getAttribute("viewBox");

  // Text placed just left of the rail would open its 344 px editor across it.
  await placeText(page, { x: railBounds.x - canvasBounds.x - 40, y: 320 });
  const frame = page.getByTestId("canvas-text-editor");
  const checkFrame = async () => {
    await expect
      .poll(async () => {
        const [bounds, docks] = await Promise.all([
          frame.boundingBox(),
          page.locator("[data-canvas-overlay]").evaluateAll((elements) =>
            elements
              .filter(
                (element) => getComputedStyle(element).visibility !== "hidden",
              )
              .map((element) => element.getBoundingClientRect())
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .map((rect) => ({ left: rect.left, right: rect.right })),
          ),
        ]);
        if (!bounds) return "unmeasured";
        const right = bounds.x + bounds.width;
        return docks.every(
          (dock) => right <= dock.left + 1 || bounds.x >= dock.right - 1,
        )
          ? "clear"
          : `editor ${Math.round(bounds.x)}–${Math.round(right)} overlaps ${JSON.stringify(docks)}`;
      })
      .toBe("clear");
    // Every control fits the visible foreignObject, including its right
    // edge; Playwright's visibility check alone accepts clipped descendants.
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
            return rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
          });
        }),
      )
      .toBe(true);
    await expect(canvas).toHaveAttribute("viewBox", viewBox!);
    const bounds = (await frame.boundingBox())!;
    expect(bounds.width).toBeCloseTo(344, 0);
    expect(bounds.x).toBeGreaterThanOrEqual(canvasBounds.x);
  };
  await checkFrame();

  // At this width the commit row wraps below the formatting row, and the
  // symbol menu stays within the editor.
  const top = (name: string) => controlTop(page.getByRole("button", { name }));
  await expect
    .poll(async () =>
      Math.abs((await top("Increase text size")) - (await top("Bold"))),
    )
    .toBeLessThan(1);
  expect(await top("Apply text changes")).toBeGreaterThan(
    await top("Increase text size"),
  );
  await page.getByLabel("Insert circuit symbol").click();
  const menuBounds = (await page
    .getByRole("menu", { name: "Circuit symbols" })
    .boundingBox())!;
  const editorBounds = (await frame.boundingBox())!;
  expect(menuBounds.x).toBeGreaterThanOrEqual(editorBounds.x - 1);
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(
    editorBounds.x + editorBounds.width + 1,
  );
  await page.getByLabel("Insert circuit symbol").click();

  const dialog = page.getByRole("dialog", { name: "Formula", exact: true });
  const source = page.getByRole("textbox", { name: "Formula LaTeX source" });
  const display = dialog.getByRole("button", { name: "Display", exact: true });
  const latex = String.raw`NTF=\frac{\left(1-z^{-1}\right)\left(1-0.75z^{-1}\right)^2}{\left(1-p_1z^{-1}\right)\left(1-p_2z^{-1}\right)}`;
  const openFormula = async () => {
    await page
      .getByRole("button", { name: "Insert formula", exact: true })
      .click();
    await expect(dialog.locator("math-field")).toBeVisible();
  };
  await openFormula();
  await source.fill(latex);
  await display.click();
  await expect(display).toHaveAttribute("aria-pressed", "true");
  await checkFrame();
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(frame.locator("[data-rich-text-math]")).toHaveAttribute(
    "data-latex",
    latex,
  );
  await checkFrame();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(frame).toHaveCount(0);

  // Reopened, the formula and its Display choice return inside the frame.
  await page.getByTestId(/^drafting-hit-note-/).dblclick();
  await checkFrame();
  await openFormula();
  await expect(source).toHaveValue(latex);
  await expect(display).toHaveAttribute("aria-pressed", "true");
  await checkFrame();
  // Both the dialog's close control and the outer cancel remain reachable.
  await dialog.getByRole("button", { name: "Close formula editor" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel text changes" }).click();
  await expect(frame).toHaveCount(0);
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

test("T writes Text first, places it at its preview on the stored annotation pitch after zoom and pan, and undoes it in one step", async ({
  page,
}) => {
  await openEditor(page);
  // The annotation pitch is an editor preference that survives a reload.
  expect(
    JSON.parse(await readDocumentStyleCode(page)).canvas.annotationGrid,
  ).toBe(5);
  await editDocumentStyleCode(page, (code) => {
    code.canvas.annotationGrid = 1;
  });
  await page.reload();
  expect(
    JSON.parse(await readDocumentStyleCode(page)).canvas.annotationGrid,
  ).toBe(1);
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
  const expected = await snappedCanvasPoint(canvas, point, 1);
  expect(expected.x % 5 !== 0 || expected.y % 5 !== 0).toBe(true);

  // The editor opens first: nothing follows the pointer, nothing exists.
  await page.keyboard.press("t");
  const editor = page.getByTestId("text-draft-editor");
  const draft = editor.getByRole("textbox", { name: "Canvas text editor" });
  const preview = page.getByTestId("text-placement-preview");
  const expectPreviewAt = (at: { x: number; y: number }, up = false) =>
    expect(preview).toHaveAttribute(
      "transform",
      `translate(${at.x} ${at.y})${up ? " rotate(270)" : ""}`,
    );
  await expect(draft).toBeVisible();
  await expect(preview).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  // Written first, the text follows the pointer without a revision until
  // Escape drops it.
  await page.keyboard.press("t");
  await draft.pressSequentially("Vout");
  await draft.press("Enter");
  await page.mouse.move(point.x + 153, point.y + 77);
  const moved = await snappedCanvasPoint(
    canvas,
    { x: point.x + 153, y: point.y + 77 },
    1,
  );
  await expect(preview).toHaveText("Vout");
  await expectPreviewAt(moved);
  await expect(preview).toHaveCSS("pointer-events", "none");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-kind="draft-text"]')).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  await page.keyboard.press("t");
  await draft.pressSequentially("Custom text");
  await draft.press("Enter");
  await page.mouse.move(point.x, point.y);
  await expectPreviewAt(expected);
  await page.keyboard.press("r");
  await expectPreviewAt(expected, true);
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
  // It lands as written, with no editor opening afterwards.
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toHaveCount(0);
  await expect(texts).toHaveText("Custom text");

  // R turned it to read up the page, as its preview showed.
  const textObject = await exportedTextObject(page);
  expect(textObject.anchor).toEqual({ kind: "free", position: expected });
  expect(textObject.rotation).toBe(270);
  const svg = await exportedSvg(page);
  expect(svg).toContain("Custom text");
  expect(svg).toContain(`rotate(270 ${expected.x} ${expected.y})`);
  expect(svg).not.toContain("text-placement-preview");
  await page.getByTestId("draw-tool-undo").click();
  await expect(texts).toHaveCount(0);
  await page.getByTestId("draw-tool-redo").click();
  await expect(texts).toHaveText("Custom text");
});

test("types Greek letters by LaTeX name and from the symbol menu", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
  const editable = page.getByRole("textbox", { name: "Canvas text editor" });
  await editable.click();
  await page.keyboard.press("ControlOrMeta+A");
  // A LaTeX name then Space spells the letter, lowercase or capital, and the
  // Space is spent on it; an unknown name stays as typed.
  await page.keyboard.type("\\phi");
  await page.keyboard.press("Space");
  await page.keyboard.type("1 \\Omega");
  await page.keyboard.press("Space");
  await page.keyboard.type("\\foo");
  await page.keyboard.press("Space");
  const typed = () =>
    editable.evaluate((element) =>
      (element.textContent ?? "").replace(/\u00a0/gu, " "),
    );
  await expect.poll(typed).toBe("φ1 Ω\\foo ");

  // The menu floats over the page but belongs to the editor: picking from it
  // keeps the text open, and the menu opens below the text being typed.
  await page.getByLabel("Insert circuit symbol").click();
  const menu = page.getByRole("menu", { name: "Circuit symbols" });
  const [menuBounds, editorBounds] = await Promise.all([
    menu.boundingBox(),
    editable.boundingBox(),
  ]);
  if (!menuBounds || !editorBounds)
    throw new Error("Symbol menu geometry is not measurable");
  expect(menuBounds.y).toBeGreaterThanOrEqual(
    editorBounds.y + editorBounds.height,
  );
  // Σ and σ differ only in case, which role names otherwise ignore.
  await menu.getByRole("menuitem", { name: "Insert Σ", exact: true }).click();
  await menu.getByRole("menuitem", { name: "Insert ψ", exact: true }).click();
  // The menu is a portal on the page body, yet React routes its events
  // through the canvas: a press on it must not hand the canvas the focus
  // (and with it the typing) or a press on whatever lies under the menu.
  const notEqual = menu.getByRole("menuitem", {
    name: "Insert ≠",
    exact: true,
  });
  const notEqualBox = (await notEqual.boundingBox())!;
  await page.mouse.move(
    notEqualBox.x + notEqualBox.width / 2,
    notEqualBox.y + notEqualBox.height / 2,
  );
  await page.mouse.down();
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
  ).toBe("Canvas text editor");
  await page.mouse.up();
  await expect(page.getByTestId("canvas-text-editor")).toBeVisible();
  await expect.poll(typed).toBe("φ1 Ω\\foo Σψ≠");

  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-kind="draft-text"]').first()).toHaveText(
    /^φ1\sΩ\\foo\sΣψ≠$/u,
  );
});

test("Escape cancels a text drag and a component drag, with its Smart Snap guides, without a revision", async ({
  page,
}) => {
  await page.goto("/editor");
  for (const position of [
    { x: 300, y: 240 },
    { x: 560, y: 360 },
  ]) {
    await chooseComponent(page, "resistor");
    await page.getByTestId("schematic-canvas").click({ position });
  }
  await page.keyboard.press("Escape");
  await placeText(page, { x: 450, y: 140 });
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .press("Escape");
  const revision = await page.getByTestId("revision").textContent();
  const snapGuides = page.locator(
    '[data-layer="snap-guides"] .smart-snap-guide',
  );
  const dragThenEscape = async (
    from: Locator,
    to: { x: number; y: number },
  ) => {
    const box = (await from.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
  };

  const note = page.getByTestId(/^drafting-hit-note-/);
  const noteBox = (await note.boundingBox())!;
  await dragThenEscape(note, {
    x: noteBox.x + noteBox.width / 2 + 80,
    y: noteBox.y + noteBox.height / 2 - 30,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("status")).toHaveText("Cancelled canvas drag");
  await expect(page.getByTestId("revision")).toHaveText(revision!);

  const target = (await page.getByTestId("hit-R2").boundingBox())!;
  await dragThenEscape(page.getByTestId("hit-R1"), {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });
  await expect.poll(async () => snapGuides.count()).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(snapGuides).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId("revision")).toHaveText(revision!);
});

test("line arrow clicks add bends and snap through to an arbitrary rectangle edge", async ({
  page,
}) => {
  await openEditor(page);
  // The arrow is drawn from the Library and the annotation menu only.
  await expect(page.getByTestId("draw-tool-arrow")).toHaveCount(0);
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 430, y: 220 }, { x: 650, y: 400 });
  const rectangle = page.locator('[data-kind="draft-rectangle"]');
  const [from, to] = await screenPoints(rectangle);
  if (!from || !to) throw new Error("Rectangle edge is not measurable");
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const exact = { x: from.x + dx * 0.37, y: from.y + dy * 0.37 };
  const target = {
    exact,
    near: { x: exact.x + (-dy / length) * 2, y: exact.y + (dx / length) * 2 },
  };

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
    svgPoints(line),
    rectangle.evaluate((element) => {
      const polygon = element as SVGPolygonElement;
      return [polygon.points.getItem(0), polygon.points.getItem(1)].map(
        (point) => ({ x: point.x, y: point.y }),
      );
    }),
    svgPoints(head),
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

// A construction line selects through its stroke, not a blocking bounds
// rectangle, and a double-click on the line inserts a vertex.
test("construction line hits by its stroke and inserts a vertex on double-click", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "line");
  await clickCreate(page, { x: 200, y: 200 }, { x: 420, y: 200 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const hit = page.getByTestId(/^drafting-hit-construction-/);
  await expect(hit).toHaveCount(1);
  expect(await hit.evaluate((element) => element.tagName)).toBe("polyline");
  const box = (await hit.boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
  await expect(hit).toHaveClass(/selected/u);

  // Avoid the midpoint curve handle, which owns its own pointer events.
  await page.mouse.dblclick(box.x + box.width * 0.35, box.y + box.height / 2);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.locator('[data-testid^="draft-handle-vx-"]')).toHaveCount(
    3,
  );
});

test("a drawn rectangle selects by its outline, passes interior clicks through and resizes by its corner", async ({
  page,
}) => {
  await openEditor(page);
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 220, y: 220 }, { x: 380, y: 320 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const rectangle = page.locator('[data-kind="draft-rectangle"]');
  await expect(rectangle).toHaveCount(1);
  await expect(rectangle).toHaveAttribute("fill", "none");

  const hit = page.getByTestId(/^drafting-hit-rectangle-/);
  await expect(hit).toHaveCSS("pointer-events", "stroke");
  await expect(hit).toHaveCSS("fill", "none");
  const corners = await screenPoints(hit);
  if (corners.length !== 4) throw new Error("rectangle is not measurable");
  const center = corners.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );

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

  const edge = await segmentPoint(hit);
  await page.mouse.click(edge.x, edge.y);
  await expect(
    page.locator('[data-testid^="draft-handle-corner-"]'),
  ).toHaveCount(4);

  const pointsBeforeResize = await rectangle.getAttribute("points");
  await dragLocator(page.getByTestId(/^draft-handle-corner-0-/), {
    x: -20,
    y: -10,
  });
  await expect(page.getByTestId("revision")).toHaveText("3");
  expect(await rectangle.getAttribute("points")).not.toBe(pointsBeforeResize);

  await expect(page.locator('[data-testid^="draft-handle-side-"]')).toHaveCount(
    4,
  );
});

test("double-click inside a rectangle writes a centered, anchored label", async ({
  page,
}) => {
  await openEditor(page);
  await clickDrawTool(page, "rectangle");
  await clickCreate(page, { x: 220, y: 220 }, { x: 380, y: 320 });
  await expect(page.getByTestId("revision")).toHaveText("1");

  const box = (await page
    .getByTestId(/^drafting-hit-rectangle-/)
    .boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
  const geometry = await page.evaluate(() => {
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
  if (!geometry) throw new Error("label geometry is not measurable");
  expect(geometry.x).toBeCloseTo(geometry.center.x, 5);
  expect(geometry.y).toBeCloseTo(geometry.center.y + 0.35 * 15.116, 1);

  // Re-entering editing reuses the same label instead of stacking a second.
  await page.mouse.dblclick(center.x, center.y);
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(label).toHaveCount(1);
});

test("authors inline fractions alongside styled text and preserves them through editing and export", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
  const editor = page.getByRole("textbox", {
    name: "Canvas text editor",
    exact: true,
  });
  // A selected slash becomes a fraction; the editor's own history undoes it.
  await editor.fill("1u/150n");
  await editor.press("ControlOrMeta+A");
  await page
    .getByRole("button", { name: "Insert fraction", exact: true })
    .click();
  await expect(editor.locator('[data-fraction-part="denominator"]')).toHaveText(
    "150n",
  );
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toHaveText("1u/150n");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor.locator("[data-rich-text-fraction]")).toHaveCount(1);

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
  const project = parseSavedProject(saved.toString("utf8"));
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
  const svg = await exportedSvg(page);
  expect(svg).toContain('data-role="fraction-bar"');
  expect(svg).toContain('data-text-run="subscript"');
  expect(svg).toContain(" + R");
  expect(svg).not.toContain("data-rich-text-fraction");
  await openProjectFile(page, saved, "fractions.icproj.json");
  await expect(note.locator('[data-role="fraction-bar"]')).toHaveCount(1);
  const reopened = await exportedProject(page);
  expect(reopened.documents[0].drafting.objects[0].content).toEqual(content);
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
      // Native glyph advances are intentionally not stretched to the
      // deterministic layout width. Keep the visible centers within a small
      // fraction of one em while retaining the stronger containment checks.
      expect(Math.abs(part.center - bar.center)).toBeLessThan(
        partFontSize * 0.15,
      );
      expect(part.x).toBeGreaterThan(bar.x);
      expect(part.x + part.width).toBeLessThan(bar.x + bar.width);
    }
    // The bar follows deterministic layout advances while glyphs retain their
    // native width. Require it to enclose both parts; the grow/shrink checks
    // below prove that its width still follows content without stretching text.
    const nativeOverhang = bar.width - Math.max(top.width, bottom.width);
    expect(nativeOverhang).toBeGreaterThan(0);
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
  await openProjectFile(page, saved, "fraction-layout.icproj.json");
  await check(note);
});

test("rectangle annotation code commits paint and stacking atomically and survives export", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const project = createEmptyProject("code-rectangle", "Annotation code");
  project.documents[0]!.drafting = {
    objects: [
      {
        id: "shape",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 100, y: 100 } },
        center: { x: 100, y: 100 },
        lineStyle: "solid",
        width: 160,
        height: 80,
        rotation: 0,
      },
    ],
  };
  await openProject(page, serializeProject(project), "annotation.icproj.json");
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
  await page.mouse.click(edge.x, edge.y);
  await page.keyboard.press("q");
  const editor = page.getByLabel("Editable Canvas property code");
  await expect(editor).toBeVisible();
  const shape = page.locator(
    '[data-kind="draft-rectangle"][data-object-id="shape"]',
  );
  const background = page.locator(
    '[data-drafting-layer="background"] [data-object-id="shape"]',
  );
  const before = await readComponentCode(page);
  expect(before.stacking).toEqual({ layer: "front" });
  const lineStyle = page.getByRole("combobox", {
    name: "Line style options",
    exact: true,
  });
  const layer = page.getByRole("combobox", {
    name: "Layer options",
    exact: true,
  });
  await lineStyle.selectOption("dotted");
  await expect(shape).toHaveAttribute("stroke-dasharray", /\d/);
  await layer.selectOption("back");
  await expect(background).toHaveCount(1);
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
  await expect(background).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await readComponentCode(page)).toEqual(before);
  await expect(shape).toHaveAttribute("fill", "none");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  // An invalid draft changes nothing and is discarded without a revision.
  const valid = await readComponentPropertyCode(page);
  const bad = JSON.parse(valid);
  bad.appearance.fillColor = [999, 0, 0];
  bad.geometry.width = 200;
  await editor.fill(JSON.stringify(bad));
  await expect(
    page.getByRole("button", { name: "Discard draft" }),
  ).toBeVisible();
  await expect(shape).toHaveAttribute("fill", "#e1eeff");
  const lastRevision = await page.getByTestId("revision").textContent();
  await page.getByRole("button", { name: "Discard draft" }).click();
  expect(await readComponentCode(page)).toEqual(JSON.parse(valid));
  await expect(page.getByTestId("revision")).toHaveText(lastRevision!);
  const saved = await downloadBytes(page, "File", "Export Project File…");
  const svg = await exportedSvg(page);
  expect(svg).toContain('fill="#e1eeff"');
  expect(svg).toContain('stroke="#0c2238"');
  await openProjectFile(page, saved, "reopen.icproj.json");
  await expectStatus(page, "Opened reopen.icproj.json");
  // The context menu opens the same Properties code.
  const reopenedEdge = await edgePoint();
  await page.mouse.click(reopenedEdge.x, reopenedEdge.y, { button: "right" });
  await page
    .getByRole("menuitem", { name: "Properties (Q)", exact: true })
    .click();
  expect(await readComponentCode(page)).toEqual(JSON.parse(valid));
  await page.getByRole("button", { name: "Edit fill color" }).click();
  await page.getByRole("button", { name: "Reset fill color" }).click();
  await expect(shape).toHaveAttribute("fill", "none");
  await expect(shape).toHaveAttribute("stroke", "#0c2238");
});

test("arrow endpoints keep independent styles through rotation, history, file export and a click on the dot", async ({
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
      },
    ],
  };
  await openProject(page, serializeProject(project), "ends.icproj.json");
  await expectStatus(page, "Opened ends.icproj.json");
  const hit = page.getByTestId("drafting-hit-arrow-ends");
  const [edge] = (await screenPoints(hit)) as [Point];
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
  await expect(start).toHaveValue("none");
  await expect(end).toHaveValue("medium-arrow");
  const art = page.locator(
    '[data-kind="draft-arrow"][data-object-id="arrow-ends"]',
  );
  await start.selectOption("dot");
  await expect(end).toHaveValue("medium-arrow");
  await end.selectOption("open-arrow");
  await expect(start).toHaveValue("dot");
  await expect(art.locator("circle")).toHaveCount(1);
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
    parseSavedProject(saved.toString("utf8")).documents[0].drafting.objects[0]
      .styleOverride,
  ).toMatchObject({ arrowStart: "dot", arrowEnd: "large-arrow" });
  const svg = await exportedSvg(page);
  expect(svg).toContain(`points="${polygon}"`);
  expect(svg).toContain(
    `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}"`,
  );
  await openProjectFile(page, saved, "reopened-ends.icproj.json");
  await expectStatus(page, "Opened reopened-ends.icproj.json");
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
});

async function polylinePoints(page: Page): Promise<number[][]> {
  const points = await page
    .getByTestId(/^drafting-hit-arrow-/)
    .getAttribute("points");
  return points!
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
}

async function selectPolyline(page: Page): Promise<void> {
  const point = await segmentPoint(
    page.getByTestId(/^drafting-hit-arrow-/),
    0.25,
  );
  await page.mouse.click(point.x, point.y);
}

async function drawPolyline(page: Page): Promise<void> {
  await page.getByTestId("annotation-menu").locator("summary").click();
  await page.getByTestId("annotation-shortcut-annotation-polyline").click();
  const box = (await page.getByTestId("schematic-canvas").boundingBox())!;
  for (const point of [
    { x: 190, y: 180 },
    { x: 190, y: 340 },
    { x: 330, y: 340 },
  ]) {
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.mouse.click(box.x + point.x, box.y + point.y);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(/^drafting-hit-arrow-/)).toHaveCount(1);
  await expect(page.getByTestId("drafting-create-preview")).toHaveCount(0);
}

test("Polyline annotation draws a right angle, edits vertices, stretches and preserves both endpoint styles", async ({
  page,
}) => {
  await openEditor(page);
  await drawPolyline(page);
  const original = await polylinePoints(page);
  expect(original).toHaveLength(3);
  expect(original[0]![0]).toBe(original[1]![0]);
  expect(original[1]![1]).toBe(original[2]![1]);
  await expect(page.locator('[data-kind="draft-arrow"] > polygon')).toHaveCount(
    0,
  );
  await selectPolyline(page);
  const hit = page.getByTestId(/^drafting-hit-arrow-/);
  await expect(hit).toHaveCSS("fill", "none");
  const interiorHit = await hit.evaluate((element) => {
    const line = element as SVGPolylineElement;
    const points = [...line.points];
    const point = new DOMPoint(
      points.reduce((sum, p) => sum + p.x, 0) / points.length,
      points.reduce((sum, p) => sum + p.y, 0) / points.length,
    ).matrixTransform(line.getScreenCTM()!);
    return document
      .elementsFromPoint(point.x, point.y)
      .some(
        (node) =>
          node.getAttribute("data-canvas-hit-id") ===
          line.getAttribute("data-canvas-hit-id"),
      );
  });
  expect(interiorHit).toBe(false);
  await expect(page.getByTestId(/^draft-handle-path-corner-/)).toHaveCount(4);
  await dragLocator(page.getByTestId(/^draft-handle-waypoint-0-/), {
    x: -35,
    y: 20,
  });
  const bent = await polylinePoints(page);
  expect(bent[0]).toEqual(original[0]);
  expect(bent[2]).toEqual(original[2]);
  expect(bent[1]).not.toEqual(original[1]);
  await dragLocator(page.getByTestId(/^draft-handle-path-corner-2-/), {
    x: 55,
    y: 25,
  });
  const stretched = await polylinePoints(page);
  expect(stretched[2]).not.toEqual(bent[2]);
  await page.keyboard.press("Control+z");
  expect(await polylinePoints(page)).toEqual(bent);
  await page.keyboard.press("Control+Shift+z");
  expect(await polylinePoints(page)).toEqual(stretched);

  await page.keyboard.press("q");
  await editComponentPropertyCode(page, (code) => {
    code.appearance.startStyle = "dot";
    code.appearance.endStyle = "large-arrow";
    code.appearance.strokeScale = 2;
  });
  await expect(page.locator('[data-kind="draft-arrow"] > circle')).toHaveCount(
    1,
  );
  await expect(page.locator('[data-kind="draft-arrow"] > polygon')).toHaveCount(
    1,
  );
  const exported = await downloadBytes(page, "File", "Export Project File…");
  const project = parseSavedProject(exported.toString("utf8"));
  expect(project.documents[0].instances).toEqual([]);
  expect(project.documents[0].nets).toEqual([]);
  expect(project.documents[0].drafting.objects[0].styleOverride).toMatchObject({
    arrowStart: "dot",
    arrowEnd: "large-arrow",
  });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "polyline.icproj.json",
    mimeType: "application/json",
    buffer: exported,
  });
  await expect.poll(() => polylinePoints(page)).toEqual(stretched);
  const svg = await exportedSvg(page);
  expect(svg).toContain('data-kind="draft-arrow"');
  const artwork = await page.evaluate((source) => {
    const root = new DOMParser().parseFromString(source, "image/svg+xml");
    const path = root.querySelector('[data-kind="draft-arrow"]')!;
    const dot = path.querySelector("circle")!;
    return {
      heads: path.querySelectorAll("polygon").length,
      dot: [Number(dot.getAttribute("cx")), Number(dot.getAttribute("cy"))],
    };
  }, svg);
  expect(artwork).toEqual({ heads: 1, dot: stretched[0] });
});

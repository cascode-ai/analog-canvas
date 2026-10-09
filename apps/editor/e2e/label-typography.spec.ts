// Label typography: subscripts, italics and overbars, and the complement Nets
// an overbar names.

import { parseSavedProject } from "./editor-fixtures";
import { expect, test } from "@playwright/test";
import {
  awaitEditorReady,
  clickDrawTool,
  placeText,
  downloadBytes,
  editComponentPropertyCode,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { clickRoute, selectRichTextOffsets } from "./canvas-fixtures.js";

test("starts a V-led Net Label subscripted and lets the author turn it off without renaming the Net", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "VB";
  });
  // A V-led Net name starts in its voltage-node look: V with subscript B.
  const renderedLabel = page.locator('[data-object-id="net-label-route-ui-1"]');
  await expect(renderedLabel).toHaveText("VB");
  await expect(renderedLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "B",
  );
  const label = page.getByTestId("annotation-hit-net-label-route-ui-1");
  await label.dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toHaveText("VB");
  await expect(page.getByRole("button", { name: "Italic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subscript" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Superscript" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insert formula" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insert fraction" }),
  ).toBeDisabled();

  // Turning the subscript off is the author's own look.
  await selectRichTextOffsets(editor, 1, 2);
  await page.getByRole("button", { name: "Subscript" }).click();
  await expect(editor.locator("sub")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(
    renderedLabel.locator('[data-text-run="subscript"]'),
  ).toHaveCount(0);
  await expect(renderedLabel).toHaveText("VB");

  const projectBytes = await downloadBytes(
    page,
    "File",
    "Export Project File…",
  );
  const saved = parseSavedProject(projectBytes.toString("utf8"));
  // Styling never renames: the Net keeps its name VB.
  expect(saved.documents[0].connectivityEvidence).toContainEqual(
    expect.objectContaining({
      kind: "name-claim",
      name: "VB",
      owner: {
        kind: "net-label",
        annotationId: "net-label-route-ui-1",
      },
    }),
  );
  expect(
    saved.documents[0].annotations.find(
      (candidate: { id: string }) => candidate.id === "net-label-route-ui-1",
    ).formatOverride,
  ).toBeDefined();

  await page.getByTestId("project-file").setInputFiles({
    name: "rich-net-label.icproj.json",
    mimeType: "application/json",
    buffer: projectBytes,
  });
  await expect(
    page
      .locator('[data-object-id="net-label-route-ui-1"]')
      .locator('[data-text-run="subscript"]'),
  ).toHaveCount(0);
});

test("draws a new subscript upright, lights the looks it has, and keeps one the author slants", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "CLKE";
  });
  const hit = page.getByTestId("annotation-hit-net-label-route-ui-1");
  const rendered = page.locator('[data-object-id="net-label-route-ui-1"]');
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  const italic = page.getByRole("button", { name: "Italic" });
  const subscriptButton = page.getByRole("button", { name: "Subscript" });

  // Opening the bold italic label lights Italic for its first letter.
  await hit.dblclick();
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await expect(subscriptButton).toHaveAttribute("aria-pressed", "false");

  // Subscripting part of the bold italic label does not slant the script,
  // and the buttons report the upright script rather than the label around it.
  await selectRichTextOffsets(editor, 3, 4);
  await subscriptButton.click();
  await expect(editor.locator("sub")).toHaveCSS("font-style", "normal");
  await expect(subscriptButton).toHaveAttribute("aria-pressed", "true");
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await selectRichTextOffsets(editor, 0, 1);
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await expect(subscriptButton).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const subscript = rendered.locator('[data-text-run="subscript"]');
  await expect(subscript).toHaveText("E");
  await expect(subscript).toHaveCSS("font-style", "normal");

  // The author may still slant it on purpose, Italic lights for it, and that
  // choice is kept.
  await hit.dblclick();
  await selectRichTextOffsets(editor, 3, 4);
  await expect(subscriptButton).toHaveAttribute("aria-pressed", "true");
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await italic.click();
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await expect(subscriptButton).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(subscript.locator('[data-text-run="span"]').first()).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(rendered).toHaveText("CLKE");
});

test("italic over a whole label slants its subscript too, and takes it off everywhere", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "CLKE";
  });
  const hit = page.getByTestId("annotation-hit-net-label-route-ui-1");
  const rendered = page.locator('[data-object-id="net-label-route-ui-1"]');
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  const italic = page.getByRole("button", { name: "Italic" });
  const apply = page.getByRole("button", { name: "Apply text changes" });
  const subscript = rendered.locator('[data-text-run="subscript"]');
  await hit.dblclick();
  await selectRichTextOffsets(editor, 3, 4);
  await page.getByRole("button", { name: "Subscript" }).click();
  await apply.click();
  await expect(subscript).toHaveCSS("font-style", "normal");

  // Bold italic CLK with an upright E is not italic throughout, so Italic
  // over all of it slants the subscript as well.
  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await italic.click();
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await apply.click();
  await expect(subscript.locator('[data-text-run="span"]').first()).toHaveCSS(
    "font-style",
    "italic",
  );

  // Italic throughout, the same press takes it off every character.
  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await italic.click();
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await apply.click();
  await expect(subscript).toHaveCSS("font-style", "normal");
  await expect(rendered.locator('[data-text-run="span"]').first()).toHaveCSS(
    "font-style",
    "normal",
  );
  await expect(rendered).toHaveText("CLKE");
});

test("a bar over a Pin's V_LO names its complement and draws V̄_LO, never a subscript spelling _bar", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("p");
  await canvas.hover({ position: { x: 320, y: 180 } });
  await canvas.click({ position: { x: 320, y: 180 } });
  await expect(page.getByTestId("status")).toContainText("Added Cell Pin Vinp");
  await page.keyboard.press("Escape");
  const hit = page.getByTestId("annotation-hit-instance-label-P1");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  const apply = page.getByRole("button", { name: "Apply text changes" });
  const rendered = page.locator('[data-object-id="instance-label-P1"]');
  const subscript = rendered.locator('[data-text-run="subscript"]');

  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially("VLO");
  await apply.click();
  await expect(page.getByTestId("status")).toContainText(
    "Renamed Cell Pin to VLO",
  );
  await expect(subscript).toHaveText("LO");

  // The Pin's own standard look, barred whole.
  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Overbar" }).click();
  await apply.click();
  await expect(page.getByTestId("status")).toContainText(
    "Renamed Cell Pin to VLO_bar",
  );
  await expect(rendered).toHaveText("VLO");
  await expect(subscript).toHaveText("LO");
  await expect(rendered.locator('[data-text-run="overbar"]')).toHaveCount(1);

  // Unbarred again, then an author's look (an italic subscript) barred
  // whole: the look is kept, and the subscript still spells LO.
  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Overbar" }).click();
  await apply.click();
  await expect(page.getByTestId("status")).toContainText(
    "Renamed Cell Pin to VLO",
  );
  await hit.dblclick();
  await editor.press("End");
  await editor.press("Shift+ArrowLeft");
  await editor.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Italic" }).click();
  await apply.click();
  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Overbar" }).click();
  await apply.click();
  await expect(page.getByTestId("status")).toContainText(
    "Renamed Cell Pin to VLO_bar",
  );
  await expect(rendered).toHaveText("VLO");
  await expect(subscript).toHaveText("LO");
  await expect(rendered.locator('[data-text-run="overbar"]')).toHaveCount(1);
});

test("italic over a new Pin's standard look is the author's look, kept on Apply", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("p");
  await canvas.hover({ position: { x: 320, y: 180 } });
  await canvas.click({ position: { x: 320, y: 180 } });
  await expect(page.getByTestId("status")).toContainText("Added Cell Pin Vinp");
  await page.keyboard.press("Escape");
  const rendered = page.locator('[data-object-id="instance-label-P1"]');
  const subscript = rendered.locator('[data-text-run="subscript"]');
  const revision = page.getByTestId("revision");
  const placed = Number(await revision.textContent());

  // Placed as V over an upright inp. Italic over all of it restyles the
  // name: Apply keeps that look rather than redrawing the standard one.
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Italic" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(revision).toHaveText(String(placed + 1));
  await expect(subscript).toHaveText("inp");
  await expect(subscript.locator('[data-text-run="span"]').first()).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(rendered).toHaveText("Vinp");
});

test("keeps an overbar from widening a narrow glyph", async ({ page }) => {
  await page.goto("/editor");

  await placeText(page, { x: 360, y: 300 });
  let editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("f");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await placeText(page, { x: 560, y: 300 });
  editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("f");
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Overbar" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const textObjects = page.locator(
    '[data-layer="drafting"] text[data-kind="draft-text"]',
  );
  await expect(textObjects).toHaveCount(2);
  const widths = await textObjects.evaluateAll((elements) =>
    elements.map((element) => {
      const glyph =
        element.querySelector<SVGTSpanElement>('[data-text-run="base"]') ??
        (element as SVGTextElement);
      return glyph.getComputedTextLength();
    }),
  );
  expect(widths[0]).toBeGreaterThan(0);
  expect(widths[1]).toBeCloseTo(widths[0]!, 1);

  const overbarGlyph = textObjects.nth(1).locator('[data-text-run="base"]');
  await expect(overbarGlyph).not.toHaveAttribute("textLength", /.+/u);
  await expect(overbarGlyph).not.toHaveAttribute("lengthAdjust", /.+/u);
  await expect(page.locator('[data-text-decoration="overbar"]')).toHaveCount(1);
});

test("stacks complementary scripts under one uninterrupted overbar", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeText(page);
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("In22");

  await selectRichTextOffsets(editor, 1, 3);
  await page.getByRole("button", { name: "Subscript" }).click();
  await selectRichTextOffsets(editor, 3, 4);
  await page.getByRole("button", { name: "Superscript" }).click();
  await selectRichTextOffsets(editor, 0, 4);
  await page.getByRole("button", { name: "Overbar" }).click();

  const editableOverbar = editor.locator('[data-rich-text-style="overbar"]');
  const editableStack = editableOverbar.locator(
    "[data-rich-text-script-stack]",
  );
  await expect(editableStack).toHaveCount(1);
  await expect(editor.locator("[data-rich-text-script-stack]")).toHaveCount(1);
  const editableLayout = await editableOverbar.evaluate((overbar) => {
    const stack = overbar.querySelector("[data-rich-text-script-stack]");
    const superscript = stack?.querySelector("sup");
    const subscript = stack?.querySelector("sub");
    if (!superscript || !subscript) {
      throw new Error("Editable script stack is incomplete");
    }
    const superscriptBounds = superscript.getBoundingClientRect();
    const subscriptBounds = subscript.getBoundingClientRect();
    const overbarBounds = overbar.getBoundingClientRect();
    const contentRange = document.createRange();
    contentRange.selectNodeContents(overbar);
    const contentBounds = contentRange.getBoundingClientRect();
    return {
      scriptOffset: Math.abs(superscriptBounds.left - subscriptBounds.left),
      superscriptTop: superscriptBounds.top,
      subscriptTop: subscriptBounds.top,
      barTop: overbarBounds.top,
      barLeft: overbarBounds.left,
      barRight: overbarBounds.right,
      contentLeft: contentBounds.left,
      contentRight: contentBounds.right,
    };
  });
  expect(editableLayout.scriptOffset).toBeLessThan(1);
  expect(editableLayout.superscriptTop).toBeLessThan(
    editableLayout.subscriptTop,
  );
  expect(editableLayout.barTop).toBeLessThanOrEqual(
    editableLayout.superscriptTop,
  );
  expect(
    Math.abs(editableLayout.barLeft - editableLayout.contentLeft),
  ).toBeLessThan(1);
  expect(
    Math.abs(editableLayout.barRight - editableLayout.contentRight),
  ).toBeLessThan(1);
  await expect(editableOverbar).toHaveCSS("border-top-style", "solid");

  await page.getByRole("button", { name: "Apply text changes" }).click();
  const formalSvg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  const formalLayout = await page.evaluate((source) => {
    const svg = new DOMParser().parseFromString(source, "image/svg+xml");
    const lines = [...svg.querySelectorAll('[data-text-decoration="overbar"]')];
    const line = lines[0];
    const base = [...svg.querySelectorAll('[data-text-run="base"]')];
    const superscript = svg.querySelector('[data-text-run="superscript"]');
    const subscript = svg.querySelector('[data-text-run="subscript"]');
    if (!line || base.length === 0 || !superscript || !subscript) return null;
    const numberAttribute = (element: Element, name: string): number =>
      Number(element.getAttribute(name));
    const content = [...base, superscript, subscript];
    const contentLeft = Math.min(
      ...content.map((run) => numberAttribute(run, "x")),
    );
    const contentRight = Math.max(
      ...content.map(
        (run) =>
          numberAttribute(run, "x") + numberAttribute(run, "data-text-advance"),
      ),
    );
    const viewBox = (svg.documentElement.getAttribute("viewBox") ?? "")
      .trim()
      .split(/\s+/u)
      .map(Number);
    return {
      lineCount: lines.length,
      text: svg.querySelector('[data-text-run="overbar"]')?.textContent,
      superscriptX: numberAttribute(superscript, "x"),
      subscriptX: numberAttribute(subscript, "x"),
      superscriptY: numberAttribute(superscript, "y"),
      subscriptY: numberAttribute(subscript, "y"),
      lineLeft: numberAttribute(line, "x1"),
      lineRight: numberAttribute(line, "x2"),
      lineY: numberAttribute(line, "y1"),
      contentLeft,
      contentRight,
      viewBox,
    };
  }, formalSvg);
  expect(formalLayout).not.toBeNull();
  if (!formalLayout) throw new Error("Formal SVG lacks the positioned formula");
  expect(formalLayout.lineCount).toBe(1);
  expect(formalLayout.text).toBe("In22");
  expect(formalLayout.superscriptX).toBeCloseTo(formalLayout.subscriptX, 6);
  expect(formalLayout.superscriptY).toBeLessThan(formalLayout.subscriptY);
  expect(formalLayout.lineLeft).toBeCloseTo(formalLayout.contentLeft, 6);
  expect(formalLayout.lineRight).toBeCloseTo(formalLayout.contentRight, 6);

  const png = await downloadBytes(page, "File", "Export PNG");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const rasterOverbar = await page.evaluate(
    async ({ source, lineLeft, lineRight, lineY, viewBox }) => {
      if (
        viewBox.length !== 4 ||
        viewBox.some((value) => !Number.isFinite(value))
      ) {
        throw new Error("Formal SVG viewBox is invalid");
      }
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("PNG could not be decoded"));
      });
      image.src = source;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D is unavailable");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const [viewX, viewY, viewWidth, viewHeight] = viewBox as [
        number,
        number,
        number,
        number,
      ];
      const scaleX = canvas.width / viewWidth;
      const scaleY = canvas.height / viewHeight;
      const firstX = Math.ceil((lineLeft - viewX) * scaleX) + 2;
      const lastX = Math.floor((lineRight - viewX) * scaleX) - 2;
      const centerY = (lineY - viewY) * scaleY;
      let sampledColumns = 0;
      let inkColumns = 0;
      let blankRun = 0;
      let longestBlankRun = 0;
      for (let x = firstX; x <= lastX; x += 1) {
        sampledColumns += 1;
        let hasInk = false;
        for (
          let y = Math.floor(centerY - 3);
          y <= Math.ceil(centerY + 3);
          y += 1
        ) {
          if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) {
            continue;
          }
          const offset = (y * canvas.width + x) * 4;
          if (
            pixels[offset]! < 128 &&
            pixels[offset + 1]! < 128 &&
            pixels[offset + 2]! < 128
          ) {
            hasInk = true;
            break;
          }
        }
        if (hasInk) {
          inkColumns += 1;
          blankRun = 0;
        } else {
          blankRun += 1;
          longestBlankRun = Math.max(longestBlankRun, blankRun);
        }
      }
      return { sampledColumns, inkColumns, longestBlankRun };
    },
    {
      source: `data:image/png;base64,${png.toString("base64")}`,
      lineLeft: formalLayout.lineLeft,
      lineRight: formalLayout.lineRight,
      lineY: formalLayout.lineY,
      viewBox: formalLayout.viewBox,
    },
  );
  expect(rasterOverbar.sampledColumns).toBeGreaterThan(5);
  expect(rasterOverbar.inkColumns).toBe(rasterOverbar.sampledColumns);
  expect(rasterOverbar.longestBlankRun).toBe(0);
  const pdf = await downloadBytes(page, "File", "Export PDF");
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

  type SavedRichTextRun = {
    kind: string;
    value?: string;
    style?: string;
    children?: SavedRichTextRun[];
    numerator?: { runs: SavedRichTextRun[] };
    denominator?: { runs: SavedRichTextRun[] };
  };
  const project = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      drafting: {
        objects: Array<{
          kind: string;
          content?: { runs: SavedRichTextRun[] };
        }>;
      };
    }>;
  };
  const textObject = project.documents[0]!.drafting.objects.find(
    (object) => object.kind === "text",
  );
  expect(textObject?.content).toBeTruthy();
  if (!textObject?.content) throw new Error("Saved drafting text is missing");

  const descendants = (runs: SavedRichTextRun[]): SavedRichTextRun[] =>
    runs.flatMap((run) => [
      run,
      ...(run.children ? descendants(run.children) : []),
      ...(run.numerator ? descendants(run.numerator.runs) : []),
      ...(run.denominator ? descendants(run.denominator.runs) : []),
    ]);
  const savedRuns = descendants(textObject.content.runs);
  const overbar = savedRuns.find(
    (run) => run.kind === "span" && run.style === "overbar",
  );
  const boldText = (value: string) => ({
    kind: "span",
    style: "bold",
    children: [{ kind: "text", value }],
  });
  expect(overbar?.children).toEqual([
    boldText("I"),
    {
      kind: "span",
      style: "subscript",
      children: [boldText("n2")],
    },
    {
      kind: "span",
      style: "superscript",
      children: [boldText("2")],
    },
  ]);
  expect(
    savedRuns.filter(
      (run) => run.kind === "span" && (run.children?.length ?? 0) === 0,
    ),
  ).toEqual([]);
});

test("a Net Label drawn under an overbar names the complement Net, through undo and reload", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-1").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-2").click();
  await page.keyboard.press("Escape");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "F";
  });
  const hit = page.getByTestId("annotation-hit-net-label-route-ui-1");
  const label = page.locator(
    '[data-layer="annotations"] [data-object-id="net-label-route-ui-1"]',
  );
  const bar = label.locator("..").locator('[data-text-decoration="overbar"]');
  await hit.dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Overbar", exact: true }).click();
  await expect(editor.locator('[data-rich-text-style="overbar"]')).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(bar).toHaveCount(1);
  await expect(label).toHaveText("F");
  const saved = await downloadBytes(page, "File", "Export Project File…");
  const document = parseSavedProject(saved.toString()).documents[0];
  // An overbar over a Net Label means its complement: the Net is F_bar.
  expect(document.connectivityEvidence).toContainEqual(
    expect.objectContaining({ kind: "name-claim", name: "F_bar" }),
  );
  await page.getByTestId("draw-tool-undo").click();
  await expect(bar).toHaveCount(0);
  await page.getByTestId("draw-tool-redo").click();
  await expect(bar).toHaveCount(1);
  await page.getByTestId("project-file").setInputFiles({
    name: "overbar.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  const discard = page.getByRole("button", {
    name: "Continue without saving",
    exact: true,
  });
  await discard.click();
  await expect(bar).toHaveCount(1);
  // Open the netlist panel to verify both formats carry the same spelling.
  if (
    (await page
      .getByTestId("netlist-panel-toggle")
      .getAttribute("aria-pressed")) !== "true"
  )
    await page.getByTestId("netlist-panel-toggle").click();
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("F_bar");
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spice");
  await expect(code).toContainText("F_bar");
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spectre");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  // Renamed to another complement, the label keeps the author's bar.
  await editComponentPropertyCode(page, (code) => {
    code.name = "Q_bar";
  });
  await expect(label).toHaveText("Q");
  await expect(bar).toHaveCount(1);
  await hit.dblclick();
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Overbar", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(bar).toHaveCount(0);
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  // Removing the bar returned the label to its default look, so it has no
  // formatting of its own: a name ending in _bar with an underscore keeps the
  // historical overbar and subscript, and the name keeps both.
  await editComponentPropertyCode(page, (code) => {
    code.name = "Q_in_bar";
  });
  await expect(bar).toHaveCount(1);
  await expect(label).toHaveText("Qin");
  await expect(label.locator('[data-text-run="subscript"]')).toHaveText("in");
});

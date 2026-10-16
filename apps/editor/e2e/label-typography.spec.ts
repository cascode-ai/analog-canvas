// Label typography: subscripts, italics and overbars, and the complement Nets
// an overbar names.

import { expect, test } from "@playwright/test";
import { resolveDocumentLogicalNets } from "@icm/derived";
import {
  placeText,
  editComponentPropertyCode,
  openEditor,
  openProject,
  exportedProject,
  clickNetlistWorkflowCommand,
  expectStatus,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import {
  clickRoute,
  selectRichTextOffsets,
  drawWire,
} from "./canvas-fixtures.js";

test("creates a barred Net Label as a separate signal from its unbarred name", async ({
  page,
}) => {
  await openEditor(page);
  for (const y of [180, 380]) {
    await placeComponent(page, "resistor", { x: 280, y });
    await placeComponent(page, "resistor", { x: 480, y });
  }
  await drawWire(page, "R1-2", "R2-1");
  await drawWire(page, "R3-2", "R4-1");
  for (const [routeId, barred] of [
    ["route-ui-1", false],
    ["route-ui-2", true],
  ] as const) {
    await clickRoute(page, routeId, 0.5, 0);
    await page.keyboard.press("l");
    const dialog = page.getByTestId("net-label-editor");
    const editor = dialog.getByRole("textbox", { name: "Canvas text editor" });
    await editor.fill("Q");
    if (barred) {
      await editor.press("ControlOrMeta+A");
      await dialog.getByRole("button", { name: "Overbar" }).click();
    }
    await dialog.getByRole("button", { name: "Apply text changes" }).click();
  }
  const project = await exportedProject(page);
  const document = project.documents[0]!;
  const names = document.connectivityEvidence.filter(
    (item: { kind: string }) => item.kind === "name-claim",
  );
  expect(names.map((item: { name: string }) => item.name).sort()).toEqual([
    "Q",
    "Q_bar",
  ]);
  const logical = resolveDocumentLogicalNets(document);
  expect(logical.byBaseNetId.get(names[0]!.netId)!.id).not.toBe(
    logical.byBaseNetId.get(names[1]!.netId)!.id,
  );
  await expect(
    page.locator(
      '[data-object-id="net-label-route-ui-2"] [data-text-run="overbar"]',
    ),
  ).toHaveCount(1);

  // Historical files can draw the same bar while still naming Q. Opening
  // them must not silently reconnect the circuit; the existing Issues path
  // explains the mismatch and navigates to the label.
  const barredClaim = names.find(
    (item: { name: string }) => item.name === "Q_bar",
  )!;
  barredClaim.name = "Q";
  const barredLabel = document.annotations.find(
    (item: { id: string }) => item.id === "net-label-route-ui-2",
  )!;
  barredLabel.formatOverride = {
    runs: [
      {
        kind: "span",
        style: "overbar",
        children: [{ kind: "text", value: "Q" }],
      },
    ],
  };
  await openProject(page, project);
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await page.getByTestId("statusbar-issues").click();
  const warning = page.getByTestId("project-diagnostics").getByRole("button", {
    name: /ERC_OVERBAR_NAME_MISMATCH/u,
  });
  await expect(warning).toContainText("electrical name is Q");
  await warning.click();
  await expectStatus(page, "ERC_OVERBAR_NAME_MISMATCH");
  const reopened = await exportedProject(page);
  expect(
    reopened.documents[0].connectivityEvidence
      .filter((item: { kind: string }) => item.kind === "name-claim")
      .map((item: { name: string }) => item.name),
  ).toEqual(["Q", "Q"]);
});

// The looks themselves are label-typography's and rich-text's; this is the
// toolbar reading and writing them through a real selection.
test("draws a new subscript upright, lights the looks it has, and slants it only on request", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await drawWire(page, "R1-2", "R2-1");
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
  const apply = page.getByRole("button", { name: "Apply text changes" });
  const subscript = rendered.locator('[data-text-run="subscript"]');
  const slanted = subscript.locator('[data-text-run="span"]').first();

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
  await apply.click();
  await expect(subscript).toHaveText("E");
  await expect(subscript).toHaveCSS("font-style", "normal");

  // Bold italic CLK with an upright E is not italic throughout, so Italic
  // over all of it slants the subscript as well; italic throughout, the same
  // press takes it off every character.
  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await italic.click();
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await apply.click();
  await expect(slanted).toHaveCSS("font-style", "italic");
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

  // The author may still slant the subscript alone on purpose, Italic lights
  // for it, and that choice is kept.
  await hit.dblclick();
  await selectRichTextOffsets(editor, 3, 4);
  await expect(subscriptButton).toHaveAttribute("aria-pressed", "true");
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await italic.click();
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await expect(subscriptButton).toHaveAttribute("aria-pressed", "true");
  await apply.click();
  await expect(slanted).toHaveCSS("font-style", "italic");
  await expect(rendered).toHaveText("CLKE");
});

// Naming the complement is identifier-text's and text-editing's; this is
// the Cell Pin's canvas editor and its status.
test("a bar over a Pin's V_LO names its complement and draws V̄_LO, keeping the author's look", async ({
  page,
}) => {
  await openEditor(page);
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
  const status = page.getByTestId("status");
  const barWhole = async () => {
    await hit.dblclick();
    await editor.press("ControlOrMeta+A");
    await page.getByRole("button", { name: "Overbar" }).click();
    await apply.click();
  };

  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially("VLO");
  await apply.click();
  await expect(status).toContainText("Renamed Cell Pin to VLO");
  await expect(subscript).toHaveText("LO");

  // The Pin's own standard look, barred whole, then unbarred again.
  await barWhole();
  await expect(status).toContainText("Renamed Cell Pin to VLO_bar");
  await expect(rendered).toHaveText("VLO");
  await expect(subscript).toHaveText("LO");
  await expect(rendered.locator('[data-text-run="overbar"]')).toHaveCount(1);
  await barWhole();
  await expect(status).toContainText("Renamed Cell Pin to VLO");

  // Italic over all of the standard look is the author's look: Apply keeps
  // it in one edit rather than redrawing the standard one. Barred whole, the
  // subscript still spells LO.
  const revision = page.getByTestId("revision");
  const before = Number(await revision.textContent());
  await hit.dblclick();
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Italic" }).click();
  await apply.click();
  await expect(revision).toHaveText(String(before + 1));
  const slanted = subscript.locator('[data-text-run="span"]').first();
  await expect(slanted).toHaveCSS("font-style", "italic");
  await barWhole();
  await expect(status).toContainText("Renamed Cell Pin to VLO_bar");
  await expect(rendered).toHaveText("VLO");
  await expect(subscript).toHaveText("LO");
  await expect(rendered.locator('[data-text-run="overbar"]')).toHaveCount(1);
});

// Real rendered widths: the font metrics positioned-rich-text cannot see.
test("keeps an overbar from widening a narrow glyph", async ({ page }) => {
  await page.goto("/editor");

  await placeText(page, { x: 360, y: 300 });
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("f");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await placeText(page, { x: 560, y: 300 });
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

// The exported formula's positions, its one overbar line and the saved runs
// are positioned-rich-text's ("stacks I sub n2 and sup 2 at one attachment
// column under one exact overbar") and drafting-render's ("renders a squared
// subscript under one explicit overbar"); a PNG rasterizes that same SVG.
test("stacks complementary scripts under one uninterrupted overbar while editing", async ({
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
  await expect(page.locator('[data-text-decoration="overbar"]')).toHaveCount(1);
});

// A Net Label drawn under an overbar names the complement Net (text-editing's
// "names a signal's complement when its label gains or loses an overbar"),
// round trips without the marker and keeps or drops its bar on rename
// (identifier-text), and is spelled so in SPICE and Spectre
// (label-name-matrix).

import { expect, test, type Locator, type Page } from "@playwright/test";
import { createEmptyProject, createRoutePath } from "@icm/model";

import { EDITOR_SHORTCUT_REFERENCE } from "../src/interaction/editor-shortcut-reference";
import {
  revealPropertiesShelf,
  awaitEditorReady,
  chooseComponent,
  clickCommand,
  downloadBytes,
  editComponentPropertyCode,
  setComponentCodeField,
  expectComponentCodeField,
  expectStatus,
  openProject,
  openProjectFile,
  parseSavedProject,
  placeComponentAt,
  placeResistors,
  readComponentPropertyCode,
  readDocumentStyleCode,
  readRecoveryRecords,
  openEditor,
  awaitTwoFrames,
} from "./editor-fixtures.js";
import {
  exportedDocument,
  openPlacedProperties,
  openSelectionShelf,
  readComponentCode,
} from "./manual-editor-fixtures.js";
import { placedInstance, onScreen } from "./canvas-fixtures.js";

// These tests assert device behavior against decoded content, independently
// of the current portable field spelling and structural shorthand.
async function recoveryProjectTexts(page: import("@playwright/test").Page) {
  const records = await readRecoveryRecords(page);
  return records
    .map((record) =>
      JSON.stringify(parseSavedProject(record.projectText), null, 2),
    )
    .join("\n");
}

const storedItem = (page: Page, key: string) =>
  page.evaluate((key) => localStorage.getItem(key), key);

// The plainest gate. component-property-code-edits.test.ts covers all six
// configurable gates, shrinking after a disconnect and the shrink refusals.
test("a gate's input count changes drawn pins and black-box target together", async ({
  page,
}) => {
  await openPlacedProperties(page, "and-gate", { x: 360, y: 230 }, "hit-X1");
  expect((await readComponentCode(page)).inputs).toBe(2);
  await editComponentPropertyCode(page, (code) => {
    code.inputs = 4;
  });
  await expect(page.getByTestId("terminal-X1-C")).toHaveCount(1);
  await expect(page.getByTestId("terminal-X1-D")).toHaveCount(1);
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"name": "and_gate_4"');
  await page.getByLabel("Inputs options").selectOption("3");
  await expect(page.getByTestId("terminal-X1-D")).toHaveCount(0);
  await expectComponentCodeField(page, "inputs", 3);
});

test("C copy shows alignment guides, commits the preview and clears guides on Escape", async ({
  page,
}) => {
  const project = createEmptyProject("copy-guides", "Copy guides");
  project.documents[0]!.instances = [
    placedInstance("R1", "resistor", 300, 200),
  ];
  await openProject(page, project, "copy-guides.icproj.json");
  // Import fits this single part tightly; leave room for both copy destinations.
  for (let step = 0; step < 7; step += 1)
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const canvas = page.getByTestId("schematic-canvas");
  const screenPoint = async (x: number, y: number) =>
    (await onScreen(canvas, [{ x, y }]))[0];
  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("c");
  const horizontal = await screenPoint(500, 202);
  await page.mouse.move(horizontal.x, horizontal.y);
  const ghost = page.getByTestId("copy-placement-preview");
  const guideY = page.getByTestId("snap-guide-y");
  await expect(ghost).toHaveAttribute("transform", "translate(200 0)");
  await expect(guideY).toHaveCount(1);
  expect(Number(await guideY.getAttribute("x2"))).toBeGreaterThan(500);
  await expect(page.getByTestId("revision")).toHaveText("0");

  const beforeRotation = await guideY.getAttribute("y1");
  await page.keyboard.press("r");
  // A turn under a stationary pointer must refresh the pin/edge guides too.
  await expect(guideY).not.toHaveAttribute("y1", beforeRotation!);
  await expect(
    ghost.locator('[data-object-id="R1_2"] > g').first(),
  ).toHaveAttribute("transform", /rotate\(90\)/);
  await page.keyboard.press("Shift+r");
  await expect(guideY).toHaveCount(1);
  // Both mirror chords turn the copy preview before it commits.
  const copied = ghost.locator('[data-object-id="R1_2"] > g').first();
  await expect(copied).toHaveAttribute("transform", /scale\(-1 1\)/u);
  await page.keyboard.press("Control+r");
  await expect(copied).toHaveAttribute("transform", /scale\(-1 -1\)/u);
  await page.keyboard.press("Control+r");
  await expect(copied).toHaveAttribute("transform", /scale\(-1 1\)/u);

  const away = await screenPoint(457, 287);
  await page.mouse.move(away.x, away.y);
  await expect(page.locator(".smart-snap-guide")).toHaveCount(0);

  const vertical = await screenPoint(302, 400);
  await page.mouse.move(vertical.x, vertical.y);
  await expect(ghost).toHaveAttribute("transform", "translate(0 200)");
  await expect(page.getByTestId("snap-guide-x")).toHaveCount(1);
  expect(
    Number(await page.getByTestId("snap-guide-x").getAttribute("y2")),
  ).toBeGreaterThan(400);
  const screenOrigin = async (locator: typeof ghost) =>
    (await onScreen(locator.first(), [{ x: 0, y: 0 }]))[0];
  const preview = await screenOrigin(copied);
  await page.mouse.click(vertical.x, vertical.y);
  const placed = await screenOrigin(
    canvas.locator('[data-layer="symbols"] [data-object-id="R1_2"] > g'),
  );
  expect(placed.x).toBeCloseTo(preview.x, 4);
  expect(placed.y).toBeCloseTo(preview.y, 4);
  await expect(page.getByTestId("revision")).toHaveText("1");
  // Repeated placement aligns to the newly stamped part as well as its source.
  const next = await screenPoint(500, 402);
  await page.mouse.move(next.x, next.y);
  await expect(guideY).toHaveCount(1);
  await page.mouse.move(100, 60);
  await expect(ghost).toHaveCount(0);
  await expect(page.locator(".smart-snap-guide")).toHaveCount(0);
  await page.mouse.move(next.x, next.y);
  await expect(guideY).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
  await expect(page.locator(".smart-snap-guide")).toHaveCount(0);
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("instance-count")).toHaveText("1");
});

test("blocks destructive browser refresh shortcuts while work is unsaved", async ({
  page,
}) => {
  await openEditor(page);
  const canvas = page.getByTestId("schematic-canvas");
  const status = page.getByTestId("status");
  const blocked = "Refresh blocked to protect the current circuit";
  const expectGuardAlive = () =>
    expect(page.locator("body")).toHaveAttribute("data-refresh-guard", "alive");
  await expect(page.locator(".canvas-grid-dot").first()).toHaveCSS(
    "fill",
    "rgb(196, 199, 201)",
  );
  // A blank circuit has nothing to protect: the editor does not intercept
  // the refresh shortcut (a real browser would reload here; synthetic keys
  // cannot drive the browser accelerator, so assert the guard stays silent).
  await page.keyboard.press("Control+r");
  await expect(status).not.toHaveText(blocked);

  // With meaningful content (three objects) the guard takes over. Clear the
  // selection first: Ctrl+R on a mirrorable selection means mirror, not
  // refresh.
  await placeResistors(page, [220, 320, 420], 220);
  await page.keyboard.press("Escape");
  await canvas.click({ position: { x: 60, y: 60 } });
  await page.evaluate(() => {
    document.body.dataset.refreshGuard = "alive";
  });
  await page.keyboard.press("Control+r");
  await expect(status).toHaveText(blocked);
  await expectGuardAlive();

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").focus();
  await page.keyboard.press("F5");
  await expect(dialog).toBeVisible();
  await expectGuardAlive();
  await page.keyboard.press("Escape");

  // Once an equally safe copy exists — here the exported Project file, the
  // same stamp a gallery publish leaves — the guards stand down: refresh is
  // no longer intercepted and File > New Project proceeds without the
  // unsaved-changes dialog.
  const download = page.waitForEvent("download");
  await clickCommand(page, "File", "Export Project File…");
  await download;
  await status.click({ trial: true }).catch(() => {});
  await page.keyboard.press("Escape");
  await canvas.click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("Control+r");
  await expect(status).not.toHaveText(blocked);
  await clickCommand(page, "File", "New Project");
  await expect(
    page.getByRole("dialog", { name: "Unsaved changes" }),
  ).toHaveCount(0);
  await expect(page.locator('[data-canvas-hit-kind="instance"]')).toHaveCount(
    0,
  );
});

test("the status bar toggles the grid, labelled full-width and an icon half-width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openEditor(page);
  const toggle = page.getByRole("button", { name: "Grid", exact: true });
  const label = toggle.locator(".statusbar-grid-label");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(label).toHaveText("Grid On");
  await expect(label).toBeVisible();
  await expect(page.getByTestId("canvas-grid-dots")).toBeVisible();

  await toggle.click();
  await expect(page.getByTestId("canvas-grid-dots")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(label).toHaveText("Grid Off");
  // Style settings show the state the status bar set.
  expect(JSON.parse(await readDocumentStyleCode(page)).canvas.showGrid).toBe(
    false,
  );
  await page.getByTestId("draw-tool-document-style").click();

  // A window snapped to half of a common desktop keeps only the icon.
  await page.setViewportSize({ width: 960, height: 800 });
  await expect(label).toBeHidden();
  expect((await toggle.boundingBox())!.width).toBeLessThanOrEqual(32);
  await toggle.click();
  await expect(page.getByTestId("canvas-grid-dots")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("a part set down beside a pin is pulled onto it and connects", async ({
  page,
}) => {
  // Placement reaches for a pin as far as a moved part or a wire end does.
  // With the quiet drawing radius a Pin put down a few pixels off a gate
  // landed a grid step away and stayed unconnected.
  await openEditor(page);
  await revealPropertiesShelf(page);
  const canvas = page.getByTestId("schematic-canvas");
  await placeComponentAt(page, "nmos", { x: 420, y: 300 });
  const [gate, box] = await Promise.all([
    page.getByTestId("terminal-M1-G").boundingBox(),
    canvas.boundingBox(),
  ]);
  if (!gate || !box) throw new Error("Gate is not measurable");
  await placeComponentAt(page, "port", {
    x: gate.x + gate.width / 2 - box.x,
    y: gate.y + gate.height / 2 - box.y - 6,
  });
  const document = await exportedDocument(page);
  const port = document.instances.find(
    (instance: { symbolId: string }) => instance.symbolId === "port",
  );
  const netOf = (instanceId: string, pinName: string) =>
    document.nets.find(
      (net: { terminals: { instanceId: string; pinName: string }[] }) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instanceId && terminal.pinName === pinName,
        ),
    )?.id;
  expect(netOf(port.id, "P")).toBeDefined();
  expect(netOf(port.id, "P")).toBe(netOf("M1", "G"));
});

test("new circuits open Library and Netlist, keep the saved preference, and mirror Library annotations in the menu", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("icm.library-panel-open.v1", "false");
  });

  await openEditor(page, "/editor?new=1");

  await expect(page.getByTestId("shapes-library-panel")).toHaveAttribute(
    "data-open",
    "true",
  );
  await expect(page.getByTestId("refresh-netlist-panel")).toBeVisible();
  for (const toggle of ["library-toggle", "netlist-panel-toggle"])
    await expect(page.getByTestId(toggle)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  await expect
    .poll(() => storedItem(page, "icm.library-panel-open.v1"))
    .toBe("false");
  const labelsOf = (locator: Locator) =>
    locator.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  const libraryEntries = await labelsOf(
    page.getByTestId("shapes-category-annotations").getByRole("button"),
  );
  await page.getByTestId("library-toggle").click();
  await page.getByTestId("netlist-panel-toggle").click();
  const menu = page.getByTestId("annotation-menu");
  const canvas = page.getByTestId("schematic-canvas");
  const drafted = canvas.locator('[data-testid^="drafting-hit-"]');
  const pickAnnotation = async (symbol: string) => {
    await menu.locator("summary").click();
    await menu.getByTestId(`annotation-shortcut-annotation-${symbol}`).click();
    await expect(menu).not.toHaveAttribute("open");
  };
  await menu.locator("summary").click();
  expect(await labelsOf(menu.getByRole("button"))).toEqual(libraryEntries);
  await page.keyboard.press("Escape");
  const drawingTools = [
    ["arrow", "arrow"],
    ["line", "construction-line"],
    ["rectangle", "rectangle"],
    ["circle", "circle"],
  ];
  for (const [index, [symbol, tool]] of drawingTools.entries()) {
    await pickAnnotation(symbol!);
    await expect(page.getByTestId("active-tool")).toHaveText(tool!);
    await canvas.click({ position: { x: 160 + index * 150, y: 400 } });
    await canvas.click({ position: { x: 240 + index * 150, y: 470 } });
    if (symbol === "arrow" || symbol === "line")
      await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(drafted).toHaveCount(index + 1);
  }
  for (const [index, symbol] of [
    "polarity-both",
    "text-plus",
    "text-minus",
    "ellipsis",
  ].entries()) {
    await pickAnnotation(symbol);
    await canvas.hover({ position: { x: 160 + index * 150, y: 560 } });
    // A minus is a stroked horizontal line with a zero-height SVG geometry
    // box; Playwright's visibility heuristic excludes it despite the stroke.
    await expect(page.getByTestId("text-placement-preview")).toBeAttached();
    await canvas.click({ position: { x: 160 + index * 150, y: 560 } });
    if (symbol === "polarity-both") {
      await page.getByRole("button", { name: "Apply text changes" }).click();
    }
    await page.keyboard.press("Escape");
    await expect(drafted).toHaveCount(index + 5);
  }
  await expect(canvas.locator('[data-polarity="both"]')).toBeVisible();
  await expect(canvas.locator('[data-polarity="positive"]')).toBeVisible();
  await expect(canvas.locator('[data-polarity="negative"]')).toBeVisible();
  await expect(canvas.locator('[data-layer="drafting"]')).toContainText("...");
});

test("keeps shortcuts hidden until the status-bar Hints control requests them", async ({
  page,
}) => {
  await page.goto("/editor");
  await revealPropertiesShelf(page);
  await awaitEditorReady(page);
  const hintsButton = page.getByTestId("statusbar-shortcut-hints");
  const shortcutHints = page.getByTestId("canvas-shortcut-hints");
  await expect(shortcutHints).toHaveCount(0);
  await expect(hintsButton).toHaveText("Hints");
  await expect(hintsButton).toHaveAttribute("aria-pressed", "false");
  const gridButton = page.getByTestId("statusbar-grid-toggle");
  const [hintsBounds, gridBounds] = await Promise.all([
    hintsButton.boundingBox(),
    gridButton.boundingBox(),
  ]);
  if (!hintsBounds || !gridBounds) {
    throw new Error("Status-bar controls are not measurable");
  }
  expect(hintsBounds.x + hintsBounds.width).toBeLessThan(gridBounds.x);

  await hintsButton.click();
  await expect(hintsButton).toHaveAttribute("aria-pressed", "true");
  await expect(shortcutHints).toBeVisible();
  await expect(shortcutHints).toHaveAttribute(
    "aria-label",
    "Keyboard shortcuts",
  );
  await expect(shortcutHints).toContainText("Keyboard shortcuts");
  await expect(shortcutHints.locator("li")).toHaveText(
    EDITOR_SHORTCUT_REFERENCE.map(({ keys, action }) => keys.join("") + action),
  );
  expect(
    (
      await shortcutHints
        .locator(".canvas-shortcut-list")
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    ).split(" ").length,
  ).toBeGreaterThan(1);
  expect(
    await shortcutHints.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const canvasBounds = element.parentElement?.getBoundingClientRect();
      if (!canvasBounds) throw new Error("Canvas panel is not measurable");
      return {
        top: style.top,
        right: style.right,
        rightGap: Math.round(canvasBounds.right - bounds.right),
        transform: style.transform,
      };
    }),
  ).toEqual({
    top: "12px",
    right: "12px",
    rightGap: 12,
    transform: "none",
  });

  const initialViewport = page.viewportSize();
  if (!initialViewport) throw new Error("Viewport is not measurable");
  await page.setViewportSize({ width: 720, height: 720 });
  const shortcutHintsBox = await shortcutHints.boundingBox();
  const canvasPanelBox = await page.locator(".canvas-panel").boundingBox();
  const propertiesBox = await page
    .getByRole("complementary", { name: "Properties" })
    .boundingBox();
  if (!shortcutHintsBox || !canvasPanelBox || !propertiesBox) {
    throw new Error("Narrow editor chrome is not measurable");
  }
  expect(
    Math.round(propertiesBox.x - (shortcutHintsBox.x + shortcutHintsBox.width)),
  ).toBe(12);
  expect(shortcutHintsBox.x).toBeGreaterThanOrEqual(canvasPanelBox.x + 11.5);
  await expect
    .poll(async () => {
      const [menu, panel] = await Promise.all([
        shortcutHints.boundingBox(),
        page.locator(".canvas-panel").boundingBox(),
      ]);
      if (!menu || !panel) return Number.POSITIVE_INFINITY;
      return menu.y + menu.height - (panel.y + panel.height - 11.5);
    })
    .toBeLessThanOrEqual(0);
  await page.setViewportSize(initialViewport);

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const search = dialog.getByLabel("Component search");
  await expect(search).toBeFocused();
  await search.fill("not-a-real-component");
  await expect(dialog.getByText("No matching components")).toBeVisible();
  await search.fill("mos");
  const before = await search.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  expect(await search.getAttribute("aria-activedescendant")).not.toBe(before);

  await search.fill("resistor");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  // The top match places at once; R turns its preview before the click.
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 360, y: 230 } });
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toHaveAttribute("transform", /rotate\(0\)/u);
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /rotate\(90\)/u);
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  // Hints stay up through placement until their control hides them.
  await expect(shortcutHints).toBeVisible();
  await hintsButton.click();
  await expect(shortcutHints).toHaveCount(0);
  await expect(hintsButton).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("i");
  // The grid reads in Library order, transistors first, not by recency.
  await expect(dialog.getByRole("option").first()).toHaveAttribute(
    "data-testid",
    "insert-component-nmos",
  );
});

test("category chips multi-select which kinds the quick pick shows", async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await expect(dialog.getByTestId("insert-component-nmos")).toBeVisible();

  // Hiding one category removes only its tiles.
  await dialog.getByTestId("insert-category-transistors").click();
  await expect(dialog.getByTestId("insert-component-nmos")).toHaveCount(0);
  await expect(dialog.getByTestId("insert-component-resistor")).toBeVisible();

  // The filter is a free multi-select, not a single choice.
  await dialog.getByTestId("insert-category-passives").click();
  await expect(dialog.getByTestId("insert-component-resistor")).toHaveCount(0);
  await expect(dialog.getByTestId("insert-component-and-gate")).toBeVisible();

  // Toggling back restores the tiles, and typing still filters afterwards.
  await dialog.getByTestId("insert-category-transistors").click();
  await expect(dialog.getByTestId("insert-component-nmos")).toBeVisible();
  await dialog.getByLabel("Component search").fill("nmos");
  await expect(dialog.getByTestId("insert-component-resistor")).toHaveCount(0);
  await expect(dialog.getByTestId("insert-component-nmos")).toBeVisible();

  // Clear all starts from zero: nothing shows until kinds are picked back.
  await dialog.getByLabel("Component search").fill("");
  await dialog.getByTestId("insert-category-clear").click();
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await expect(dialog.getByText("No matching components")).toBeVisible();
  await dialog.getByTestId("insert-category-logic-gates").click();
  await expect(dialog.getByTestId("insert-component-and-gate")).toBeVisible();
  await expect(dialog.getByTestId("insert-component-nmos")).toHaveCount(0);

  // Reopening resets to everything shown.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("i");
  await expect(dialog.getByTestId("insert-category-passives")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByTestId("insert-component-resistor")).toBeVisible();
});

test("edits the polarity label's text without losing its marks", async ({
  page,
}) => {
  await openEditor(page);
  const panel = page.getByTestId("shapes-library-panel");
  if ((await panel.getAttribute("data-open")) !== "true") {
    await page.getByTestId("library-toggle").click();
  }
  await page
    .getByTestId("shapes-category-annotations")
    .getByTestId("shapes-chip-annotation-polarity-both")
    .click();
  const canvas = page.getByTestId("schematic-canvas");
  // The empty-canvas Quick Start card occupies the upper-right area until the
  // first object lands. Start below it so this exercises the canvas rather
  // than asking a covered coordinate to produce a placement preview.
  await canvas.hover({ position: { x: 460, y: 520 } });
  const preview = page.getByTestId("text-placement-preview");
  await expect(preview).toBeVisible();
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /^translate\(/u);
  await expect(preview).not.toHaveAttribute("transform", /rotate/u);

  await canvas.click({ position: { x: 460, y: 520 } });
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText("Vx");
  await expect(editor.locator("sub")).toHaveText("x");
  await expect(editor).not.toContainText("_");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const polarity = canvas.locator('[data-polarity="both"]');
  const expectMarks = async () => {
    await expect(
      polarity.locator('[data-role^="polarity-positive"]'),
    ).toHaveCount(2);
    await expect(
      polarity.locator('[data-role="polarity-negative"]'),
    ).toHaveCount(1);
  };
  await expect(polarity).toBeVisible();
  await expect(polarity.locator("text")).toHaveText("Vx");
  await expect(polarity.locator('[data-text-run="subscript"]')).toHaveText("x");
  await expect(polarity.locator("text")).not.toContainText("_");

  await page.getByTestId("drafting-hit-polarity-1").dblclick();
  await expect(editor).toBeVisible();
  await editor.fill("VGS");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  await expect(polarity).toBeVisible();
  await expect(polarity).not.toHaveAttribute("transform", /rotate/u);
  await expectMarks();
  await expect(polarity.locator("text")).toContainText("VGS");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"polarity": "both"');

  // Deleting the center text keeps the polarity object: the + / − marks are
  // the component and the text is one removable part of it.
  await page.getByTestId("drafting-hit-polarity-1").dblclick();
  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+a");
  await editor.press("Delete");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(polarity).toBeVisible();
  await expectMarks();
  await expect(polarity.locator("text")).not.toContainText("VGS");
});

test("reopens I, starts Copy from retained selection without stacking modes, and Escape closes it from outside", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 360, y: 230 });
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("hit-R1").click();

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  // Closing the dialog is a state update, so a keystroke sent in the same tick
  // still lands in its search field. Wait for it to leave before typing.
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 560, y: 330 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);

  await page.keyboard.press("i");
  await expect(dialog).toBeVisible();
  // The dialog claims focus a frame after it opens, so an Escape pressed in
  // that gap is delivered elsewhere: it must not stay stuck open.
  await page.evaluate(() => {
    (
      document.querySelector(
        '[data-testid="draw-tool-wire"]',
      ) as HTMLElement | null
    )?.focus();
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("publishes placement cancellation synchronously before rapid Copy", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
  });
  await expect(
    page.getByRole("heading", { name: "Analog Canvas" }),
  ).toBeVisible();
  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 320, y: 240 } });
  // A fast physical Esc -> C sequence can arrive before React publishes a
  // render between the two native events. The command state must still see
  // the reducer transition synchronously, especially after MOS bulk-default
  // reconciliation makes the committed scene more expensive to derive.
  await page.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", bubbles: true }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "v", bubbles: true }),
    );
  });

  await canvas.hover({ position: { x: 400, y: 380 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
});

test("Enter confirms property code unchanged and Shift+Enter adds layout whitespace", async ({
  page,
}) => {
  await openPlacedProperties(page, "resistor", { x: 360, y: 230 }, "hit-R1");
  const propertyCode = page.getByLabel("Editable Canvas property code");
  // Enter confirms the current draft without changing its bytes. Shift+Enter
  // remains the explicit way to add layout whitespace inside the JSON.
  const singleLine = JSON.stringify(await readComponentCode(page));
  await propertyCode.fill(singleLine);
  await propertyCode.press("ControlOrMeta+End");
  await propertyCode.press("ArrowLeft");
  await propertyCode.press("Enter");
  expect(await readComponentPropertyCode(page)).toBe(singleLine);
  await propertyCode.press("Shift+Enter");
  const multiline = await readComponentPropertyCode(page);
  expect(multiline).toContain("\n}");
  expect(JSON.parse(multiline)).toEqual(JSON.parse(singleLine));
});

test("merges opamp body marks into one Library entry and property", async ({
  page,
}) => {
  await openPlacedProperties(page, "opamp", { x: 360, y: 230 }, "hit-X1");
  const body = page.locator("[data-symbol-id]").first();
  await expect(page.getByLabel("Amplifier placement actions")).toHaveCount(0);
  await expectComponentCodeField(page, "appearance.internalMark", "none");
  await page.getByRole("button", { name: "Use A internal mark" }).click();
  await expectComponentCodeField(page, "appearance.internalMark", "A");
  await expect(body).toHaveAttribute("data-symbol-id", "opamp-lettered");
  await setComponentCodeField(page, "appearance.internalMark", "G");
  await expect(
    page.locator('[data-symbol-id="opamp-lettered"] text', { hasText: "G" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove internal mark" }).click();
  await expectComponentCodeField(page, "appearance.internalMark", "none");
  await expect(body).toHaveAttribute("data-symbol-id", "opamp");
  await expectComponentCodeField(page, "symbol", undefined);
  await setComponentCodeField(page, "appearance.inputsSwapped", true);
  await expect(body).toHaveAttribute("data-symbol-id", "opamp-inputs-swapped");
  await expect(
    page.getByRole("button", { name: "Return component to Placement Tray" }),
  ).toHaveCount(0);
  const saved = await exportedDocument(page);
  expect(saved.instances[0].symbolId).toBe("opamp-inputs-swapped");
});

test("edits independent input and output swaps with undo, named connections and saved state", async ({
  page,
}) => {
  const project = createEmptyProject(
    "polarity-properties",
    "Polarity properties",
  );
  const document = project.documents[0]!;
  document.instances.push({
    ...placedInstance("X1", "opamp-differential-lettered", 360, 230),
    reference: "X1",
    signalFlowParameters: { formula: "G" },
  });
  for (const [pinName, x, y] of [
    ["IN+", 180, 240],
    ["IN-", 180, 220],
    ["OUT+", 520, 240],
    ["OUT-", 520, 220],
  ] as const) {
    const netId = `net-${pinName}`;
    const junctionId = `junction-${pinName}`;
    document.nets.push({
      id: netId,
      terminals: [{ instanceId: "X1", pinName }],
    });
    document.junctions.push({ id: junctionId, netId, position: { x, y } });
    document.routes.push(
      createRoutePath({
        id: `route-${pinName}`,
        netId,
        start: { kind: "terminal", instanceId: "X1", pinName },
        end: { kind: "junction", junctionId },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  await openProject(page, project, "polarity.icproj.json");
  await page.getByTestId("hit-X1").click();
  await openSelectionShelf(page);
  const inputs = page.getByRole("switch", { name: "Swap the + and - inputs" });
  const outputs = page.getByRole("switch", {
    name: "Swap the + and - outputs",
  });
  const amplifier = page.locator(
    '[data-layer="symbols"] [data-object-id="X1"]',
  );
  const terminalY = async (pinName: string) =>
    (await page.getByTestId(`terminal-X1-${pinName}`).boundingBox())!.y;
  const initialInputY = await terminalY("IN+");
  const initialOutputY = await terminalY("OUT+");
  await expect(inputs).toHaveAttribute("aria-checked", "false");
  await expect(outputs).toHaveAttribute("aria-checked", "false");

  await inputs.click();
  await expect(amplifier).toHaveAttribute(
    "data-symbol-id",
    "opamp-differential-lettered-inputs-swapped",
  );
  await expect(outputs).toHaveAttribute("aria-checked", "false");
  expect(await terminalY("IN+")).toBeLessThan(initialInputY);
  expect(await terminalY("OUT+")).toBe(initialOutputY);
  await outputs.focus();
  await page.keyboard.press("Space");
  await expect(amplifier).toHaveAttribute(
    "data-symbol-id",
    "opamp-differential-crossed-lettered-inputs-swapped",
  );
  await expect(inputs).toHaveAttribute("aria-checked", "true");
  expect(await terminalY("OUT+")).toBeLessThan(initialOutputY);
  await expect(amplifier.locator("text", { hasText: "G" })).toBeVisible();

  await page.getByTestId("draw-tool-undo").click();
  await expect(outputs).toHaveAttribute("aria-checked", "false");
  await expect(inputs).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("draw-tool-redo").click();
  await expect(outputs).toHaveAttribute("aria-checked", "true");
  await setComponentCodeField(page, "appearance.inputsSwapped", false);
  await expect(amplifier).toHaveAttribute(
    "data-symbol-id",
    "opamp-differential-crossed-lettered",
  );
  await expect(outputs).toHaveAttribute("aria-checked", "true");
  await inputs.click();
  await expectComponentCodeField(page, "appearance.inputsSwapped", true);
  await setComponentCodeField(page, "rotation", 90);
  await setComponentCodeField(page, "mirror", "horizontal");
  await expectComponentCodeField(page, "appearance.outputsSwapped", true);

  const bytes = await downloadBytes(page, "File", "Export Project File…");
  const saved = parseSavedProject(bytes.toString("utf8"));
  expect(saved.documents[0].nets).toEqual(document.nets);
  expect(
    saved.documents[0].routes.map((route: { start: unknown }) => route.start),
  ).toEqual(document.routes.map((route) => route.start));
  expect(saved.documents[0].instances[0]).toMatchObject({
    symbolId: "opamp-differential-crossed-lettered-inputs-swapped",
    signalFlowParameters: { formula: "G" },
    placement: { rotation: 90, mirror: "horizontal" },
  });
  await openProjectFile(page, bytes, "reopen.icproj.json");
  await page.getByTestId("hit-X1").click();
  await openSelectionShelf(page);
  await expect(inputs).toHaveAttribute("aria-checked", "true");
  await expect(outputs).toHaveAttribute("aria-checked", "true");
  await expectComponentCodeField(page, "appearance.internalMark", "G");
  await page.getByRole("button", { name: "Defaults", exact: true }).click();
  await expect(inputs).toHaveAttribute("aria-checked", "false");
  await expect(outputs).toHaveAttribute("aria-checked", "false");
  await expect(amplifier).toHaveAttribute(
    "data-symbol-id",
    "opamp-differential",
  );
});

test("tiles the whole catalog into one flat quick-pick grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await openEditor(page);
  await page.keyboard.press("i");

  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const grid = dialog.locator(".insert-tile-grid");
  await expect(grid).toBeVisible();
  expect(
    await grid.evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe("auto");

  // One glance covers the library: the grid is flat (no category headings)
  // and every tile carries its own artwork. The widening test counts columns.
  await expect(grid.locator("h3, h4")).toHaveCount(0);
  const optionCount = await dialog.getByRole("option").count();
  expect(optionCount).toBeGreaterThan(20);
  expect(await grid.locator("svg.insert-symbol-artwork").count()).toBe(
    optionCount,
  );
  // There is no separate confirm step to fit in: the footer is a hint line,
  // and it stays inside the dialog bounds.
  await expect(dialog.getByRole("button", { name: "Apply" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  const bounds = await dialog.evaluate((element) => {
    const footer = element.querySelector(".insert-dialog-actions")!;
    return {
      dialogBottom: element.getBoundingClientRect().bottom,
      footerBottom: footer.getBoundingClientRect().bottom,
    };
  });
  expect(bounds.footerBottom).toBeLessThanOrEqual(bounds.dialogBottom);

  // Clicking a tile starts placement immediately.
  await dialog.getByTestId("insert-component-inductor").click();
  await expect(dialog).toHaveCount(0);
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 360, y: 230 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  // Double-clicking a tile applies it at once, too.
  await page.keyboard.press("i");
  await dialog.getByTestId("insert-component-resistor").dblclick();
  await expect(dialog).toHaveCount(0);
  await expectStatus(page, "Place Resistor on the canvas");
  await page.keyboard.press("Escape");
});

test("widens the Insert picker and adds columns with the editor viewport", async ({
  page,
}) => {
  const measurePicker = async () => {
    const dialog = page.getByRole("dialog", { name: "Insert Component" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    if (!box) throw new Error("Insert Component dialog is not measurable");
    const firstTop = await dialog
      .getByRole("option")
      .first()
      .evaluate((element) => (element as HTMLElement).offsetTop);
    const columns = await dialog
      .locator(".insert-tile-grid")
      .evaluate(
        (element, top) =>
          Array.from(
            element.querySelectorAll<HTMLElement>('[role="option"]'),
          ).filter((option) => option.offsetTop === top).length,
        firstTop,
      );
    return { width: box.width, columns };
  };

  // A window snapped to half of a common desktop uses its complete available
  // width apart from the 20px modal gutter on each side.
  await page.setViewportSize({ width: 960, height: 800 });
  await openEditor(page);
  await page.keyboard.press("i");
  const halfScreen = await measurePicker();
  const rootFontSize = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(halfScreen.width).toBe(960 - rootFontSize * 2.5);

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press("i");
  const fullScreen = await measurePicker();

  expect(fullScreen.width).toBe(rootFontSize * 96);
  expect(fullScreen.width).toBeGreaterThan(halfScreen.width + 250);
  expect(fullScreen.columns).toBeGreaterThan(halfScreen.columns);
});

// A preview whose pin names sit away from the cursor.
test(`places a D flip-flop on the first click with slight pointer drift over its preview`, async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "d-flip-flop");
  const canvas = page.getByTestId("schematic-canvas");
  const box = (await canvas.boundingBox())!;
  const instances = canvas.locator('[data-canvas-hit-kind="instance"]');

  // Separate move/down/up events let the ghost render beneath the pointer.
  // A single mouse.click() can beat that render and hide this regression.
  for (const [index, x] of [320, 520, 520].entries()) {
    await page.mouse.move(box.x + x, box.y + 230);
    await expect(page.getByTestId("component-placement-preview")).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(box.x + x + 1, box.y + 231);
    await awaitTwoFrames(page);
    await page.mouse.up();
    await expect(instances).toHaveCount(index + 1);
    await expect(page.getByTestId("revision")).toHaveText(String(index + 1));
    await expect(page.getByTestId("component-input-plane")).toBeVisible();
  }

  // Upright formulas and pin names must be as transparent to input as the
  // body, including names away from the cursor at the symbol origin.
  const previewText = canvas.locator('[data-layer="editor-overlay"] text');
  expect(await previewText.count()).toBeGreaterThan(0);
  for (const text of await previewText.all()) {
    await expect(text).toHaveCSS("pointer-events", "none");
  }
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-placement-preview")).toHaveCount(0);
  await expect(instances).toHaveCount(3);
});

test("shows the complete foldable categorized Library, quick-places a device, and restores state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await openEditor(page);
  const panel = page.getByTestId("shapes-library-panel");
  const canvas = page.getByTestId("schematic-canvas");
  const libraryChips = panel.locator('[data-testid^="shapes-chip-"]');

  await expect(panel).toHaveAttribute("data-open", "true");
  // The panel toggles lead the drawing toolbar on one row, Examples first.
  const [examplesBox, libraryBox] = await Promise.all(
    ["examples-toggle", "library-toggle"].map((id) =>
      page.getByTestId(id).boundingBox(),
    ),
  );
  expect(examplesBox!.y).toBe(libraryBox!.y);
  expect(examplesBox!.x).toBeLessThan(libraryBox!.x);
  const transistorCategory = page.getByTestId("shapes-category-transistors");
  const transistorChips = transistorCategory.locator(
    '[data-testid^="shapes-chip-"]',
  );
  // Keep the everyday transistor palette compact; the two diode tiles live
  // in Extended Devices below.
  await expect(transistorChips).toHaveCount(4);
  const transistorGrid = transistorCategory.locator(".shapes-grid");
  // Tiles keep a fixed square size; a wider panel fits more of them per row
  // instead of stretching each tile.
  const tileBox = await transistorChips.first().boundingBox();
  if (!tileBox) throw new Error("Library tile is not measurable");
  expect(Math.round(tileBox.width)).toBe(Math.round(tileBox.height));
  const gridBox = await transistorGrid.boundingBox();
  if (!gridBox) throw new Error("Library grid is not measurable");
  const columns = (
    await transistorGrid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns,
    )
  ).split(" ").length;
  expect(columns).toBe(Math.floor((gridBox.width + 4) / (tileBox.width + 4)));
  expect(
    await transistorChips.evaluateAll(
      (elements) =>
        new Set(
          elements.map((element) =>
            Math.round(element.getBoundingClientRect().top),
          ),
        ).size,
    ),
  ).toBe(Math.ceil(4 / columns));
  // Every tile sits inside its grid, 56px high, with 40x32 artwork centred
  // above a label that fits; list the tiles that break any of it.
  expect(
    await libraryChips.evaluateAll((tiles) =>
      tiles.flatMap((tile) => {
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
        const box = tile.getBoundingClientRect();
        const art = tile
          .querySelector<SVGElement>(".shapes-chip-art")
          ?.getBoundingClientRect();
        const span = tile.querySelector<HTMLElement>("span");
        const label = span?.getBoundingClientRect();
        const centre = box.left + box.width / 2;
        const grid = tile.closest(".shapes-grid")!.getBoundingClientRect();
        const fits =
          box.left >= grid.left - 0.5 &&
          box.right <= grid.right + 0.5 &&
          art &&
          span &&
          label &&
          near(box.height, 56) &&
          near(art.width, 40) &&
          near(art.height, 32) &&
          near(art.left + art.width / 2, centre) &&
          near(label.left + label.width / 2, centre) &&
          near(
            (Math.min(art.top, label.top) +
              Math.max(art.bottom, label.bottom)) /
              2,
            box.top + box.height / 2,
          ) &&
          art.left >= box.left - 0.5 &&
          art.right <= box.right + 0.5 &&
          art.top >= box.top - 0.5 &&
          art.bottom <= label.top + 0.5 &&
          label.height <= 12.5 &&
          span.scrollWidth <= span.clientWidth + 1 &&
          span.scrollHeight <= span.clientHeight + 1;
        return fits ? [] : [tile.getAttribute("data-testid")];
      }),
    ),
  ).toEqual([]);
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  const analogCategory = page.getByTestId("shapes-category-analog-blocks");
  await expect(analogCategory).toHaveJSProperty("open", true);

  await page.getByTestId("shapes-chip-resistor").click();
  await canvas.hover({ position: { x: 280, y: 220 } });
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toBeVisible();
  await page.keyboard.press("Shift+R");
  await expect(preview).toHaveAttribute("transform", /scale\(-1 1\)/u);
  await canvas.click({ position: { x: 280, y: 220 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(
    canvas.locator('[data-object-id="R1"] > g').first(),
  ).toHaveAttribute("transform", /scale\(-1 1\)/u);
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  await expect(analogCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await expect(page.getByTestId("shapes-chip-nmos")).toBeVisible();

  await page.keyboard.press("q");
  await expectComponentCodeField(page, "parameters.value", "1k");
  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect
    .poll(() => storedItem(page, "icm.library-panel-open.v1"))
    .toBe("false");

  await page.reload();
  await awaitEditorReady(page);
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect
    .poll(() => storedItem(page, "icm.recent-components.v1"))
    .toContain("resistor");
});

test("keeps a usable canvas while toggling Library at the narrow breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await openEditor(page);

  const panel = page.getByTestId("shapes-library-panel");
  const canvas = page.getByTestId("schematic-canvas");
  await expect(panel).toHaveAttribute("data-open", "false");
  const canvasWidth = async () => (await canvas.boundingBox())?.width ?? 0;
  const closedWidth = await canvasWidth();
  expect(closedWidth).toBeGreaterThan(600);

  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(panel.getByText("All", { exact: true })).toBeVisible();
  // The panel cannot take more than its share of the narrow window.
  const panelWidth = (await panel.boundingBox())?.width ?? 0;
  expect(panelWidth).toBeLessThanOrEqual(720 * 0.6);
  await expect.poll(canvasWidth).toBeLessThan(closedWidth);
  const openWidth = await canvasWidth();
  expect(openWidth).toBeGreaterThan(450);

  await revealPropertiesShelf(page);
  await page.getByTestId("selection-shelf").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect.poll(canvasWidth).toBeCloseTo(closedWidth, 0);
  expect(
    await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      vertical:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false });
});

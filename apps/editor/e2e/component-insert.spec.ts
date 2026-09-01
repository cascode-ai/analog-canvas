import { expect, test } from "@playwright/test";

import {
  awaitEditorReady,
  chooseComponent,
  clickCommand,
  downloadBytes,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

async function openSelectionShelf(page: import("@playwright/test").Page) {
  const shelf = page.getByTestId("selection-shelf");
  await expect(shelf).toBeVisible();
  if ((await shelf.getAttribute("aria-expanded")) !== "true") {
    await shelf.click();
  }
}

test("blocks destructive browser refresh shortcuts and uses the stronger grid", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.locator(".canvas-grid-dot").first()).toHaveCSS(
    "fill",
    "rgb(196, 199, 201)",
  );
  // A blank circuit has nothing to protect: the editor does not intercept
  // the refresh shortcut (a real browser would reload here; synthetic keys
  // cannot drive the browser accelerator, so assert the guard stays silent).
  await awaitEditorReady(page);
  await page.keyboard.press("Control+r");
  await expect(page.getByTestId("status")).not.toHaveText(
    "Refresh blocked to protect the current circuit",
  );

  // With meaningful content (three objects) the guard takes over. Clear the
  // selection first: Ctrl+R on a mirrorable selection means mirror, not
  // refresh.
  for (const x of [220, 320, 420]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 220 } });
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("Escape");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await page.evaluate(() => {
    document.body.dataset.refreshGuard = "alive";
  });
  await page.keyboard.press("Control+r");
  await expect(page.getByTestId("status")).toHaveText(
    "Refresh blocked to protect the current circuit",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-refresh-guard",
    "alive",
  );

  await page.getByRole("button", { name: "Hide background dots" }).click();
  await expect(page.getByTestId("canvas-grid-dots")).toHaveCount(0);
  await page.getByRole("button", { name: "Show background dots" }).click();
  await expect(page.getByTestId("canvas-grid-dots")).toBeVisible();

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").focus();
  await page.keyboard.press("F5");
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-refresh-guard",
    "alive",
  );
  await page.keyboard.press("Escape");

  // Once an equally safe copy exists — here the exported Project file, the
  // same stamp a gallery publish leaves — the guards stand down: refresh is
  // no longer intercepted and File > New Project proceeds without the
  // unsaved-changes dialog.
  const download = page.waitForEvent("download");
  await clickCommand(page, "File", "Export Project File…");
  await download;
  await page
    .getByTestId("status")
    .click({ trial: true })
    .catch(() => {});
  await page.keyboard.press("Escape");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("Control+r");
  await expect(page.getByTestId("status")).not.toHaveText(
    "Refresh blocked to protect the current circuit",
  );
  await clickCommand(page, "File", "New Project");
  await expect(
    page.getByRole("dialog", { name: "Unsaved changes" }),
  ).toHaveCount(0);
  await expect(page.locator('[data-canvas-hit-kind="instance"]')).toHaveCount(
    0,
  );
});

test("mirrors component and copy placement previews before their commits", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 320, box.y + 220);
  const componentPreview = page.getByTestId("component-placement-preview");
  await page.keyboard.press("Shift+R");
  await expect(componentPreview).toHaveAttribute("transform", /scale\(-1 1\)/u);
  await canvas.click({ position: { x: 320, y: 220 } });
  await page.keyboard.press("Escape");

  const placedSymbol = canvas.locator('[data-object-id="R1"] > g').first();
  await expect(placedSymbol).toHaveAttribute("transform", /scale\(-1 1\)/u);

  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("c");
  await page.mouse.move(box.x + 520, box.y + 220);
  const copyPreview = page
    .getByTestId("copy-placement-preview")
    .locator("[data-object-id] > g")
    .first();
  await page.keyboard.press("Control+r");
  await expect(copyPreview).toHaveAttribute("transform", /rotate\(180\)/u);
  await canvas.click({ position: { x: 520, y: 220 } });
  await expect(
    canvas.locator('[data-object-id="R1-copy-1"] > g').first(),
  ).toHaveAttribute("transform", /rotate\(180\)/u);
  await expect(canvas.getByText("R2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("writes an Instance Reference through post-placement Properties", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByTestId("insert-component-resistor").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 220 } });
  await page.keyboard.press("Escape");

  // The quick pick carries no reference field; naming happens in Properties.
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("selection-shelf").click();
  const instanceReference = page.getByLabel("Component reference");
  await instanceReference.fill("R7");
  await instanceReference.press("Tab");

  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"reference": "R7"');
});

test("returns a component to the Placement Tray and places the retained Instance again", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 320, y: 220 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("selection-shelf").click();

  await page
    .getByRole("button", { name: "Return component to Placement Tray" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Placement Tray" })
      .getByLabel("1 retained Instance"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Placement Tray" }),
  ).not.toContainText("drag to the canvas");
  await expect(page.getByTestId("unplaced-R1")).toContainText("R1 · resistor");
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Place R1 · resistor from tray" })
    .click();
  await canvas.hover({ position: { x: 480, y: 260 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 480, y: 260 } });

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Placement Tray" })
      .getByLabel("0 retained Instances"),
  ).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("3");

  await page.getByTestId("hit-R1").click();
  await page
    .getByRole("button", { name: "Return component to Placement Tray" })
    .click();
  await page
    .getByRole("region", { name: "Placement Tray" })
    .getByRole("button", { name: "Place all" })
    .click();

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("5");
});

test("refreshes explicitly only after flushing and automatically restoring recovery", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");

  const navigated = page.waitForEvent("framenavigated");
  await clickCommand(page, "File", "Refresh app");
  await navigated;

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toHaveText(
    "Restored recovery revision 1",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("icm.restore-after-refresh.v1"),
      ),
    )
    .toBeNull();
});

test("refresh restores the circuit when the session started from a boot-target URL", async ({
  page,
}) => {
  // location.reload() keeps the entry URL, so the ?new=1 boot target re-runs
  // on the refreshed page. It must yield to the pending restore instead of
  // forking a fresh working copy that orphans the flushed snapshot.
  await page.goto("/editor?new=1");
  await expect(page.getByTestId("status")).toHaveText("Created a new Project");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");

  const navigated = page.waitForEvent("framenavigated");
  await clickCommand(page, "File", "Refresh app");
  await navigated;

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toHaveText(
    "Restored recovery revision 1",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("icm.restore-after-refresh.v1"),
      ),
    )
    .toBeNull();
});

test("keeps quick-start shortcuts in the upper-right corner until the first component is inserted", async ({
  page,
}) => {
  await page.goto("/editor");
  const quickStart = page.getByTestId("canvas-empty-state");
  await expect(quickStart).toBeVisible();
  await expect(quickStart).toHaveAttribute(
    "aria-label",
    "Quick start shortcuts",
  );
  await expect(quickStart).toContainText("Quick start");
  await expect(quickStart).toContainText("Cadence keys");
  await expect(quickStart.locator("li")).toHaveText([
    "FFit view",
    "IInsert component",
    "RRotate",
    "MMove selection",
    "ShiftMMove without wires",
    "UUndo",
    "PPlace Cell Pin",
    "CCopy selection",
    "QProperties",
    "WDraw wire",
    "LEdit Net Label",
    "ShiftRMirror left / right",
    "CtrlRMirror top / bottom",
    "EscCancel tool",
    "ShiftURedo",
  ]);
  await expect(quickStart.locator(".canvas-shortcut-list")).toHaveCSS(
    "grid-template-columns",
    /^\d+(?:\.\d+)?px$/u,
  );
  expect(
    await quickStart.evaluate((element) => {
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
  const quickStartBox = await quickStart.boundingBox();
  const canvasPanelBox = await page.locator(".canvas-panel").boundingBox();
  const propertiesBox = await page
    .getByRole("complementary", { name: "Properties" })
    .boundingBox();
  if (!quickStartBox || !canvasPanelBox || !propertiesBox) {
    throw new Error("Narrow editor chrome is not measurable");
  }
  expect(
    Math.round(propertiesBox.x - (quickStartBox.x + quickStartBox.width)),
  ).toBe(12);
  expect(quickStartBox.x).toBeGreaterThanOrEqual(canvasPanelBox.x + 11.5);
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

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 360, box.y + 230);
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("transform", /rotate\(0\)/u);

  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /rotate\(90\)/u);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  await chooseComponent(page, "resistor");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(quickStart).toHaveCount(0);
  await page.getByTestId("selection-shelf").click();
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "R1 · resistor",
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.recent-components.v1")),
    )
    .toContain("resistor");

  await page.keyboard.press("i");
  const reopened = page.getByRole("dialog", { name: "Insert Component" });
  await expect(reopened.locator(".insert-tile-grid")).toBeVisible();
  // The grid reads in Library order — transistors first — not recency, even
  // though a resistor was just placed.
  await expect(reopened.getByRole("option").first()).toHaveAttribute(
    "data-testid",
    "insert-component-nmos",
  );
});

test("category chips multi-select which kinds the quick pick shows", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
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

test("groups and places high-voltage DMOS from Extended Devices", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  // The flat grid tiles both DMOS variants with their full names; clicking
  // one starts placement with the catalog defaults.
  await expect(dialog.getByTestId("insert-component-ndmos")).toContainText(
    "N-channel DMOS",
  );
  await expect(dialog.getByTestId("insert-component-pdmos")).toContainText(
    "P-channel DMOS",
  );

  await dialog.getByTestId("insert-component-ndmos").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator('[data-object-id="M1"][data-symbol-id="ndmos"]'),
  ).toBeVisible();
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"symbolId": "ndmos"');
  // Quick placement still carries the catalog defaults for the device.
  await expect.poll(() => recoveryProjectTexts(page)).toContain('"w": "1u"');
});

test("a signal-flow block lands with no designator on it", async ({ page }) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const panel = page.getByTestId("shapes-library-panel");
  if ((await panel.getAttribute("data-open")) !== "true") {
    await page.getByTestId("library-toggle").click();
  }

  const chip = page.getByTestId("shapes-chip-adder");
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 300, y: 200 } });
  await expect(page.getByTestId("revision")).toHaveText("1");

  // A summing junction is read by its shape; a diagram full of X1, X2, X3
  // says nothing a reader needs.
  await expect(canvas.locator('[data-kind="instance-label"]')).toHaveCount(0);
  await expect(canvas.locator("text")).toHaveCount(0);
  // Nor is one announced: the internal id stays bookkeeping.
  await expect(page.getByTestId("status")).not.toContainText("X1");
});

test("finds and places the discrete-time integrator from Signal Flow", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });

  await dialog.getByLabel("Component search").fill("discrete-time-integrator");
  const tile = dialog.getByTestId("insert-component-discrete-time-integrator");
  await expect(tile).toContainText("Discrete-Time Integrator");
  await tile.click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  await expect(
    page
      .getByTestId("schematic-canvas")
      .locator('[data-symbol-id="discrete-time-integrator"]'),
  ).toBeVisible();
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"symbolId": "discrete-time-integrator"');
});

test("groups drafting tools and editable polarity labels under Annotations", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const panel = page.getByTestId("shapes-library-panel");
  if ((await panel.getAttribute("data-open")) !== "true") {
    await page.getByTestId("library-toggle").click();
  }

  const annotations = page.getByTestId("shapes-category-annotations");
  await expect(annotations).toBeVisible();
  await expect(annotations.locator(".shapes-category-count")).toHaveText("8");
  // Drawing tools lead; the polarity label and the standalone sign texts
  // close the category. The one-sign-with-text variants no longer exist.
  expect(
    await annotations
      .locator(".shapes-chip")
      .evaluateAll((chips) =>
        chips.map((chip) => chip.getAttribute("data-testid")),
      ),
  ).toEqual([
    "shapes-chip-annotation-arrow",
    "shapes-chip-annotation-line",
    "shapes-chip-annotation-rectangle",
    "shapes-chip-annotation-circle",
    "shapes-chip-annotation-polarity-both",
    "shapes-chip-annotation-text-plus",
    "shapes-chip-annotation-text-minus",
    "shapes-chip-annotation-ellipsis",
  ]);

  // The Library entries reuse the authoritative toolbar tools rather than
  // creating fixed-size decorative symbols.
  await annotations.getByTestId("shapes-chip-annotation-arrow").click();
  await expect(page.getByTestId("draw-tool-arrow")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("draw-tool-arrow")).not.toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("draw-tool-rectangle")).toBeVisible();
  await expect(page.getByTestId("draw-tool-circle")).toBeVisible();

  await annotations.getByTestId("shapes-chip-annotation-polarity-both").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 460, y: 260 } });
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toBeVisible();
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /rotate\(90\)/u);

  await canvas.click({ position: { x: 460, y: 260 } });
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeVisible();
  await editor.fill("VGS");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const polarity = canvas.locator('[data-polarity="both"]');
  await expect(polarity).toBeVisible();
  await expect(polarity).toHaveAttribute("transform", /rotate\(90 /u);
  await expect(
    polarity.locator('[data-role^="polarity-positive"]'),
  ).toHaveCount(2);
  await expect(polarity.locator('[data-role="polarity-negative"]')).toHaveCount(
    1,
  );
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
  await expect(
    polarity.locator('[data-role^="polarity-positive"]'),
  ).toHaveCount(2);
  await expect(polarity.locator('[data-role="polarity-negative"]')).toHaveCount(
    1,
  );
  await expect(polarity.locator("text")).not.toContainText("VGS");

  // A standalone sign places directly from the Insert picker with no editor
  // popup, and lands as the same mark the pair draws rather than as a font's
  // glyph for the character — otherwise the two are different sizes side by
  // side.
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("minus");
  await dialog.getByTestId("insert-component-annotation-text-minus").click();
  await canvas.hover({ position: { x: 600, y: 260 } });
  await canvas.click({ position: { x: 600, y: 260 } });
  await expect(editor).toHaveCount(0);
  const loneMinus = canvas.locator('[data-polarity="negative"]');
  await expect(loneMinus).toBeVisible();
  await expect(
    loneMinus.locator('[data-role="polarity-negative"]'),
  ).toHaveCount(1);
  // Its arm is the pair's arm, measured rather than eyeballed.
  const armOf = (locator: ReturnType<typeof canvas.locator>) =>
    locator.evaluate((line) =>
      Math.abs(
        Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
      ),
    );
  expect(
    await armOf(loneMinus.locator('[data-role="polarity-negative"]')),
  ).toBe(await armOf(polarity.locator('[data-role="polarity-negative"]')));

  // Three dots use the canonical DraftText path. That makes each dot exactly
  // the current default font's period glyph and reuses the same generic text
  // selection frame instead of a symbol-specific box.
  await page.keyboard.press("i");
  await dialog.getByLabel("Component search").fill("three dots");
  await dialog.getByTestId("insert-component-annotation-ellipsis").click();
  await canvas.hover({ position: { x: 700, y: 260 } });
  await page.keyboard.press("r");
  await canvas.click({ position: { x: 700, y: 260 } });
  const ellipsis = canvas.locator('[data-kind="draft-text"]').filter({
    hasText: "...",
  });
  await expect(ellipsis).toBeVisible();
  await expect(ellipsis).toHaveText("...");
  await expect(ellipsis).toHaveAttribute("transform", /rotate\(90\b/u);
  await expect(
    canvas.locator('[data-testid^="drafting-hit-text-"]'),
  ).toHaveClass(/hit-target annotation-text-hit selected/u);
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"kind": "text"');
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"value": "..."');
});

test("places a vertical Power Rail from I and renames it on the canvas", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("vdd");
  await dialog.getByTestId("insert-component-vdd").click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 260, y: 140 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 260, y: 140 } });
  await canvas.click({ position: { x: 260, y: 380 } });
  await page.keyboard.press("Escape");

  // The quick pick always lands the default VDD name; the label is the
  // net-name authority, so editing it renames the rail to AVDD.
  await page.getByTestId("annotation-hit-label-VDD1").dblclick();
  const railEditor = page.getByRole("textbox", { name: "Canvas text editor" });
  await railEditor.fill("AVDD");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);
  await expect(page.getByTestId("instance-count")).toHaveText("0");
  const railPoints = await page
    .getByTestId("route-hit-route-vdd1-rail")
    .evaluate((element) =>
      Array.from((element as SVGPolylineElement).points).map((point) => ({
        x: point.x,
        y: point.y,
      })),
    );
  expect(new Set(railPoints.map((point) => point.x)).size).toBe(1);
  expect(railPoints.at(-1)!.y).not.toBe(railPoints[0]!.y);

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      nets: Array<{ id: string; name?: string; scope: string }>;
      connectivityEvidence: Array<{
        kind: string;
        netId: string;
        name?: string;
        scope?: string;
        powerDomain?: string;
      }>;
      routes: Array<{ netId: string; presentation?: string }>;
      annotations: Array<{
        kind: string;
        netId: string;
        binding?: { kind: string; netId?: string };
      }>;
    }>;
  };
  const document = saved.documents[0]!;
  const avddClaim = document.connectivityEvidence.find(
    (evidence) => evidence.kind === "name-claim" && evidence.name === "AVDD",
  );
  expect(avddClaim).toMatchObject({ scope: "global", powerDomain: "vdd" });
  const avdd = document.nets.find((net) => net.id === avddClaim!.netId);
  expect(avdd).toBeDefined();
  expect(document.routes).toContainEqual(
    expect.objectContaining({ netId: avdd!.id, presentation: "power-rail" }),
  );
  expect(document.annotations).toContainEqual(
    expect.objectContaining({
      kind: "power-label",
      netId: avdd!.id,
      binding: { kind: "net-name", netId: avdd!.id },
    }),
  );
});

test("places the VDD power-port device as the default VDD entry", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("vdd");
  const vddEntries = await dialog
    .locator(
      '[data-testid="insert-component-vdd-port"], [data-testid="insert-component-vdd"]',
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")),
    );
  // Both VDD entries stay reachable from one search, and the supply Port
  // leads its Rail rather than being separated from it by alphabetical order.
  expect(vddEntries).toEqual([
    "insert-component-vdd-port",
    "insert-component-vdd",
  ]);
  await dialog.getByTestId("insert-component-vdd-port").click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 300, y: 160 } });
  await canvas.click({ position: { x: 480, y: 260 } });
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-VDD1")).toBeVisible();
  await expect(page.getByTestId("hit-VDD2")).toBeVisible();
  await expect(canvas.locator('[data-symbol-id="vdd-port"]')).toHaveCount(2);
  await expect(canvas.getByText("VDD", { exact: true })).toHaveCount(2);
  await expect(page.getByTestId("instance-count")).toHaveText("2");

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      instances: Array<{ id: string; symbolId: string }>;
      nets: Array<{
        id: string;
        name?: string;
        scope: string;
        powerDomain?: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
      connectivityEvidence: Array<{
        kind: string;
        netId: string;
        name?: string;
        scope?: string;
        powerDomain?: string;
      }>;
      annotations: Array<{ id: string; kind: string; netId: string }>;
    }>;
  };
  const document = saved.documents[0]!;
  expect(document.instances.map((instance) => instance.symbolId)).toEqual([
    "vdd-port",
    "vdd-port",
  ]);
  const vddClaims = document.connectivityEvidence.filter(
    (evidence) =>
      evidence.kind === "name-claim" &&
      evidence.name === "VDD" &&
      evidence.powerDomain === "vdd",
  );
  expect(vddClaims).toHaveLength(2);
  expect(vddClaims).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ scope: "global" }),
      expect.objectContaining({ scope: "global" }),
    ]),
  );
  const vddTerminals = vddClaims
    .flatMap(
      (claim) =>
        document.nets.find((net) => net.id === claim.netId)?.terminals ?? [],
    )
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  expect(vddTerminals).toEqual([
    { instanceId: "VDD1", pinName: "P" },
    { instanceId: "VDD2", pinName: "P" },
  ]);
  expect(
    document.annotations
      .filter((annotation) => annotation.kind === "power-label")
      .map((annotation) => annotation.id),
  ).toEqual(["power-label-vdd1", "power-label-vdd2"]);
});

test("renames one supply marker without changing its same-name peer", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "vdd-port");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 300, y: 180 } });
  await canvas.click({ position: { x: 500, y: 180 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-VDD1").click();
  await openSelectionShelf(page);
  const name = page.getByRole("textbox", { name: "Supply name" });
  await name.fill("AVDD");
  await name.press("Tab");

  await expect(page.getByTestId("status")).toContainText("Supply named AVDD");
  await expect(
    canvas.locator('[data-object-id="power-label-vdd1"]'),
  ).toContainText("AVDD");
  await expect(
    canvas.locator('[data-object-id="power-label-vdd2"]'),
  ).toContainText("VDD");
});

test("reopens I and starts Copy from retained selection without stacking modes", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // Closing the dialog is a state update, so a keystroke sent in the same tick
  // still lands in its search field. Wait for it to leave before typing.
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toHaveCount(0);
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 560, y: 330 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
});

test("Escape closes the Insert dialog even when focus is outside it", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const dialog = page.getByRole("dialog", { name: "Insert Component" });

  await page.keyboard.press("i");
  await expect(dialog).toBeVisible();
  // The dialog claims focus a frame after it opens, so an Escape pressed in
  // that gap is delivered elsewhere. Reproduce that deterministically by
  // moving focus out, then dismiss: the dialog must not stay stuck open.
  await page.evaluate(() => {
    (
      document.querySelector(
        '[data-testid="draw-tool-wire"]',
      ) as HTMLElement | null
    )?.focus();
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press("i");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Copy shows its ghost under the cursor without waiting for a move", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();

  // The pointer is over the canvas and stays there: the ghost has to appear
  // from the remembered position rather than from the next pointer move.
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
});

test("publishes placement cancellation synchronously before rapid Copy", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  const symbols = ["nmos", "pmos", "resistor"] as const;

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
  });
  await expect(
    page.getByRole("heading", { name: "Analog Canvas" }),
  ).toBeVisible();

  for (const [index, symbolId] of symbols.entries()) {
    await chooseComponent(page, symbolId);
    await canvas.click({ position: { x: 320 + index * 150, y: 240 } });

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
    });

    await canvas.hover({ position: { x: 400 + index * 130, y: 380 } });
    await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  }
});

test("copies a MOS whose bulk belongs to a shared supply Net", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 280, y: 220 } });
  await page.keyboard.press("Escape");
  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 460, y: 220 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 620, y: 340 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 620, y: 340 } });
  await expect(page.getByTestId("hit-M1-copy-1")).toBeVisible();
  await expect(canvas.getByText("M3", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Analog Canvas" }),
  ).toBeVisible();
});

test("carries a manual Value through placement and Q property editing", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByTestId("insert-component-resistor").click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const placementControls = page.getByLabel("Component geometry");
  await expect(placementControls).toContainText("XY");
  await expect(
    placementControls.getByRole("button", {
      name: /Rotate component clockwise 90 degrees/,
    }),
  ).toBeVisible();
  await expect(
    placementControls.getByRole("button", {
      name: "Mirror component left to right, Shift+R",
    }),
  ).toBeVisible();
  await expect(
    placementControls.getByRole("button", {
      name: "Mirror component top to bottom, Ctrl+R",
    }),
  ).toBeVisible();
  expect(
    await placementControls.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(5);
  await expect(page.locator(".selection-overview")).toHaveCount(0);
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "R1 · resistor",
  );
  const displayCard = page.locator(".property-display-card");
  await expect(
    displayCard.getByLabel("Component display toggles"),
  ).toContainText("ReferenceValue");
  expect(
    await displayCard.evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      height: element.getBoundingClientRect().height,
      toggleBackgrounds: Array.from(
        element.querySelectorAll<HTMLElement>(".display-toggle"),
        (toggle) => getComputedStyle(toggle).backgroundColor,
      ),
    })),
  ).toEqual({
    columns: 2,
    height: expect.any(Number),
    toggleBackgrounds: ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"],
  });
  expect((await displayCard.boundingBox())?.height).toBeLessThan(48);
  await expect(page.getByText("Placement", { exact: true })).toBeVisible();
  const propertyValue = page.getByLabel("Component value");
  // Opening focuses the shelf header, never the first field: Q stays a pure
  // toggle and editing starts only when the user clicks an input.
  await expect(page.getByTestId("selection-shelf")).toBeFocused();
  await expect(propertyValue).not.toBeFocused();
  // Quick placement leaves the value blank; it arrives through Q editing.
  await expect(propertyValue).toHaveValue("");
  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(propertyValue).not.toBeFocused();
  await expect(propertyValue).toHaveValue("");
  await propertyValue.click();
  await expect(propertyValue).toBeFocused();
  await propertyValue.fill("10k");
  await expect(propertyValue).toHaveValue("10k");
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(
    page.getByRole("button", { name: "Apply component properties" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(propertyValue).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Discard changes" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Component identity")).toContainText(
    "ReferenceSymbolresistorCell",
  );
  await expect(page.getByLabel("Component identity")).not.toContainText(
    "Device class",
  );
  const instanceReference = page.getByLabel("Component reference");
  await expect(instanceReference).toHaveValue("R1");
  await instanceReference.fill("R7");
  await instanceReference.press("Tab");
  await expect(page.getByTestId("revision")).toHaveText("4");
  await expect(instanceReference).toHaveValue("R7");
  await page
    .locator("summary")
    .filter({ hasText: "Advanced parameters" })
    .click();
  await page.getByRole("button", { name: "Add parameter" }).click();
  await page.getByLabel("Additional parameter name 1").fill("tc");
  await page.getByLabel("Additional parameter value 1").fill("0.1");
  await page.getByRole("button", { name: "Apply parameters" }).click();
  await expect(page.getByTestId("revision")).toHaveText("5");
  await expect(page.getByLabel("Additional parameter name 1")).toHaveValue(
    "tc",
  );
  await expect(page.getByLabel("Additional parameter value 1")).toHaveValue(
    "0.1",
  );
});

test("keeps differential amplifier swaps in a dedicated placement row", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "opamp-differential");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-X1").click();
  await page.getByTestId("selection-shelf").click();

  const amplifierActions = page.getByLabel("Amplifier placement actions");
  await expect(
    amplifierActions.getByRole("button", { name: "Swap the + and - outputs" }),
  ).toBeVisible();
  await expect(
    amplifierActions.getByRole("button", { name: "Swap the + and - inputs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return component to Placement Tray" }),
  ).toBeVisible();
});

test("keeps the workspace inside the viewport and exposes low-interference zoom controls", async ({
  page,
}) => {
  await page.goto("/editor");

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

  const zoom = page.getByRole("status", { name: "Current zoom" });
  await expect(zoom).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText("100%");
  await page.getByRole("button", { name: "Fit view" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  const canvasBefore = await canvas.boundingBox();
  await page.getByTestId("selection-shelf").click();
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThan(canvasBefore?.width ?? 0);
});

test("tiles the whole catalog into one flat quick-pick grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");

  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const grid = dialog.locator(".insert-tile-grid");
  await expect(grid).toBeVisible();
  expect(
    await grid.evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe("auto");

  // One glance covers the library: the grid is flat (no category headings),
  // every tile carries its own artwork, and the grid packs several columns.
  await expect(grid.locator("h3, h4")).toHaveCount(0);
  const optionCount = await dialog.getByRole("option").count();
  expect(optionCount).toBeGreaterThan(20);
  expect(await grid.locator("svg.insert-symbol-artwork").count()).toBe(
    optionCount,
  );
  const firstTop = await dialog
    .getByRole("option")
    .first()
    .evaluate((element) => (element as HTMLElement).offsetTop);
  const sameRow = await grid.evaluate(
    (element, top) =>
      Array.from(
        element.querySelectorAll<HTMLElement>('[role="option"]'),
      ).filter((option) => option.offsetTop === top).length,
    firstTop,
  );
  expect(sameRow).toBeGreaterThan(3);

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
});

test("sets MOS parameters and orientation through the ghost and Properties", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");

  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("nmos");
  await dialog.getByTestId("insert-component-nmos").click();

  // Orientation is a ghost decision now: R rotates the placement preview.
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 360, box.y + 230);
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.getByTestId("component-placement-preview")).toHaveAttribute(
    "transform",
    /rotate\(90\)/u,
  );
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  // Parameters and label visibility are Properties decisions.
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("q");
  await expect(page.getByLabel("Component w", { exact: true })).toHaveValue(
    "1u",
  );
  await page.getByLabel("Component w", { exact: true }).fill("2u");
  await page.getByLabel("Component l", { exact: true }).fill("180n");
  await page.getByLabel("Component m", { exact: true }).fill("4");
  await page.getByLabel("Component m", { exact: true }).press("Tab");
  await page
    .getByRole("checkbox", { name: "Reference", exact: true })
    .uncheck();
  await expect(
    page.locator('[data-object-id="instance-label-M1"]'),
  ).toHaveCount(0);
  await expect(page.getByLabel("Component w", { exact: true })).toHaveValue(
    "2u",
  );
  await expect(page.getByLabel("Component l", { exact: true })).toHaveValue(
    "180n",
  );
  await expect(page.getByLabel("Component m", { exact: true })).toHaveValue(
    "4",
  );
  await expect(
    page.getByRole("button", {
      name: /Rotate component clockwise 90 degrees; current rotation 90 degrees/,
    }),
  ).toBeVisible();
});

test("keeps component placement active across independent canvas commits", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  // Enter places the top match straight from the search field.
  await page.keyboard.press("Enter");

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await canvas.dispatchEvent("click", {
    bubbles: true,
    detail: 0,
    clientX: box.x + 360,
    clientY: box.y + 230,
  });

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("component-input-plane")).toBeVisible();
  await canvas.click({ position: { x: 520, y: 230 } });
  await expect(page.getByTestId("hit-R2")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);
});

test("shows the complete foldable categorized Library, quick-places a device, and restores state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/editor");
  await awaitEditorReady(page);
  const panel = page.getByTestId("shapes-library-panel");
  const canvas = page.getByTestId("schematic-canvas");
  const libraryChips = panel.locator('[data-testid^="shapes-chip-"]');
  const categories = panel.locator('[data-testid^="shapes-category-"]');

  await expect(panel).toHaveAttribute("data-open", "true");
  const libraryChipCount = await libraryChips.count();
  expect(libraryChipCount).toBeGreaterThanOrEqual(35);
  await expect(categories).toHaveCount(10);
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
  expect(
    await transistorGrid.evaluate((element) => {
      const gridBounds = element.getBoundingClientRect();
      return [...element.children].every((child) => {
        const tileBounds = child.getBoundingClientRect();
        return (
          tileBounds.left >= gridBounds.left - 0.5 &&
          tileBounds.right <= gridBounds.right + 0.5
        );
      });
    }),
  ).toBe(true);
  const artworkGeometry = await libraryChips.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const tileBounds = tile.getBoundingClientRect();
      const artwork = tile.querySelector<SVGElement>(".shapes-chip-art");
      if (!artwork) throw new Error("Library artwork is missing");
      const artworkBounds = artwork.getBoundingClientRect();
      const label = tile.querySelector<HTMLElement>("span");
      if (!label) throw new Error("Library label is missing");
      const labelBounds = label.getBoundingClientRect();
      return {
        centerDeltaX:
          artworkBounds.left +
          artworkBounds.width / 2 -
          (tileBounds.left + tileBounds.width / 2),
        groupCenterDeltaY:
          (Math.min(artworkBounds.top, labelBounds.top) +
            Math.max(artworkBounds.bottom, labelBounds.bottom)) /
            2 -
          (tileBounds.top + tileBounds.height / 2),
        height: artworkBounds.height,
        labelFits:
          label.scrollWidth <= label.clientWidth + 1 &&
          label.scrollHeight <= label.clientHeight + 1,
        labelCenterDeltaX:
          labelBounds.left +
          labelBounds.width / 2 -
          (tileBounds.left + tileBounds.width / 2),
        labelHeight: labelBounds.height,
        separatedFromLabel: artworkBounds.bottom <= labelBounds.top + 0.5,
        tileHeight: tileBounds.height,
        withinTile:
          artworkBounds.left >= tileBounds.left - 0.5 &&
          artworkBounds.right <= tileBounds.right + 0.5 &&
          artworkBounds.top >= tileBounds.top - 0.5 &&
          artworkBounds.bottom <= tileBounds.bottom + 0.5,
        width: artworkBounds.width,
      };
    }),
  );
  expect(artworkGeometry.every((artwork) => artwork.withinTile)).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.width - 40) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.height - 32) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.centerDeltaX) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every(
      (artwork) => Math.abs(artwork.groupCenterDeltaY) <= 0.5,
    ),
  ).toBe(true);
  expect(
    artworkGeometry.every(
      (artwork) => Math.abs(artwork.labelCenterDeltaX) <= 0.5,
    ),
  ).toBe(true);
  expect(
    artworkGeometry.every(
      (artwork) => Math.abs(artwork.tileHeight - 56) <= 0.5,
    ),
  ).toBe(true);
  expect(artworkGeometry.every((artwork) => artwork.labelFits)).toBe(true);
  expect(artworkGeometry.every((artwork) => artwork.labelHeight <= 12.5)).toBe(
    true,
  );
  expect(artworkGeometry.every((artwork) => artwork.separatedFromLabel)).toBe(
    true,
  );
  await expect(libraryChips.locator("span")).toHaveCount(libraryChipCount);
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  const analogCategory = page.getByTestId("shapes-category-analog-blocks");
  await expect(analogCategory).toHaveJSProperty("open", true);
  await expect(
    page
      .getByTestId("shapes-category-power-and-ports")
      .locator('[data-testid^="shapes-chip-"]'),
  ).toHaveCount(5);
  await expect(
    page
      .getByTestId("shapes-category-passives")
      .locator('[data-testid^="shapes-chip-"]'),
  ).toHaveCount(4);
  await expect(
    page
      .getByTestId("shapes-category-logic-gates")
      .locator('[data-testid^="shapes-chip-"]'),
  ).toHaveCount(11);
  await expect(page.getByTestId("shapes-chip-buffer")).toBeAttached();
  await expect(page.getByTestId("shapes-chip-delay-cell")).toBeAttached();
  await expect(page.getByTestId("shapes-chip-d-flip-flop")).toBeAttached();
  // The Q-only flip-flop is its own part, so it browses beside its source.
  await expect(page.getByTestId("shapes-chip-d-flip-flop-q")).toBeAttached();
  const extendedCategory = page.getByTestId("shapes-category-extended-devices");
  await expect(
    extendedCategory.locator('[data-testid^="shapes-chip-"]'),
  ).toHaveCount(7);
  await expect(
    extendedCategory.getByTestId("shapes-chip-variable-resistor"),
  ).toBeVisible();
  await expect(
    extendedCategory.getByTestId("shapes-chip-variable-capacitor"),
  ).toBeVisible();
  await expect(
    extendedCategory.getByTestId("shapes-chip-variable-inductor"),
  ).toBeVisible();
  await expect(extendedCategory.getByTestId("shapes-chip-diode")).toBeVisible();
  await expect(
    extendedCategory.getByTestId("shapes-chip-zener-diode"),
  ).toBeVisible();
  await expect(extendedCategory).not.toContainText("High-voltage devices");
  await expect(
    panel.getByRole("button", { name: "Place Independent Voltage Source" }),
  ).toBeAttached();
  await expect(
    panel.getByRole("button", { name: "Place Variable Resistor" }),
  ).toBeAttached();

  await page.getByTestId("shapes-chip-resistor").click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 280, box.y + 220);
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 280, y: 220 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  // The Library has no Recent fold; the placed device stays reachable from
  // its own category chip.
  await expect(page.getByTestId("shapes-fold-recent")).toHaveCount(0);
  const resistorChip = page.getByTestId("shapes-chip-resistor");
  await expect(resistorChip).toHaveAttribute("aria-label", "Place Resistor");
  await expect(resistorChip.locator("span")).toHaveText("Res");
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  await expect(analogCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await expect(page.getByTestId("shapes-chip-nmos")).toBeVisible();

  await page.keyboard.press("q");
  await expect(page.getByLabel("Component value")).toHaveValue("");
  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.library-panel-open.v1")),
    )
    .toBe("false");

  await page.reload();
  await expect(page.getByTestId("shapes-library-panel")).toHaveAttribute(
    "data-open",
    "false",
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.recent-components.v1")),
    )
    .toContain("resistor");
});

test("opens named full-width Project examples from the toolbar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/editor");

  const libraryToggle = page.getByTestId("library-toggle");
  const examplesToggle = page.getByTestId("examples-toggle");
  const libraryTabBox = await libraryToggle.boundingBox();
  const examplesToggleBox = await examplesToggle.boundingBox();
  if (!libraryTabBox || !examplesToggleBox) {
    throw new Error("Library and Examples controls are not measurable");
  }
  // The panel toggles lead the horizontal drawing toolbar instead of standing
  // in a vertical rail, so they share a row and Examples comes first.
  expect(examplesToggleBox.y).toBe(libraryTabBox.y);
  expect(examplesToggleBox.x).toBeLessThan(libraryTabBox.x);
  expect(examplesToggleBox.x).toBeLessThanOrEqual(24);

  await examplesToggle.click();
  const panel = page.getByTestId("examples-panel");
  const exampleList = panel.locator(".shapes-example-list");
  const examples = exampleList.locator(".shapes-example-card");
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(examples).toHaveCount(4);
  expect(
    await exampleList.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(1);
  await expect(
    panel.getByTestId("shapes-example-common-source-amplifier"),
  ).toContainText("Common-Source Amplifier");
  await expect(
    panel.getByTestId("shapes-example-two-stage-op-amp"),
  ).toContainText("Two-Stage Op Amp");
  await expect(
    panel.getByTestId("shapes-example-current-mirror-loaded-differential-pair"),
  ).toContainText("Current-Mirror-Loaded Differential Pair");
  await expect(
    panel.getByTestId("shapes-example-fully-differential-two-stage-op-amp"),
  ).toContainText("Fully Differential Two-Stage Op Amp");

  await examplesToggle.click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(examplesToggle).toHaveAttribute("aria-expanded", "false");

  await examplesToggle.click();
  await expect(panel).toHaveAttribute("data-open", "true");

  // An example joins the drawing on the placement cursor; it never replaces
  // the canvas, so work already on it survives.
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 200, y: 150 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  const placedInstances = page.locator('[data-testid^="hit-"]');
  await expect(placedInstances).toHaveCount(1);

  await panel.getByTestId("shapes-example-common-source-amplifier").click();
  await expect(page.getByTestId("status")).toContainText(
    "Place Common-Source Amplifier on the canvas",
  );
  await canvas.click({ position: { x: 520, y: 320 } });
  await expect(page.getByTestId("status")).toContainText(
    "Copied 10 components",
  );
  await page.keyboard.press("Escape");
  // The example joined the drawing: the resistor that was already there stays.
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  const afterFirstExample = await placedInstances.count();
  expect(afterFirstExample).toBeGreaterThan(1);

  await panel.getByTestId("shapes-example-two-stage-op-amp").click();
  await expect(page.getByTestId("status")).toContainText(
    "Place Two-Stage Op Amp on the canvas",
  );
  // Land clear of the first example so the press commits the placement rather
  // than selecting something already drawn there.
  await canvas.click({ position: { x: 700, y: 460 } });
  await expect(page.getByTestId("status")).toContainText("Copied 7 components");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  expect(await placedInstances.count()).toBeGreaterThan(afterFirstExample);
});

test("keeps a usable canvas while toggling Library at the narrow breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto("/editor");
  await awaitEditorReady(page);

  const chrome = page.locator(".app-chrome-main");
  // The analytics readout lives in the statusbar now; the top bar ends
  // with Help inside the chrome bounds.
  const help = page.getByRole("button", { name: "Help" });
  await expect(help).toBeVisible();
  const chromeBox = await chrome.boundingBox();
  const helpBox = await help.boundingBox();
  if (!chromeBox || !helpBox) {
    throw new Error("Top navigation is not measurable");
  }
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(
    chromeBox.x + chromeBox.width,
  );

  const panel = page.getByTestId("shapes-library-panel");
  const canvas = page.getByTestId("schematic-canvas");
  await expect(panel).toHaveAttribute("data-open", "false");
  const closedWidth = (await canvas.boundingBox())?.width ?? 0;
  expect(closedWidth).toBeGreaterThan(600);

  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(panel.getByText("All", { exact: true })).toBeVisible();
  // The narrow layout keeps the dragged width authoritative rather than
  // pinning the panel to one cramped column, so several chips fit per row
  // while the panel still cannot take more than its share of the window.
  expect(
    await panel
      .locator(".shapes-grid")
      .first()
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
  ).toBeGreaterThanOrEqual(1);
  const panelWidth = (await panel.boundingBox())?.width ?? 0;
  expect(panelWidth).toBeLessThanOrEqual(720 * 0.6);
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThan(closedWidth);
  const openWidth = (await canvas.boundingBox())?.width ?? 0;
  expect(openWidth).toBeGreaterThan(450);

  await page.getByTestId("selection-shelf").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeCloseTo(closedWidth, 0);
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

test("double-clicking a placed device opens Properties for editing", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByTestId("insert-component-resistor").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.getByTestId("hit-R1").dblclick();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const propertyValue = page.getByLabel("Component value");
  await expect(propertyValue).toBeVisible();
  await expect(propertyValue).toBeFocused();
});

test("Library rail folds the sidebar; Insert opens the catalog", async ({
  page,
}) => {
  await page.goto("/editor");
  const panel = page.getByTestId("shapes-library-panel");
  await expect(panel).toHaveAttribute("data-open", "true");

  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "true");

  await page.getByTestId("shapes-insert").click();
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toHaveCount(0);

  // No title banner competes with the footer button or the shortcut.
  await expect(panel.getByRole("button", { name: /Quick place/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
});

test("double-clicking a catalog item applies it immediately", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByTestId("insert-component-resistor").dblclick();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "Place Resistor on the canvas",
  );
  await page.keyboard.press("Escape");
});

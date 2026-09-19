import type { SchematicDocument } from "@icm/model";
import { razaviProductSymbols } from "@icm/symbols";
import { expect, test } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  revealPropertiesShelf,
  awaitEditorReady,
  clickCommand,
  clickDrawTool,
  downloadBytes,
  editComponentPropertyCode,
  readComponentPropertyCode,
  setComponentParameter,
  setComponentCodeField,
  expectComponentCodeField,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";

test("property inspection and remounts keep canvas keyboard ownership", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 350, y: 220 });
  await placeComponent(page, "resistor", { x: 550, y: 320 });
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("hit-R1").dblclick();
  const code = page.getByLabel("Editable Canvas property code");
  await expect(code).toBeVisible();
  await expect(canvas).toBeFocused();
  await page.getByTestId("hit-R2").click();
  await expect(code).toContainText("R2");
  await expect(canvas).toBeFocused();
  await page.keyboard.press("r");
  await expectComponentCodeField(page, "rotation", 90);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R2")).toHaveCount(0);
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("hit-R2")).toHaveCount(1);
  await page.getByTestId("hit-R1").click();
  await expect(code).toContainText("R1");
  await expect(canvas).toBeFocused();
});

test("explicit property typing keeps Delete local and returns shortcuts to canvas", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 350, y: 220 });
  await page.getByTestId("hit-R1").dblclick();
  const code = page.getByLabel("Editable Canvas property code");
  await code.click();
  await expect(code).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(code).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await page.getByTestId("hit-R1").click();
  await expect(page.getByTestId("schematic-canvas")).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
});

test("live JSON properties update controls immediately and round-trip raw parameter strings", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await openSelectionShelf(page);
  const panel = page.getByRole("complementary", { name: "Properties" });
  await expect(
    panel.getByLabel("Component parameters and display"),
  ).toHaveCount(0);
  await expect(panel.getByLabel("Component actions")).toHaveCount(0);
  await expect(panel.getByLabel("Netlist target", { exact: true })).toHaveCount(
    0,
  );
  const revision = await page.getByTestId("revision").textContent();
  await expect(panel.getByRole("button", { name: "Apply code" })).toHaveCount(
    0,
  );
  await expect(panel.locator(".cm-property-unit")).toHaveCount(2);
  await expect(panel.getByLabel("Target netlist options")).toBeVisible();
  await editComponentPropertyCode(page, (code) => {
    code.rotation = 90;
    code.display.visualAnnotation = false;
  });
  await expect(page.getByTestId("revision")).toHaveText(
    String(Number(revision) + 1),
  );
  await panel.getByRole("button", { name: "Edit line color" }).click();
  await page.getByRole("button", { name: "Use Red for line" }).click();
  await expect(page.getByTestId("revision")).toHaveText(
    String(Number(revision) + 2),
  );
  const draft = JSON.parse(await readComponentPropertyCode(page));
  expect(draft.rotation).toBe(90);
  expect(draft.display.visualAnnotation).toBe(false);
  expect(draft.color).toEqual([220, 38, 38]);
  expect(draft.appearance ?? {}).not.toHaveProperty("foreground");
  expect(draft.appearance ?? {}).not.toHaveProperty("background");
  expect(draft.appearance ?? {}).not.toHaveProperty("fillColor");
  draft.parameters.w = "EV";
  draft.parameters.l = "L";
  draft.parameters.custom = "{raw_expression}";
  draft.display.value = true;
  await panel
    .getByLabel("Editable Canvas property code")
    .fill(JSON.stringify(draft, null, 2));
  await expect(page.getByTestId("revision")).toHaveText(
    String(Number(revision) + 3),
  );
  const value = page.locator(
    '[data-layer="formal"] [data-object-id="instance-value-M1"]',
  );
  await expect(value).toContainText("EV");
  await expect(value).not.toContainText("EVm");
  const source = await readComponentPropertyCode(page);
  expect(source).not.toContain("Clockwise");
  expect(source).not.toContain("Enter any unit");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances[0]).toMatchObject({
    netlist: { parameters: { w: "EV", l: "L", custom: "{raw_expression}" } },
    styleOverride: { foreground: "#dc2626" },
    placement: { rotation: 90 },
  });
  await clickCommand(page, "Edit", "Undo");
  await expectComponentCodeField(page, "parameters.w", "1u");
  await clickCommand(page, "Edit", "Redo");
  await expectComponentCodeField(page, "parameters.w", "EV");
  await page.getByTestId("project-file").setInputFiles({
    name: "raw.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "parameters.w", "EV");
});

test("live Defaults are undoable and invalid drafts never change the canvas", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await openSelectionShelf(page);
  await setComponentParameter(page, "w", "7u");
  const revision = await page.getByTestId("revision").textContent();
  await page.getByRole("button", { name: "Defaults", exact: true }).click();
  await expectComponentCodeField(page, "parameters.w", "1u");
  await expect(page.getByTestId("revision")).toHaveText(
    String(Number(revision) + 1),
  );
  await clickCommand(page, "Edit", "Undo");
  await expectComponentCodeField(page, "parameters.w", "7u");
  const code = page.getByLabel("Editable Canvas property code");
  const invalid = JSON.parse(await readComponentPropertyCode(page));
  const lastValidRevision = await page.getByTestId("revision").textContent();
  invalid.color = [256, 0, 0];
  await code.fill(JSON.stringify(invalid, null, 2));
  await expect(
    page.getByText(/Canvas keeps the last valid edit/u),
  ).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText(lastValidRevision!);
  await expect(
    page.getByRole("button", { name: "Edit line color" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("switch", {
      name: "Toggle visual annotation visibility",
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("switch", { name: "Toggle value visibility" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Rotate clockwise" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Mirror left to right" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Mirror top to bottom" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Target netlist options")).toBeDisabled();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expectComponentCodeField(page, "parameters.w", "7u");
  await expect(page.locator(".cm-json-key").first()).toBeVisible();
  await expect(page.locator(".cm-json-string").first()).toBeVisible();
});

test("one live JSON edit combines model, dimensions and appearance in one undo boundary", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.netlistTarget = "sky130_fd_pr__nfet_01v8";
    code.parameters.w = "5u";
    code.color = [20, 30, 40];
  });
  await expectComponentCodeField(page, "netlistName", "M1");
  await expectComponentCodeField(page, "parameters.w", "5u");
  await expectComponentCodeField(page, "color", [20, 30, 40]);
  await clickCommand(page, "Edit", "Undo");
  await expectComponentCodeField(page, "netlistName", "M1");
  await expectComponentCodeField(page, "parameters.w", "1u");
  await expectComponentCodeField(page, "color", "auto");
  await clickCommand(page, "Edit", "Redo");
  await expectComponentCodeField(page, "netlistName", "M1");
  await expectComponentCodeField(page, "parameters.w", "5u");
});

for (const platform of ["native", "Win32", "Linux x86_64"])
  test(`live typing preserves the caret, local undo and incomplete JSON (${platform})`, async ({
    page,
  }) => {
    if (platform !== "native")
      await page.addInitScript(
        (name) =>
          Object.defineProperty(navigator, "platform", { get: () => name }),
        platform,
      );
    const modifier = platform === "native" ? "ControlOrMeta" : "Control";
    await page.goto("/editor");
    await placeComponent(page, "nmos", { x: 360, y: 220 });
    await openSelectionShelf(page);
    const code = page.getByLabel("Editable Canvas property code");
    await editComponentPropertyCode(page, (value) => {
      value.display.value = true;
    });
    // Locate the width string through the actual editable DOM, then type normally.
    await code
      .locator(".cm-line")
      .filter({ hasText: '"w":' })
      .evaluate((line) => {
        const token = line.querySelector(".cm-json-string")!;
        const text = document
          .createTreeWalker(token, NodeFilter.SHOW_TEXT)
          .nextNode()!;
        const range = document.createRange();
        range.setStart(text, 1);
        range.setEnd(text, 3);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        (line.closest('[contenteditable="true"]') as HTMLElement).focus();
      });
    await page.keyboard.type("EV", { delay: 80 });
    const value = page.locator(
      '[data-layer="formal"] [data-object-id="instance-value-M1"]',
    );
    await expect(value).toContainText("EV");
    await page.keyboard.type("x", { delay: 80 });
    await expect(value).toContainText("EVx");
    await code.press(`${modifier}+z`);
    await expect(value).toContainText("1u");
    // Emit the actual shifted letter, not lowercase z with Shift held: the
    // latter is a synthetic layout event that CodeMirror interprets as Undo.
    await code.press(`${modifier}+Shift+Z`);
    await expect(value).toContainText("EVx");
    const raw = await readComponentPropertyCode(page);
    const revision = await page.getByTestId("revision").textContent();
    await code.fill(raw.slice(0, -1));
    await expect(
      page.getByText(/Canvas keeps the last valid edit/u),
    ).toBeVisible();
    await expect(value).toContainText("EVx");
    await expect(page.getByTestId("revision")).toHaveText(revision!);
    await code.press("Escape");
    await expect(code).not.toBeFocused();
    await expect(
      page.getByText(/Canvas keeps the last valid edit/u),
    ).toBeVisible();
    await expect(page.getByTestId("revision")).toHaveText(revision!);
    await code.press(`${modifier}+End`);
    await code.press("}");
    await expect(
      page.getByText(/Canvas keeps the last valid edit/u),
    ).toHaveCount(0);
    await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("revision")).toHaveText(revision!);
  });

for (const width of [300, 540]) {
  test(`plain selectable property code and inline controls at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript(
      (size) =>
        localStorage.setItem("icm.properties-panel-width.v1", String(size)),
      width,
    );
    await page.goto("/editor");
    await placeComponent(page, "pmos", { x: 360, y: 220 });
    await openSelectionShelf(page);
    const editor = page.getByTestId("component-property-code-editor");
    const code = page.getByLabel("Editable Canvas property code");
    const target = editor.getByLabel("Target netlist options");
    await target.selectOption("sky130_fd_pr__pfet_01v8");
    await expectComponentCodeField(
      page,
      "netlistTarget",
      "sky130_fd_pr__pfet_01v8",
    );
    const picker = editor.locator(".cm-netlist-target-picker");
    await expect(picker).toBeVisible();
    await expect(
      editor.locator(".cm-json-string").filter({
        hasText: '"sky130_fd_pr__pfet_01v8"',
      }),
    ).toHaveCount(1);
    // Only the JSON name is painted; the native menu occupies one icon button.
    await expect(target).toHaveCSS("opacity", "0");
    const pickerBox = await picker.boundingBox();
    expect(pickerBox!.width).toBeLessThanOrEqual(24);
    const editorBox = await editor.boundingBox();
    expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(
      editorBox!.x + editorBox!.width,
    );
    await target.focus();
    await expect(target).toBeFocused();
    await expect(picker).toHaveCSS("outline-style", "solid");
    const raw = await readComponentPropertyCode(page);

    await expect(editor.locator(".cm-property-assist")).toHaveCount(0);
    await expect(editor.locator(".cm-property-hint")).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: "Need help?", exact: true }),
    ).toHaveCount(0);
    expect(raw).not.toContain("//");

    // Focus a text-only line; the editor center may contain an inline switch.
    await code.locator(".cm-line").first().click();
    await page.keyboard.press("ControlOrMeta+a");
    const selected = await code.evaluate(() =>
      window.getSelection()?.toString(),
    );
    // Selection serialization uses LF even when innerText uses the Windows
    // CRLF convention. Compare all selected content, not OS line separators.
    expect(selected?.replace(/\r\n/gu, "\n")).toBe(raw.replace(/\r\n/gu, "\n"));

    const color = editor.getByRole("button", { name: "Edit line color" });
    const reference = editor.getByRole("switch", {
      name: "Toggle visual annotation visibility",
    });
    const value = editor.getByRole("switch", {
      name: "Toggle value visibility",
    });
    const rotation = editor.getByRole("button", {
      name: "Rotate clockwise 90 degrees",
    });
    const mirrorLeftRight = editor.getByRole("button", {
      name: "Mirror left to right",
    });
    const mirrorTopBottom = editor.getByRole("button", {
      name: "Mirror top to bottom",
    });
    await expect(color).toBeVisible();
    await expect(reference).toHaveAttribute("aria-checked", "true");
    await expect(value).toHaveAttribute("aria-checked", "false");
    await expect(rotation).toBeVisible();
    await expect(mirrorLeftRight).toBeVisible();
    await expect(mirrorTopBottom).toBeVisible();
    const horizontalIcon = mirrorLeftRight.locator("svg");
    const verticalIcon = mirrorTopBottom.locator("svg");
    await expect(horizontalIcon).toBeVisible();
    await expect(verticalIcon).toBeVisible();
    expect(await horizontalIcon.locator("path").getAttribute("d")).toBe(
      await verticalIcon.locator("path").getAttribute("d"),
    );
    await expect(horizontalIcon.locator("g")).not.toHaveAttribute(
      "transform",
      /.+/u,
    );
    await expect(verticalIcon.locator("g")).toHaveAttribute(
      "transform",
      "rotate(90 8 8)",
    );
    expect(
      await reference.evaluate((element) =>
        element
          .closest(".cm-line")
          ?.textContent?.includes('"visualAnnotation"'),
      ),
    ).toBe(true);
    expect(
      await value.evaluate((element) =>
        element.closest(".cm-line")?.textContent?.includes('"value"'),
      ),
    ).toBe(true);
    expect(
      await color.evaluate((element) =>
        element.closest(".cm-line")?.textContent?.includes('"color"'),
      ),
    ).toBe(true);
    expect(
      await rotation.evaluate((element) =>
        element.closest(".cm-line")?.textContent?.includes('"rotation"'),
      ),
    ).toBe(true);
    expect(
      await mirrorLeftRight.evaluate((element) =>
        element.closest(".cm-line")?.textContent?.includes('"mirror"'),
      ),
    ).toBe(true);
    expect(
      await mirrorTopBottom.evaluate((element) =>
        element.closest(".cm-line")?.textContent?.includes('"mirror"'),
      ),
    ).toBe(true);
    await expect(
      page.getByRole("dialog", { name: "Line color settings" }),
    ).toHaveCount(0);
    const layout = await editor.evaluate((section) => ({
      overflow: section.scrollWidth > section.clientWidth,
      editable: Boolean(section.querySelector('[contenteditable="true"]')),
      inlineControls: section.querySelectorAll(
        ".cm-line .cm-property-inline-toggle, .cm-line .cm-property-inline-placement, .cm-line .cm-property-inline-color",
      ).length,
    }));
    expect(layout).toEqual({
      overflow: false,
      editable: true,
      inlineControls: 6,
    });
    expect(raw).not.toContain("Line color");
    await reference.click();
    await value.click();
    await rotation.click();
    await expectComponentCodeField(page, "display.visualAnnotation", false);
    await expectComponentCodeField(page, "display.value", true);
    await expectComponentCodeField(page, "rotation", 90);
    await mirrorLeftRight.click();
    await expectComponentCodeField(page, "rotation", 90);
    await expectComponentCodeField(page, "mirror", "horizontal");
    await mirrorLeftRight.click();
    await expectComponentCodeField(page, "rotation", 90);
    await expectComponentCodeField(page, "mirror", "none");
    await mirrorTopBottom.click();
    await expectComponentCodeField(page, "rotation", 90);
    await expectComponentCodeField(page, "mirror", "vertical");
    await mirrorLeftRight.click();
    await expectComponentCodeField(page, "rotation", 90);
    await expectComponentCodeField(page, "mirror", "both");
    await mirrorLeftRight.click();
    await expectComponentCodeField(page, "rotation", 90);
    await expectComponentCodeField(page, "mirror", "vertical");
    await mirrorTopBottom.click();
    await expectComponentCodeField(page, "rotation", 90);
    await expectComponentCodeField(page, "mirror", "none");
    for (const next of [180, 270, 0, 90]) {
      await rotation.click();
      await expectComponentCodeField(page, "rotation", next);
    }
    await color.click();

    expect(
      await page
        .getByLabel("Line presets")
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("aria-label")),
        ),
    ).toEqual([
      "Use Black for line",
      "Use Light gray for line",
      "Use Red for line",
      "Use Green for line",
      "Use Blue for line",
    ]);
    await expect(
      page.getByRole("button", { name: "Use Light gray for line" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use Blue for line" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use Black for line" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reset line", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Use Black for line" }).click();
    await expectComponentCodeField(page, "color", [0, 0, 0]);

    await color.click();
    await page
      .getByRole("button", { name: "Use Red for line", exact: true })
      .click();
    await expectComponentCodeField(page, "color", [220, 38, 38]);

    await color.click();
    await expect(page.getByLabel("Line RGB")).toHaveValue("[220,38,38]");
    await page.getByLabel("Line RGB").fill("[12,38,38]");
    await expectComponentCodeField(page, "color", [12, 38, 38]);
  });
}

test("a black-box part exposes its generated Reference", async ({ page }) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  // Analog Blocks are exported as unresolved subcircuits, so their visible
  // X reference is part of the same contract as their netlist instance.
  await placeComponent(page, "voltage-amplifier", { x: 300, y: 200 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(properties).toContainText("voltage-amplifier");
  const code = properties.getByLabel("Editable Canvas property code");
  await expect(code).toContainText(/"visualAnnotation": true/u);
  await expect(code).toContainText(/"name": "X1"/u);
  await expect(code).toContainText(/"netlistName": "X1"/u);
});

test("Q opens a text-first Properties editor with one-click exact draft copy", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "pmos", { x: 360, y: 220 });
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "true")
    await shelf.click();
  await page.keyboard.press("q");
  const code = page.getByLabel("Editable Canvas property code");
  await expect(code).toBeVisible();
  await page.keyboard.press("q");
  await expect(code).not.toBeVisible();
  await page.keyboard.press("q");
  await expect(code).toBeVisible();
  const draft = JSON.parse(await readComponentPropertyCode(page));
  draft.parameters.w = "EV";
  const raw = JSON.stringify(draft, null, 2) + "\n\n";
  await code.fill(raw);
  await code.press("ControlOrMeta+End");
  const copy = page.getByRole("button", { name: "Copy JSON", exact: true });
  await expect(copy).toHaveCount(1);
  await expect(copy.locator("svg")).toBeVisible();
  await copy.click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe(raw);
  await expect(
    page.getByText("JSON copied", {
      exact: true,
    }),
  ).toBeVisible();
  const positions = await page
    .getByTestId("component-property-code-editor")
    .evaluate((section) => {
      const copy = section
        .querySelector(".component-property-copy")!
        .getBoundingClientRect();
      const editor = section
        .querySelector(".cm-scroller")!
        .getBoundingClientRect();
      return {
        copyBottom: copy.bottom,
        editorTop: editor.top,
        editorHeight: editor.height,
        panelHeight: section.getBoundingClientRect().height,
      };
    });
  expect(positions.copyBottom).toBeGreaterThan(0);
  expect(positions.editorHeight).toBeGreaterThan(240);
  await clickCommand(page, "Edit", "Undo");
  await expectComponentCodeField(page, "parameters.w", "1u");
});

test("Properties offers no dead Reference controls for a schematic-only block", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "adder", { x: 300, y: 200 });
  await placeComponent(page, "resistor", { x: 520, y: 200 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  const referenceField = properties.getByLabel("Netlist Reference");
  const parametersCard = properties.getByLabel(
    "Component parameters and display",
  );

  // A summing junction hides its designator on the canvas, so the panel
  // offers neither a Reference field nor display keys that could never
  // change the drawing. Its Canvas property code still owns placement/style.
  await page.locator('[data-canvas-hit-kind="instance"]').first().click();
  await expect(
    properties.getByLabel("Editable Canvas property code"),
  ).toBeVisible();
  await expect(referenceField).toHaveCount(0);
  await expect(parametersCard).toHaveCount(0);
  await expect(
    properties.getByLabel("Editable Canvas property code"),
  ).not.toContainText(/"display"/u);
  await expect(
    properties.locator('details[aria-label="Component appearance"]'),
  ).toHaveCount(0);

  // An ordinary device exposes both in the single code editor, not forms.
  await page.getByTestId("hit-R1").click();
  await expect(referenceField).toHaveCount(0);
  await expect(parametersCard).toHaveCount(0);
  await expectComponentCodeField(page, "netlistName", "R1");
  await expect(
    properties.getByLabel("Editable Canvas property code"),
  ).toContainText(/"display"/u);
});

test("resizes Properties and applies component presentation as editable code", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 240 });
  await openSelectionShelf(page);

  const properties = page.getByRole("complementary", { name: "Properties" });
  const resize = page.getByTestId("properties-resize-handle");
  const code = properties.getByLabel("Editable Canvas property code");
  await expect(resize).toBeVisible();
  await expect(code).toBeVisible();
  await expect(properties.getByLabel("Component geometry")).toHaveCount(0);
  await expect(
    properties.locator('details[aria-label="Component appearance"]'),
  ).toHaveCount(0);
  await expect(properties.getByLabel("Component display toggles")).toHaveCount(
    0,
  );

  const beforeWidth = (await properties.boundingBox())!.width;
  const resizeBox = await resize.boundingBox();
  if (!resizeBox) throw new Error("Properties resize handle is not measurable");
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2 - 24,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await properties.boundingBox())?.width ?? 0)
    .toBeCloseTo(beforeWidth + 24, 0);

  await resize.focus();
  await resize.press("Shift+ArrowLeft");
  await expect
    .poll(async () => (await properties.boundingBox())?.width ?? 0)
    .toBeCloseTo(beforeWidth + 56, 0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(localStorage.getItem("icm.properties-panel-width.v1")),
      ),
    )
    .toBeCloseTo(beforeWidth + 56, 0);

  // The half-window overlay keeps the same adjustable left edge rather than
  // falling back to a fixed narrow Properties panel.
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(resize).toBeVisible();
  const compactWidth = (await properties.boundingBox())!.width;
  await resize.focus();
  await resize.press("ArrowLeft");
  await expect
    .poll(async () => (await properties.boundingBox())?.width ?? 0)
    .toBeCloseTo(compactWidth + 8, 0);

  const edited = JSON.parse(await readComponentPropertyCode(page));
  edited.coordinate = [420, 280];
  edited.rotation = 90;
  edited.mirror = "horizontal";
  edited.display.visualAnnotation = false;
  edited.color = "#DC2626";
  await code.fill(JSON.stringify(edited, null, 2));

  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(
    page.locator(
      '[data-layer="formal"] [data-object-id="R1"] [data-role="instance-symbol"]',
    ),
  ).toHaveAttribute("stroke", "#DC2626");
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(0);
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances[0]).toMatchObject({
    placement: {
      position: { x: 420, y: 280 },
      rotation: 90,
      mirror: "horizontal",
    },
    styleOverride: { foreground: "#DC2626" },
  });
});

test("Properties toggles reference label visibility for one or many components", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  for (const sectionName of ["Parameters", "Netlist overrides", "Actions"]) {
    await expect(
      properties.getByText(sectionName, { exact: true }),
    ).toHaveCount(0);
  }
  const componentProperties = properties.getByRole("region", {
    name: "Component properties",
  });
  await expect(
    componentProperties.locator(":scope > .property-disclosure"),
  ).toHaveCount(0);
  await expect(
    componentProperties.locator(":scope > :last-child"),
  ).toHaveAttribute("aria-label", "Canvas property code");
  await expect(
    componentProperties.locator(
      ':scope > details[aria-label="Component appearance"]',
    ),
  ).toHaveCount(0);
  await expect(
    componentProperties.getByText("Built-in primitive: resistor", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    componentProperties.getByText("Netlist target", { exact: true }),
  ).toHaveCount(0);
  await expect(
    componentProperties.getByLabel("Component model target"),
  ).toHaveCount(0);
  await expectComponentCodeField(page, "netlistTarget", "");
  await editComponentPropertyCode(page, (value) => {
    value.display.visualAnnotation = false;
  });
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-object-id="instance-label-R1"]'),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R2"),
  ).toHaveCount(1);
  // Hiding is recoverable: the annotation is still in the project.
  await editComponentPropertyCode(page, (value) => {
    value.display.visualAnnotation = true;
  });
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(1);
  await editComponentPropertyCode(page, (value) => {
    value.display.visualAnnotation = false;
  });

  // Marquee both components and edit the shared code surface. The left-to-right
  // window requires FULL coverage, so sweep well past both symbol bodies.
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 120, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 340, { steps: 6 });
  await page.mouse.up();
  const groupEditor = page.getByTestId("group-property-code-editor");
  await expect(groupEditor).toBeVisible();
  await expect(
    groupEditor.getByText("2 selected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Canvas labels", { exact: true })).toHaveCount(0);
  const groupToggle = groupEditor.getByRole("switch", {
    name: "Toggle visual annotation visibility",
  });
  await expect(groupToggle).toBeVisible();
  await expect(groupToggle).toHaveAttribute("data-mixed", "true");
  expect(
    JSON.parse(await readComponentPropertyCode(page)).display.visualAnnotation,
  ).toBe("");
  await groupToggle.click();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R2"),
  ).toHaveCount(1);
  await groupToggle.click();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R2"),
  ).toHaveCount(0);
  await groupToggle.click();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R2"),
  ).toHaveCount(1);
});

test("Select All shows one batch code surface instead of object-specific forms", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+a");
  await openSelectionShelf(page);

  const properties = page.getByRole("complementary", { name: "Properties" });
  const batch = properties.getByTestId("group-property-code-editor");
  await expect(batch).toBeVisible();
  await expect(batch.getByText("2 selected", { exact: true })).toBeVisible();
  expect(JSON.parse(await readComponentPropertyCode(page))).toEqual({
    name: "",
    coordinate: null,
    rotation: null,
    mirror: null,
    display: { visualAnnotation: true, value: false },
    color: [0, 0, 0],
    parameters: { value: "1k" },
    type: "resistor",
  });
  await expect(
    properties.getByText("Electrical route", { exact: true }),
  ).toHaveCount(0);
  await expect(properties.getByLabel("Electrical Net label")).toHaveCount(0);
  await expect(properties.getByLabel("Wire color custom RGB")).toHaveCount(0);
  await expect(
    properties.getByText("Canvas labels", { exact: true }),
  ).toHaveCount(0);

  await batch.getByRole("button", { name: "Edit line color" }).click();
  await page.getByRole("button", { name: "Use Red for line" }).click();
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances).toMatchObject([
    { id: "R1", styleOverride: { foreground: "#dc2626" } },
    { id: "R2", styleOverride: { foreground: "#dc2626" } },
  ]);
  expect(saved.documents[0].routes[0].styleOverride).toBeUndefined();
});

test("Properties keeps component and Annotation text colors independent", async ({
  page,
}) => {
  const clockStart = Date.parse("2026-08-31T00:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);

  const properties = page.getByRole("complementary", { name: "Properties" });
  const component = page.locator('[data-object-id="R1"]');
  const symbol = component.locator('[data-role="instance-symbol"]');
  const label = page.locator('[data-object-id="instance-label-R1"]');
  const secondLabel = page.locator('[data-object-id="instance-label-R2"]');

  await editComponentPropertyCode(page, (value) => {
    value.color = "#dc2626";
  });
  await expect(symbol).toHaveAttribute("stroke", "#dc2626");
  await expect(
    component.locator('[data-role="instance-background"]'),
  ).toHaveCount(0);
  await expect(label).toHaveAttribute("fill", "#dc2626");

  await page
    .getByTestId("annotation-hit-instance-label-R1")
    .click({ force: true });
  await openSelectionShelf(page);
  await expect(
    properties.getByRole("region", { name: "Text properties" }),
  ).toBeVisible();
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("auto");
  await properties.getByRole("button", { name: "Edit text color" }).click();
  await page
    .getByRole("button", { name: "Use Blue for text", exact: true })
    .click();
  await expect(label).toHaveAttribute("fill", "#2563eb");
  await expect(symbol).toHaveAttribute("stroke", "#dc2626");

  // Incomplete property code belongs only to this selection and never reaches another label.
  await page
    .getByLabel("Editable Canvas property code")
    .fill('{ "appearance":');
  await page
    .getByTestId("annotation-hit-instance-label-R2")
    .click({ force: true });
  await expect(label).toHaveAttribute("fill", "#2563eb");
  await expect(secondLabel).not.toHaveAttribute("fill");
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("auto");

  await page
    .getByTestId("annotation-hit-instance-label-R1")
    .click({ force: true });
  await editComponentPropertyCode(page, (code) => {
    code.color = "auto";
  });
  await expect(label).toHaveAttribute("fill", "#dc2626");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(label).toHaveAttribute("fill", "#2563eb");
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toEqual([
    37, 99, 235,
  ]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(label).toHaveAttribute("fill", "#dc2626");
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("auto");

  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const savedR1 = project.documents[0].instances.find(
    (instance: { id: string }) => instance.id === "R1",
  );
  const savedLabel = project.documents[0].annotations.find(
    (annotation: { id: string }) => annotation.id === "instance-label-R1",
  );
  expect(savedR1.styleOverride).toEqual({ foreground: "#dc2626" });
  expect(savedR1.styleOverride).not.toHaveProperty("labelColor");
  expect(savedLabel).not.toHaveProperty("textColor");
});

test("keeps fixed and variable capacitor Properties on the shared code surface", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "capacitor", { x: 280, y: 180 });
  await placeComponent(page, "variable-capacitor", { x: 480, y: 180 });

  await page.getByTestId("hit-C1").click();
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  const componentProperties = properties.getByRole("region", {
    name: "Component properties",
  });
  await expect(
    componentProperties.getByLabel("Editable Canvas property code"),
  ).toBeVisible();
  await expect(componentProperties.locator(":scope > *")).toHaveCount(1);
  await expect(
    properties.getByRole("group", { name: "Capacitor plate terminals" }),
  ).toHaveCount(0);

  await page.getByTestId("hit-C2").click();
  await expect(properties).toContainText("C2 · variable-capacitor");
  await expect(
    componentProperties.getByLabel("Editable Canvas property code"),
  ).toBeVisible();
  await expect(componentProperties.locator(":scope > *")).toHaveCount(1);
  await expect(
    properties.getByRole("group", { name: "Capacitor plate terminals" }),
  ).toHaveCount(0);
});

test("value display projects MOS W/L and passive values beside the reference", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("nmos");
  await dialog.getByTestId("insert-component-nmos").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");

  // Geometry and the Value display are Properties decisions after placement.
  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);
  await setComponentParameter(page, "w", "2u");
  await setComponentParameter(page, "l", "180n");
  await setComponentParameter(page, "m", "4");
  await editComponentPropertyCode(page, (propertyCode) => {
    propertyCode.display.value = true;
  });
  await canvas.click({ position: { x: 80, y: 80 } });

  const reference = page.locator('[data-object-id="instance-label-M1"]');
  const value = page.locator('[data-object-id="instance-value-M1"]');
  await expect(reference).toContainText("M1");
  // MOS values render as a stacked fraction with engineering units: the
  // numerator and denominator are separate part texts around a fraction bar.
  await expect(value).toContainText("2u");
  await expect(value).toContainText("180n");
  await expect(value).toContainText("×4");
  await expect(page.locator('[data-role="fraction-bar"]')).toHaveCount(1);
  const fractionCenters = await value.evaluate((element) => {
    const box = (role: string) => {
      const part = element.querySelector<SVGGraphicsElement>(
        `[data-role="fraction-${role}"]`,
      )!;
      if (role === "bar") return part.getBBox();
      // Compare typographic advances, not platform-specific ink overhang.
      const texts = part.matches("text")
        ? [part as SVGTextElement]
        : Array.from(part.querySelectorAll("text"));
      const positions = texts.flatMap((text) =>
        Array.from({ length: text.getNumberOfChars() }, (_, index) => [
          text.getStartPositionOfChar(index).x,
          text.getEndPositionOfChar(index).x,
        ]).flat(),
      );
      const x = Math.min(...positions);
      return { x, width: Math.max(...positions) - x };
    };
    const bar = box("bar");
    return [box("numerator"), box("denominator")].map((part) => ({
      centerGap: Math.abs(part.x + part.width / 2 - bar.x - bar.width / 2),
      leftGap: part.x - bar.x,
      rightGap: bar.x + bar.width - part.x - part.width,
    }));
  });
  for (const part of fractionCenters) {
    expect(part.centerGap).toBeLessThan(0.02);
    expect(part.leftGap).toBeGreaterThan(0);
    expect(part.rightGap).toBeGreaterThan(0);
  }
  const multiplierGap = await value.evaluate((element) => {
    const bar = element.querySelector<SVGLineElement>(
      '[data-role="fraction-bar"]',
    );
    const multiplier = [
      ...element.querySelectorAll<SVGTextElement>("text"),
    ].find((text) => text.getAttribute("text-anchor") === "start");
    if (!bar || !multiplier) throw new Error("Value geometry is incomplete");
    const barBox = bar.getBBox();
    return multiplier.getStartPositionOfChar(1).x - (barBox.x + barBox.width);
  });
  expect(multiplierGap).toBeGreaterThan(0);
  expect(multiplierGap).toBeLessThan(12);
  // The value block is the second upright row under the reference.
  const referenceBox = await reference.boundingBox();
  const valueBox = await value.boundingBox();
  if (!referenceBox || !valueBox) throw new Error("Labels are not measurable");
  expect(valueBox.y).toBeGreaterThan(referenceBox.y);

  // A passive value projects the same way through Properties.
  await page.keyboard.press("i");
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByTestId("insert-component-resistor").click();
  await canvas.click({ position: { x: 560, y: 240 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await setComponentParameter(page, "value", "33k");
  await editComponentPropertyCode(page, (propertyCode) => {
    propertyCode.display.value = true;
  });
  await canvas.click({ position: { x: 80, y: 80 } });
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("33k");

  // The formal SVG export carries the fraction bar and unit text through the
  // shared annotation path.
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  expect(svg).toContain('data-kind="instance-value"');
  expect(svg).toContain('data-role="fraction-bar"');
  expect(svg).toContain("2u");
  expect(svg).toContain("180n");
  expect(svg).toContain("×4");
  expect(svg).toContain("33k");
});

test("reference and value code refreshes content after parameter edits", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await placeComponent(page, "resistor", { x: 500, y: 200 });

  // Removing a required value leaves no valid annotation and proves that the
  // pending code becomes applicable as soon as the value is restored.
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  const propertyCode = properties.getByLabel("Editable Canvas property code");
  const missingValueCode = JSON.parse(await readComponentPropertyCode(page));
  delete missingValueCode.parameters.value;
  missingValueCode.display.value = true;
  await propertyCode.fill(JSON.stringify(missingValueCode, null, 2));
  await expect(
    properties.getByText(/Set a valid component value/u),
  ).toBeVisible();
  await expect(
    page.getByTestId("annotation-hit-instance-value-R1"),
  ).toHaveCount(0);

  // Typing a value makes the same pending code applicable without closing and
  // reopening Properties.

  await setComponentParameter(page, "value", "33k");

  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("33k");

  // A later parameter edit re-projects the visible value text.

  await setComponentParameter(page, "value", "47k");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("47k");

  // Hiding keeps the annotation recoverable.
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.display.value = false;
  });
  await expect(
    page.getByTestId("annotation-hit-instance-value-R1"),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toHaveCount(0);

  // The shared code toggle applies the same value display to every component
  // that has a projection; R2 exposes its authored 1k device default.
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 180, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 340, { steps: 6 });
  await page.mouse.up();
  await page
    .getByTestId("group-property-code-editor")
    .getByRole("switch", { name: "Toggle value visibility" })
    .click();
  await expect(
    page.locator('[data-object-id="instance-value-R1"]'),
  ).toContainText("47k");
  await expect(
    page.locator('[data-object-id="instance-value-R2"]'),
  ).toContainText("1k");
});

for (const symbol of ["nmos", "pmos"]) {
  test(`${symbol} W/L numerator drags freely and retains its offset through editing and file reload`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await placeComponent(page, symbol, { x: 350, y: 250 });
    const canvas = page.getByTestId("schematic-canvas");
    const instance = page.getByTestId("hit-M1");
    await instance.click();
    await openSelectionShelf(page);
    await setComponentParameter(page, "w", "2u");
    await setComponentParameter(page, "l", "180n");
    await setComponentParameter(page, "m", "4");
    await editComponentPropertyCode(page, (code) => {
      code.display.value = true;
    });
    await canvas.click({ position: { x: 70, y: 70 } });

    const value = page.locator('[data-object-id="instance-value-M1"]');
    const numerator = value.locator('[data-role="fraction-numerator"]');
    await expect(numerator).toContainText("2u");
    const before = (await value.boundingBox())!;
    const ownerBefore = (await instance.boundingBox())!;
    const grip = (await numerator.boundingBox())!;
    const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    // Grab the numerator itself, not the lower hit rectangle or an Alt cycle.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 180, start.y + 120, { steps: 12 });
    await expect
      .poll(async () => (await value.boundingBox())!.x)
      .toBeCloseTo(before.x + 180, 0);
    await page.mouse.up();
    // The only allowed difference on release is annotation-grid rounding.
    await expect
      .poll(async () =>
        Math.abs((await value.boundingBox())!.x - before.x - 180),
      )
      .toBeLessThan(3);
    await expect
      .poll(async () =>
        Math.abs((await value.boundingBox())!.y - before.y - 120),
      )
      .toBeLessThan(3);
    expect(await instance.boundingBox()).toEqual(ownerBefore);
    const dropped = (await value.boundingBox())!;

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => (await value.boundingBox())!.x)
      .toBeCloseTo(before.x, 0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => (await value.boundingBox())!.x)
      .toBeCloseTo(dropped.x, 0);

    const readDocument = async (): Promise<SchematicDocument> => {
      const bytes = await downloadBytes(page, "File", "Export Project File…");
      return JSON.parse(bytes.toString("utf8")).documents[0];
    };
    const valueAnchor = (document: SchematicDocument) => {
      const anchor = document.annotations.find(
        (annotation) => annotation.id === "instance-value-M1",
      )!.anchor;
      if (anchor.kind !== "object")
        throw new Error("Value must retain its component anchor");
      return anchor;
    };
    const authored = await readDocument();
    const anchor = valueAnchor(authored);
    expect(anchor.objectId).toBe("M1");
    expect(
      Math.hypot(anchor.localOffset.x, anchor.localOffset.y),
    ).toBeGreaterThan(200);

    // Updating W refreshes the fraction without restoring its default slot.
    await instance.click();
    await openSelectionShelf(page);
    await setComponentParameter(page, "w", "3u");
    await canvas.click({ position: { x: 70, y: 70 } });
    await expect(numerator).toContainText("3u");
    expect(valueAnchor(await readDocument())).toEqual(anchor);

    // Move and rotate the host: the authored vector follows, never reflows.
    const host = (await instance.boundingBox())!;
    await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      host.x + host.width / 2 + 60,
      host.y + host.height / 2 - 40,
      { steps: 8 },
    );
    await page.mouse.up();
    const moved = await readDocument();
    const movedAnchor = valueAnchor(moved);
    expect(movedAnchor.localOffset).toEqual(anchor.localOffset);
    const movedPosition = moved.instances.find((item) => item.id === "M1")!
      .placement!.position;
    expect(movedAnchor.fallbackPosition).toEqual({
      x: movedPosition.x + anchor.localOffset.x,
      y: movedPosition.y + anchor.localOffset.y,
    });
    await openSelectionShelf(page);
    await editComponentPropertyCode(page, (code) => {
      code.rotation = 45;
    });
    await expect(
      page.locator('[data-object-id="M1"] > g').first(),
    ).toHaveAttribute("transform", /rotate\(45\)/u);
    const rotated = await readDocument();
    const rotatedAnchor = valueAnchor(rotated);
    expect(
      rotated.instances.find((item) => item.id === "M1")!.placement!.rotation,
    ).toBe(45);
    expect(rotatedAnchor.localOffset.x).toBe(
      Math.round((anchor.localOffset.x - anchor.localOffset.y) / Math.sqrt(2)),
    );
    expect(rotatedAnchor.localOffset.y).toBe(
      Math.round((anchor.localOffset.x + anchor.localOffset.y) / Math.sqrt(2)),
    );
    await expect(numerator).toContainText("3u");

    // Reopen a real exported file, then export again to verify persisted data.
    const saved = await downloadBytes(page, "File", "Export Project File…");
    await page.getByTestId("project-file").setInputFiles({
      name: `${symbol}-value-drag.icproj.json`,
      mimeType: "application/json",
      buffer: saved,
    });
    await expect(numerator).toContainText("3u");
    const reopened = await readDocument();
    expect(valueAnchor(reopened)).toEqual(rotatedAnchor);
    expect(reopened.instances).toEqual(rotated.instances);
    expect(reopened.nets).toEqual(authored.nets);
  });
}

test("live property edits survive blank click and Escape without replaying legacy drafts", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  const canvas = page.getByTestId("schematic-canvas");

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await setComponentParameter(page, "value", "33k");
  await canvas.click({ position: { x: 60, y: 60 } });
  await expect(page.getByTestId("revision")).toHaveText("2");

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "parameters.value", "33k");

  await setComponentParameter(page, "value", "47k");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("3");

  await canvas.click({ position: { x: 60, y: 60 } });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "parameters.value", "47k");
});

test("edits the transconductance trapezoid from gm to -gmL", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "transconductance", { x: 360, y: 240 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  const componentProperties = properties.locator(
    '[aria-label="Component properties"]',
  );
  const formalScene = page.locator('[data-layer="formal"]');
  const frame = formalScene.locator('[data-role="signal-flow-frame"]');

  await expect(properties.getByText("Identity", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    componentProperties.locator(":scope > :last-child"),
  ).toHaveAttribute("aria-label", "Canvas property code");
  await expectComponentCodeField(page, "signalFlow", {});
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute(
    "points",
    "-20,-35 20,-17.5 20,17.5 -20,35",
  );
  await expect(
    formalScene.locator('[data-role="formula-subscript"]'),
  ).toHaveText("m");

  await setComponentCodeField(page, "signalFlow.formula", "−gₘL");
  await expect(
    formalScene.locator('[data-role="formula-subscript"]'),
  ).toHaveText("mL");

  await clickCommand(page, "Edit", "Undo");
  await expectComponentCodeField(page, "signalFlow", {});
  await clickCommand(page, "Edit", "Redo");
  await expectComponentCodeField(page, "signalFlow.formula", "−gₘL");
});

test("edits a formula-capable Signal Flow block with undo, redo, and Reset defaults", async ({
  page,
}) => {
  // Capability determines this scenario: a catalog addition becomes the
  // exercised block without this test baking in a symbol ID. Blocks whose
  // frame takes a non-rectangular `shape` are excluded — they size their body
  // by different rules, and the frame dimensions asserted below belong to the
  // rectangular family. A tapered block is its own scenario.
  const formulaSymbol = razaviProductSymbols.find(
    (symbol) =>
      symbol.formulaPresentation?.supportsCoefficient &&
      symbol.formulaPresentation.adaptiveFrame &&
      !symbol.formulaPresentation.adaptiveFrame.shape,
  );
  expect(formulaSymbol).toBeDefined();
  const symbol = formulaSymbol!;

  await page.goto("/editor");
  await placeComponent(page, symbol.id, { x: 360, y: 240 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  // Empty presentation code inherits the canonical symbol's own formula.
  await expectComponentCodeField(page, "signalFlow", {});

  const formalScene = page.locator('[data-layer="formal"]');
  const renderedFormula = formalScene.locator(
    '[data-role="signal-flow-formula"]',
  );
  const frame = formalScene.locator('[data-role="signal-flow-frame"]');
  await expect(renderedFormula).toHaveCount(1);
  await expect(renderedFormula.locator('text[font-size="12"]')).not.toHaveCount(
    0,
  );

  await setComponentCodeField(page, "signalFlow.formula", "z⁻¹/(1−z⁻¹)");
  await expect(
    formalScene.locator('[data-role="formula-fraction-bar"]'),
  ).toHaveCount(1);
  await expect(
    formalScene.locator('[data-role="formula-superscript"]'),
  ).toHaveCount(2);
  await expect(frame).toHaveAttribute("width", "60");
  // The 40-unit preset is a minimum. The shared stacked-fraction layout
  // expands to 50 units so superscript denominators clear the fraction bar.
  await expect(frame).toHaveAttribute("height", "50");

  await setComponentCodeField(page, "signalFlow.coefficient", "K");
  await expect(
    formalScene.locator('[data-role="formula-coefficient"]'),
  ).toHaveText("K·");
  await expect(frame).toHaveAttribute("width", "80");

  await setComponentCodeField(page, "signalFlow.bodyWidth", 160);
  await setComponentCodeField(page, "signalFlow.bodyHeight", 80);
  await expect(frame).toHaveAttribute("width", "160");
  await expect(frame).toHaveAttribute("height", "80");

  await clickCommand(page, "Edit", "Undo");
  await expect(frame).toHaveAttribute("height", "50");
  await clickCommand(page, "Edit", "Redo");
  await expect(frame).toHaveAttribute("height", "80");

  await properties
    .getByRole("button", { name: "Defaults", exact: true })
    .click();
  // Reset restores the Symbol's own formula as editable text, not an empty
  // box: the default is the starting point for the next edit.
  await expectComponentCodeField(page, "signalFlow", {});
  await expect(
    formalScene.locator('[data-role="formula-coefficient"]'),
  ).toHaveCount(0);
});

test("selects a reviewed SKY130 MOS through the inline Target netlist field", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });

  await expect(
    properties.getByRole("button", { name: "Need help?", exact: true }),
  ).toHaveCount(0);
  await properties
    .getByLabel("Target netlist options")
    .selectOption("sky130_fd_pr__nfet_01v8");

  await expectComponentCodeField(
    page,
    "netlistTarget",
    "sky130_fd_pr__nfet_01v8",
  );
  await expectComponentCodeField(page, "netlistName", "M1");
  await expectComponentCodeField(page, "parameters.nf", "1");
  await expectComponentCodeField(page, "parameters.m", "1");

  await setComponentCodeField(page, "netlistTarget", "");
  await expectComponentCodeField(page, "netlistTarget", "");
  await expectComponentCodeField(page, "netlistName", "M1");
  await setComponentCodeField(page, "netlistTarget", "generic_nmos");
  await expectComponentCodeField(page, "netlistTarget", "generic_nmos");
  await expectComponentCodeField(page, "netlistName", "M1");

  await setComponentCodeField(page, "netlistTarget", "sky130_fd_pr__nfet_01v8");
  await expectComponentCodeField(
    page,
    "netlistTarget",
    "sky130_fd_pr__nfet_01v8",
  );
  await expectComponentCodeField(page, "netlistName", "M1");

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.externalSubcircuitDefinitions).toEqual([
    expect.objectContaining({
      name: "sky130_fd_pr__nfet_01v8",
      terminals: [
        expect.objectContaining({ name: "D" }),
        expect.objectContaining({ name: "G" }),
        expect.objectContaining({ name: "S" }),
        expect.objectContaining({ name: "B" }),
      ],
    }),
  ]);
  expect(saved.documents[0].instances[0]).toMatchObject({
    id: "M1",
    symbolId: "nmos",
    reference: "M1",
    netlist: {
      parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
      binding: { kind: "external-subcircuit" },
    },
  });
});

test("keeps the exact SKY130 PNP on its three-terminal model interface", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "pnp", { x: 360, y: 220 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", {
    name: "Properties",
  });

  await expect(properties.getByLabel("Substrate Net")).toHaveCount(0);
  await setComponentCodeField(
    page,
    "netlistTarget",
    "sky130_fd_pr__pnp_05v5_W0p68L0p68",
  );
  await expect(properties.getByLabel("Substrate Net")).toHaveCount(0);
  await expectComponentCodeField(page, "netlistName", "Q1");

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.externalSubcircuitDefinitions[0]).toMatchObject({
    name: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
    terminals: [{ name: "C" }, { name: "B" }, { name: "E" }],
  });

  await setComponentCodeField(page, "netlistTarget", "");
  await expect(properties.getByLabel("Substrate Net")).toHaveCount(0);
  await expectComponentCodeField(page, "netlistName", "Q1");
});

test("derives NPN substrate from its exact Model", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "npn", { x: 360, y: 220 });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", {
    name: "Properties",
  });

  await expect(properties.getByLabel("Substrate Net")).toHaveCount(0);
  await setComponentCodeField(
    page,
    "netlistTarget",
    "sky130_fd_pr__npn_05v5_W1p00L1p00",
  );
  await expect(properties.getByLabel("Substrate Net")).toBeVisible();
  await expectComponentCodeField(page, "netlistName", "Q1");

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.externalSubcircuitDefinitions[0]).toMatchObject({
    name: "sky130_fd_pr__npn_05v5_W1p00L1p00",
    terminals: [{ name: "C" }, { name: "B" }, { name: "E" }, { name: "S" }],
  });

  await setComponentCodeField(page, "netlistTarget", "");
  await expect(properties.getByLabel("Substrate Net")).toHaveCount(0);
  await expectComponentCodeField(page, "netlistName", "Q1");
});

for (const fixture of [
  {
    symbolId: "resistor",
    model: "sky130_fd_pr__res_high_po",
    externalParameter: "mult",
    primitiveParameter: "value",
    nativeReference: "R1",
    externalReference: "R1",
  },
  {
    symbolId: "capacitor",
    model: "sky130_fd_pr__cap_mim_m3_1",
    externalParameter: "mf",
    primitiveParameter: "value",
    nativeReference: "C1",
    externalReference: "C1",
  },
] as const) {
  test(`switches ${fixture.symbolId} Model parameters immediately and clears through None`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await placeComponent(page, fixture.symbolId, { x: 360, y: 220 });
    await openSelectionShelf(page);

    await setComponentCodeField(page, "netlistTarget", fixture.model);
    await expectComponentCodeField(
      page,
      "netlistName",
      fixture.externalReference,
    );
    expect(
      JSON.parse(await readComponentPropertyCode(page)).parameters,
    ).toHaveProperty(fixture.externalParameter);
    await expectComponentCodeField(
      page,
      `parameters.${fixture.primitiveParameter}`,
      undefined,
    );

    await setComponentCodeField(page, "netlistTarget", "");
    await expectComponentCodeField(page, "netlistTarget", "");
    await expectComponentCodeField(
      page,
      "netlistName",
      fixture.nativeReference,
    );
    await expectComponentCodeField(
      page,
      `parameters.${fixture.primitiveParameter}`,
      "",
    );
    await expectComponentCodeField(
      page,
      `parameters.${fixture.externalParameter}`,
      undefined,
    );
  });
}

for (const symbol of ["xfmr", "tcoil"] as const) {
  test(`${symbol} independently displays magnetic parameters and preserves them through history and files`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await placeComponent(page, symbol, { x: 360, y: 220 });
    await openSelectionShelf(page);
    const winding = symbol === "xfmr" ? "lp" : "l1";
    const windingLabel = symbol === "xfmr" ? "Lp" : "L1";
    const formalLabels = page.locator(
      '[data-layer="formal"] [data-kind="instance-value"]',
    );
    const kToggle = page.getByRole("switch", {
      name: "Toggle K visibility",
      exact: true,
    });
    await expect(kToggle).toHaveAttribute("aria-checked", "false");
    await kToggle.click();
    await expect(formalLabels).toHaveCount(1);
    await expect(formalLabels).toContainText("K = 1");
    await editComponentPropertyCode(page, (code) => {
      code.display.parameters.k = false;
      code.display.parameters[winding] = true;
      code.parameters[winding] = "2.5n";
    });
    await expect(formalLabels).toHaveCount(1);
    await expect(formalLabels).toContainText(`${windingLabel} = 2.5n`);
    await clickCommand(page, "Edit", "Undo");
    await expect(formalLabels).toContainText("K = 1");
    await clickCommand(page, "Edit", "Redo");
    await expect(formalLabels).toContainText(`${windingLabel} = 2.5n`);
    await editComponentPropertyCode(page, (code) => {
      code.display.parameters.k = true;
      code.parameters.k = "0.83";
      code.rotation = 45;
    });
    await expect(formalLabels).toHaveCount(2);
    await expect(formalLabels.filter({ hasText: "K = 0.83" })).toHaveCount(1);
    const labelBoxes = await formalLabels.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, bottom: box.bottom };
      }),
    );
    expect(labelBoxes[0]!.x).toBeCloseTo(labelBoxes[1]!.x, 1);
    expect(labelBoxes[0]!.bottom).toBeLessThan(labelBoxes[1]!.y);
    const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
      "utf8",
    );
    expect(svg).toContain("K = 0.83");
    expect(svg).toContain(`${windingLabel} = 2.5n`);
    const saved = await downloadBytes(page, "File", "Export Project File…");
    const project = JSON.parse(saved.toString("utf8"));
    const instanceId = project.documents[0].instances[0].id;
    expect(
      project.documents[0].annotations.filter(
        (annotation: { binding?: { parameter?: string } }) =>
          annotation.binding?.parameter,
      ),
    ).toHaveLength(2);
    await page.getByTestId("project-file").setInputFiles({
      name: `${symbol}.icproj.json`,
      mimeType: "application/json",
      buffer: saved,
    });
    await page.getByTestId(`hit-${instanceId}`).click();
    await openSelectionShelf(page);
    await expect(kToggle).toHaveAttribute("aria-checked", "true");
    await expect(formalLabels).toHaveCount(2);
    await page
      .getByRole("switch", {
        name: `Toggle ${windingLabel} visibility`,
        exact: true,
      })
      .click();
    await expect(formalLabels).toHaveCount(1);
    await expect(formalLabels).toContainText("K = 0.83");
  });
}

test("batch Code edits common resistor values and colors atomically and reopens them", async ({
  page,
}) => {
  const project = createEmptyProject("batch-values", "Batch values");
  project.documents[0]!.instances = ["1k", "2k"].map((value, index) => ({
    id: `R${index + 1}`,
    reference: `R${index + 1}`,
    symbolId: "resistor",
    placement: {
      position: { x: 100 + index * 180, y: 100 },
      rotation: 0,
      mirror: "none",
    },
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { ...(index === 0 ? { value } : {}), tc: `${index + 1}` },
    },
    ...(index === 1
      ? { styleOverride: { foreground: "#000000", background: "#ffffff" } }
      : {}),
  }));
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "batch-values.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened batch-values.icproj.json",
  );
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("hit-R2").click({ modifiers: ["Shift"] });
  await openSelectionShelf(page);
  const code = JSON.parse(await readComponentPropertyCode(page));
  expect(code).toMatchObject({
    type: "resistor",
    parameters: { value: "", tc: "" },
    color: [0, 0, 0],
  });
  const revision = Number(await page.getByTestId("revision").textContent());
  await editComponentPropertyCode(page, (value) => {
    value.parameters.value = "10k";
    value.color = [255, 0, 0];
    value.display.value = true;
  });
  await expect(page.getByTestId("revision")).toHaveText(String(revision + 1));
  for (const id of ["R1", "R2"]) {
    await expect(
      page.locator(`[data-object-id="${id}"] [data-role="instance-symbol"]`),
    ).toHaveAttribute("stroke", "#ff0000");
    await expect(
      page.locator(`[data-object-id="instance-value-${id}"]`),
    ).toContainText("10k");
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(JSON.parse(await readComponentPropertyCode(page))).toEqual(code);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const saved = await downloadBytes(page, "File", "Export Project File…");
  expect(
    JSON.parse(saved.toString("utf8")).documents[0].instances,
  ).toMatchObject([
    {
      id: "R1",
      netlist: { parameters: { value: "10k", tc: "1" } },
      styleOverride: { foreground: "#ff0000" },
    },
    {
      id: "R2",
      netlist: { parameters: { value: "10k", tc: "2" } },
      styleOverride: { foreground: "#ff0000" },
    },
  ]);
  await page.getByTestId("project-file").setInputFiles({
    name: "batch-reopened.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened batch-reopened.icproj.json",
  );
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("hit-R2").click({ modifiers: ["Shift"] });
  // Opening the Project brought the project dock back over Properties.
  await openSelectionShelf(page);
  expect(JSON.parse(await readComponentPropertyCode(page))).toMatchObject({
    type: "resistor",
    parameters: { value: "10k", tc: "" },
    color: [255, 0, 0],
  });
  await page.screenshot({ path: "plan/batch-value-properties.png" });
});

test("batch Code colors different component types while rejecting incompatible value edits", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await placeComponent(page, "capacitor", { x: 520, y: 200 });
  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.color = [0, 0, 255];
  });
  await page.getByTestId("hit-C1").click({ modifiers: ["Shift"] });
  const code = JSON.parse(await readComponentPropertyCode(page));
  expect(code).toMatchObject({
    type: "",
    parameters: "",
    color: "",
  });
  const editor = page.getByLabel("Editable Canvas property code");
  const revision = await page.getByTestId("revision").textContent();
  await editor.fill(
    JSON.stringify({
      ...code,
      parameters: { value: "10k" },
      color: [255, 0, 0],
    }),
  );
  await expect(
    page.getByRole("button", { name: "Discard draft", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit line color", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use Red for line", exact: true })
    .click();
  for (const id of ["R1", "C1"])
    await expect(
      page.locator(`[data-object-id="${id}"] [data-role="instance-symbol"]`),
    ).toHaveAttribute("stroke", "#dc2626");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances).toMatchObject([
    { id: "R1", netlist: { parameters: { value: "1k" } } },
    { id: "C1", netlist: { parameters: { value: "1p" } } },
  ]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(JSON.parse(await readComponentPropertyCode(page)).color).toBe("");
});

test("batch Code drafts follow selection identity even when common values are identical", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 250, y: 200 });
  await placeComponent(page, "resistor", { x: 450, y: 200 });
  await placeComponent(page, "resistor", { x: 650, y: 200 });
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("hit-R2").click({ modifiers: ["Shift"] });
  await openSelectionShelf(page);
  await page
    .getByLabel("Editable Canvas property code")
    .fill('{ "appearance":');
  await page.getByTestId("hit-R3").click({ modifiers: ["Shift"] });
  await expect(
    page.getByRole("button", { name: "Discard draft", exact: true }),
  ).toHaveCount(0);
  expect(
    JSON.parse(await readComponentPropertyCode(page)).parameters.value,
  ).toBe("1k");
  await editComponentPropertyCode(page, (code) => {
    code.parameters.value = "22k";
  });
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(
    saved.documents[0].instances.map(
      (instance: any) => instance.netlist.parameters.value,
    ),
  ).toEqual(["22k", "22k", "22k"]);
});

test("common item fields start with type and name and preserve reference binding", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 240 });
  await openSelectionShelf(page);
  const before = JSON.parse(await readComponentPropertyCode(page));
  expect(Object.keys(before).slice(0, 6)).toEqual([
    "type",
    "name",
    "coordinate",
    "rotation",
    "mirror",
    "color",
  ]);
  await setComponentCodeField(page, "name", "RL");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances[0].reference).toBe("RL");
  expect(
    saved.documents[0].annotations.find(
      (annotation: { id: string }) => annotation.id === "instance-label-R1",
    ).binding,
  ).toEqual({ kind: "instance-reference", instanceId: "R1" });
  await page.screenshot({ path: "plan/common-item-properties.png" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectComponentCodeField(page, "name", "R1");
});

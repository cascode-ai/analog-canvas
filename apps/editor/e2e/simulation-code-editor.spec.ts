import { expect, test, type Page } from "@playwright/test";

import { harnessModuleUrl, harnessPagePreamble } from "./helpers/harness-url";
import { sourceEditor } from "./simulation-e2e-fixtures.js";

/** Show the Explorer if it is hidden, then open the experiment's configuration. */
async function openExperimentJson(page: Page) {
  const explorer = page.getByRole("button", { name: "Explorer", exact: true });
  if ((await explorer.getAttribute("aria-expanded")) !== "true")
    await explorer.click();
  await page
    .getByRole("treeitem", { name: "experiment.json", exact: true })
    .first()
    .click();
}

// What each Helper entry, completion and diagnostic writes is the language
// modules' tests (code-spice-language, simulation-language, spec-results). These
// cases keep what only a browser shows: keyboard, focus, scroll and layout.
test.beforeEach(async ({ page }) => {
  await page.route("**/code-component-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><script type="module">
        ${harnessPagePreamble}
        const { mountSimulationCodeHarness } = await import(${JSON.stringify(
          harnessModuleUrl("simulation-code-harness"),
        )});
        mountSimulationCodeHarness();
      </script></body></html>`,
    }),
  );
  await page.goto("/code-component-check");
  await expect(sourceEditor(page)).toBeVisible();
});

test("SPICE save and dc arguments open automatically and preview their Canvas target", async ({
  page,
}) => {
  const editor = sourceEditor(page);
  await editor.fill("* test\n.control\nsave");
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  const body = page.locator("body");
  const output = page.getByRole("option").filter({
    has: page.locator(".cm-completionLabel", { hasText: /^v\(out\)$/ }),
  });
  await expect(output).toBeVisible();
  await expect(output).toHaveCount(1);
  // CodeMirror deliberately ignores completion navigation for 75ms after
  // opening. Visibility alone does not mean keyboard navigation is armed.
  // Exercise the post-open interaction, preserving the library's safety delay.
  await page.waitForTimeout(100);
  await page.keyboard.press("ArrowDown");
  const selected = await page
    .locator(
      '.cm-tooltip-autocomplete [aria-selected="true"] .cm-completionLabel',
    )
    .textContent();
  await expect(body).toHaveAttribute("data-focused-signal", selected!);
  await output.hover();
  await expect(body).toHaveAttribute("data-focused-signal", "v(out)");
  await page.keyboard.press("Escape");
  await expect(body).toHaveAttribute("data-focused-signal", "");
  await editor.fill("* test\n.control\nsave v(out)");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(body).toHaveAttribute("data-focused-signal", "v(out)");
  await editor.blur();
  await expect(body).toHaveAttribute("data-focused-signal", "");
  await editor.fill("* test\n.control\ndc");
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await expect(
    page.getByRole("option").filter({ hasText: "VBIAS" }),
  ).toBeVisible();
});

test("Helper finds commands by purpose, Tab fills ghost arguments that never reach saved source, and the Spec entry writes the language's comment", async ({
  page,
}) => {
  const editor = sourceEditor(page);
  const trigger = page.getByRole("button", { name: /Helper/ }).first();
  const popup = page.getByRole("dialog", { name: "Insert / Helper" });
  const ghost = page.locator(".simulation-parameter-ghost");
  // The trigger toggles a compact popup closed; so does Escape.
  await trigger.click();
  await expect(popup).toBeVisible();
  expect((await popup.boundingBox())!.width).toBeLessThanOrEqual(400);
  await trigger.click();
  await expect(popup).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  // Unknown input offers help explicitly.
  await editor.fill("* test\n.control\n频响");
  await expect(
    page.getByRole("button", { name: "Find a helper…" }),
  ).toBeVisible();
  await page.keyboard.press("Control+Space");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  // A purpose finds the analysis; Tab moves through its ghost arguments.
  await editor.fill("* test\n.control\n");
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("频响");
  await page.getByRole("option").click();
  await expect(ghost).toContainText("dec|oct|lin");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify("* test\r\n.control\r\nac "),
  );
  await page.keyboard.insertText("dec");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("20");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("10");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("1M");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("saved-source")).toHaveText(
    JSON.stringify("* test\r\n.control\r\nac dec 20 10 1M"),
  );
  // Escape suppresses the ghosts for the rest of the line.
  await editor.fill("* test\n.control\nac ");
  await expect(ghost).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
  await page.keyboard.insertText("dec");
  await expect(ghost).toHaveCount(0);
  // SPICE uses `*` line comments for `@spec` annotations.
  await editor.fill("* test\n.control\nmeas tran peak MAX v(out)");
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("spec");
  await page.getByRole("option", { name: "Spec acceptance rule…" }).click();
  await page.keyboard.insertText("peak");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("saved-source")).toContainText(
    "* @spec peak <= 1 unit=V",
  );
  await expect(editor).toContainText("meas tran peak MAX v(out)");
});

test("diagnostics stay on their line: an invalid Spec before any run, invalid text that stays editable and saveable", async ({
  page,
}) => {
  const editor = sourceEditor(page);
  // The run's parser checks the annotation as it is written (#1311).
  await editor.fill("Wien bridge\n* @spec per10 range 9.0ms 11.1ms unit=s\n");
  await page.locator(".cm-lintRange").first().hover();
  await expect(page.locator(".cm-tooltip-lint")).toContainText(
    'Bound "9.0ms" is not a decimal or scientific number or one with a SPICE suffix (f p n u m k meg g t); write 9.0e-3.',
  );
  await editor.fill("* test\n.control\nac dec 10\n.endc\n");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByTestId("saved-source")).toContainText("ac dec 10");
  await editor.fill("* test\n.control\nac dec 10 10 1M\n.endc\n");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
});

test("Explorer opens sideways, configuration is advanced, and results maximize/restore without a new fixed panel", async ({
  page,
}) => {
  const editor = sourceEditor(page);
  const before = await editor.boundingBox();
  await expect(page.getByRole("tab", { name: "Configuration" })).toHaveCount(0);
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  const files = page.getByRole("complementary", { name: "Simulation files" });
  await expect(files).toBeVisible();
  const after = await editor.boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.x - before!.x).toBeGreaterThan(100);
  await openExperimentJson(page);
  await expect(
    page.getByRole("tab", { name: "Configuration" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText('"version"');
  await page.getByRole("tab", { name: "Specs", exact: true }).click();
  await page.getByRole("button", { name: "Maximize results" }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.locator(".simulation-spec-results")).toBeVisible();
  await page.getByRole("button", { name: "Restore results" }).click();
  await expect(editor).toBeVisible();
  await expect(files).toBeVisible();
});

test("edits, saves and undoes exact source bytes through Ctrl+S or Save source, keeping a save boundary and readonly generated text", async ({
  page,
}) => {
  const editor = sourceEditor(page);
  const draftSource = page.getByTestId("draft-source");
  const savedSource = page.getByTestId("saved-source");
  const original = JSON.parse((await draftSource.textContent())!);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("// edited");
  await expect(draftSource).toHaveText(JSON.stringify(original + "// edited"));
  await page.keyboard.press("ControlOrMeta+z");
  await expect(draftSource).toHaveText(JSON.stringify(original));
  const redoShortcut = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta+Shift+z" : "Control+y",
  );
  await page.keyboard.press(redoShortcut);
  await expect(draftSource).toHaveText(JSON.stringify(original + "// edited"));
  await page.keyboard.press("ControlOrMeta+s");
  await expect(savedSource).toHaveText(JSON.stringify(original + "// edited"));
  await page.keyboard.press("ControlOrMeta+z");
  await expect(draftSource).toHaveText(JSON.stringify(original + "// edited"));
  // The button saves the same current source as the shortcut.
  await editor.fill("* saved by button\ncontrol\nendc\n");
  await expect(draftSource).toContainText("saved by button");
  const draft = await draftSource.textContent();
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(savedSource).toHaveText(draft!);
  await page.getByRole("tab", { name: /circuit.spice/ }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

test("file switching preserves caret, selection, scroll and local Undo history", async ({
  page,
}) => {
  const editor = sourceEditor(page);
  const long =
    "* file navigation\n" +
    Array.from({ length: 90 }, (_, i) => `// line ${i}\n`).join("");
  await editor.fill(long);
  const beforeEdit = (await page.getByTestId("draft-source").textContent())!;
  // Seed a committed file so Undo checks the later edit, independently of
  // whether CodeMirror groups two rapid input events into one history entry.
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByTestId("saved-source")).toHaveText(beforeEdit);
  await editor.focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End",
  );
  await page.keyboard.insertText("// preserve this selection");
  await page.keyboard.press("Control+Shift+ArrowLeft");
  const position = await page.getByTestId("source-cursor").textContent();
  const selection = await page.evaluate(() =>
    window.getSelection()?.toString(),
  );
  const scroller = page.locator(".cm-scroller");
  const scroll = await scroller.evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(100);
  await openExperimentJson(page);
  await editor.fill('{"version":1,"different":true}');
  await page.getByRole("tab", { name: "run.cir" }).click();
  await expect(editor).toBeFocused();
  await editor.focus();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeCloseTo(scroll, 0);
  expect(await page.getByTestId("source-cursor").textContent()).toBe(position);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    selection,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("draft-source")).toHaveText(beforeEdit);
});

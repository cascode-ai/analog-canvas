import { expect, test } from "@playwright/test";

test("native postprocessor Helper inserts editable report source and preserves undo/save", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("Native reports\n");
  const before = await page.getByTestId("draft-source").textContent();
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("embed");
  await page.getByRole("option").click();
  await expect(editor).toContainText('embed "reports.py" <<<ICM_REPORTS');
  await expect(editor).toContainText("def report_measurement(");
  await expect(editor).toContainText("def report_plot(");
  const inserted = await page.getByTestId("draft-source").textContent();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("draft-source")).toHaveText(before!);
  await page.keyboard.press(
    await page.evaluate(() =>
      /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta+Shift+z" : "Control+y",
    ),
  );
  await expect(page.getByTestId("draft-source")).toHaveText(inserted!);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("saved-source")).toHaveText(inserted!);
  await editor.fill("Native reports\ncontrol\n");
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("postprocess");
  await page.getByRole("option").click();
  await expect(editor).toContainText('postprocess(PYTHON, "reports.py")');
});

test("source Helper writes native model and instance skeletons with no electrical defaults", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("Native source helper\n");
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("voltage source");
  await page.getByRole("option").click();
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(
      "Native source helper\r\nmodel __vsource1 vsource\r\nV1 () __vsource1 dc=",
    ),
  );
  await page.keyboard.insertText("in 0");
  await page.keyboard.press("End");
  await page.keyboard.insertText("1.8");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("saved-source")).toHaveText(
    JSON.stringify(
      "Native source helper\r\nmodel __vsource1 vsource\r\nV1 (in 0) __vsource1 dc=1.8",
    ),
  );
});

test("Specs clears source Canvas preview without changing authored source", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\ncontrol\nsave v(out)");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("body")).toHaveAttribute(
    "data-focused-signal",
    "v(out)",
  );
  await page.getByRole("tab", { name: "Specs", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-focused-signal", "");
  await expect(
    page.getByRole("region", { name: "Specification results" }),
  ).toBeVisible();
  await expect(editor).toContainText("save v(out)");
});

test("native save and dc arguments open automatically and preview their Canvas target", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\ncontrol\nsave");
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
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
  await expect(page.locator("body")).toHaveAttribute(
    "data-focused-signal",
    selected!,
  );
  await output.hover();
  await expect(page.locator("body")).toHaveAttribute(
    "data-focused-signal",
    "v(out)",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-focused-signal", "");
  await editor.fill("* test\ncontrol\nsave v(out)");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("body")).toHaveAttribute(
    "data-focused-signal",
    "v(out)",
  );
  await editor.blur();
  await expect(page.locator("body")).toHaveAttribute("data-focused-signal", "");
  await editor.fill("* test\ncontrol\nsweep bias instance=");
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await expect(
    page.getByRole("option").filter({ hasText: "VBIAS" }),
  ).toBeVisible();
});

test("flat Helper finds an analysis by purpose and ghost arguments never enter saved source", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\ncontrol\n");
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("频响");
  await page.getByRole("option").click();
  await expect(page.locator(".simulation-parameter-ghost")).toContainText(
    "from=start Hz",
  );
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify("* test\r\ncontrol\r\nanalysis ac1 ac "),
  );
  await page.keyboard.insertText("from=10");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("to=1M");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText('mode="dec"');
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("points=20");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("saved-source")).toHaveText(
    JSON.stringify(
      '* test\r\ncontrol\r\nanalysis ac1 ac from=10 to=1M mode="dec" points=20',
    ),
  );
});

test("Spec Helper inserts an ordinary editable source comment", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
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

test("unknown input offers explicit help and Escape suppresses parameter ghosts", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\ncontrol\n频响");
  await expect(
    page.getByRole("button", { name: "Find a helper…" }),
  ).toBeVisible();
  await page.keyboard.press("Control+Space");
  await expect(
    page.getByRole("dialog", { name: "Insert / Helper" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.fill("* test\ncontrol\nanalysis ac1 ac ");
  await expect(page.locator(".simulation-parameter-ghost")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".simulation-parameter-ghost")).toHaveCount(0);
  await page.keyboard.insertText("dec");
  await expect(page.locator(".simulation-parameter-ghost")).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  await page.route("**/code-component-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><script type="module">
        import RefreshRuntime from "/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const { mountSimulationCodeHarness } = await import("/e2e/helpers/simulation-code-harness.tsx");
        mountSimulationCodeHarness();
      </script></body></html>`,
    }),
  );
  await page.goto("/code-component-check");
  await expect(
    page.getByRole("textbox", { name: "Simulation source editor" }),
  ).toBeVisible();
});

test("Explorer opens sideways, configuration is advanced, and results maximize/restore without a new fixed panel", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const before = await editor.boundingBox();
  await expect(page.getByRole("tab", { name: "Configuration" })).toHaveCount(0);
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Simulation files" }),
  ).toBeVisible();
  const after = await editor.boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.x - before!.x).toBeGreaterThan(100);
  if (
    (await page
      .getByRole("button", { name: "Explorer", exact: true })
      .getAttribute("aria-expanded")) !== "true"
  )
    await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "experiment.json", exact: true })
    .first()
    .click();
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
  await expect(
    page.getByRole("complementary", { name: "Simulation files" }),
  ).toBeVisible();
});

test("edits, saves and undoes exact source bytes while keeping a save boundary and readonly generated text", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const original = JSON.parse(
    (await page.getByTestId("draft-source").textContent())!,
  );
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("// edited");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "// edited"),
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original),
  );
  const redoShortcut = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta+Shift+z" : "Control+y",
  );
  await page.keyboard.press(redoShortcut);
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "// edited"),
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("saved-source")).toHaveText(
    JSON.stringify(original + "// edited"),
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "// edited"),
  );
  await page.getByRole("tab", { name: /circuit.spice/ }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

test("Save source button and Ctrl+S apply the same current-project source", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const save = page.getByRole("button", { name: "Save source" });
  await editor.fill("* saved by button\ncontrol\nendc\n");
  await expect(page.getByTestId("draft-source")).toContainText(
    "saved by button",
  );
  const firstDraft = await page.getByTestId("draft-source").textContent();
  await save.click();
  await expect(page.getByTestId("saved-source")).toContainText(
    "saved by button",
  );
  await expect(page.getByTestId("saved-source")).toHaveText(firstDraft!);

  await editor.fill("* saved by shortcut\ncontrol\nendc\n");
  await expect(page.getByTestId("draft-source")).toContainText(
    "saved by shortcut",
  );
  const secondDraft = await page.getByTestId("draft-source").textContent();
  await save.press("ControlOrMeta+s");
  await expect(page.getByTestId("saved-source")).toContainText(
    "saved by shortcut",
  );
  await expect(page.getByTestId("saved-source")).toHaveText(secondDraft!);
});

test("invalid text stays editable and saveable and known command errors are inline diagnostics", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\ncontrol\nanalysis\nendc\n");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByTestId("saved-source")).toContainText("analysis");
  await editor.fill(
    "* test\ncontrol\nanalysis response tran step=1n stop=10u\nendc\n",
  );
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
});

test("Helper trigger toggles closed and stays compact", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /Helper/ }).first();
  await trigger.click();
  const popup = page.getByRole("dialog", { name: "Insert / Helper" });
  await expect(popup).toBeVisible();
  expect((await popup.boundingBox())!.width).toBeLessThanOrEqual(400);
  await trigger.click();
  await expect(popup).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
});

test("file switching preserves caret, selection, scroll and local Undo history", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
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
  if (
    (await page
      .getByRole("button", { name: "Explorer", exact: true })
      .getAttribute("aria-expanded")) !== "true"
  )
    await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "experiment.json", exact: true })
    .first()
    .click();
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

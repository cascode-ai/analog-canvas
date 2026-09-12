import { expect, test } from "@playwright/test";

test("native save result focuses its captured Canvas address after code preview ends", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\n.control\nsave v(out)");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("body")).toHaveAttribute(
    "data-focused-signal",
    "v(out)",
  );
  await page.getByRole("tab", { name: "Plot", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-focused-signal", "");
  await page.getByRole("button", { name: "Hide Output", exact: true }).click();
  await page.getByRole("button", { name: "Show Output", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-chart-target",
    JSON.stringify({
      id: "native:v(out)",
      kind: "voltage",
      rootDocumentId: "root",
      documentId: "child",
      occurrence: ["dut"],
      anchor: { kind: "base-net", netId: "output-net" },
    }),
  );
});

test("native save and dc arguments open automatically and preview their Canvas target", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\n.control\nsave");
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  const output = page.getByRole("option").filter({ hasText: "v(out)" });
  await expect(output).toBeVisible();
  await expect(
    page.getByRole("option").filter({ hasText: /v\(out\)/i }),
  ).toHaveCount(1);
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
  await editor.fill("* test\n.control\nsave v(out)");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("body")).toHaveAttribute(
    "data-focused-signal",
    "v(out)",
  );
  await editor.blur();
  await expect(page.locator("body")).toHaveAttribute("data-focused-signal", "");
  await editor.fill("* test\n.control\ndc");
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
  await editor.fill("* test\n.control\n");
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("频响");
  await page.getByRole("option").click();
  await expect(page.locator(".simulation-parameter-ghost")).toContainText(
    "dec|oct|lin",
  );
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify("* test\r\n.control\r\nac "),
  );
  await page.keyboard.insertText("dec");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("20");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("10");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("1G");
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("saved-source")).toHaveText(
    JSON.stringify("* test\r\n.control\r\nac dec 20 10 1G"),
  );
});

test("unknown input offers explicit help and Escape suppresses parameter ghosts", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\n.control\n频响");
  await expect(
    page.getByRole("button", { name: "Find a helper…" }),
  ).toBeVisible();
  await page.keyboard.press("Control+Space");
  await expect(
    page.getByRole("dialog", { name: "Insert / Helper" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.fill("* test\n.control\nac ");
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
  await page.getByRole("tab", { name: "Plot", exact: true }).click();
  await page.getByRole("button", { name: "Maximize results" }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.locator(".simulation-output-results")).toBeVisible();
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
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("* edited");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original),
  );
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("saved-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.getByRole("tab", { name: /circuit.spice/ }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

test("invalid text stays editable and saveable and known command errors are inline diagnostics", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\n.control\ntran\n.endc\n.end\n");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByTestId("saved-source")).toContainText("tran");
  await editor.fill("* test\n.control\ntran 1n 10u\n.endc\n.end\n");
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
    Array.from({ length: 90 }, (_, i) => `* line ${i}\n`).join("");
  await editor.fill(long);
  const beforeEdit = (await page.getByTestId("draft-source").textContent())!;
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("* preserve this selection");
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
  await editor.focus();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeCloseTo(scroll, 0);
  expect(await page.getByTestId("source-cursor").textContent()).toBe(position);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    selection,
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("draft-source")).toHaveText(beforeEdit);
});
